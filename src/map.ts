/**
 * The System map panel: a canvas of one frame at a time (a body and what orbits it), Kepler-propagated live, with
 * breadcrumbs, pan (drag, arrows), zoom (wheel, + −), warp, faction territory (Sol frame), ships, and a side list or
 * detail. Colours are read from the theme tokens (`mu.theme.cssVar`), faction colours are game data.
 */
import { h } from '@muclient/sdk';
import { COPY } from './copy';
import { burnDuration, burnFlip, burnState, type BurnLeg } from './burn';
import { chainOf, childBodies, frameExtent, frameOfVessel, frameSites, frameStations, hasFrame, posOf, targetAt, vesselPos, type Body, type Catalog, type Nav, type Site, type Station, type Thing, type Traffic, type Vessel } from './model';
import { AU_M, ellipse, fmtDist, fmtDur, fmtIC, fmtKms, orbitSpeed, period, type Vec } from './orbit';

export interface MapData { cat: Catalog | null; catWall: number; traffic: Traffic | null; nav: Nav | null }
export interface MapDeps {
  css: Record<string, string>;
  data(): MapData;
  colors(): Palette;
  /** The world-scoped toggles, kept in settings. */
  pref(key: 'territory' | 'traffic'): boolean;
  setPref(key: 'territory' | 'traffic', on: boolean): void;
  /** Send a =nav command for the session. */
  send(cmd: string): void;
  calm(): boolean;
}
export interface Palette { bg: string; fg: string; dim: string; faint: string; accent: string; bright: string; gold: string; alert: string; ok: string; border: string; borderBright: string; font: string }

const WARPS: [number, string][] = [[0, '1×'], [60, '1m/s'], [3600, '1h/s'], [86400, '1d/s'], [86400 * 30, '30d/s']];
const COMPRESS = 0.42;
const TAU = Math.PI * 2;
const wall = () => Date.now() / 1000;

interface Pick { x: number; y: number; r: number; id: string }

/** Screen projection of a frame: a compressed radius (r/R)^0.42 so moons and planets share a view. Exported for tests. */
export function projector(center: Vec, extent: number, w: number, h: number, zoom: number, pan: Vec) {
  const R = Math.max(40, Math.min(w, h) / 2 - 34);
  const cx = w / 2 + pan.x, cy = h / 2 + pan.y;
  return (p: Vec): Vec => {
    const dx = p.x - center.x, dy = p.y - center.y;
    const r = Math.hypot(dx, dy);
    if (!r) return { x: cx, y: cy };
    const pr = Math.pow(r / extent, COMPRESS) * R * zoom;
    return { x: cx + (pr * dx) / r, y: cy - (pr * dy) / r };
  };
}

export class MapView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private side: HTMLElement;
  private crumbs: HTMLElement;
  private clock: HTMLElement;
  private warpEl: HTMLElement;
  private legend: HTMLElement;
  private modeEl: HTMLElement;
  private shipBtn: HTMLButtonElement;
  private terrBtn: HTMLButtonElement;
  private shipsBtn: HTMLButtonElement;
  private listBtn: HTMLButtonElement;
  private empty: HTMLElement;
  private stage: HTMLElement;

  frame = '';
  sel = '';
  hover = '';
  showList = false;
  zoom = 1;
  pan: Vec = { x: 0, y: 0 };
  /** Game seconds per real second; 0 is live. */
  warp = 0;
  /** Simulated real-unix time while warping. */
  private tSim = 0;
  private last = 0;
  private lastDraw = 0;
  private dirty = true;
  private raf = 0;
  private dead = false;
  private W = 0;
  private H = 0;
  private picks: Pick[] = [];
  private ro: ResizeObserver | null = null;
  private followed = false;
  private sideKey = '';

  constructor(private deps: MapDeps) {
    const css = deps.css;
    const tog = (label: string, on: boolean, testid: string, fn: () => void) => h('button', { class: css.toggle, type: 'button', 'aria-pressed': String(on), 'data-testid': testid, onclick: fn }, label) as HTMLButtonElement;
    const cmd = (label: string, testid: string, fn: () => void, title = '') => h('button', { class: css.cmd, type: 'button', 'data-testid': testid, title, onclick: fn }, label) as HTMLButtonElement;
    this.crumbs = h('nav', { class: 'crumbs', 'aria-label': COPY.frames, 'data-testid': 'nc-crumbs' });
    this.terrBtn = tog(COPY.territory, deps.pref('territory'), 'nc-territory', () => { deps.setPref('territory', !deps.pref('territory')); this.refresh(); });
    this.shipsBtn = tog(COPY.traffic, deps.pref('traffic'), 'nc-traffic', () => { deps.setPref('traffic', !deps.pref('traffic')); this.refresh(); });
    this.listBtn = tog(COPY.list, false, 'nc-list', () => { this.showList = !this.showList; if (this.showList) this.sel = ''; this.refresh(); });
    this.shipBtn = cmd(COPY.ship, 'nc-goto-ship', () => this.followShip(true));
    const zoomOut = cmd('−', 'nc-zoom-out', () => this.zoomBy(1 / 1.4), COPY.zoomOut);
    const zoomIn = cmd('+', 'nc-zoom-in', () => this.zoomBy(1.4), COPY.zoomIn);
    const reset = cmd('↺', 'nc-reset', () => { this.zoom = 1; this.pan = { x: 0, y: 0 }; this.dirty = true; }, COPY.resetView);
    for (const b of [zoomOut, zoomIn, reset]) b.classList.add(css.sq ?? 'sq');
    const bar = h('div', { class: 'bar' }, this.crumbs, h('span', { class: 'sp' }), this.shipBtn, this.terrBtn, this.shipsBtn, this.listBtn, zoomOut, zoomIn, reset);

    this.canvas = h('canvas', { class: 'sky', tabindex: '0', role: 'img', 'aria-label': COPY.mapTitle, 'data-testid': 'nc-canvas' }) as HTMLCanvasElement;
    this.ctx = (() => { try { return this.canvas.getContext('2d'); } catch { return null; } })();
    this.side = h('aside', { class: 'side', 'data-testid': 'nc-side', hidden: true });
    this.legend = h('div', { class: 'legend', 'data-testid': 'nc-legend' });
    this.empty = h('p', { class: `${css.empty} awaiting`, 'data-testid': 'nc-empty' }, COPY.waiting);
    this.stage = h('div', { class: 'stage' }, this.canvas, this.legend, this.empty, this.side);

    this.clock = h('span', { class: 'clock', 'data-testid': 'nc-clock' }, '—');
    this.warpEl = h('span', { class: 'warp', 'data-testid': 'nc-warp' });
    this.modeEl = h('span', { class: 'mode', 'data-testid': 'nc-mode' });
    const foot = h('div', { class: 'foot' }, h('span', { class: css.label }, COPY.icClock), this.clock, this.warpEl, h('span', { class: 'sp' }), this.modeEl, h('span', { class: 'hint' }, COPY.hintMap));

    this.el = h('section', { class: 'mu-navmap', 'aria-label': COPY.mapTitle, 'data-focus-region': 'navcomp.map', tabindex: '-1', 'data-testid': 'navmap' }, bar, this.stage, foot);
    this.bindInput();
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.stage); }
    this.refresh();
    if (typeof requestAnimationFrame !== 'undefined') this.raf = requestAnimationFrame((ts) => this.loop(ts));
  }

  destroy() {
    this.dead = true;
    if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.el.remove();
  }

  /** New data or prefs: fix the frame, redraw the DOM parts. */
  refresh() {
    const { cat } = this.deps.data();
    const css = this.deps.css;
    this.empty.hidden = !!cat;
    if (cat) {
      if (!this.frame || !cat.bodies.has(this.frame)) { this.frame = cat.rootId; this.followShip(false); }
      if (!this.followed && this.self()) this.followShip(false);
      if (this.sel && !this.thing(this.sel)) this.sel = '';
    }
    const on = (b: HTMLButtonElement, v: boolean) => b.setAttribute('aria-pressed', String(v));
    on(this.terrBtn, this.deps.pref('territory'));
    on(this.shipsBtn, this.deps.pref('traffic'));
    on(this.listBtn, this.showList);
    this.shipBtn.hidden = !this.self();
    this.renderCrumbs(cat);
    this.renderWarp();
    this.renderLegend(cat);
    this.renderSide();
    const { traffic, nav } = this.deps.data();
    this.modeEl.textContent = !cat ? '' : cat.admin ? COPY.modeAdmin : COPY.modePilot(nav?.ship.squawk || this.self()?.name || '');
    void traffic;
    this.dirty = true;
    void css;
  }

  /** Select a thing by id (from the nav panel): its frame, and its detail. */
  select(id: string) {
    const { cat } = this.deps.data();
    const t = this.thing(id);
    if (!cat || !t) return;
    this.frame = t.kind === 'body' ? (hasFrame(cat, t.id) ? t.id : t.parent ?? cat.rootId) : t.kind === 'ship' ? frameOfVessel(cat, t) : t.parent;
    this.sel = id; this.showList = false; this.zoom = 1; this.pan = { x: 0, y: 0 };
    this.refresh();
  }

  private self(): Vessel | undefined { return this.deps.data().traffic?.vessels.find((v) => v.self); }

  private followShip(force: boolean) {
    const { cat } = this.deps.data();
    const me = this.self();
    if (!cat || !me) return;
    if (!force && this.followed) return;
    this.followed = true;
    this.frame = frameOfVessel(cat, me);
    if (force) { this.sel = me.id; this.showList = false; this.zoom = 1; this.pan = { x: 0, y: 0 }; this.refresh(); }
  }

  private thing(id: string): Thing | undefined {
    const { cat, traffic } = this.deps.data();
    if (!cat) return undefined;
    return cat.bodies.get(id) ?? cat.stations.get(id) ?? cat.sites.get(id) ?? traffic?.vessels.find((v) => v.id === id);
  }

  // ─── time ────────────────────────────────────────────────────────────────────────────────────────────────

  /** Real-unix time the map shows. */
  now(): number {
    const { cat, catWall } = this.deps.data();
    if (!cat) return wall();
    const live = cat.now + (wall() - catWall);
    return this.warp ? this.tSim : live;
  }
  private setWarp(w: number) {
    if (w && !this.warp) this.tSim = this.now();
    this.warp = w;
    this.renderWarp();
    this.dirty = true;
  }

  // ─── DOM parts ───────────────────────────────────────────────────────────────────────────────────────────

  private renderCrumbs(cat: Catalog | null) {
    const css = this.deps.css;
    if (!cat) { this.crumbs.replaceChildren(); return; }
    const chain = chainOf(cat, this.frame);
    const extra = [...cat.bodies.values()].filter((b) => b.featured && !chain.includes(b));
    const me = this.self();
    const meFrame = me ? cat.bodies.get(frameOfVessel(cat, me)) : undefined;
    if (meFrame && !chain.includes(meFrame) && !extra.includes(meFrame)) extra.unshift(meFrame);
    const btn = (b: Body, i: number, inChain: boolean) => {
      const n = frameStations(cat, b.id).length;
      return h('button', { class: `${css.cmd} crumb`, type: 'button', 'data-testid': 'nc-crumb', 'data-id': b.id, 'aria-current': b.id === this.frame ? 'true' : undefined, 'aria-pressed': String(b.id === this.frame), onclick: () => this.goFrame(b.id) },
        inChain && i ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null, b.name, n ? h('span', { class: 'n' }, `${n}◆`) : null);
    };
    this.crumbs.replaceChildren(...chain.map((b, i) => btn(b, i, true)), ...(extra.length ? [h('span', { class: 'div', 'aria-hidden': 'true' }, '·')] : []), ...extra.map((b) => btn(b, 0, false)));
  }

  goFrame(id: string) {
    this.frame = id; this.zoom = 1; this.pan = { x: 0, y: 0 };
    if (this.sel && this.sel !== id) { const t = this.thing(this.sel); if (t && t.kind !== 'ship' && t.kind !== 'body' && t.parent !== id) this.sel = ''; }
    this.refresh();
  }

  private renderWarp() {
    const css = this.deps.css;
    this.warpEl.replaceChildren(...WARPS.map(([w, l]) => h('button', { class: css.toggle, type: 'button', 'aria-pressed': String(this.warp === w), 'data-testid': 'nc-warp-btn', 'data-w': String(w), title: COPY.warp(l), onclick: () => this.setWarp(w) }, l)),
      h('button', { class: css.cmd, type: 'button', 'data-testid': 'nc-now', disabled: this.warp ? undefined : true, onclick: () => this.setWarp(0) }, COPY.now));
  }

  private renderLegend(cat: Catalog | null) {
    const show = !!cat && this.deps.pref('territory') && this.frame === cat.rootId;
    this.legend.hidden = !show;
    if (!show || !cat) { this.legend.replaceChildren(); return; }
    const used = new Set<string>();
    for (const b of cat.bodies.values()) for (const f of b.influence?.factions ?? []) used.add(f);
    for (const s of cat.stations.values()) for (const f of s.influence?.factions ?? []) used.add(f);
    this.legend.replaceChildren(...[...cat.factions.values()].filter((f) => used.has(f.id)).map((f) =>
      h('span', { class: 'lg', 'data-testid': 'nc-faction' }, h('i', { style: f.color ? `background:${f.color}` : '' }), f.name)));
  }

  private renderSide() {
    const { cat, nav } = this.deps.data();
    const css = this.deps.css;
    const t = this.sel ? this.thing(this.sel) : undefined;
    const key = `${this.sel}|${this.showList}|${this.frame}|${!!nav}|${nav?.plan?.target.id ?? ''}|${nav?.under_way ? 1 : 0}|${this.deps.data().traffic?.vessels.length ?? 0}`;
    if (!cat || (!t && !this.showList)) { this.side.hidden = true; this.side.replaceChildren(); this.sideKey = ''; return; }
    if (key === this.sideKey && !this.side.hidden) return;
    this.sideKey = key;
    this.side.hidden = false;
    const close = h('button', { class: css.cmd, type: 'button', 'data-testid': 'nc-close', onclick: () => { this.sel = ''; this.showList = false; this.refresh(); this.canvas.focus(); } }, COPY.close);
    if (!t) {
      const rows = this.frameThings(cat).map((x) => h('button', { class: `${css.row} item`, type: 'button', 'data-testid': 'nc-item', 'data-id': x.id, onclick: () => this.pick(x.id) },
        h('span', { class: 'l1' }, h('span', { class: 'nm' }, x.name), h('span', { class: `${css.plate} ${css.dim}` }, kindLabel(x)))));
      this.side.replaceChildren(h('div', { class: 'shead' }, h('div', { class: css.secHead, role: 'heading', 'aria-level': '3' }, COPY.inFrame, h('span', { class: css.secClose, 'aria-hidden': 'true' })), close),
        ...(rows.length ? rows : [h('p', { class: `${css.empty} awaiting` }, COPY.nothingInFrame)]));
      return;
    }
    this.side.replaceChildren(...this.detail(cat, t, nav, close));
  }

  /** What the frame holds, for the list: bodies, stations, sites, ships. */
  private frameThings(cat: Catalog): Thing[] {
    const out: Thing[] = [cat.bodies.get(this.frame)!, ...childBodies(cat, this.frame), ...frameStations(cat, this.frame), ...frameSites(cat, this.frame)];
    if (this.deps.pref('traffic')) out.push(...this.shipsInFrame(cat));
    return out.filter(Boolean);
  }

  private shipsInFrame(cat: Catalog): Vessel[] {
    const vs = this.deps.data().traffic?.vessels ?? [];
    const chain = new Set(chainOf(cat, this.frame).map((b) => b.id));
    return vs.filter((v) => {
      const f = frameOfVessel(cat, v);
      if (f === this.frame) return true;
      // Your own ship shows in every frame above its own (the course line starts there); burning ships in Sol.
      if (v.self) return chainOf(cat, f).some((b) => b.id === this.frame);
      return v.burning && chainOf(cat, f).some((b) => b.id === this.frame) && chain.size > 0;
    });
  }

  private detail(cat: Catalog, t: Thing, nav: Nav | null, close: HTMLElement): HTMLElement[] {
    const css = this.deps.css;
    const rows: [string, string, string?][] = [];
    const fac = (ids: string[]) => ids.map((id) => cat.factions.get(id)?.name ?? id).join(' · ');
    const tNow = this.now();
    const me = this.self();
    const myPos = me ? vesselPos(cat, me, tNow, this.deps.data().traffic?.now ?? tNow) : nav?.pos ?? null;
    const where = t.kind === 'ship' ? vesselPos(cat, t, tNow, this.deps.data().traffic?.now ?? tNow) : posOf(cat, t, tNow);
    if (t.kind === 'body') {
      const parent = t.parent ? cat.bodies.get(t.parent) : undefined;
      rows.push([COPY.fType, COPY.kind[t.type] ?? t.type]);
      if (parent) rows.push([COPY.fParent, parent.name]);
      if (t.r_km) rows.push([COPY.fRadius, `${Math.round(t.r_km).toLocaleString('en-US')} km`]);
      if (t.o && parent) {
        rows.push([COPY.fSemi, fmtDist(t.o.a)]);
        rows.push([COPY.fEcc, t.o.e.toFixed(3)]);
        const p = period(t.o, parent.mu);
        if (p) rows.push([COPY.fPeriod, fmtDur(p) + (t.o.dir === -1 ? ` · ${COPY.retro}` : '')]);
      }
      if (t.influence) rows.push([COPY.fSpace, fac(t.influence.factions), 'fac']);
      const st = frameStations(cat, t.id).length, si = frameSites(cat, t.id).length;
      if (st) rows.push([COPY.fStations, String(st)]);
      if (si) rows.push([COPY.fSites, String(si)]);
    } else if (t.kind === 'station') {
      const parent = cat.bodies.get(t.parent);
      if (parent) rows.push([COPY.fParent, parent.name]);
      if (t.o && parent) { rows.push([COPY.fSemi, fmtDist(t.o.a)]); const p = period(t.o, parent.mu); if (p) rows.push([COPY.fPeriod, fmtDur(p) + (t.o.dir === -1 ? ` · ${COPY.retro}` : '')]); }
      rows.push([COPY.fOwner, t.owner ? fac([t.owner]) : COPY.independent, t.owner ? 'fac' : undefined]);
      if (t.influence) rows.push([COPY.fReach, fmtDist(t.influence.r)]);
    } else if (t.kind === 'site') {
      const parent = cat.bodies.get(t.parent);
      if (parent) rows.push([COPY.fOn, parent.name]);
      if (t.owner) rows.push([COPY.fOwner, fac([t.owner]), 'fac']);
    } else {
      if (t.hull) rows.push([COPY.fHull, t.hull]);
      rows.push([COPY.fState, t.burning ? COPY.burning : COPY.coasting]);
      if (t.burning && t.target) rows.push([COPY.fBound, this.thing(t.target)?.name ?? t.target]);
      const parent = t.parent ? cat.bodies.get(t.parent) : undefined;
      if (!t.burning && parent) rows.push([COPY.fParent, parent.name]);
      // A coaster's speed relative to what it orbits (as the console reports it); a burner's as sent, which is m per
      // real second, so divide by the clock rate for m per game second.
      if (!t.burning && parent && t.o) rows.push([COPY.fSpeed, fmtKms(orbitSpeed(t.o, parent.mu, tNow) / 1000)]);
      else rows.push([COPY.fSpeed, fmtKms(Math.hypot(t.vel.x, t.vel.y) / 1000 / (cat.rate || 1))]);
    }
    if (myPos && !(t.kind === 'ship' && t.self)) rows.push([COPY.fRange, fmtDist(Math.hypot(where.x - myPos.x, where.y - myPos.y))]);

    const acts: HTMLElement[] = [];
    if (t.kind === 'body' && t.id !== this.frame && hasFrame(cat, t.id)) acts.push(h('button', { class: css.cmd, type: 'button', 'data-testid': 'nc-enter', onclick: () => this.goFrame(t.id) }, COPY.enterFrame));
    const target = navName(t, nav);
    if (nav && !nav.under_way && !nav.scrambled.length && target) {
      acts.push(h('button', { class: `${css.cmd} primary`, type: 'button', 'data-testid': 'nc-plot', onclick: () => this.deps.send(COPY.cmd.target(target)) }, COPY.plotCourse));
      if (t.kind === 'ship') acts.push(h('button', { class: css.cmd, type: 'button', 'data-testid': 'nc-pass', onclick: () => this.deps.send(COPY.cmd.pass(target)) }, COPY.pass));
    }
    const plate = t.kind === 'ship' && t.self ? h('span', { class: `${css.plate} ${css.ok}` }, COPY.you) : h('span', { class: `${css.plate} ${css.dim}` }, kindLabel(t));
    return [
      h('div', { class: 'shead' }, h('span', { class: 'ttl', 'data-testid': 'nc-detail-name' }, t.name), plate, close),
      h('dl', { class: 'facts', 'data-testid': 'nc-facts' }, ...rows.flatMap(([k, v, cls]) => [h('dt', {}, k), h('dd', { class: cls ?? '' }, v)])),
      ...(t.kind !== 'ship' && 'blurb' in t && t.blurb ? [h('p', { class: 'blurb' }, t.blurb)] : []),
      ...(acts.length ? [h('div', { class: 'acts' }, ...acts)] : []),
    ];
  }

  private pick(id: string) {
    const { cat } = this.deps.data();
    const t = this.thing(id);
    if (!cat || !t) return;
    this.sel = id; this.showList = false;
    this.refresh();
  }

  // ─── input ───────────────────────────────────────────────────────────────────────────────────────────────

  private zoomBy(k: number, at?: Vec) {
    const z = Math.min(40, Math.max(0.3, this.zoom * k));
    const f = z / this.zoom;
    const v = this.view(), cx = v.w / 2, cy = v.h / 2;
    const c = at ?? { x: cx, y: cy };
    // Keep the point under the cursor still: the projection scales linearly with zoom about the centre.
    this.pan = { x: c.x - cx - (c.x - cx - this.pan.x) * f, y: c.y - cy - (c.y - cy - this.pan.y) * f };
    this.zoom = z;
    this.dirty = true;
  }

  private bindInput() {
    const cv = this.canvas;
    let down: { x: number; y: number; px: number; py: number; drag: boolean } | null = null;
    const local = (e: { clientX: number; clientY: number }) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => { const p = local(e); down = { x: p.x, y: p.y, px: this.pan.x, py: this.pan.y, drag: false }; try { cv.setPointerCapture(e.pointerId); } catch { /* happy-dom */ } });
    cv.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (down) {
        const dx = p.x - down.x, dy = p.y - down.y;
        if (!down.drag && Math.hypot(dx, dy) > 4) down.drag = true;
        if (down.drag) { this.pan = { x: down.px + dx, y: down.py + dy }; this.dirty = true; cv.style.cursor = 'grabbing'; return; }
      }
      const hit = this.hit(p.x, p.y);
      if ((hit?.id ?? '') !== this.hover) { this.hover = hit?.id ?? ''; this.dirty = true; }
      cv.style.cursor = hit ? 'pointer' : 'grab';
      cv.title = hit ? this.thing(hit.id)?.name ?? '' : '';
    });
    const up = (e: PointerEvent) => {
      if (!down) return;
      const p = local(e);
      const wasDrag = down.drag;
      down = null;
      cv.style.cursor = '';
      if (wasDrag) return;
      this.clickAt(p.x, p.y);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { down = null; });
    cv.addEventListener('pointerleave', () => { if (this.hover) { this.hover = ''; this.dirty = true; } });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, local(e)); }, { passive: false });
    cv.addEventListener('dblclick', (e) => { const p = local(e); const hit = this.hit(p.x, p.y); const { cat } = this.deps.data(); if (hit && cat?.bodies.has(hit.id) && hasFrame(cat, hit.id)) this.goFrame(hit.id); });
    cv.addEventListener('keydown', (e) => {
      const step = 40;
      const k = e.key;
      if (k === 'ArrowLeft') this.pan.x += step; else if (k === 'ArrowRight') this.pan.x -= step;
      else if (k === 'ArrowUp') this.pan.y += step; else if (k === 'ArrowDown') this.pan.y -= step;
      else if (k === '+' || k === '=') this.zoomBy(1.25); else if (k === '-' || k === '_') this.zoomBy(0.8);
      else if (k === 'Escape') { if (this.sel || this.showList) { this.sel = ''; this.showList = false; this.refresh(); } else { const { cat } = this.deps.data(); const up1 = cat?.bodies.get(this.frame)?.parent; if (up1) this.goFrame(up1); } }
      else return;
      e.preventDefault();
      this.dirty = true;
    });
  }

  /** A click on the canvas: select what is under it (bodies with a frame open it on a second click), else clear. */
  clickAt(x: number, y: number) {
    const hit = this.hit(x, y);
    const { cat } = this.deps.data();
    if (!hit || !cat) { if (this.sel) { this.sel = ''; this.refresh(); } return; }
    if (hit.id === this.sel && cat.bodies.has(hit.id) && hasFrame(cat, hit.id) && hit.id !== this.frame) { this.goFrame(hit.id); return; }
    this.sel = hit.id; this.showList = false;
    this.refresh();
  }

  private hit(x: number, y: number): Pick | null {
    let best: Pick | null = null, bd = Infinity;
    for (const p of this.picks) { const d = Math.hypot(p.x - x, p.y - y); if (d <= p.r && d < bd) { best = p; bd = d; } }
    return best;
  }

  /** The part of the stage the side panel leaves uncovered: it docks right, or along the bottom on a narrow stage. */
  private view(): { w: number; h: number } {
    if (this.side.hidden) return { w: this.W, h: this.H };
    const bottom = this.side.offsetWidth >= this.W - 1;
    return bottom ? { w: this.W, h: Math.max(80, this.H - this.side.offsetHeight) } : { w: Math.max(120, this.W - this.side.offsetWidth), h: this.H };
  }

  private resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    this.W = Math.max(1, Math.floor(r.width)); this.H = Math.max(1, Math.floor(r.height));
    this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
    this.canvas.style.width = `${this.W}px`; this.canvas.style.height = `${this.H}px`;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  // ─── drawing ─────────────────────────────────────────────────────────────────────────────────────────────

  private loop(ts: number) {
    if (this.dead) return;
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = this.last ? Math.min(0.25, (ts - this.last) / 1000) : 0;
    this.last = ts;
    const { cat } = this.deps.data();
    if (this.warp && cat) this.tSim += (dt * this.warp) / (cat.rate || 1);
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!this.el.isConnected || !this.W) return;
    // Live: four frames a second is plenty (a coasting ship moves a pixel a minute); warping, every frame unless calm.
    const every = this.warp && !this.deps.calm() ? 0 : 250;
    if (!this.dirty && ts - this.lastDraw < every) return;
    this.lastDraw = ts; this.dirty = false;
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
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
    const frame = cat.bodies.get(this.frame) ?? cat.bodies.get(cat.rootId)!;
    const memo = new Map<string, Vec>();
    const ships = this.deps.pref('traffic') ? this.shipsInFrame(cat) : [];
    const extent = frameExtent(cat, frame.id, ships);
    const center = posOf(cat, frame, t, memo);
    // An open side panel covers the right of the stage: centre the frame in what is left.
    const V = this.view();
    const proj = projector(center, extent, V.w, V.h, this.zoom, this.pan);
    const font = (px: number, w = 400) => `${w} ${px}px ${P.font || 'monospace'}`;
    // Labels are queued and placed last, most important first; one that would overlap a placed label (or run off
    // the canvas) is dropped unless it is selected or hovered.
    const labels: { text: string; x: number; y: number; hot: boolean; color: string; pri: number }[] = [];
    const label = (text: string, x: number, y: number, hot: boolean, color = P.dim, pri = 1) => { labels.push({ text, x, y, hot, color, pri: hot ? 99 : pri }); };
    const ring = (x: number, y: number, r: number, id: string) => {
      if (id !== this.sel && id !== this.hover) return;
      ctx.strokeStyle = id === this.sel ? P.bright : P.dim; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.stroke();
    };

    // Territory (Sol frame only: the radii are heliocentric).
    if (this.deps.pref('territory') && frame.id === cat.rootId) {
      const srcs: { p: Vec; r: number; f: string[] }[] = [];
      for (const b of cat.bodies.values()) if (b.influence) srcs.push({ p: posOf(cat, b, t, memo), r: b.influence.r, f: b.influence.factions });
      for (const s of cat.stations.values()) if (s.influence && s.parent === cat.rootId) srcs.push({ p: posOf(cat, s, t, memo), r: s.influence.r, f: s.influence.factions });
      for (const s of srcs) {
        const sp = proj(s.p);
        const ex = proj({ x: s.p.x + s.r, y: s.p.y }), ey = proj({ x: s.p.x, y: s.p.y + s.r }), wx = proj({ x: s.p.x - s.r, y: s.p.y }), wy = proj({ x: s.p.x, y: s.p.y - s.r });
        const rs = Math.max(4, (Math.hypot(ex.x - sp.x, ex.y - sp.y) + Math.hypot(ey.x - sp.x, ey.y - sp.y) + Math.hypot(wx.x - sp.x, wx.y - sp.y) + Math.hypot(wy.x - sp.x, wy.y - sp.y)) / 4);
        const cols = s.f.map((id) => cat.factions.get(id)?.color || P.faint);
        ctx.globalAlpha = 0.08; ctx.fillStyle = cols[0]!;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, rs, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
        if (cols.length > 1) {
          cols.forEach((c, i) => { ctx.strokeStyle = c; ctx.setLineDash([6, 6 * (cols.length - 1)]); ctx.lineDashOffset = -i * 6; ctx.beginPath(); ctx.arc(sp.x, sp.y, rs, 0, TAU); ctx.stroke(); });
          ctx.setLineDash([]); ctx.lineDashOffset = 0;
        } else { ctx.strokeStyle = cols[0]!; ctx.beginPath(); ctx.arc(sp.x, sp.y, rs, 0, TAU); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    }

    // Orbits.
    const path = (o: NonNullable<Body['o']>, base: Vec, color: string, dash: number[]) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash);
      ctx.beginPath();
      ellipse(o, 120).forEach((q, i) => { const s = proj({ x: base.x + q.x, y: base.y + q.y }); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    const kids = childBodies(cat, frame.id);
    for (const b of kids) if (b.o) path(b.o, center, b.type === 'belt' ? P.border : P.borderBright, []);
    const stations = frameStations(cat, frame.id);
    for (const s of stations) if (s.o) path(s.o, center, P.border, [3, 4]);

    // The central body and its landing sites.
    const cp = proj(center);
    const CR = frame.type === 'star' ? 11 : 8;
    ctx.fillStyle = bodyColor(frame, P);
    ctx.beginPath(); ctx.arc(cp.x, cp.y, CR, 0, TAU); ctx.fill();
    ring(cp.x, cp.y, CR, frame.id);
    label(frame.name, cp.x, cp.y + CR + 5, frame.id === this.sel || frame.id === this.hover, P.fg, 9);
    this.picks.push({ x: cp.x, y: cp.y, r: CR + 6, id: frame.id });
    const sites = frameSites(cat, frame.id);
    sites.forEach((s, i) => {
      const a = -Math.PI / 2 + ((i + 0.5) / sites.length) * TAU;
      const x = cp.x + (CR + 14) * Math.cos(a), y = cp.y + (CR + 14) * Math.sin(a);
      diamond(ctx, x, y, 3.5, s.owner ? cat.factions.get(s.owner)?.color || P.dim : P.dim);
      ring(x, y, 3, s.id);
      if (s.id === this.sel || s.id === this.hover) label(s.name, x, y + 7, true);
      this.picks.push({ x, y, r: 9, id: s.id });
    });

    // Child bodies.
    for (const b of kids) {
      const sp = proj(posOf(cat, b, t, memo));
      const r = b.type === 'planet' ? 4.5 : b.type === 'belt' ? 2.5 : 3.2;
      ctx.fillStyle = bodyColor(b, P);
      ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, TAU); ctx.fill();
      if (hasFrame(cat, b.id)) { ctx.strokeStyle = P.faint; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sp.x, sp.y, r + 2.5, 0, TAU); ctx.stroke(); }
      ring(sp.x, sp.y, r, b.id);
      label(b.name, sp.x, sp.y + r + 5, b.id === this.sel || b.id === this.hover, P.dim, b.featured ? 7 : b.type === 'planet' ? 6 : b.type === 'moon' ? 5 : 2);
      this.picks.push({ x: sp.x, y: sp.y, r: 12, id: b.id });
    }
    // Stations.
    for (const s of stations) {
      const sp = proj(posOf(cat, s, t, memo));
      const own = s.owner ? cat.factions.get(s.owner)?.color : '';
      ctx.fillStyle = own || P.gold; ctx.strokeStyle = P.gold; ctx.lineWidth = 1;
      ctx.fillRect(sp.x - 3, sp.y - 3, 6, 6); ctx.strokeRect(sp.x - 3.5, sp.y - 3.5, 7, 7);
      ring(sp.x, sp.y, 4, s.id);
      label(s.name, sp.x, sp.y + 8, s.id === this.sel || s.id === this.hover, P.gold, 3);
      this.picks.push({ x: sp.x, y: sp.y, r: 11, id: s.id });
    }

    // Ships and the course.
    const sentAt = traffic?.now ?? t;
    const tgt = targetAt(cat, traffic ?? null, sentAt);
    const me = traffic?.vessels.find((v) => v.self);
    const course = courseOf(nav, me ?? null);
    if (me && ships.includes(me) && course) {
      const blocked = !!nav?.plan?.blocked;
      this.drawCourse(ctx, proj, cat, center, frame.id, t, course, tgt, blocked ? P.alert : P.bright, P, label);
    } else if (me && ships.includes(me)) {
      // No flyable leg (a blocked plan, an old server): the straight line to the aim, as before.
      const aim = nav?.under_way?.aim ?? nav?.plan?.aim ?? null;
      const wp = nav?.plan?.waypoint ?? null;
      if (aim) {
        const a = proj(vesselPos(cat, me, t, sentAt, memo, traffic));
        ctx.strokeStyle = nav?.plan?.blocked ? P.alert : P.bright; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        if (wp && (wp.x !== aim.x || wp.y !== aim.y)) { const w = proj(wp); ctx.lineTo(w.x, w.y); }
        const b = proj(aim); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        crosshair(ctx, b, nav?.plan?.blocked ? P.alert : P.bright);
      }
    }
    // Other burning ships (an admin sees them all): their path from here to arrival, faint gold.
    for (const v of ships) if (v.burning && v.burn && !v.self) this.drawCourse(ctx, proj, cat, center, frame.id, t, { legs: [v.burn], from: v.burn.t_start, live: true }, tgt, P.gold, P, null, 0.45);
    for (const v of ships) {
      const sp = proj(vesselPos(cat, v, t, sentAt, memo, traffic));
      const col = v.self ? P.ok : v.burning ? P.gold : P.fg;
      const vv = v.burning && v.burn ? burnState(v.burn, t, tgt).vel : v.vel;
      const ang = Math.atan2(-vv.y, vv.x);
      if (v.burning) { ctx.strokeStyle = P.gold; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(sp.x - 12 * Math.cos(ang), sp.y - 12 * Math.sin(ang)); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(ang);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 3.6); ctx.lineTo(-2, 0); ctx.lineTo(-4, -3.6); ctx.closePath(); ctx.fill();
      ctx.restore();
      ring(sp.x, sp.y, 5, v.id);
      if (v.self || v.id === this.sel || v.id === this.hover) label(v.name, sp.x, sp.y + 9, v.id === this.sel || v.id === this.hover, v.self ? P.ok : P.dim, v.self ? 8 : 4);
      this.picks.push({ x: sp.x, y: sp.y, r: 10, id: v.id });
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const placed: [number, number, number, number][] = [];
    for (const l of labels.sort((a, b) => b.pri - a.pri)) {
      const text = l.text.toUpperCase();
      ctx.font = font(10, l.hot ? 500 : 400);
      const w = ctx.measureText(text).width, x0 = l.x - w / 2 - 2, y0 = l.y - 1, x1 = l.x + w / 2 + 2, y1 = l.y + 12;
      if (!l.hot && (x0 < 0 || x1 > W || y1 > H || placed.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b))) continue;
      placed.push([x0, y0, x1, y1]);
      ctx.fillStyle = l.hot ? P.fg : l.color; ctx.fillText(text, l.x, l.y);
    }
    void AU_M;
  }

  /**
   * One course: each leg sampled on the game's own profile from `from` to its arrival, drawn RELATIVE TO THE FRAME
   * BODY at each instant (the path the ship traces as seen in this frame), the flown part solid and the rest dashed;
   * a tick at the flip, a diamond at a limb waypoint, a crosshair at the aim with the time to go, and the target
   * where it will be at arrival (a hollow square). `label` null: no marks (other ships).
   */
  private drawCourse(ctx: CanvasRenderingContext2D, proj: (p: Vec) => Vec, cat: Catalog, center: Vec, frameId: string, t: number,
    course: Course, tgt: ReturnType<typeof targetAt>, color: string, P: Palette,
    label: ((text: string, x: number, y: number, hot: boolean, color?: string, pri?: number) => void) | null, alpha = 1) {
    const frameBody = cat.bodies.get(frameId)!;
    const rel = (p: Vec, at: number): Vec => {
      // The frame body moves during a long burn: put each sample where it is relative to the body then, about the body now.
      if (frameId === cat.rootId) return p;
      const c = posOf(cat, frameBody, at);
      return { x: center.x + p.x - c.x, y: center.y + p.y - c.y };
    };
    ctx.save(); ctx.globalAlpha = alpha; ctx.lineWidth = 1; ctx.strokeStyle = color;
    const N = 96;
    course.legs.forEach((L, i) => {
      const t0 = i === 0 ? Math.max(L.t_start, course.from) : L.t_start;
      const end = L.t_start + burnDuration(L);
      if (!(end > t0)) return;
      // Samples bunch where the ship is slow (ignition, arrival) so the ends stay smooth: u in [0,1] → (1 − cos πu)/2.
      const pts: { t: number; s: Vec }[] = [];
      for (let k = 0; k <= N; k++) { const at = t0 + (end - t0) * (1 - Math.cos((Math.PI * k) / N)) / 2; pts.push({ t: at, s: proj(rel(burnState(L, at, tgt).pos, at)) }); }
      const stroke = (from: number, to: number, dash: number[]) => {
        const seg = pts.filter((q) => q.t >= from && q.t <= to);
        if (seg.length < 2) return;
        ctx.setLineDash(dash); ctx.beginPath(); seg.forEach((q, j) => (j ? ctx.lineTo(q.s.x, q.s.y) : ctx.moveTo(q.s.x, q.s.y))); ctx.stroke();
      };
      const now = Math.min(Math.max(t, t0), end);
      if (course.live) { stroke(t0, now, []); stroke(now, end, [5, 4]); }
      else stroke(t0, end, L.est ? [2, 4] : [5, 4]);
      ctx.setLineDash([]);
      if (!label) return;
      const fl = burnFlip(L);
      if (fl && fl > t0 && fl < end) {
        const a = proj(rel(burnState(L, fl - 1, tgt).pos, fl - 1)), b = proj(rel(burnState(L, fl + 1, tgt).pos, fl + 1));
        const nx = -(b.y - a.y), ny = b.x - a.x, n = Math.hypot(nx, ny) || 1;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.beginPath(); ctx.moveTo(m.x - (5 * nx) / n, m.y - (5 * ny) / n); ctx.lineTo(m.x + (5 * nx) / n, m.y + (5 * ny) / n); ctx.stroke();
        if (fl > t) label(COPY.markFlip, m.x, m.y + 7, false, color, 3);
      }
      const last = i === course.legs.length - 1;
      const ep = pts.at(-1)!.s;
      if (!last) { diamond(ctx, ep.x, ep.y, 3.5, color); label(COPY.markLimb, ep.x, ep.y + 7, false, P.dim, 3); return; }
      if (course.then) {
        // Leg 1 of a limb route under way: leg 2 is solved at the limb, so only where it ends is known.
        const tg = tgt(course.then.id, course.then.t);
        diamond(ctx, ep.x, ep.y, 3.5, color); label(COPY.markLimb, ep.x, ep.y + 7, false, P.dim, 3);
        if (!tg) return;
        const q = proj(rel(tg.pos, course.then.t));
        ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(ep.x, ep.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
        crosshair(ctx, q, color);
        const left = course.then.t - t;
        if (left > 0) label(COPY.markArrive(fmtDur(left * cat.rate)), q.x, q.y + 10, false, color, 8);
        return;
      }
      // The aim, and the target there at arrival (it is where the ship stops when stop_m is 0).
      crosshair(ctx, ep, color);
      const tg = L.tbody ? tgt(L.tbody, end) : null;
      if (tg && L.stop_m > 0) {
        const q = proj(rel(tg.pos, end));
        ctx.strokeRect(q.x - 3.5, q.y - 3.5, 7, 7);
      }
      const left = (course.tFinal ?? end) - t;
      if (left > 0) label(COPY.markArrive(fmtDur(left * cat.rate)), ep.x, ep.y + 10, false, color, 8);
    });
    ctx.restore();
  }
}

/** What the course line is made of: the legs, the time the path starts, whether it is being flown. */
export interface Course { legs: BurnLeg[]; from: number; live: boolean; tFinal?: number | null; then?: { id: string; t: number } | null }
/**
 * The course to draw for your ship: under way, the leg being flown (from ignition: the flown part goes solid; leg 2
 * of a limb route is solved at the handoff, so only the current leg is known); a plan, its legs from now. null when
 * there is no flyable leg. Exported for tests.
 */
export function courseOf(nav: Nav | null, me: Vessel | null): Course | null {
  const uw = nav?.under_way;
  if (uw) { const L = uw.burn ?? me?.burn ?? null; return L ? { legs: [L], from: L.t_start, live: true, tFinal: uw.t_final, then: uw.leg === 1 && uw.t_final && uw.target.id ? { id: uw.target.id, t: uw.t_final } : null } : null; }
  const p = nav?.plan;
  if (p && !p.lost && p.legs.length) return { legs: p.legs, from: p.legs[0]!.t_start, live: false };
  return null;
}
function crosshair(ctx: CanvasRenderingContext2D, b: Vec, color: string) {
  ctx.strokeStyle = color; ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, TAU); ctx.moveTo(b.x - 8, b.y); ctx.lineTo(b.x + 8, b.y); ctx.moveTo(b.x, b.y - 8); ctx.lineTo(b.x, b.y + 8); ctx.stroke();
}

function bodyColor(b: Body, P: Palette) {
  return b.type === 'star' ? P.gold : b.type === 'planet' ? P.bright : b.type === 'belt' ? P.faint : P.dim;
}
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
}
export function kindLabel(t: Thing): string {
  return t.kind === 'body' ? COPY.kind[t.type] ?? t.type : COPY.kind[t.kind] ?? t.kind;
}
/**
 * What to type after `=nav` for a thing, or '' when the console cannot target it: bodies (not the star) and
 * stations by name; ships under the callsign the traffic carries (a sensor contact, for a pilot). Exported for tests.
 */
export function navName(t: Thing, nav: Nav | null): string {
  if (!nav) return '';
  if (t.kind === 'site') return '';
  if (t.kind === 'ship') return t.self ? '' : t.name;
  if (t.kind === 'body') return t.type === 'star' || (nav.orbit.body && 'body_id' in nav.orbit && nav.orbit.body_id === t.id) ? '' : t.name;
  return (t as Station).name;
}
export type { Site };
