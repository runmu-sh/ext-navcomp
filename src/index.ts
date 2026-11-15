/**
 * Navcomp (@runmu.sh/ext-navcomp): Torchship's solar system and flight console as two panels.
 *
 *   System map   the catalog (Space.System) Kepler-propagated on a canvas, one frame at a time, with breadcrumbs,
 *                pan / zoom / warp, faction territory, ships (Space.Traffic) and a detail side. Admins have it always;
 *                a pilot while seated at a powered cockpit, centred on their ship, with the plotted course drawn.
 *   Navigation   the =nav console (Ship.Nav) as a UI: ship and orbit, the flight plan with its error and warning plates,
 *                EXECUTE / EXECUTE ANYWAY / CANCEL / ABORT, a burn slider, and a target picker. Every control sends
 *                the typed =nav command, so the console's answer shows in the terminal as usual.
 *
 * Both are `show: 'auto'`: each joins the session the first time it has something to draw. A panel mounted with
 * no data asks for it once (`Space.Get`). Activation is `onGmcp:Space` / `onGmcp:Ship`.
 */
import { defineExtension, h, type Dispose, type Mu, type PanelMountCtx } from '@muclient/sdk';
import { COPY } from './copy';
import { catalogOf, navOf, trafficOf, type Catalog, type Nav, type Traffic } from './model';
import { MapView, type Palette } from './map';
import { NavView } from './nav';

export { COPY } from './copy';
export { catalogOf, elementsOf, navOf, trafficOf, posOf, vesselPos, vesselState, targetAt, legOf, chainOf, frameExtent, tagOf, planOf } from './model';
export * from './burn';
export type { Catalog, Nav, Traffic, Body, Station, Site, Vessel, NavPlan, NavContact } from './model';
export { projector, navName, courseOf } from './map';
export { targetRows, clampG } from './nav';
export * from './orbit';

const ID = 'navcomp';
export const MAP = 'navcomp.map';
export const NAV = 'navcomp.nav';
export const SETTINGS = { territory: 'map.territory', traffic: 'map.traffic' } as const;

const R = `.ext-panel[data-ext="${ID}"]`;
const M = `${R} .mu-navmap`;
const N = `${R} .mu-navcon`;
/** Theme tokens only, every rule under the panel root. Faction colours (game data) are set inline. */
export const NAVCOMP_CSS = `
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

interface SessionState { cat: Catalog | null; catWall: number; traffic: Traffic | null; nav: Nav | null; asked: boolean }

export default defineExtension({
  activate(ctx) {
    const mu: Mu = ctx.mu;
    mu.ui.style(NAVCOMP_CSS);
    const css = mu.ui.css as unknown as Record<string, string>;

    mu.settings.define({
      title: COPY.settingsTitle,
      items: [
        { key: SETTINGS.territory, label: COPY.settingTerritory, default: true, kind: 'toggle', scope: 'world' },
        { key: SETTINGS.traffic, label: COPY.settingTraffic, default: true, kind: 'toggle', scope: 'world', hint: COPY.settingTrafficHint },
      ],
    });

    const state = new Map<string, SessionState>();
    const st = (sid: string) => state.get(sid) ?? state.set(sid, { cat: null, catWall: 0, traffic: null, nav: null, asked: false }).get(sid)!;
    const redraws = new Map<string, Set<() => void>>();
    const redraw = (sid: string) => { for (const fn of redraws.get(sid) ?? []) fn(); };
    const maps = new Map<string, Set<MapView>>();
    /** A thing the nav panel asked to show while the map was closed: selected when the map mounts. */
    const pending = new Map<string, string>();
    const worldOf = (sid: string) => mu.sessions.list().find((s) => s.id === sid)?.worldId ?? null;

    // Palette: the theme's tokens, read once per theme change (canvas cannot use var()).
    let palette: Palette | null = null;
    let calm = false;
    const readPalette = (): Palette => {
      const v = (n: string) => mu.theme.cssVar(n);
      return { bg: v('--bg'), fg: v('--fg'), dim: v('--fg-dim'), faint: v('--fg-faint'), accent: v('--accent'), bright: v('--accent-bright'), gold: v('--gold'), alert: v('--alert'), ok: v('--ok'), border: v('--border'), borderBright: v('--border-bright'), font: v('--font-mono') };
    };
    ctx.subscriptions.push(mu.theme.watch((t) => {
      palette = null; calm = !!t.reduceMotion;
      for (const set of maps.values()) for (const m of set) m.refresh();
    }));
    const isCalm = () => calm || (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-calm'));

    const ask = (sid: string) => {
      const s = st(sid);
      if (s.asked || s.cat) return;
      s.asked = true;
      void mu.gmcp.send('Space.Get', {}, sid);
    };
    const sendCmd = (sid: string | null, cmd: string) => { if (sid) void mu.sessions.send(cmd, sid); };

    const mountWith = (make: (sid: string | null) => { el: HTMLElement; refresh(): void; destroy(): void }) => (hostEl: HTMLElement, pc: PanelMountCtx): Dispose => {
      const sid = pc.sid;
      const view = make(sid);
      hostEl.append(view.el);
      const set = sid ? (redraws.get(sid) ?? redraws.set(sid, new Set()).get(sid)!) : null;
      const fn = () => view.refresh();
      set?.add(fn);
      if (sid) ask(sid);
      return () => { set?.delete(fn); view.destroy(); };
    };

    mu.panels.register({
      id: MAP, title: COPY.mapTitle, defaultPosition: 'float', order: 60, show: 'auto', singleton: true,
      mount: mountWith((sid) => {
        const view = new MapView({
          css,
          data: () => { const s = sid ? state.get(sid) : undefined; return { cat: s?.cat ?? null, catWall: s?.catWall ?? 0, traffic: s?.traffic ?? null, nav: s?.nav ?? null }; },
          colors: () => (palette ??= readPalette()),
          pref: (k) => mu.settings.get<boolean>(SETTINGS[k], sid ? { sid } : undefined) !== false,
          setPref: (k, on) => mu.settings.set(SETTINGS[k], on, sid ? worldOf(sid) : undefined),
          send: (cmd) => sendCmd(sid, cmd),
          calm: isCalm,
        });
        if (sid) {
          const ms = maps.get(sid) ?? maps.set(sid, new Set()).get(sid)!;
          ms.add(view);
          const d = view.destroy.bind(view);
          view.destroy = () => { ms.delete(view); d(); };
          const want = pending.get(sid);
          if (want) { pending.delete(sid); view.select(want); }
        }
        return view;
      }),
    });

    mu.panels.register({
      id: NAV, title: COPY.navTitle, defaultPosition: 'right-top', order: 61, show: 'auto', singleton: true,
      mount: mountWith((sid) => new NavView({
        css,
        data: () => { const s = sid ? state.get(sid) : undefined; return { nav: s?.nav ?? null, cat: s?.cat ?? null, active: !!s?.cat, sid }; },
        send: (cmd) => sendCmd(sid, cmd),
        show: (id) => {
          if (!sid) return;
          const open = maps.get(sid);
          if (open?.size) for (const m of open) m.select(id);
          else pending.set(sid, id);
          mu.panels.open(MAP, {}, { sid });
        },
      })),
      snapshot: (el) => el.querySelector<HTMLInputElement>('[data-testid="nv-filter"]')?.value || undefined,
      restore: (el, saved) => {
        const inp = el.querySelector<HTMLInputElement>('[data-testid="nv-filter"]');
        if (inp && typeof saved === 'string' && saved) { inp.value = saved; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      },
    });

    ctx.subscriptions.push(mu.sessions.each((s) => {
      let touchedMap = false, touchedNav = false;
      // `now` in a payload is the game's real clock when it was sent. A fresh event pairs it with the moment it arrived
      // (which also absorbs any skew between the two clocks); a replayed one (reload, late activation) arrived long
      // ago, so it is taken as on our clock, or the map's time would jump back.
      const arrived = (now: number, meta?: { replay?: boolean }) => (meta?.replay ? now : Date.now() / 1000);
      const sys = mu.gmcp.watch('Space.System', (data, meta) => {
        const cur = st(s.id);
        cur.cat = catalogOf(data);
        cur.catWall = cur.cat ? arrived(cur.cat.now, meta) : Date.now() / 1000;
        if (!cur.cat) cur.traffic = null;
        if (cur.cat && !touchedMap) { touchedMap = true; mu.panels.touch(MAP, s.id); }
        redraw(s.id);
      }, { sid: s.id });
      const trf = mu.gmcp.watch('Space.Traffic', (data) => {
        const cur = st(s.id);
        const t = trafficOf(data);
        // `now` is the server's clock at send, the same clock as the catalog's; without one, estimate it.
        if (t && !t.now) t.now = cur.cat ? cur.cat.now + (Date.now() / 1000 - cur.catWall) : Date.now() / 1000;
        cur.traffic = t;
        redraw(s.id);
      }, { sid: s.id });
      const nav = mu.gmcp.watch('Ship.Nav', (data) => {
        const cur = st(s.id);
        cur.nav = navOf(data);
        if (cur.nav && !touchedNav) { touchedNav = true; mu.panels.touch(NAV, s.id); }
        redraw(s.id);
      }, { sid: s.id });
      const a = mu.settings.watch(SETTINGS.territory, () => redraw(s.id), { sid: s.id });
      const b = mu.settings.watch(SETTINGS.traffic, () => redraw(s.id), { sid: s.id });
      return () => { sys(); trf(); nav(); a(); b(); state.delete(s.id); redraws.delete(s.id); maps.delete(s.id); };
    }));

    void h;
  },
});
