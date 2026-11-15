/**
 * The three GMCP packages as typed, normalised data, and where everything is at a given time. Pure: no DOM, no `mu`.
 *
 *   Space.System   the catalog: bodies, charted stations, landing sites, factions; `now` (real unix s), `ic`, `rate`.
 *                  Admins always; a pilot while seated at a powered cockpit. `{active: false}` otherwise.
 *   Space.Traffic  ships: every one for an admin, the pilot's own (`self`) and its sensor-contact ships otherwise.
 *   Ship.Nav       the console readout (=status / =nav as data) while seated; `{active: false}` otherwise.
 */
import { AU_M, localPos, type Elements, type Vec } from './orbit';
import { burnState, type BurnLeg, type TargetAt } from './burn';

export type BodyType = 'star' | 'planet' | 'moon' | 'belt';
export interface Influence { factions: string[]; r: number }
export interface Body { kind: 'body'; id: string; name: string; type: BodyType; parent: string | null; o: Elements | null; mu: number; r_km: number; featured: boolean; influence: Influence | null }
export interface Station { kind: 'station'; id: string; name: string; parent: string; o: Elements | null; owner: string; blurb: string; influence: Influence | null }
export interface Site { kind: 'site'; id: string; name: string; parent: string; owner: string; blurb: string }
export interface Faction { id: string; name: string; color: string }
export interface Catalog {
  admin: boolean; now: number; ic: number; rate: number; rootId: string;
  bodies: Map<string, Body>; stations: Map<string, Station>; sites: Map<string, Site>; factions: Map<string, Faction>;
}
export interface Vessel { kind: 'ship'; id: string; name: string; hull: string; parent: string | null; o: Elements | null; pos: Vec; vel: Vec; burning: boolean; target: string; self: boolean; burn: BurnLeg | null }
export interface Traffic { admin: boolean; now: number; ic: number; rate: number; vessels: Vessel[] }

export interface NavContact { id: string; name: string; kind: 'body' | 'station' | 'ship'; dist_au: number }
export interface NavPlan {
  lost: boolean; target: { id: string; name: string; kind: string }; mode: string; maneuver: string; g: number; dist_m: number;
  errors: string[]; warnings: string[]; confirm: boolean; blocked: boolean; pass: boolean; pct: number; alt_m: number | null;
  route: string; closing_kms: number | null; eta: number | null; vp_kms: number | null; aim: Vec | null; waypoint: Vec | null;
  /** The burn :start would light now, then a limb route's leg 2 (an estimate). Empty when there is no flyable leg. */
  legs: BurnLeg[];
}
export interface NavUnderWay { target: { id: string; name: string }; maneuver: string; phase: string; label: string; frac: number; eta: number; g: number; pass: boolean; route: string; replan: string; warnings: string[]; aim: Vec | null;
  /** The leg being flown; leg 1 or 2 of a limb route (0: no route) and the whole trip's arrival (real s). */
  burn: BurnLeg | null; leg: number; t_final: number | null }
export interface Nav {
  active: true; console: string; ship: { id: string; name: string; squawk: string }; scrambled: string[];
  pos: Vec | null; vel: Vec | null;
  orbit: { body: string; body_id: string; alt_km: number; v_kms: number; period: number | null; course: string } | { body: ''; course: string };
  contacts: NavContact[]; destinations: NavContact[];
  burn: { g: number; min: number; max: number; rating: number };
  combat: boolean; crippled: string[]; comms: string; coast: string[];
  plan: NavPlan | null; under_way: NavUnderWay | null;
}

type R = Record<string, unknown>;
const isObj = (v: unknown): v is R => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
/** A MOO object reference as an id: '' for #-1 / missing. */
const ref = (v: unknown) => { const s = str(v); return s === '#-1' || s === '-1' ? '' : s.replace(/^#/, ''); };
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown) => v === true || v === 1;
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const vec = (v: unknown): Vec | null => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? { x: v[0], y: v[1] } : null);

const v0 = { x: 0, y: 0 };
/** One burn leg (#4709:_burn_desc as sent by $gmcp:_burn_wire); null when it is not one. */
export function legOf(v: unknown): BurnLeg | null {
  if (!isObj(v) || typeof v.t_start !== 'number' || typeof v.init_dist !== 'number' || typeof v.a !== 'number') return null;
  const opos = vec(v.opos), tpos0 = vec(v.tpos0);
  if (!opos || !tpos0) return null;
  return {
    tbody: ref(v.tbody), opos, tpos0, tvel0: vec(v.tvel0) ?? v0, t_start: v.t_start, init_dist: v.init_dist, stop_m: num(v.stop_m),
    t1: num(v.t1), coast: num(v.coast), a: v.a, v0: num(v.v0), vl: num(v.vl), ve: num(v.ve), pass: bool(v.pass), inertial: bool(v.inertial),
    toff: vec(v.toff) ?? v0, est: bool(v.est),
  };
}
const legsOf = (v: unknown) => (Array.isArray(v) ? v.map(legOf).filter((l): l is BurnLeg => !!l) : []);

export function elementsOf(v: unknown): Elements | null {
  if (!isObj(v) || typeof v.a !== 'number' || typeof v.e !== 'number') return null;
  const o: Elements = { a: v.a, e: v.e, om: num(v.om), M0: num(v.M0), ep: num(v.ep), rate: num(v.rate, 1) };
  if (typeof v.dir === 'number' && v.dir < 0) o.dir = -1;
  return o;
}
const factionsOf = (v: unknown) => (Array.isArray(v) ? v.map(str) : [str(v)]).filter(Boolean);
const TYPES: BodyType[] = ['star', 'planet', 'moon', 'belt'];

/** `Space.System` → a catalog; null for `{active: false}` or anything that is not one. */
export function catalogOf(d: unknown): Catalog | null {
  if (!isObj(d) || !bool(d.active) || !Array.isArray(d.bodies)) return null;
  const bodies = new Map<string, Body>(), stations = new Map<string, Station>(), sites = new Map<string, Site>(), factions = new Map<string, Faction>();
  for (const b of d.bodies) {
    if (!isObj(b) || !str(b.id)) continue;
    const inf = isObj(b.influence) && typeof b.influence.Rsys === 'number' && b.influence.Rsys > 0 ? { factions: factionsOf(b.influence.faction), r: b.influence.Rsys } : null;
    const type = TYPES.includes(b.type as BodyType) ? (b.type as BodyType) : 'moon';
    bodies.set(str(b.id), { kind: 'body', id: str(b.id), name: str(b.name) || str(b.id), type, parent: ref(b.parent) || null, o: elementsOf(b.o), mu: num(b.mu, 1), r_km: num(b.r_km), featured: bool(b.featured), influence: inf && inf.factions.length ? inf : null });
  }
  for (const s of Array.isArray(d.stations) ? d.stations : []) {
    if (!isObj(s) || !str(s.id) || !ref(s.parent)) continue;
    const owner = ref(s.owner);
    const r = num(s.influence_au);
    stations.set(str(s.id), { kind: 'station', id: str(s.id), name: str(s.name) || str(s.id), parent: ref(s.parent), o: elementsOf(s.o), owner, blurb: str(s.blurb), influence: owner && r > 0 ? { factions: [owner], r } : null });
  }
  for (const s of Array.isArray(d.landing_sites) ? d.landing_sites : []) {
    if (!isObj(s) || !str(s.id) || !ref(s.parent)) continue;
    sites.set(str(s.id), { kind: 'site', id: str(s.id), name: str(s.name) || str(s.id), parent: ref(s.parent), owner: ref(s.owner), blurb: str(s.blurb) });
  }
  for (const f of Array.isArray(d.factions) ? d.factions : []) {
    if (isObj(f) && str(f.id)) factions.set(str(f.id), { id: str(f.id), name: str(f.name) || str(f.id), color: /^#[0-9a-f]{6}$/i.test(str(f.color)) ? str(f.color) : '' });
  }
  const rootId = ref(d.root_id) || [...bodies.values()].find((b) => !b.parent)?.id || '';
  if (!rootId || !bodies.has(rootId)) return null;
  return { admin: bool(d.admin), now: num(d.now), ic: num(d.ic), rate: num(d.rate, 1) || 1, rootId, bodies, stations, sites, factions };
}

/** `Space.Traffic` → ships; null when it is not one. */
export function trafficOf(d: unknown): Traffic | null {
  if (!isObj(d) || !Array.isArray(d.vessels)) return null;
  const vessels: Vessel[] = [];
  for (const v of d.vessels) {
    if (!isObj(v) || !str(v.id)) continue;
    const pos = vec(v.pos), vel = vec(v.vel);
    if (!pos) continue;
    vessels.push({ kind: 'ship', id: str(v.id), name: str(v.name) || str(v.id), hull: str(v.hull), parent: ref(v.parent) || null, o: elementsOf(v.o), pos, vel: vel ?? { x: 0, y: 0 }, burning: bool(v.burning), target: ref(v.target), self: bool(v.self), burn: bool(v.burning) ? legOf(v.burn) : null });
  }
  return { admin: bool(d.admin), now: num(d.now), ic: num(d.ic), rate: num(d.rate, 1) || 1, vessels };
}

const KINDS = ['body', 'station', 'ship'] as const;
const contactsOf = (v: unknown): NavContact[] => (Array.isArray(v) ? v : []).filter(isObj).map((c) => ({ id: str(c.id), name: str(c.name), kind: (KINDS as readonly string[]).includes(str(c.kind)) ? (str(c.kind) as NavContact['kind']) : 'ship', dist_au: num(c.dist_au, NaN) })).filter((c) => c.name);

export function planOf(v: unknown): NavPlan | null {
  if (!isObj(v)) return null;
  const t = isObj(v.target) ? v.target : {};
  const target = { id: str(t.id), name: str(t.name), kind: str(t.kind) };
  const opt = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return {
    lost: bool(v.lost), target, mode: str(v.mode), maneuver: str(v.maneuver), g: num(v.g), dist_m: num(v.dist_m, NaN),
    errors: strs(v.errors), warnings: strs(v.warnings), confirm: bool(v.confirm), blocked: bool(v.blocked), pass: bool(v.pass), pct: num(v.pct, NaN),
    alt_m: opt(v.alt_m), route: str(v.route), closing_kms: opt(v.closing_kms), eta: opt(v.eta), vp_kms: opt(v.vp_kms), aim: vec(v.aim), waypoint: vec(v.waypoint), legs: legsOf(v.legs),
  };
}

function underWayOf(v: unknown): NavUnderWay | null {
  if (!isObj(v)) return null;
  const t = isObj(v.target) ? v.target : {};
  return { target: { id: str(t.id), name: str(t.name) }, maneuver: str(v.maneuver), phase: str(v.phase), label: str(v.label), frac: Math.min(1, Math.max(0, num(v.frac))), eta: num(v.eta), g: num(v.g), pass: bool(v.pass), route: str(v.route), replan: str(v.replan), warnings: strs(v.warnings), aim: vec(v.aim), burn: legOf(v.burn), leg: num(v.leg), t_final: typeof v.t_final === 'number' && v.t_final > 0 ? v.t_final : null };
}

/** `Ship.Nav` → the console; null for `{active: false}` or anything that is not one. */
export function navOf(d: unknown): Nav | null {
  if (!isObj(d) || !bool(d.active)) return null;
  const ship = isObj(d.ship) ? d.ship : {};
  const ob = isObj(d.orbit) ? d.orbit : {};
  const burn = isObj(d.burn) ? d.burn : {};
  const orbit: Nav['orbit'] = str(ob.body)
    ? { body: str(ob.body), body_id: str(ob.body_id), alt_km: num(ob.alt_km), v_kms: num(ob.v_kms), period: typeof ob.period === 'number' ? ob.period : null, course: str(ob.course) }
    : { body: '', course: str(ob.course) };
  return {
    active: true, console: str(d.console), ship: { id: str(ship.id), name: str(ship.name), squawk: str(ship.squawk) }, scrambled: strs(d.scrambled),
    pos: vec(d.pos), vel: vec(d.vel), orbit,
    contacts: contactsOf(d.contacts), destinations: contactsOf(d.destinations),
    burn: { g: num(burn.g, 1), min: num(burn.min, 0.01), max: num(burn.max, 1), rating: num(burn.rating, 1) },
    combat: bool(d.combat), crippled: strs(d.crippled), comms: str(d.comms), coast: strs(d.coast),
    plan: planOf(d.plan), under_way: underWayOf(d.under_way),
  };
}

/** A console line "[WARNING] DRIFTING: NO COURSE" → its tag and text. */
export function tagOf(line: string): { tag: string; text: string } {
  const m = /^\s*\[([A-Z ]+)\]\s*(.*)$/.exec(line);
  return m ? { tag: m[1]!.trim(), text: m[2]! } : { tag: '', text: line.trim() };
}

// ─── where things are ─────────────────────────────────────────────────────────────────────────────────────────

export type Thing = Body | Station | Site | Vessel;

/** World position (AU, heliocentric) of a body, station or site at real time `t`. Sites sit on their body. */
export function posOf(cat: Catalog, thing: Body | Station | Site, t: number, memo?: Map<string, Vec>): Vec {
  const hit = memo?.get(thing.id);
  if (hit) return hit;
  let p: Vec;
  if (thing.kind === 'site') p = posOf(cat, cat.bodies.get(thing.parent) ?? cat.bodies.get(cat.rootId)!, t, memo);
  else {
    const parent = thing.parent ? cat.bodies.get(thing.parent) : undefined;
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

/**
 * A ship at real time `t`: coasting ones by their elements around their parent; burning ones on their burn leg
 * (the game's own profile, riding the target); anything else carried on from the reported position at the reported
 * velocity (m per real second). `traffic` lets a burn that chases a ship find it.
 */
export function vesselPos(cat: Catalog | null, v: Vessel, t: number, sentAt: number, memo?: Map<string, Vec>, traffic?: Traffic | null): Vec {
  return vesselState(cat, v, t, sentAt, traffic ?? null, 1, memo).pos;
}

/** A ship's position (AU) and velocity (m per real s) at `t`. depth guards a burn chasing a burn chasing us. */
export function vesselState(cat: Catalog | null, v: Vessel, t: number, sentAt: number, traffic: Traffic | null, depth = 1, memo?: Map<string, Vec>): { pos: Vec; vel: Vec } {
  const parent = v.parent && cat ? cat.bodies.get(v.parent) : undefined;
  if (!v.burning && v.o && parent && cat) {
    const base = posOf(cat, parent, t, memo);
    const l = localPos(v.o, parent.mu, t);
    return { pos: { x: base.x + l.x, y: base.y + l.y }, vel: v.vel };
  }
  if (v.burning && v.burn && cat) return burnState(v.burn, t, depth < 3 ? targetAt(cat, traffic, sentAt, depth + 1) : undefined);
  const dt = t - sentAt;
  return { pos: { x: v.pos.x + (v.vel.x * dt) / AU_M, y: v.pos.y + (v.vel.y * dt) / AU_M }, vel: v.vel };
}

/**
 * Where a burn's target is at any time: a body or station from the catalog, a ship from the traffic. Velocity in m
 * per real s (bodies by a 2 s central difference). null for what the map cannot see: the leg then carries on its
 * ignition snapshot, exactly as the game does for a target that has left space.
 */
export function targetAt(cat: Catalog, traffic: Traffic | null, sentAt: number, depth = 1): TargetAt {
  return (id, t) => {
    const thing = cat.bodies.get(id) ?? cat.stations.get(id);
    if (thing) {
      const a = posOf(cat, thing, t - 1), b = posOf(cat, thing, t + 1), p = posOf(cat, thing, t);
      return { pos: p, vel: { x: ((b.x - a.x) / 2) * AU_M, y: ((b.y - a.y) / 2) * AU_M } };
    }
    const v = traffic?.vessels.find((x) => x.id === id);
    return v ? vesselState(cat, v, t, sentAt, traffic, depth) : null;
  };
}

/** The chain of frames from the root down to `id` (a body). */
export function chainOf(cat: Catalog, id: string): Body[] {
  const out: Body[] = [];
  let cur = cat.bodies.get(id);
  for (let guard = 0; cur && guard < 16; guard++) { out.unshift(cur); cur = cur.parent ? cat.bodies.get(cur.parent) : undefined; }
  return out;
}

export const childBodies = (cat: Catalog, id: string) => [...cat.bodies.values()].filter((b) => b.parent === id);
export const frameStations = (cat: Catalog, id: string) => [...cat.stations.values()].filter((s) => s.parent === id);
export const frameSites = (cat: Catalog, id: string) => [...cat.sites.values()].filter((s) => s.parent === id);
/** Whether a body has anything to show inside its own frame. */
export const hasFrame = (cat: Catalog, id: string) => childBodies(cat, id).length > 0 || frameStations(cat, id).length > 0 || frameSites(cat, id).length > 0;

/** The farthest apoapsis (AU) of what orbits in a frame: the scale of the frame. */
export function frameExtent(cat: Catalog, id: string, vessels: Vessel[] = []): number {
  let m = 0;
  for (const b of childBodies(cat, id)) if (b.o) m = Math.max(m, b.o.a * (1 + b.o.e));
  for (const s of frameStations(cat, id)) if (s.o) m = Math.max(m, s.o.a * (1 + s.o.e));
  for (const v of vessels) if (v.parent === id && v.o && !v.burning) m = Math.max(m, v.o.a * (1 + Math.min(v.o.e, 0.99)));
  if (!m) { const b = cat.bodies.get(id); m = b ? Math.max((b.r_km * 1000 * 8) / AU_M, 1e-5) : 1; }
  return m;
}

/**
 * The frame a ship is best seen in: its parent when it coasts around one; under thrust, the deepest frame on its
 * target's chain (the target itself when it is a body with a frame, else up through its parents: Earth for a leg
 * riding Earth, for Luna, or for a station on Earth) that the ship is inside (three of that frame's extents); else the root.
 */
export function frameOfVessel(cat: Catalog, v: Vessel): string {
  if (!v.burning) return v.parent && cat.bodies.has(v.parent) ? v.parent : cat.rootId;
  const tb = v.burn?.tbody || v.target;
  const tgt = cat.bodies.get(tb) ?? cat.stations.get(tb);
  if (!tgt) return cat.rootId;
  const start = tgt.kind === 'body' && hasFrame(cat, tgt.id) ? tgt.id : tgt.parent;
  for (const f of start ? chainOf(cat, start).reverse() : []) {
    if (f.id === cat.rootId) break;
    const c = posOf(cat, f, cat.now);
    if (Math.hypot(v.pos.x - c.x, v.pos.y - c.y) < 3 * frameExtent(cat, f.id)) return f.id;
  }
  return cat.rootId;
}
