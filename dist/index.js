// src/index.ts
import { defineExtension, h as h3 } from "@muclient/sdk";

// src/copy.ts
var COPY = {
  mapTitle: "System map",
  navTitle: "Navigation",
  settingsTitle: "Navcomp",
  settingTerritory: "Faction territory on the map",
  settingTraffic: "Ships on the map",
  settingTrafficHint: "admins see every ship; pilots their own and sensor contacts",
  // empty states
  waiting: "Waiting for navcomp",
  noConsole: "Sit at a powered pilot console",
  scrambled: "Console scrambled",
  noSession: "No session",
  // map bar and foot
  territory: "Territory",
  traffic: "Ships",
  list: "List",
  now: "Now",
  ship: "Ship",
  live: "live",
  warp: (label) => `warp ${label}`,
  modeAdmin: "admin \xB7 all traffic",
  modePilot: (who) => `pilot \xB7 ${who}`,
  hintMap: "drag to pan \xB7 scroll to zoom \xB7 click a body",
  icClock: "IC",
  zoomIn: "zoom in",
  zoomOut: "zoom out",
  resetView: "reset view",
  frames: "frames",
  inFrame: "In frame",
  nothingInFrame: "Nothing in this frame",
  // detail
  close: "Close",
  enterFrame: "Enter frame",
  plotCourse: "Plot course",
  pass: "Pass",
  kind: { star: "star", planet: "planet", moon: "moon", belt: "minor body", station: "station", site: "landing site", ship: "ship", body: "body" },
  fType: "Type",
  fParent: "Orbits",
  fOn: "On",
  fRadius: "Radius",
  fSemi: "Orbit",
  fEcc: "Ecc.",
  fPeriod: "Period",
  fSpace: "Space of",
  fOwner: "Owner",
  fReach: "Reach",
  fHull: "Hull",
  fSpeed: "Speed",
  fState: "State",
  fBound: "Bound for",
  fRange: "Range",
  fStations: "Stations",
  fSites: "Landing sites",
  burning: "under thrust",
  coasting: "coasting",
  independent: "independent",
  you: "you",
  retro: "retrograde",
  // nav panel
  hShip: "Ship",
  hCourse: "Flight plan",
  hUnderWay: "Under way",
  hBurn: "Burn",
  hTarget: "Plot a course",
  orbiting: "Orbiting",
  course: "Course",
  comms: "Comms",
  alt: "alt",
  maneuver: "Maneuver",
  distance: "Distance",
  eta: "ETA",
  arrival: "Arrival",
  passIn: "Pass in",
  fuel: "Propellant",
  closing: "Closing",
  passSpeed: "Pass speed",
  route: "Route",
  via: (body) => `via ${body}`,
  phase: "Phase",
  progress: "Progress",
  replan: "Replan",
  noCourse: "No course plotted",
  lostTarget: (name) => `${name} is no longer on sensors`,
  execute: "Execute",
  executeAnyway: "Execute anyway",
  cancel: "Cancel",
  abort: "Abort burn",
  setBurn: "Set",
  burnLabel: "Burn rating",
  burnRange: (min, max) => `${min} \u2013 ${max}`,
  combat: "Combat",
  combatNote: "nav locked in combat \xB7 use helm",
  crippled: "Crippled",
  filter: "filter targets",
  contacts: "Contacts",
  destinations: "Destinations",
  bodies: "Bodies",
  orbitLow: "Orbit low",
  orbitHigh: "Orbit high",
  leave: "Leave orbit",
  noMatch: "No matching target",
  confirmNeeded: "warnings \xB7 execute anyway to burn",
  blocked: "blocked",
  sent: (cmd) => `sent ${cmd}`,
  onMap: "show on map",
  // commands (the console's grammar)
  cmd: {
    target: (name) => `=nav ${name}`,
    pass: (name) => `=nav pass ${name}`,
    orbit: (alt) => `=nav orbit ${alt}`,
    leave: "=nav leave",
    burn: (g) => `=nav burn ${g.toFixed(2)}`,
    execute: "=nav execute",
    confirm: "=nav execute confirm",
    abort: "=nav abort",
    cancel: "=nav cancel"
  }
};

// src/orbit.ts
var AU_M = 149597870700;
var AU_KM = AU_M / 1e3;
var LY_AU = 63241.077;
var TWO_PI = Math.PI * 2;
function meanMotion(o, mu) {
  const a = Math.abs(o.a) * AU_M;
  const n = Math.sqrt(mu / (a * a * a));
  return (o.dir ?? 1) < 0 ? -n : n;
}
function solveKepler(M2, e) {
  let E = e < 0.8 ? M2 : Math.PI;
  for (let i = 0; i < 100; i++) {
    const step = (E - e * Math.sin(E) - M2) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
}
function localPos(o, mu, t) {
  let M2 = (o.M0 + meanMotion(o, mu) * (o.rate || 1) * (t - o.ep)) % TWO_PI;
  if (M2 < 0) M2 += TWO_PI;
  const E = solveKepler(M2, o.e);
  const nu = Math.atan2(Math.sqrt(1 - o.e * o.e) * Math.sin(E), Math.cos(E) - o.e);
  const r = o.a * (1 - o.e * Math.cos(E));
  const th = o.om + nu;
  return { x: r * Math.cos(th), y: r * Math.sin(th) };
}
function orbitSpeed(o, mu, t) {
  const a = Math.abs(o.a) * AU_M;
  const p = localPos(o, mu, t);
  const r = Math.hypot(p.x, p.y) * AU_M || a;
  return Math.sqrt(Math.max(0, mu * (2 / r - 1 / a)));
}
function period(o, mu) {
  if (o.e >= 1 || o.a <= 0) return 0;
  const a = o.a * AU_M;
  return TWO_PI * Math.sqrt(a * a * a / mu);
}
function ellipse(o, steps = 128) {
  const out = [];
  const p = o.a * (1 - o.e * o.e);
  for (let i = 0; i <= steps; i++) {
    const nu = i / steps * TWO_PI;
    const r = p / (1 + o.e * Math.cos(nu));
    out.push({ x: r * Math.cos(o.om + nu), y: r * Math.sin(o.om + nu) });
  }
  return out;
}
var n0 = (v, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
function fmtDist(au) {
  if (!Number.isFinite(au)) return "\u2014";
  const km = Math.abs(au) * AU_KM;
  if (km < 1e6) return `${n0(km)} km`;
  if (Math.abs(au) < LY_AU) return `${n0(au, Math.abs(au) < 10 ? 3 : 2)} AU`;
  return `${n0(au / LY_AU, 2)} ly`;
}
function fmtDur(s) {
  if (!Number.isFinite(s) || s < 0) return "\u2014";
  s = Math.round(s);
  const d = Math.floor(s / 86400), h4 = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  if (d) return `${d}d ${h4}h`;
  if (h4) return `${h4}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function fmtIC(ic) {
  if (!Number.isFinite(ic)) return "\u2014";
  const d = new Date(ic * 1e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
var fmtKms = (v) => Number.isFinite(v) ? `${n0(v, 2)} km/s` : "\u2014";
var fmtG = (g) => Number.isFinite(g) ? `${g.toFixed(2)} G` : "\u2014";

// src/model.ts
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var str = (v) => typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
var ref = (v) => {
  const s = str(v);
  return s === "#-1" || s === "-1" ? "" : s.replace(/^#/, "");
};
var num = (v, d = 0) => typeof v === "number" && Number.isFinite(v) ? v : d;
var bool = (v) => v === true || v === 1;
var strs = (v) => Array.isArray(v) ? v.map(str).filter(Boolean) : [];
var vec = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" ? { x: v[0], y: v[1] } : null;
function elementsOf(v) {
  if (!isObj(v) || typeof v.a !== "number" || typeof v.e !== "number") return null;
  const o = { a: v.a, e: v.e, om: num(v.om), M0: num(v.M0), ep: num(v.ep), rate: num(v.rate, 1) };
  if (typeof v.dir === "number" && v.dir < 0) o.dir = -1;
  return o;
}
var factionsOf = (v) => (Array.isArray(v) ? v.map(str) : [str(v)]).filter(Boolean);
var TYPES = ["star", "planet", "moon", "belt"];
function catalogOf(d) {
  if (!isObj(d) || !bool(d.active) || !Array.isArray(d.bodies)) return null;
  const bodies = /* @__PURE__ */ new Map(), stations = /* @__PURE__ */ new Map(), sites = /* @__PURE__ */ new Map(), factions = /* @__PURE__ */ new Map();
  for (const b of d.bodies) {
    if (!isObj(b) || !str(b.id)) continue;
    const inf = isObj(b.influence) && typeof b.influence.Rsys === "number" && b.influence.Rsys > 0 ? { factions: factionsOf(b.influence.faction), r: b.influence.Rsys } : null;
    const type = TYPES.includes(b.type) ? b.type : "moon";
    bodies.set(str(b.id), { kind: "body", id: str(b.id), name: str(b.name) || str(b.id), type, parent: ref(b.parent) || null, o: elementsOf(b.o), mu: num(b.mu, 1), r_km: num(b.r_km), featured: bool(b.featured), influence: inf && inf.factions.length ? inf : null });
  }
  for (const s of Array.isArray(d.stations) ? d.stations : []) {
    if (!isObj(s) || !str(s.id) || !ref(s.parent)) continue;
    const owner = ref(s.owner);
    const r = num(s.influence_au);
    stations.set(str(s.id), { kind: "station", id: str(s.id), name: str(s.name) || str(s.id), parent: ref(s.parent), o: elementsOf(s.o), owner, blurb: str(s.blurb), influence: owner && r > 0 ? { factions: [owner], r } : null });
  }
  for (const s of Array.isArray(d.landing_sites) ? d.landing_sites : []) {
    if (!isObj(s) || !str(s.id) || !ref(s.parent)) continue;
    sites.set(str(s.id), { kind: "site", id: str(s.id), name: str(s.name) || str(s.id), parent: ref(s.parent), owner: ref(s.owner), blurb: str(s.blurb) });
  }
  for (const f of Array.isArray(d.factions) ? d.factions : []) {
    if (isObj(f) && str(f.id)) factions.set(str(f.id), { id: str(f.id), name: str(f.name) || str(f.id), color: /^#[0-9a-f]{6}$/i.test(str(f.color)) ? str(f.color) : "" });
  }
  const rootId = ref(d.root_id) || [...bodies.values()].find((b) => !b.parent)?.id || "";
  if (!rootId || !bodies.has(rootId)) return null;
  return { admin: bool(d.admin), now: num(d.now), ic: num(d.ic), rate: num(d.rate, 1) || 1, rootId, bodies, stations, sites, factions };
}
function trafficOf(d) {
  if (!isObj(d) || !Array.isArray(d.vessels)) return null;
  const vessels = [];
  for (const v of d.vessels) {
    if (!isObj(v) || !str(v.id)) continue;
    const pos = vec(v.pos), vel = vec(v.vel);
    if (!pos) continue;
    vessels.push({ kind: "ship", id: str(v.id), name: str(v.name) || str(v.id), hull: str(v.hull), parent: ref(v.parent) || null, o: elementsOf(v.o), pos, vel: vel ?? { x: 0, y: 0 }, burning: bool(v.burning), target: ref(v.target), self: bool(v.self) });
  }
  return { admin: bool(d.admin), now: num(d.now), ic: num(d.ic), rate: num(d.rate, 1) || 1, vessels };
}
var KINDS = ["body", "station", "ship"];
var contactsOf = (v) => (Array.isArray(v) ? v : []).filter(isObj).map((c) => ({ id: str(c.id), name: str(c.name), kind: KINDS.includes(str(c.kind)) ? str(c.kind) : "ship", dist_au: num(c.dist_au, NaN) })).filter((c) => c.name);
function planOf(v) {
  if (!isObj(v)) return null;
  const t = isObj(v.target) ? v.target : {};
  const target = { id: str(t.id), name: str(t.name), kind: str(t.kind) };
  const opt = (x) => typeof x === "number" && Number.isFinite(x) ? x : null;
  return {
    lost: bool(v.lost),
    target,
    mode: str(v.mode),
    maneuver: str(v.maneuver),
    g: num(v.g),
    dist_m: num(v.dist_m, NaN),
    errors: strs(v.errors),
    warnings: strs(v.warnings),
    confirm: bool(v.confirm),
    blocked: bool(v.blocked),
    pass: bool(v.pass),
    pct: num(v.pct, NaN),
    alt_m: opt(v.alt_m),
    route: str(v.route),
    closing_kms: opt(v.closing_kms),
    eta: opt(v.eta),
    vp_kms: opt(v.vp_kms),
    aim: vec(v.aim),
    waypoint: vec(v.waypoint)
  };
}
function underWayOf(v) {
  if (!isObj(v)) return null;
  const t = isObj(v.target) ? v.target : {};
  return { target: { id: str(t.id), name: str(t.name) }, maneuver: str(v.maneuver), phase: str(v.phase), label: str(v.label), frac: Math.min(1, Math.max(0, num(v.frac))), eta: num(v.eta), g: num(v.g), pass: bool(v.pass), route: str(v.route), replan: str(v.replan), warnings: strs(v.warnings), aim: vec(v.aim) };
}
function navOf(d) {
  if (!isObj(d) || !bool(d.active)) return null;
  const ship = isObj(d.ship) ? d.ship : {};
  const ob = isObj(d.orbit) ? d.orbit : {};
  const burn = isObj(d.burn) ? d.burn : {};
  const orbit = str(ob.body) ? { body: str(ob.body), body_id: str(ob.body_id), alt_km: num(ob.alt_km), v_kms: num(ob.v_kms), period: typeof ob.period === "number" ? ob.period : null, course: str(ob.course) } : { body: "", course: str(ob.course) };
  return {
    active: true,
    console: str(d.console),
    ship: { id: str(ship.id), name: str(ship.name), squawk: str(ship.squawk) },
    scrambled: strs(d.scrambled),
    pos: vec(d.pos),
    vel: vec(d.vel),
    orbit,
    contacts: contactsOf(d.contacts),
    destinations: contactsOf(d.destinations),
    burn: { g: num(burn.g, 1), min: num(burn.min, 0.01), max: num(burn.max, 1), rating: num(burn.rating, 1) },
    combat: bool(d.combat),
    crippled: strs(d.crippled),
    comms: str(d.comms),
    coast: strs(d.coast),
    plan: planOf(d.plan),
    under_way: underWayOf(d.under_way)
  };
}
function tagOf(line) {
  const m = /^\s*\[([A-Z ]+)\]\s*(.*)$/.exec(line);
  return m ? { tag: m[1].trim(), text: m[2] } : { tag: "", text: line.trim() };
}
function posOf(cat, thing, t, memo) {
  const hit = memo?.get(thing.id);
  if (hit) return hit;
  let p;
  if (thing.kind === "site") p = posOf(cat, cat.bodies.get(thing.parent) ?? cat.bodies.get(cat.rootId), t, memo);
  else {
    const parent = thing.parent ? cat.bodies.get(thing.parent) : void 0;
    if (!parent || !thing.o) p = parent ? posOf(cat, parent, t, memo) : { x: 0, y: 0 };
    else {
      const base = posOf(cat, parent, t, memo);
      const l = localPos(thing.o, parent.mu, t);
      p = { x: base.x + l.x, y: base.y + l.y };
    }
  }
  memo?.set(thing.id, p);
  return p;
}
function vesselPos(cat, v, t, sentAt, memo) {
  const parent = v.parent && cat ? cat.bodies.get(v.parent) : void 0;
  if (!v.burning && v.o && parent && cat) {
    const base = posOf(cat, parent, t, memo);
    const l = localPos(v.o, parent.mu, t);
    return { x: base.x + l.x, y: base.y + l.y };
  }
  const dt = t - sentAt;
  return { x: v.pos.x + v.vel.x * dt / AU_M, y: v.pos.y + v.vel.y * dt / AU_M };
}
function chainOf(cat, id) {
  const out = [];
  let cur = cat.bodies.get(id);
  for (let guard = 0; cur && guard < 16; guard++) {
    out.unshift(cur);
    cur = cur.parent ? cat.bodies.get(cur.parent) : void 0;
  }
  return out;
}
var childBodies = (cat, id) => [...cat.bodies.values()].filter((b) => b.parent === id);
var frameStations = (cat, id) => [...cat.stations.values()].filter((s) => s.parent === id);
var frameSites = (cat, id) => [...cat.sites.values()].filter((s) => s.parent === id);
var hasFrame = (cat, id) => childBodies(cat, id).length > 0 || frameStations(cat, id).length > 0 || frameSites(cat, id).length > 0;
function frameExtent(cat, id, vessels = []) {
  let m = 0;
  for (const b of childBodies(cat, id)) if (b.o) m = Math.max(m, b.o.a * (1 + b.o.e));
  for (const s of frameStations(cat, id)) if (s.o) m = Math.max(m, s.o.a * (1 + s.o.e));
  for (const v of vessels) if (v.parent === id && v.o && !v.burning) m = Math.max(m, v.o.a * (1 + Math.min(v.o.e, 0.99)));
  if (!m) {
    const b = cat.bodies.get(id);
    m = b ? Math.max(b.r_km * 1e3 * 8 / AU_M, 1e-5) : 1;
  }
  return m;
}
var frameOfVessel = (cat, v) => !v.burning && v.parent && cat.bodies.has(v.parent) ? v.parent : cat.rootId;

// src/map.ts
import { h } from "@muclient/sdk";
var WARPS = [[0, "1\xD7"], [60, "1m/s"], [3600, "1h/s"], [86400, "1d/s"], [86400 * 30, "30d/s"]];
var COMPRESS = 0.42;
var TAU = Math.PI * 2;
var wall = () => Date.now() / 1e3;
function projector(center, extent, w, h4, zoom, pan) {
  const R2 = Math.max(40, Math.min(w, h4) / 2 - 34);
  const cx = w / 2 + pan.x, cy = h4 / 2 + pan.y;
  return (p) => {
    const dx = p.x - center.x, dy = p.y - center.y;
    const r = Math.hypot(dx, dy);
    if (!r) return { x: cx, y: cy };
    const pr = Math.pow(r / extent, COMPRESS) * R2 * zoom;
    return { x: cx + pr * dx / r, y: cy - pr * dy / r };
  };
}
var MapView = class {
  constructor(deps) {
    this.deps = deps;
    const css = deps.css;
    const tog = (label, on, testid, fn) => h("button", { class: css.toggle, type: "button", "aria-pressed": String(on), "data-testid": testid, onclick: fn }, label);
    const cmd = (label, testid, fn, title = "") => h("button", { class: css.cmd, type: "button", "data-testid": testid, title, onclick: fn }, label);
    this.crumbs = h("nav", { class: "crumbs", "aria-label": COPY.frames, "data-testid": "nc-crumbs" });
    this.terrBtn = tog(COPY.territory, deps.pref("territory"), "nc-territory", () => {
      deps.setPref("territory", !deps.pref("territory"));
      this.refresh();
    });
    this.shipsBtn = tog(COPY.traffic, deps.pref("traffic"), "nc-traffic", () => {
      deps.setPref("traffic", !deps.pref("traffic"));
      this.refresh();
    });
    this.listBtn = tog(COPY.list, false, "nc-list", () => {
      this.showList = !this.showList;
      if (this.showList) this.sel = "";
      this.refresh();
    });
    this.shipBtn = cmd(COPY.ship, "nc-goto-ship", () => this.followShip(true));
    const zoomOut = cmd("\u2212", "nc-zoom-out", () => this.zoomBy(1 / 1.4), COPY.zoomOut);
    const zoomIn = cmd("+", "nc-zoom-in", () => this.zoomBy(1.4), COPY.zoomIn);
    const reset = cmd("\u21BA", "nc-reset", () => {
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.dirty = true;
    }, COPY.resetView);
    for (const b of [zoomOut, zoomIn, reset]) b.classList.add(css.sq ?? "sq");
    const bar = h("div", { class: "bar" }, this.crumbs, h("span", { class: "sp" }), this.shipBtn, this.terrBtn, this.shipsBtn, this.listBtn, zoomOut, zoomIn, reset);
    this.canvas = h("canvas", { class: "sky", tabindex: "0", role: "img", "aria-label": COPY.mapTitle, "data-testid": "nc-canvas" });
    this.ctx = (() => {
      try {
        return this.canvas.getContext("2d");
      } catch {
        return null;
      }
    })();
    this.side = h("aside", { class: "side", "data-testid": "nc-side", hidden: true });
    this.legend = h("div", { class: "legend", "data-testid": "nc-legend" });
    this.empty = h("p", { class: `${css.empty} awaiting`, "data-testid": "nc-empty" }, COPY.waiting);
    this.stage = h("div", { class: "stage" }, this.canvas, this.legend, this.empty, this.side);
    this.clock = h("span", { class: "clock", "data-testid": "nc-clock" }, "\u2014");
    this.warpEl = h("span", { class: "warp", "data-testid": "nc-warp" });
    this.modeEl = h("span", { class: "mode", "data-testid": "nc-mode" });
    const foot = h("div", { class: "foot" }, h("span", { class: css.label }, COPY.icClock), this.clock, this.warpEl, h("span", { class: "sp" }), this.modeEl, h("span", { class: "hint" }, COPY.hintMap));
    this.el = h("section", { class: "mu-navmap", "aria-label": COPY.mapTitle, "data-focus-region": "navcomp.map", tabindex: "-1", "data-testid": "navmap" }, bar, this.stage, foot);
    this.bindInput();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.stage);
    }
    this.refresh();
    if (typeof requestAnimationFrame !== "undefined") this.raf = requestAnimationFrame((ts) => this.loop(ts));
  }
  deps;
  el;
  canvas;
  ctx;
  side;
  crumbs;
  clock;
  warpEl;
  legend;
  modeEl;
  shipBtn;
  terrBtn;
  shipsBtn;
  listBtn;
  empty;
  stage;
  frame = "";
  sel = "";
  hover = "";
  showList = false;
  zoom = 1;
  pan = { x: 0, y: 0 };
  /** Game seconds per real second; 0 is live. */
  warp = 0;
  /** Simulated real-unix time while warping. */
  tSim = 0;
  last = 0;
  lastDraw = 0;
  dirty = true;
  raf = 0;
  dead = false;
  W = 0;
  H = 0;
  picks = [];
  ro = null;
  followed = false;
  sideKey = "";
  destroy() {
    this.dead = true;
    if (this.raf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.el.remove();
  }
  /** New data or prefs: fix the frame, redraw the DOM parts. */
  refresh() {
    const { cat } = this.deps.data();
    const css = this.deps.css;
    this.empty.hidden = !!cat;
    if (cat) {
      if (!this.frame || !cat.bodies.has(this.frame)) {
        this.frame = cat.rootId;
        this.followShip(false);
      }
      if (!this.followed && this.self()) this.followShip(false);
      if (this.sel && !this.thing(this.sel)) this.sel = "";
    }
    const on = (b, v) => b.setAttribute("aria-pressed", String(v));
    on(this.terrBtn, this.deps.pref("territory"));
    on(this.shipsBtn, this.deps.pref("traffic"));
    on(this.listBtn, this.showList);
    this.shipBtn.hidden = !this.self();
    this.renderCrumbs(cat);
    this.renderWarp();
    this.renderLegend(cat);
    this.renderSide();
    const { traffic, nav } = this.deps.data();
    this.modeEl.textContent = !cat ? "" : cat.admin ? COPY.modeAdmin : COPY.modePilot(nav?.ship.squawk || this.self()?.name || "");
    void traffic;
    this.dirty = true;
    void css;
  }
  /** Select a thing by id (from the nav panel): its frame, and its detail. */
  select(id) {
    const { cat } = this.deps.data();
    const t = this.thing(id);
    if (!cat || !t) return;
    this.frame = t.kind === "body" ? hasFrame(cat, t.id) ? t.id : t.parent ?? cat.rootId : t.kind === "ship" ? frameOfVessel(cat, t) : t.parent;
    this.sel = id;
    this.showList = false;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.refresh();
  }
  self() {
    return this.deps.data().traffic?.vessels.find((v) => v.self);
  }
  followShip(force) {
    const { cat } = this.deps.data();
    const me = this.self();
    if (!cat || !me) return;
    if (!force && this.followed) return;
    this.followed = true;
    this.frame = frameOfVessel(cat, me);
    if (force) {
      this.sel = me.id;
      this.showList = false;
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.refresh();
    }
  }
  thing(id) {
    const { cat, traffic } = this.deps.data();
    if (!cat) return void 0;
    return cat.bodies.get(id) ?? cat.stations.get(id) ?? cat.sites.get(id) ?? traffic?.vessels.find((v) => v.id === id);
  }
  // ─── time ────────────────────────────────────────────────────────────────────────────────────────────────
  /** Real-unix time the map shows. */
  now() {
    const { cat, catWall } = this.deps.data();
    if (!cat) return wall();
    const live = cat.now + (wall() - catWall);
    return this.warp ? this.tSim : live;
  }
  setWarp(w) {
    if (w && !this.warp) this.tSim = this.now();
    this.warp = w;
    this.renderWarp();
    this.dirty = true;
  }
  // ─── DOM parts ───────────────────────────────────────────────────────────────────────────────────────────
  renderCrumbs(cat) {
    const css = this.deps.css;
    if (!cat) {
      this.crumbs.replaceChildren();
      return;
    }
    const chain = chainOf(cat, this.frame);
    const extra = [...cat.bodies.values()].filter((b) => b.featured && !chain.includes(b));
    const me = this.self();
    const meFrame = me ? cat.bodies.get(frameOfVessel(cat, me)) : void 0;
    if (meFrame && !chain.includes(meFrame) && !extra.includes(meFrame)) extra.unshift(meFrame);
    const btn = (b, i, inChain) => {
      const n = frameStations(cat, b.id).length;
      return h(
        "button",
        { class: `${css.cmd} crumb`, type: "button", "data-testid": "nc-crumb", "data-id": b.id, "aria-current": b.id === this.frame ? "true" : void 0, "aria-pressed": String(b.id === this.frame), onclick: () => this.goFrame(b.id) },
        inChain && i ? h("span", { class: "sep", "aria-hidden": "true" }, "\u203A") : null,
        b.name,
        n ? h("span", { class: "n" }, `${n}\u25C6`) : null
      );
    };
    this.crumbs.replaceChildren(...chain.map((b, i) => btn(b, i, true)), ...extra.length ? [h("span", { class: "div", "aria-hidden": "true" }, "\xB7")] : [], ...extra.map((b) => btn(b, 0, false)));
  }
  goFrame(id) {
    this.frame = id;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    if (this.sel && this.sel !== id) {
      const t = this.thing(this.sel);
      if (t && t.kind !== "ship" && t.kind !== "body" && t.parent !== id) this.sel = "";
    }
    this.refresh();
  }
  renderWarp() {
    const css = this.deps.css;
    this.warpEl.replaceChildren(
      ...WARPS.map(([w, l]) => h("button", { class: css.toggle, type: "button", "aria-pressed": String(this.warp === w), "data-testid": "nc-warp-btn", "data-w": String(w), title: COPY.warp(l), onclick: () => this.setWarp(w) }, l)),
      h("button", { class: css.cmd, type: "button", "data-testid": "nc-now", disabled: this.warp ? void 0 : true, onclick: () => this.setWarp(0) }, COPY.now)
    );
  }
  renderLegend(cat) {
    const show = !!cat && this.deps.pref("territory") && this.frame === cat.rootId;
    this.legend.hidden = !show;
    if (!show || !cat) {
      this.legend.replaceChildren();
      return;
    }
    const used = /* @__PURE__ */ new Set();
    for (const b of cat.bodies.values()) for (const f of b.influence?.factions ?? []) used.add(f);
    for (const s of cat.stations.values()) for (const f of s.influence?.factions ?? []) used.add(f);
    this.legend.replaceChildren(...[...cat.factions.values()].filter((f) => used.has(f.id)).map((f) => h("span", { class: "lg", "data-testid": "nc-faction" }, h("i", { style: f.color ? `background:${f.color}` : "" }), f.name)));
  }
  renderSide() {
    const { cat, nav } = this.deps.data();
    const css = this.deps.css;
    const t = this.sel ? this.thing(this.sel) : void 0;
    const key = `${this.sel}|${this.showList}|${this.frame}|${!!nav}|${nav?.plan?.target.id ?? ""}|${nav?.under_way ? 1 : 0}|${this.deps.data().traffic?.vessels.length ?? 0}`;
    if (!cat || !t && !this.showList) {
      this.side.hidden = true;
      this.side.replaceChildren();
      this.sideKey = "";
      return;
    }
    if (key === this.sideKey && !this.side.hidden) return;
    this.sideKey = key;
    this.side.hidden = false;
    const close = h("button", { class: css.cmd, type: "button", "data-testid": "nc-close", onclick: () => {
      this.sel = "";
      this.showList = false;
      this.refresh();
      this.canvas.focus();
    } }, COPY.close);
    if (!t) {
      const rows = this.frameThings(cat).map((x) => h(
        "button",
        { class: `${css.row} item`, type: "button", "data-testid": "nc-item", "data-id": x.id, onclick: () => this.pick(x.id) },
        h("span", { class: "l1" }, h("span", { class: "nm" }, x.name), h("span", { class: `${css.plate} ${css.dim}` }, kindLabel(x)))
      ));
      this.side.replaceChildren(
        h("div", { class: "shead" }, h("div", { class: css.secHead, role: "heading", "aria-level": "3" }, COPY.inFrame, h("span", { class: css.secClose, "aria-hidden": "true" })), close),
        ...rows.length ? rows : [h("p", { class: `${css.empty} awaiting` }, COPY.nothingInFrame)]
      );
      return;
    }
    this.side.replaceChildren(...this.detail(cat, t, nav, close));
  }
  /** What the frame holds, for the list: bodies, stations, sites, ships. */
  frameThings(cat) {
    const out = [cat.bodies.get(this.frame), ...childBodies(cat, this.frame), ...frameStations(cat, this.frame), ...frameSites(cat, this.frame)];
    if (this.deps.pref("traffic")) out.push(...this.shipsInFrame(cat));
    return out.filter(Boolean);
  }
  shipsInFrame(cat) {
    const vs = this.deps.data().traffic?.vessels ?? [];
    const chain = new Set(chainOf(cat, this.frame).map((b) => b.id));
    return vs.filter((v) => {
      const f = frameOfVessel(cat, v);
      if (f === this.frame) return true;
      if (v.self) return chainOf(cat, f).some((b) => b.id === this.frame);
      return v.burning && this.frame === cat.rootId && chain.size > 0;
    });
  }
  detail(cat, t, nav, close) {
    const css = this.deps.css;
    const rows = [];
    const fac = (ids) => ids.map((id) => cat.factions.get(id)?.name ?? id).join(" \xB7 ");
    const tNow = this.now();
    const me = this.self();
    const myPos = me ? vesselPos(cat, me, tNow, this.deps.data().traffic?.now ?? tNow) : nav?.pos ?? null;
    const where = t.kind === "ship" ? vesselPos(cat, t, tNow, this.deps.data().traffic?.now ?? tNow) : posOf(cat, t, tNow);
    if (t.kind === "body") {
      const parent = t.parent ? cat.bodies.get(t.parent) : void 0;
      rows.push([COPY.fType, COPY.kind[t.type] ?? t.type]);
      if (parent) rows.push([COPY.fParent, parent.name]);
      if (t.r_km) rows.push([COPY.fRadius, `${Math.round(t.r_km).toLocaleString("en-US")} km`]);
      if (t.o && parent) {
        rows.push([COPY.fSemi, fmtDist(t.o.a)]);
        rows.push([COPY.fEcc, t.o.e.toFixed(3)]);
        const p = period(t.o, parent.mu);
        if (p) rows.push([COPY.fPeriod, fmtDur(p) + (t.o.dir === -1 ? ` \xB7 ${COPY.retro}` : "")]);
      }
      if (t.influence) rows.push([COPY.fSpace, fac(t.influence.factions), "fac"]);
      const st = frameStations(cat, t.id).length, si = frameSites(cat, t.id).length;
      if (st) rows.push([COPY.fStations, String(st)]);
      if (si) rows.push([COPY.fSites, String(si)]);
    } else if (t.kind === "station") {
      const parent = cat.bodies.get(t.parent);
      if (parent) rows.push([COPY.fParent, parent.name]);
      if (t.o && parent) {
        rows.push([COPY.fSemi, fmtDist(t.o.a)]);
        const p = period(t.o, parent.mu);
        if (p) rows.push([COPY.fPeriod, fmtDur(p) + (t.o.dir === -1 ? ` \xB7 ${COPY.retro}` : "")]);
      }
      rows.push([COPY.fOwner, t.owner ? fac([t.owner]) : COPY.independent, t.owner ? "fac" : void 0]);
      if (t.influence) rows.push([COPY.fReach, fmtDist(t.influence.r)]);
    } else if (t.kind === "site") {
      const parent = cat.bodies.get(t.parent);
      if (parent) rows.push([COPY.fOn, parent.name]);
      if (t.owner) rows.push([COPY.fOwner, fac([t.owner]), "fac"]);
    } else {
      if (t.hull) rows.push([COPY.fHull, t.hull]);
      rows.push([COPY.fState, t.burning ? COPY.burning : COPY.coasting]);
      if (t.burning && t.target) rows.push([COPY.fBound, this.thing(t.target)?.name ?? t.target]);
      const parent = t.parent ? cat.bodies.get(t.parent) : void 0;
      if (!t.burning && parent) rows.push([COPY.fParent, parent.name]);
      if (!t.burning && parent && t.o) rows.push([COPY.fSpeed, fmtKms(orbitSpeed(t.o, parent.mu, tNow) / 1e3)]);
      else rows.push([COPY.fSpeed, fmtKms(Math.hypot(t.vel.x, t.vel.y) / 1e3 / (cat.rate || 1))]);
    }
    if (myPos && !(t.kind === "ship" && t.self)) rows.push([COPY.fRange, fmtDist(Math.hypot(where.x - myPos.x, where.y - myPos.y))]);
    const acts = [];
    if (t.kind === "body" && t.id !== this.frame && hasFrame(cat, t.id)) acts.push(h("button", { class: css.cmd, type: "button", "data-testid": "nc-enter", onclick: () => this.goFrame(t.id) }, COPY.enterFrame));
    const target = navName(t, nav);
    if (nav && !nav.under_way && !nav.scrambled.length && target) {
      acts.push(h("button", { class: `${css.cmd} primary`, type: "button", "data-testid": "nc-plot", onclick: () => this.deps.send(COPY.cmd.target(target)) }, COPY.plotCourse));
      if (t.kind === "ship") acts.push(h("button", { class: css.cmd, type: "button", "data-testid": "nc-pass", onclick: () => this.deps.send(COPY.cmd.pass(target)) }, COPY.pass));
    }
    const plate = t.kind === "ship" && t.self ? h("span", { class: `${css.plate} ${css.ok}` }, COPY.you) : h("span", { class: `${css.plate} ${css.dim}` }, kindLabel(t));
    return [
      h("div", { class: "shead" }, h("span", { class: "ttl", "data-testid": "nc-detail-name" }, t.name), plate, close),
      h("dl", { class: "facts", "data-testid": "nc-facts" }, ...rows.flatMap(([k, v, cls]) => [h("dt", {}, k), h("dd", { class: cls ?? "" }, v)])),
      ...t.kind !== "ship" && "blurb" in t && t.blurb ? [h("p", { class: "blurb" }, t.blurb)] : [],
      ...acts.length ? [h("div", { class: "acts" }, ...acts)] : []
    ];
  }
  pick(id) {
    const { cat } = this.deps.data();
    const t = this.thing(id);
    if (!cat || !t) return;
    this.sel = id;
    this.showList = false;
    this.refresh();
  }
  // ─── input ───────────────────────────────────────────────────────────────────────────────────────────────
  zoomBy(k, at) {
    const z = Math.min(40, Math.max(0.3, this.zoom * k));
    const f = z / this.zoom;
    const v = this.view(), cx = v.w / 2, cy = v.h / 2;
    const c = at ?? { x: cx, y: cy };
    this.pan = { x: c.x - cx - (c.x - cx - this.pan.x) * f, y: c.y - cy - (c.y - cy - this.pan.y) * f };
    this.zoom = z;
    this.dirty = true;
  }
  bindInput() {
    const cv = this.canvas;
    let down = null;
    const local = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener("pointerdown", (e) => {
      const p = local(e);
      down = { x: p.x, y: p.y, px: this.pan.x, py: this.pan.y, drag: false };
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
      }
    });
    cv.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (down) {
        const dx = p.x - down.x, dy = p.y - down.y;
        if (!down.drag && Math.hypot(dx, dy) > 4) down.drag = true;
        if (down.drag) {
          this.pan = { x: down.px + dx, y: down.py + dy };
          this.dirty = true;
          cv.style.cursor = "grabbing";
          return;
        }
      }
      const hit = this.hit(p.x, p.y);
      if ((hit?.id ?? "") !== this.hover) {
        this.hover = hit?.id ?? "";
        this.dirty = true;
      }
      cv.style.cursor = hit ? "pointer" : "grab";
      cv.title = hit ? this.thing(hit.id)?.name ?? "" : "";
    });
    const up = (e) => {
      if (!down) return;
      const p = local(e);
      const wasDrag = down.drag;
      down = null;
      cv.style.cursor = "";
      if (wasDrag) return;
      this.clickAt(p.x, p.y);
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", () => {
      down = null;
    });
    cv.addEventListener("pointerleave", () => {
      if (this.hover) {
        this.hover = "";
        this.dirty = true;
      }
    });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, local(e));
    }, { passive: false });
    cv.addEventListener("dblclick", (e) => {
      const p = local(e);
      const hit = this.hit(p.x, p.y);
      const { cat } = this.deps.data();
      if (hit && cat?.bodies.has(hit.id) && hasFrame(cat, hit.id)) this.goFrame(hit.id);
    });
    cv.addEventListener("keydown", (e) => {
      const step = 40;
      const k = e.key;
      if (k === "ArrowLeft") this.pan.x += step;
      else if (k === "ArrowRight") this.pan.x -= step;
      else if (k === "ArrowUp") this.pan.y += step;
      else if (k === "ArrowDown") this.pan.y -= step;
      else if (k === "+" || k === "=") this.zoomBy(1.25);
      else if (k === "-" || k === "_") this.zoomBy(0.8);
      else if (k === "Escape") {
        if (this.sel || this.showList) {
          this.sel = "";
          this.showList = false;
          this.refresh();
        } else {
          const { cat } = this.deps.data();
          const up1 = cat?.bodies.get(this.frame)?.parent;
          if (up1) this.goFrame(up1);
        }
      } else return;
      e.preventDefault();
      this.dirty = true;
    });
  }
  /** A click on the canvas: select what is under it (bodies with a frame open it on a second click), else clear. */
  clickAt(x, y) {
    const hit = this.hit(x, y);
    const { cat } = this.deps.data();
    if (!hit || !cat) {
      if (this.sel) {
        this.sel = "";
        this.refresh();
      }
      return;
    }
    if (hit.id === this.sel && cat.bodies.has(hit.id) && hasFrame(cat, hit.id) && hit.id !== this.frame) {
      this.goFrame(hit.id);
      return;
    }
    this.sel = hit.id;
    this.showList = false;
    this.refresh();
  }
  hit(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.picks) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= p.r && d < bd) {
        best = p;
        bd = d;
      }
    }
    return best;
  }
  /** The part of the stage the side panel leaves uncovered: it docks right, or along the bottom on a narrow stage. */
  view() {
    if (this.side.hidden) return { w: this.W, h: this.H };
    const bottom = this.side.offsetWidth >= this.W - 1;
    return bottom ? { w: this.W, h: Math.max(80, this.H - this.side.offsetHeight) } : { w: Math.max(120, this.W - this.side.offsetWidth), h: this.H };
  }
  resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(2, (typeof devicePixelRatio === "number" ? devicePixelRatio : 1) || 1);
    this.W = Math.max(1, Math.floor(r.width));
    this.H = Math.max(1, Math.floor(r.height));
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }
  // ─── drawing ─────────────────────────────────────────────────────────────────────────────────────────────
  loop(ts) {
    if (this.dead) return;
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = this.last ? Math.min(0.25, (ts - this.last) / 1e3) : 0;
    this.last = ts;
    const { cat } = this.deps.data();
    if (this.warp && cat) this.tSim += dt * this.warp / (cat.rate || 1);
    if (typeof document !== "undefined" && document.hidden) return;
    if (!this.el.isConnected || !this.W) return;
    const every = this.warp && !this.deps.calm() ? 0 : 250;
    if (!this.dirty && ts - this.lastDraw < every) return;
    this.lastDraw = ts;
    this.dirty = false;
    this.draw();
  }
  /** Draw one frame. Public for tests (a no-op without a 2D context). */
  draw() {
    const { cat, traffic, nav } = this.deps.data();
    const t = this.now();
    if (cat) this.clock.textContent = fmtIC(cat.ic + (t - cat.now) * cat.rate);
    const ctx = this.ctx;
    this.picks = [];
    if (!ctx || !cat) return;
    const P = this.deps.colors();
    const W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, W, H);
    const frame = cat.bodies.get(this.frame) ?? cat.bodies.get(cat.rootId);
    const memo = /* @__PURE__ */ new Map();
    const ships = this.deps.pref("traffic") ? this.shipsInFrame(cat) : [];
    const extent = frameExtent(cat, frame.id, ships);
    const center = posOf(cat, frame, t, memo);
    const V = this.view();
    const proj = projector(center, extent, V.w, V.h, this.zoom, this.pan);
    const font = (px, w = 400) => `${w} ${px}px ${P.font || "monospace"}`;
    const labels = [];
    const label = (text, x, y, hot, color = P.dim, pri = 1) => {
      labels.push({ text, x, y, hot, color, pri: hot ? 99 : pri });
    };
    const ring = (x, y, r, id) => {
      if (id !== this.sel && id !== this.hover) return;
      ctx.strokeStyle = id === this.sel ? P.bright : P.dim;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, TAU);
      ctx.stroke();
    };
    if (this.deps.pref("territory") && frame.id === cat.rootId) {
      const srcs = [];
      for (const b of cat.bodies.values()) if (b.influence) srcs.push({ p: posOf(cat, b, t, memo), r: b.influence.r, f: b.influence.factions });
      for (const s of cat.stations.values()) if (s.influence && s.parent === cat.rootId) srcs.push({ p: posOf(cat, s, t, memo), r: s.influence.r, f: s.influence.factions });
      for (const s of srcs) {
        const sp = proj(s.p);
        const ex = proj({ x: s.p.x + s.r, y: s.p.y }), ey = proj({ x: s.p.x, y: s.p.y + s.r }), wx = proj({ x: s.p.x - s.r, y: s.p.y }), wy = proj({ x: s.p.x, y: s.p.y - s.r });
        const rs = Math.max(4, (Math.hypot(ex.x - sp.x, ex.y - sp.y) + Math.hypot(ey.x - sp.x, ey.y - sp.y) + Math.hypot(wx.x - sp.x, wx.y - sp.y) + Math.hypot(wy.x - sp.x, wy.y - sp.y)) / 4);
        const cols = s.f.map((id) => cat.factions.get(id)?.color || P.faint);
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = cols[0];
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, rs, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        if (cols.length > 1) {
          cols.forEach((c, i) => {
            ctx.strokeStyle = c;
            ctx.setLineDash([6, 6 * (cols.length - 1)]);
            ctx.lineDashOffset = -i * 6;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, rs, 0, TAU);
            ctx.stroke();
          });
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        } else {
          ctx.strokeStyle = cols[0];
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, rs, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    const path = (o, base, color, dash) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ellipse(o, 120).forEach((q, i) => {
        const s = proj({ x: base.x + q.x, y: base.y + q.y });
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const kids = childBodies(cat, frame.id);
    for (const b of kids) if (b.o) path(b.o, center, b.type === "belt" ? P.border : P.borderBright, []);
    const stations = frameStations(cat, frame.id);
    for (const s of stations) if (s.o) path(s.o, center, P.border, [3, 4]);
    const cp = proj(center);
    const CR = frame.type === "star" ? 11 : 8;
    ctx.fillStyle = bodyColor(frame, P);
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, CR, 0, TAU);
    ctx.fill();
    ring(cp.x, cp.y, CR, frame.id);
    label(frame.name, cp.x, cp.y + CR + 5, frame.id === this.sel || frame.id === this.hover, P.fg, 9);
    this.picks.push({ x: cp.x, y: cp.y, r: CR + 6, id: frame.id });
    const sites = frameSites(cat, frame.id);
    sites.forEach((s, i) => {
      const a = -Math.PI / 2 + (i + 0.5) / sites.length * TAU;
      const x = cp.x + (CR + 14) * Math.cos(a), y = cp.y + (CR + 14) * Math.sin(a);
      diamond(ctx, x, y, 3.5, s.owner ? cat.factions.get(s.owner)?.color || P.dim : P.dim);
      ring(x, y, 3, s.id);
      if (s.id === this.sel || s.id === this.hover) label(s.name, x, y + 7, true);
      this.picks.push({ x, y, r: 9, id: s.id });
    });
    for (const b of kids) {
      const sp = proj(posOf(cat, b, t, memo));
      const r = b.type === "planet" ? 4.5 : b.type === "belt" ? 2.5 : 3.2;
      ctx.fillStyle = bodyColor(b, P);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, TAU);
      ctx.fill();
      if (hasFrame(cat, b.id)) {
        ctx.strokeStyle = P.faint;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r + 2.5, 0, TAU);
        ctx.stroke();
      }
      ring(sp.x, sp.y, r, b.id);
      label(b.name, sp.x, sp.y + r + 5, b.id === this.sel || b.id === this.hover, P.dim, b.featured ? 7 : b.type === "planet" ? 6 : b.type === "moon" ? 5 : 2);
      this.picks.push({ x: sp.x, y: sp.y, r: 12, id: b.id });
    }
    for (const s of stations) {
      const sp = proj(posOf(cat, s, t, memo));
      const own = s.owner ? cat.factions.get(s.owner)?.color : "";
      ctx.fillStyle = own || P.gold;
      ctx.strokeStyle = P.gold;
      ctx.lineWidth = 1;
      ctx.fillRect(sp.x - 3, sp.y - 3, 6, 6);
      ctx.strokeRect(sp.x - 3.5, sp.y - 3.5, 7, 7);
      ring(sp.x, sp.y, 4, s.id);
      label(s.name, sp.x, sp.y + 8, s.id === this.sel || s.id === this.hover, P.gold, 3);
      this.picks.push({ x: sp.x, y: sp.y, r: 11, id: s.id });
    }
    const sentAt = traffic?.now ?? t;
    const me = traffic?.vessels.find((v) => v.self);
    const aim = nav?.under_way?.aim ?? nav?.plan?.aim ?? null;
    const wp = nav?.plan?.waypoint ?? null;
    if (me && aim && ships.includes(me)) {
      const a = proj(vesselPos(cat, me, t, sentAt, memo));
      ctx.strokeStyle = nav?.plan?.blocked ? P.alert : P.bright;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (wp && (wp.x !== aim.x || wp.y !== aim.y)) {
        const w = proj(wp);
        ctx.lineTo(w.x, w.y);
      }
      const b = proj(aim);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = nav?.plan?.blocked ? P.alert : P.bright;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 5, 0, TAU);
      ctx.moveTo(b.x - 8, b.y);
      ctx.lineTo(b.x + 8, b.y);
      ctx.moveTo(b.x, b.y - 8);
      ctx.lineTo(b.x, b.y + 8);
      ctx.stroke();
    }
    for (const v of ships) {
      const sp = proj(vesselPos(cat, v, t, sentAt, memo));
      const col = v.self ? P.ok : v.burning ? P.gold : P.fg;
      const ang = Math.atan2(-v.vel.y, v.vel.x);
      if (v.burning) {
        ctx.strokeStyle = P.gold;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sp.x - 12 * Math.cos(ang), sp.y - 12 * Math.sin(ang));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(ang);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, 3.6);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-4, -3.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ring(sp.x, sp.y, 5, v.id);
      if (v.self || v.id === this.sel || v.id === this.hover) label(v.name, sp.x, sp.y + 9, v.id === this.sel || v.id === this.hover, v.self ? P.ok : P.dim, v.self ? 8 : 4);
      this.picks.push({ x: sp.x, y: sp.y, r: 10, id: v.id });
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const placed = [];
    for (const l of labels.sort((a, b) => b.pri - a.pri)) {
      const text = l.text.toUpperCase();
      ctx.font = font(10, l.hot ? 500 : 400);
      const w = ctx.measureText(text).width, x0 = l.x - w / 2 - 2, y0 = l.y - 1, x1 = l.x + w / 2 + 2, y1 = l.y + 12;
      if (!l.hot && (x0 < 0 || x1 > W || y1 > H || placed.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b))) continue;
      placed.push([x0, y0, x1, y1]);
      ctx.fillStyle = l.hot ? P.fg : l.color;
      ctx.fillText(text, l.x, l.y);
    }
    void AU_M;
  }
};
function bodyColor(b, P) {
  return b.type === "star" ? P.gold : b.type === "planet" ? P.bright : b.type === "belt" ? P.faint : P.dim;
}
function diamond(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}
function kindLabel(t) {
  return t.kind === "body" ? COPY.kind[t.type] ?? t.type : COPY.kind[t.kind] ?? t.kind;
}
function navName(t, nav) {
  if (!nav) return "";
  if (t.kind === "site") return "";
  if (t.kind === "ship") return t.self ? "" : t.name;
  if (t.kind === "body") return t.type === "star" || nav.orbit.body && "body_id" in nav.orbit && nav.orbit.body_id === t.id ? "" : t.name;
  return t.name;
}

// src/nav.ts
import { h as h2 } from "@muclient/sdk";
function targetRows(nav, cat, filter = "") {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const stationName = (c) => c.kind === "station" ? cat?.stations.get(c.id)?.name ?? "" : "";
  const add = (c, group) => {
    if (!c.name || seen.has(c.id || c.name)) return;
    seen.add(c.id || c.name);
    const full = stationName(c);
    out.push({ id: c.id, name: c.name, label: full && full !== c.name ? full : "", kind: c.kind, dist_au: c.dist_au, group });
  };
  for (const c of nav.contacts) add(c, "contacts");
  for (const c of [...nav.destinations].sort((a, b) => (a.dist_au || 0) - (b.dist_au || 0))) add(c, "destinations");
  if (cat) {
    const here = "body_id" in nav.orbit ? nav.orbit.body_id : "";
    for (const b of cat.bodies.values()) {
      if (b.type === "star" || b.id === here || seen.has(b.id)) continue;
      add({ id: b.id, name: b.name, kind: "body", dist_au: NaN }, "bodies");
    }
  }
  const q = filter.trim().toLowerCase();
  return q ? out.filter((r) => r.name.toLowerCase().includes(q) || r.label.toLowerCase().includes(q)) : out;
}
var clampG = (g, min, max) => Math.min(Math.max(g, min), Math.max(min, max));
var NavView = class {
  constructor(deps) {
    this.deps = deps;
    this.body = h2("div", { class: "scroll" });
    this.el = h2("section", { class: "mu-navcon", "aria-label": COPY.navTitle, "data-focus-region": "navcomp.nav", tabindex: "-1", "data-testid": "navcon" }, this.body);
    this.refresh();
  }
  deps;
  el;
  body;
  filter = "";
  /** The slider's value while the player drags it (null: follow the console). */
  draftG = null;
  destroy() {
    this.el.remove();
  }
  refresh() {
    const { nav, cat, active, sid } = this.deps.data();
    const css = this.deps.css;
    const empty = (text) => {
      this.body.replaceChildren(h2("p", { class: `${css.empty} awaiting`, "data-testid": "nv-empty" }, text));
    };
    if (!sid) return empty(COPY.noSession);
    if (!nav) return empty(active ? COPY.noConsole : COPY.noConsole);
    const focused = this.el.contains(document.activeElement) ? document.activeElement?.dataset?.testid ?? "" : "";
    const top = this.body.scrollTop;
    this.body.replaceChildren(...this.sections(nav, cat));
    this.body.scrollTop = top;
    if (focused) {
      const again = this.body.querySelector(`[data-testid="${focused}"]`);
      if (again) {
        again.focus();
        if (again instanceof HTMLInputElement && again.type !== "range") {
          const n = again.value.length;
          try {
            again.setSelectionRange(n, n);
          } catch {
          }
        }
      }
    }
  }
  head(label, extra) {
    const css = this.deps.css;
    return h2("div", { class: "hrow" }, h2("div", { class: css.secHead, role: "heading", "aria-level": "3" }, label, h2("span", { class: css.secClose, "aria-hidden": "true" })), extra ?? null);
  }
  kv(rows) {
    return h2("dl", { class: "kv" }, ...rows.flatMap(([k, v, cls]) => [h2("dt", {}, k), h2("dd", { class: cls ?? "" }, v)]));
  }
  /** Console lines as plates: [ERROR] alert, [WARNING] gold, anything else dim. */
  lines(list, testid) {
    const css = this.deps.css;
    return list.map((l) => {
      const { tag, text } = tagOf(l);
      const cls = tag === "ERROR" ? "alert" : tag === "WARNING" ? css.gold : css.dim;
      return h2(
        "div",
        { class: `line ${tag === "ERROR" ? "err" : tag === "WARNING" ? "warn" : ""}`, "data-testid": testid },
        tag ? h2("span", { class: `${css.plate} ${cls}` }, tag === "ERROR" ? "\u26A0 error" : tag === "WARNING" ? "warning" : tag) : null,
        h2("span", { class: "tx" }, text)
      );
    });
  }
  sections(nav, cat) {
    const css = this.deps.css;
    const send = (cmd) => this.deps.send(cmd);
    const out = [];
    const showShip = nav.ship.id ? h2("button", { class: css.cmd, type: "button", "data-testid": "nv-show-ship", title: COPY.onMap, onclick: () => this.deps.show(nav.ship.id) }, "\u2315") : null;
    showShip?.classList.add(css.sq ?? "sq");
    out.push(this.head(COPY.hShip, showShip));
    out.push(h2(
      "div",
      { class: "ident" },
      h2("span", { class: "sq", "data-testid": "nv-squawk" }, nav.ship.squawk || nav.ship.name),
      nav.ship.squawk ? h2("span", { class: "hull" }, nav.ship.name) : null,
      nav.combat ? h2("span", { class: `${css.plate} alert`, "data-testid": "nv-combat" }, COPY.combat) : null,
      nav.crippled.length ? h2("span", { class: `${css.plate} alert` }, COPY.crippled) : null
    ));
    if (nav.scrambled.length) {
      out.push(h2("p", { class: `${css.empty} awaiting` }, COPY.scrambled), ...this.lines(nav.scrambled, "nv-scrambled"));
      return out;
    }
    const ship = [];
    if ("body_id" in nav.orbit) {
      const o = nav.orbit;
      ship.push([COPY.orbiting, `${o.body} \xB7 ${COPY.alt} ${Math.round(o.alt_km).toLocaleString("en-US")} km \xB7 ${fmtKms(o.v_kms)}${o.period ? ` \xB7 ${fmtDur(o.period)}` : ""}`]);
    }
    if (nav.orbit.course) ship.push([COPY.course, nav.orbit.course]);
    if (nav.comms) ship.push([COPY.comms, nav.comms]);
    out.push(this.kv(ship));
    if (nav.combat) out.push(h2("p", { class: "note t-alert" }, COPY.combatNote));
    out.push(...this.lines(nav.crippled, "nv-crippled"));
    const uw = nav.under_way;
    if (uw) {
      out.push(this.head(COPY.hUnderWay));
      const bar = h2("div", { class: "prog", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(uw.frac * 100)), "data-testid": "nv-progress" }, h2("i", { style: `width:${(uw.frac * 100).toFixed(1)}%` }));
      const progress = h2("span", { class: "progrow" }, bar, h2("span", { class: "pct" }, `${Math.round(uw.frac * 100)}%`));
      out.push(h2("div", { class: "man", "data-testid": "nv-maneuver" }, uw.maneuver));
      out.push(this.kv([
        [COPY.phase, uw.label || uw.phase],
        [COPY.progress, progress],
        [uw.pass ? COPY.passIn : COPY.eta, fmtDur(uw.eta)],
        [COPY.hBurn, fmtG(uw.g)],
        ...uw.route ? [[COPY.route, COPY.via(uw.route)]] : [],
        ...uw.replan ? [[COPY.replan, uw.replan]] : []
      ]));
      out.push(...this.lines(uw.warnings, "nv-warning"));
      out.push(h2("div", { class: "acts" }, h2("button", { class: `${css.cmd} warn`, type: "button", "data-testid": "nv-abort", onclick: () => send(COPY.cmd.abort) }, COPY.abort)));
    }
    const p = nav.plan;
    if (!uw) {
      out.push(this.head(COPY.hCourse, p && p.target.id ? (() => {
        const b2 = h2("button", { class: `${css.cmd} ${css.sq ?? "sq"}`, type: "button", "data-testid": "nv-show-target", title: COPY.onMap, onclick: () => this.deps.show(p.target.id) }, "\u2315");
        return b2;
      })() : null));
      if (!p) {
        out.push(h2("p", { class: `${css.empty} awaiting`, "data-testid": "nv-no-course" }, COPY.noCourse));
        out.push(...this.lines(nav.coast, "nv-coast"));
      } else if (p.lost) {
        out.push(h2("p", { class: "note t-alert", "data-testid": "nv-lost" }, COPY.lostTarget(p.target.name)));
        out.push(h2("div", { class: "acts" }, h2("button", { class: css.cmd, type: "button", "data-testid": "nv-cancel", onclick: () => send(COPY.cmd.cancel) }, COPY.cancel)));
      } else {
        out.push(h2("div", { class: `man${p.blocked ? " blocked" : ""}`, "data-testid": "nv-maneuver" }, p.maneuver));
        const rows = [];
        if (Number.isFinite(p.dist_m)) rows.push([COPY.distance, fmtDist(p.dist_m / 1e3 / AU_KM)]);
        if (p.eta !== null) rows.push([p.pass ? COPY.passIn : COPY.eta, fmtDur(p.eta)]);
        rows.push([COPY.hBurn, fmtG(p.g)]);
        if (Number.isFinite(p.pct)) rows.push([COPY.fuel, `${(p.pct * 100).toFixed(1)}%`, p.pct > 1 ? "t-alert" : p.pct > 0.5 ? "t-gold" : ""]);
        if (p.closing_kms !== null) rows.push([COPY.closing, fmtKms(p.closing_kms)]);
        if (p.vp_kms !== null) rows.push([COPY.passSpeed, fmtKms(p.vp_kms)]);
        if (p.route) rows.push([COPY.route, COPY.via(p.route)]);
        out.push(this.kv(rows));
        out.push(...this.lines(p.errors, "nv-error"), ...this.lines(p.warnings, "nv-warning"));
        const acts = h2("div", { class: "acts" });
        if (p.blocked) acts.append(h2("span", { class: `${css.plate} alert`, "data-testid": "nv-blocked" }, COPY.blocked));
        else if (p.confirm) acts.append(h2("button", { class: `${css.cmd} primary`, type: "button", "data-testid": "nv-execute-confirm", disabled: nav.combat ? true : void 0, onclick: () => send(COPY.cmd.confirm) }, COPY.executeAnyway));
        else acts.append(h2("button", { class: `${css.cmd} primary`, type: "button", "data-testid": "nv-execute", disabled: nav.combat ? true : void 0, onclick: () => send(COPY.cmd.execute) }, COPY.execute));
        acts.append(h2("button", { class: css.cmd, type: "button", "data-testid": "nv-cancel", onclick: () => send(COPY.cmd.cancel) }, COPY.cancel));
        out.push(acts);
        if (p.confirm && !p.blocked) out.push(h2("p", { class: "hint" }, COPY.confirmNeeded));
      }
    }
    const b = nav.burn;
    const g = this.draftG ?? clampG(b.g, b.min, b.max);
    const val = h2("span", { class: "gval", "data-testid": "nv-burn-value" }, fmtG(g));
    const range = h2("input", { class: "rng", type: "range", min: String(b.min), max: String(Math.max(b.min, b.max)), step: "0.01", value: String(g), "aria-label": COPY.burnLabel, "data-testid": "nv-burn" });
    const pct = (v) => b.max > b.min ? (v - b.min) / (b.max - b.min) * 100 : 100;
    range.style.setProperty("--p", `${pct(g)}%`);
    const set = h2("button", { class: css.cmd, type: "button", "data-testid": "nv-burn-set", disabled: Math.abs(g - b.g) < 5e-3 ? true : void 0, onclick: () => {
      const v = Number(range.value);
      this.draftG = null;
      send(COPY.cmd.burn(v));
    } }, COPY.setBurn);
    range.addEventListener("input", () => {
      const v = Number(range.value);
      this.draftG = v;
      val.textContent = fmtG(v);
      range.style.setProperty("--p", `${pct(v)}%`);
      set.disabled = Math.abs(v - b.g) < 5e-3;
    });
    range.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        set.click();
      }
    });
    if (!uw) {
      out.push(this.head(COPY.hBurn));
      out.push(h2("div", { class: "burn" }, range, val, set));
      out.push(h2("p", { class: "hint" }, COPY.burnRange(fmtG(b.min), fmtG(b.max))));
    }
    if (!uw) {
      out.push(this.head(COPY.hTarget));
      const intents = h2("div", { class: "acts" });
      if (nav.orbit.body) {
        intents.append(
          h2("button", { class: css.cmd, type: "button", "data-testid": "nv-orbit-low", onclick: () => send(COPY.cmd.orbit("low")) }, COPY.orbitLow),
          h2("button", { class: css.cmd, type: "button", "data-testid": "nv-orbit-high", onclick: () => send(COPY.cmd.orbit("high")) }, COPY.orbitHigh),
          h2("button", { class: css.cmd, type: "button", "data-testid": "nv-leave", onclick: () => send(COPY.cmd.leave) }, COPY.leave)
        );
        out.push(intents);
      }
      const field = h2("input", { class: css.field, type: "search", value: this.filter, placeholder: COPY.filter, "aria-label": COPY.filter, autocomplete: "off", "data-testid": "nv-filter" });
      const list = h2("div", { class: "targets", role: "list" });
      const fill = () => {
        const rows = targetRows(nav, cat, this.filter);
        const groups = ["contacts", "destinations", "bodies"];
        const kids = [];
        for (const gname of groups) {
          const rs = rows.filter((r) => r.group === gname);
          if (!rs.length) continue;
          kids.push(h2("div", { class: `${css.label} glabel` }, COPY[gname]));
          for (const r of rs) {
            const cur = p && !p.lost && p.target.id && p.target.id === r.id;
            const row = h2(
              "div",
              { class: "trow", role: "listitem", "data-testid": "nv-target", "data-id": r.id },
              h2(
                "button",
                { class: `${css.row} tbtn${cur ? " hot" : ""}`, type: "button", "data-testid": "nv-target-plot", "aria-current": cur ? "true" : void 0, onclick: () => send(COPY.cmd.target(r.name)) },
                h2("span", { class: "l1" }, h2("span", { class: "nm" }, r.name), r.label ? h2("span", { class: "lb" }, r.label) : null, h2("span", { class: "sp" }), Number.isFinite(r.dist_au) ? h2("span", { class: "ds" }, fmtDist(r.dist_au)) : null, h2("span", { class: `${css.plate} ${css.dim}` }, COPY.kind[r.kind] ?? r.kind))
              ),
              r.kind === "ship" ? h2("button", { class: css.cmd, type: "button", "data-testid": "nv-target-pass", onclick: () => send(COPY.cmd.pass(r.name)) }, COPY.pass) : null
            );
            kids.push(row);
          }
        }
        list.replaceChildren(...kids.length ? kids : [h2("p", { class: `${css.empty} awaiting` }, COPY.noMatch)]);
      };
      field.addEventListener("input", () => {
        this.filter = field.value;
        fill();
      });
      fill();
      out.push(h2("div", { class: "filter" }, field), list);
    }
    return out;
  }
};

// src/index.ts
var ID = "navcomp";
var MAP = "navcomp.map";
var NAV = "navcomp.nav";
var SETTINGS = { territory: "map.territory", traffic: "map.traffic" };
var R = `.ext-panel[data-ext="${ID}"]`;
var M = `${R} .mu-navmap`;
var N = `${R} .mu-navcon`;
var NAVCOMP_CSS = `
${R} .mu-navmap, ${R} .mu-navcon { height: 100%; display: flex; flex-direction: column; background: var(--bg); color: var(--fg); font-family: var(--font-mono); font-size: .86rem; box-sizing: border-box; min-height: 0; }
${R} :is(.mu-navmap, .mu-navcon) *, ${R} :is(.mu-navmap, .mu-navcon) *::before, ${R} :is(.mu-navmap, .mu-navcon) *::after { box-sizing: border-box; }
${R} :is(.mu-navmap, .mu-navcon):focus { outline: none; }
${R} :is(.mu-navmap, .mu-navcon) :focus-visible { outline: 2px solid var(--accent-bright); outline-offset: -2px; }
${R} .awaiting { margin: .9rem 10px 0; color: var(--fg-faint); font-style: normal; font-size: .64rem; letter-spacing: .14em; text-transform: uppercase; }
${R} .hint { margin: 2px 0 0; font-size: .64rem; color: var(--fg-faint); letter-spacing: .04em; }
${R} .sp { flex: 1; }
${R} .t-alert { color: var(--alert); }
${R} .t-gold { color: var(--gold); }
${R} .sh-plate.alert { background: var(--alert); color: var(--bg-deep); }

${M} .bar { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 4px; padding: 3px 6px; background: var(--bg-elev); border-bottom: 1px solid var(--accent); }
${M} .crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 0 2px; min-width: 0; }
${M} .crumb .sep { color: var(--fg-faint); margin-right: .5ch; }
${M} .crumb .n { color: var(--gold); letter-spacing: 0; margin-left: .3ch; }
${M} .crumb[aria-current="true"] { color: var(--accent-bright); }
${M} .crumbs .div { color: var(--fg-faint); padding: 0 .5ch; }
${M} .stage { position: relative; flex: 1; min-height: 120px; overflow: hidden; background: var(--bg); container-type: size; }
${M} .sky { position: absolute; inset: 0; display: block; cursor: grab; touch-action: none; }
${M} .stage > .awaiting { position: absolute; top: 0; left: 0; }
${M} .legend { position: absolute; left: 6px; top: 6px; display: flex; flex-direction: column; gap: 1px; padding: 3px 6px; background: color-mix(in srgb, var(--bg) 80%, transparent); font-size: .58rem; letter-spacing: .12em; text-transform: uppercase; color: var(--fg-dim); pointer-events: none; }
${M} .legend[hidden] { display: none; }
@container (max-height: 300px) { ${M} .legend { display: none; } }
${M} .legend .lg { display: inline-flex; align-items: center; gap: 5px; }
${M} .legend i { width: 8px; height: 8px; display: inline-block; background: var(--fg-faint); }
${M} .side { position: absolute; top: 0; right: 0; bottom: 0; width: min(280px, 70%); overflow-y: auto; background: var(--bg-elev); border-left: 1px solid var(--border-bright); padding: 0 10px 10px; }
${M} .side[hidden] { display: none; }
@container (max-width: 560px) { ${M} .side { top: auto; left: 0; width: auto; max-height: 52%; border-left: 0; border-top: 1px solid var(--border-bright); } }
${M} .shead { display: flex; align-items: center; gap: 8px; padding: 8px 0 6px; border-bottom: 1px solid var(--border); margin-bottom: 6px; }
${M} .shead > :first-child { flex: 1; min-width: 0; }
${M} .shead .sec-head, ${M} .shead [role="heading"] { margin: 0; }
${M} .ttl { font-size: .9rem; font-weight: 500; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${M} .facts { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0; font-size: .78rem; }
${M} .facts dt { color: var(--fg-dim); font-size: .64rem; letter-spacing: .14em; text-transform: uppercase; align-self: center; }
${M} .facts dd { margin: 0; color: var(--fg); }
${M} .facts dd.fac { color: var(--gold); }
${M} .blurb { margin: 8px 0 0; font-size: .76rem; color: var(--fg-dim); font-style: italic; }
${M} .acts { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0 -.5ch; }
${M} .item { padding: 5px 6px 5px 2.4ch; }
${M} .item .l1 { display: flex; align-items: baseline; gap: 8px; }
${M} .item .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8rem; }
${M} .foot { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 8px; padding: 3px 8px; background: var(--bg-elev); border-top: 1px solid var(--border-bright); font-size: .7rem; }
${M} .foot .clock { color: var(--accent-bright); letter-spacing: .04em; }
${M} .foot .warp { display: inline-flex; flex-wrap: wrap; gap: 0 2px; }
${M} .foot .mode { color: var(--fg-dim); font-size: .62rem; letter-spacing: .12em; text-transform: uppercase; }
${M} .foot .hint { margin: 0; }

${N} .scroll { flex: 1; overflow-y: auto; padding: 0 10px 10px; }
${N} .hrow { display: flex; align-items: center; gap: 6px; margin: .9rem 0 .4rem; }
${N} .hrow > :first-child { flex: 1; min-width: 0; margin: 0; }
${N} .ident { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-bottom: 4px; }
${N} .ident .sq { font-size: 1rem; font-weight: 500; color: var(--accent-bright); letter-spacing: .06em; }
${N} .ident .hull { color: var(--fg-dim); font-size: .78rem; }
${N} .kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0; font-size: .78rem; }
${N} .kv dt { color: var(--fg-dim); font-size: .64rem; letter-spacing: .14em; text-transform: uppercase; align-self: center; white-space: nowrap; }
${N} .kv dd { margin: 0; color: var(--fg); min-width: 0; overflow-wrap: anywhere; }
${N} .man { font-size: .82rem; color: var(--fg); font-weight: 500; margin: 0 0 6px; }
${N} .man.blocked { color: var(--alert); }
${N} .note { margin: 4px 0; font-size: .7rem; letter-spacing: .06em; }
${N} .line { display: flex; align-items: baseline; gap: 8px; margin: 4px 0 0; font-size: .74rem; color: var(--fg-dim); }
${N} .line.err .tx { color: var(--alert); }
${N} .line.warn .tx { color: var(--gold); }
${N} .line .sh-plate { flex: none; }
${N} .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: 8px 0 0 -.5ch; }
${N} .progrow { display: flex; align-items: center; gap: 8px; height: 100%; }
${N} .progrow .pct { flex: none; font-size: .7rem; color: var(--fg-dim); }
${N} .prog { flex: 1; height: 6px; min-width: 80px; background: var(--bg-deep); box-shadow: inset 0 0 0 1px var(--border-bright); }
${N} .prog i { display: block; height: 100%; background: var(--accent); }
${N} .burn { display: flex; align-items: center; gap: 10px; }
${N} .burn .rng { flex: 1; max-width: none; min-width: 80px; }
${N} .burn .gval { min-width: 6ch; text-align: right; color: var(--accent-bright); }
${N} .filter { margin: 8px 0 4px; }
${N} .filter .sh-field { width: 100%; }
${N} .glabel { display: block; margin: 8px 0 2px; }
${N} .trow { display: flex; align-items: stretch; border-bottom: 1px solid var(--border); }
${N} .trow > .sh-cmd { align-self: center; }
${N} .tbtn { flex: 1; min-width: 0; border-bottom: 0; padding: 5px 6px 5px 2.4ch; }
${N} .tbtn .l1 { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
${N} .tbtn .nm { font-size: .8rem; color: var(--fg); white-space: nowrap; }
${N} .tbtn .lb { font-size: .72rem; color: var(--fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
${N} .tbtn .ds { font-size: .7rem; color: var(--fg-dim); white-space: nowrap; }
${N} .tbtn.hot .nm { color: var(--accent-bright); }
`;
var index_default = defineExtension({
  activate(ctx) {
    const mu = ctx.mu;
    mu.ui.style(NAVCOMP_CSS);
    const css = mu.ui.css;
    mu.settings.define({
      title: COPY.settingsTitle,
      items: [
        { key: SETTINGS.territory, label: COPY.settingTerritory, default: true, kind: "toggle", scope: "world" },
        { key: SETTINGS.traffic, label: COPY.settingTraffic, default: true, kind: "toggle", scope: "world", hint: COPY.settingTrafficHint }
      ]
    });
    const state = /* @__PURE__ */ new Map();
    const st = (sid) => state.get(sid) ?? state.set(sid, { cat: null, catWall: 0, traffic: null, nav: null, asked: false }).get(sid);
    const redraws = /* @__PURE__ */ new Map();
    const redraw = (sid) => {
      for (const fn of redraws.get(sid) ?? []) fn();
    };
    const maps = /* @__PURE__ */ new Map();
    const pending = /* @__PURE__ */ new Map();
    const worldOf = (sid) => mu.sessions.list().find((s) => s.id === sid)?.worldId ?? null;
    let palette = null;
    let calm = false;
    const readPalette = () => {
      const v = (n) => mu.theme.cssVar(n);
      return { bg: v("--bg"), fg: v("--fg"), dim: v("--fg-dim"), faint: v("--fg-faint"), accent: v("--accent"), bright: v("--accent-bright"), gold: v("--gold"), alert: v("--alert"), ok: v("--ok"), border: v("--border"), borderBright: v("--border-bright"), font: v("--font-mono") };
    };
    ctx.subscriptions.push(mu.theme.watch((t) => {
      palette = null;
      calm = !!t.reduceMotion;
      for (const set of maps.values()) for (const m of set) m.refresh();
    }));
    const isCalm = () => calm || typeof document !== "undefined" && document.documentElement.hasAttribute("data-calm");
    const ask = (sid) => {
      const s = st(sid);
      if (s.asked || s.cat) return;
      s.asked = true;
      void mu.gmcp.send("Space.Get", {}, sid);
    };
    const sendCmd = (sid, cmd) => {
      if (sid) void mu.sessions.send(cmd, sid);
    };
    const mountWith = (make) => (hostEl, pc) => {
      const sid = pc.sid;
      const view = make(sid);
      hostEl.append(view.el);
      const set = sid ? redraws.get(sid) ?? redraws.set(sid, /* @__PURE__ */ new Set()).get(sid) : null;
      const fn = () => view.refresh();
      set?.add(fn);
      if (sid) ask(sid);
      return () => {
        set?.delete(fn);
        view.destroy();
      };
    };
    mu.panels.register({
      id: MAP,
      title: COPY.mapTitle,
      defaultPosition: "float",
      order: 60,
      show: "auto",
      singleton: true,
      mount: mountWith((sid) => {
        const view = new MapView({
          css,
          data: () => {
            const s = sid ? state.get(sid) : void 0;
            return { cat: s?.cat ?? null, catWall: s?.catWall ?? 0, traffic: s?.traffic ?? null, nav: s?.nav ?? null };
          },
          colors: () => palette ??= readPalette(),
          pref: (k) => mu.settings.get(SETTINGS[k], sid ? { sid } : void 0) !== false,
          setPref: (k, on) => mu.settings.set(SETTINGS[k], on, sid ? worldOf(sid) : void 0),
          send: (cmd) => sendCmd(sid, cmd),
          calm: isCalm
        });
        if (sid) {
          const ms = maps.get(sid) ?? maps.set(sid, /* @__PURE__ */ new Set()).get(sid);
          ms.add(view);
          const d = view.destroy.bind(view);
          view.destroy = () => {
            ms.delete(view);
            d();
          };
          const want = pending.get(sid);
          if (want) {
            pending.delete(sid);
            view.select(want);
          }
        }
        return view;
      })
    });
    mu.panels.register({
      id: NAV,
      title: COPY.navTitle,
      defaultPosition: "right-top",
      order: 61,
      show: "auto",
      singleton: true,
      mount: mountWith((sid) => new NavView({
        css,
        data: () => {
          const s = sid ? state.get(sid) : void 0;
          return { nav: s?.nav ?? null, cat: s?.cat ?? null, active: !!s?.cat, sid };
        },
        send: (cmd) => sendCmd(sid, cmd),
        show: (id) => {
          if (!sid) return;
          const open = maps.get(sid);
          if (open?.size) for (const m of open) m.select(id);
          else pending.set(sid, id);
          mu.panels.open(MAP, {}, { sid });
        }
      })),
      snapshot: (el) => el.querySelector('[data-testid="nv-filter"]')?.value || void 0,
      restore: (el, saved) => {
        const inp = el.querySelector('[data-testid="nv-filter"]');
        if (inp && typeof saved === "string" && saved) {
          inp.value = saved;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    });
    ctx.subscriptions.push(mu.sessions.each((s) => {
      let touchedMap = false, touchedNav = false;
      const arrived = (now, meta) => meta?.replay ? now : Date.now() / 1e3;
      const sys = mu.gmcp.watch("Space.System", (data, meta) => {
        const cur = st(s.id);
        cur.cat = catalogOf(data);
        cur.catWall = cur.cat ? arrived(cur.cat.now, meta) : Date.now() / 1e3;
        if (!cur.cat) cur.traffic = null;
        if (cur.cat && !touchedMap) {
          touchedMap = true;
          mu.panels.touch(MAP, s.id);
        }
        redraw(s.id);
      }, { sid: s.id });
      const trf = mu.gmcp.watch("Space.Traffic", (data) => {
        const cur = st(s.id);
        const t = trafficOf(data);
        if (t && !t.now) t.now = cur.cat ? cur.cat.now + (Date.now() / 1e3 - cur.catWall) : Date.now() / 1e3;
        cur.traffic = t;
        redraw(s.id);
      }, { sid: s.id });
      const nav = mu.gmcp.watch("Ship.Nav", (data) => {
        const cur = st(s.id);
        cur.nav = navOf(data);
        if (cur.nav && !touchedNav) {
          touchedNav = true;
          mu.panels.touch(NAV, s.id);
        }
        redraw(s.id);
      }, { sid: s.id });
      const a = mu.settings.watch(SETTINGS.territory, () => redraw(s.id), { sid: s.id });
      const b = mu.settings.watch(SETTINGS.traffic, () => redraw(s.id), { sid: s.id });
      return () => {
        sys();
        trf();
        nav();
        a();
        b();
        state.delete(s.id);
        redraws.delete(s.id);
        maps.delete(s.id);
      };
    }));
    void h3;
  }
});
export {
  AU_KM,
  AU_M,
  COPY,
  MAP,
  NAV,
  NAVCOMP_CSS,
  SETTINGS,
  catalogOf,
  chainOf,
  clampG,
  index_default as default,
  elementsOf,
  ellipse,
  fmtDist,
  fmtDur,
  fmtG,
  fmtIC,
  fmtKms,
  frameExtent,
  localPos,
  meanMotion,
  navName,
  navOf,
  orbitSpeed,
  period,
  planOf,
  posOf,
  projector,
  solveKepler,
  tagOf,
  targetRows,
  trafficOf,
  vesselPos
};
