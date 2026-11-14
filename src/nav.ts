/**
 * The Navigation panel: the =status / =nav console as a UI. Everything it does is a typed =nav command sent to the
 * session, so the console's answer shows in the terminal as usual and the next Ship.Nav redraws the panel.
 *
 *   ┤SHIP├        squawk, hull, ORBITING Earth alt 500 km · 7.61 km/s · period, course, comms, combat / crippled
 *   ┤UNDER WAY├   maneuver, phase, progress bar, ETA, replan and warnings, [ ABORT BURN ]
 *   ┤FLIGHT PLAN├ maneuver, distance, ETA, propellant, closing, route, error and warning plates,
 *                 [ EXECUTE ] or [ EXECUTE ANYWAY ] and [ CANCEL ]
 *   ┤BURN├        a slider min..max with the value, [ SET ] (sends =nav burn <g>)
 *   ┤PLOT A COURSE├ [ ORBIT LOW ] [ ORBIT HIGH ] [ LEAVE ORBIT ], a filter, then contacts, destinations and bodies.
 */
import { h } from '@muclient/sdk';
import { COPY } from './copy';
import { tagOf, type Catalog, type Nav, type NavContact } from './model';
import { AU_KM, fmtDist, fmtDur, fmtG, fmtKms } from './orbit';

export interface NavDeps {
  css: Record<string, string>;
  data(): { nav: Nav | null; cat: Catalog | null; active: boolean; sid: string | null };
  send(cmd: string): void;
  /** Show a thing on the System map. */
  show(id: string): void;
}

/** One target row of the picker. */
export interface TargetRow { id: string; name: string; label: string; kind: string; dist_au: number; group: 'contacts' | 'destinations' | 'bodies' }

/**
 * Contacts first (nearest first), then charted destinations, then bodies from the catalog that the console can
 * target by name (not the star, not the one being orbited). Each id once. Exported for tests.
 */
export function targetRows(nav: Nav, cat: Catalog | null, filter = ''): TargetRow[] {
  const seen = new Set<string>();
  const out: TargetRow[] = [];
  const stationName = (c: NavContact) => (c.kind === 'station' ? cat?.stations.get(c.id)?.name ?? '' : '');
  const add = (c: NavContact, group: TargetRow['group']) => {
    if (!c.name || seen.has(c.id || c.name)) return;
    seen.add(c.id || c.name);
    const full = stationName(c);
    out.push({ id: c.id, name: c.name, label: full && full !== c.name ? full : '', kind: c.kind, dist_au: c.dist_au, group });
  };
  for (const c of nav.contacts) add(c, 'contacts');
  for (const c of [...nav.destinations].sort((a, b) => (a.dist_au || 0) - (b.dist_au || 0))) add(c, 'destinations');
  if (cat) {
    const here = 'body_id' in nav.orbit ? nav.orbit.body_id : '';
    for (const b of cat.bodies.values()) {
      if (b.type === 'star' || b.id === here || seen.has(b.id)) continue;
      add({ id: b.id, name: b.name, kind: 'body', dist_au: NaN }, 'bodies');
    }
  }
  const q = filter.trim().toLowerCase();
  return q ? out.filter((r) => r.name.toLowerCase().includes(q) || r.label.toLowerCase().includes(q)) : out;
}

/** The value the burn slider starts at: the console's G, clamped into the drive's range. */
export const clampG = (g: number, min: number, max: number) => Math.min(Math.max(g, min), Math.max(min, max));

export class NavView {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private filter = '';
  /** The slider's value while the player drags it (null: follow the console). */
  private draftG: number | null = null;

  constructor(private deps: NavDeps) {
    this.body = h('div', { class: 'scroll' });
    this.el = h('section', { class: 'mu-navcon', 'aria-label': COPY.navTitle, 'data-focus-region': 'navcomp.nav', tabindex: '-1', 'data-testid': 'navcon' }, this.body);
    this.refresh();
  }

  destroy() { this.el.remove(); }

  refresh() {
    const { nav, cat, active, sid } = this.deps.data();
    const css = this.deps.css;
    const empty = (text: string) => { this.body.replaceChildren(h('p', { class: `${css.empty} awaiting`, 'data-testid': 'nv-empty' }, text)); };
    if (!sid) return empty(COPY.noSession);
    if (!nav) return empty(active ? COPY.noConsole : COPY.noConsole);
    // Keep the filter field's focus and caret across redraws: rebuild only what changed under it.
    const focused = this.el.contains(document.activeElement) ? (document.activeElement as HTMLElement | null)?.dataset?.testid ?? '' : '';
    const top = this.body.scrollTop;
    this.body.replaceChildren(...this.sections(nav, cat));
    this.body.scrollTop = top;
    if (focused) {
      const again = this.body.querySelector<HTMLElement>(`[data-testid="${focused}"]`);
      if (again) { again.focus(); if (again instanceof HTMLInputElement && again.type !== 'range') { const n = again.value.length; try { again.setSelectionRange(n, n); } catch { /* not a text input */ } } }
    }
  }

  private head(label: string, extra?: HTMLElement | null) {
    const css = this.deps.css;
    return h('div', { class: 'hrow' }, h('div', { class: css.secHead, role: 'heading', 'aria-level': '3' }, label, h('span', { class: css.secClose, 'aria-hidden': 'true' })), extra ?? null);
  }

  private kv(rows: [string, string | HTMLElement, string?][]) {
    return h('dl', { class: 'kv' }, ...rows.flatMap(([k, v, cls]) => [h('dt', {}, k), h('dd', { class: cls ?? '' }, v)]));
  }

  /** Console lines as plates: [ERROR] alert, [WARNING] gold, anything else dim. */
  private lines(list: string[], testid: string) {
    const css = this.deps.css;
    return list.map((l) => {
      const { tag, text } = tagOf(l);
      const cls = tag === 'ERROR' ? 'alert' : tag === 'WARNING' ? css.gold : css.dim;
      return h('div', { class: `line ${tag === 'ERROR' ? 'err' : tag === 'WARNING' ? 'warn' : ''}`, 'data-testid': testid },
        tag ? h('span', { class: `${css.plate} ${cls}` }, tag === 'ERROR' ? '⚠ error' : tag === 'WARNING' ? 'warning' : tag) : null, h('span', { class: 'tx' }, text));
    });
  }

  private sections(nav: Nav, cat: Catalog | null): HTMLElement[] {
    const css = this.deps.css;
    const send = (cmd: string) => this.deps.send(cmd);
    const out: HTMLElement[] = [];

    // ┤SHIP├
    const showShip = nav.ship.id ? h('button', { class: css.cmd, type: 'button', 'data-testid': 'nv-show-ship', title: COPY.onMap, onclick: () => this.deps.show(nav.ship.id) }, '⌕') : null;
    showShip?.classList.add(css.sq ?? 'sq');
    out.push(this.head(COPY.hShip, showShip));
    out.push(h('div', { class: 'ident' }, h('span', { class: 'sq', 'data-testid': 'nv-squawk' }, nav.ship.squawk || nav.ship.name), nav.ship.squawk ? h('span', { class: 'hull' }, nav.ship.name) : null,
      nav.combat ? h('span', { class: `${css.plate} alert`, 'data-testid': 'nv-combat' }, COPY.combat) : null,
      nav.crippled.length ? h('span', { class: `${css.plate} alert` }, COPY.crippled) : null));
    if (nav.scrambled.length) {
      out.push(h('p', { class: `${css.empty} awaiting` }, COPY.scrambled), ...this.lines(nav.scrambled, 'nv-scrambled'));
      return out;
    }
    const ship: [string, string | HTMLElement, string?][] = [];
    if ('body_id' in nav.orbit) {
      const o = nav.orbit;
      ship.push([COPY.orbiting, `${o.body} · ${COPY.alt} ${Math.round(o.alt_km).toLocaleString('en-US')} km · ${fmtKms(o.v_kms)}${o.period ? ` · ${fmtDur(o.period)}` : ''}`]);
    }
    if (nav.orbit.course) ship.push([COPY.course, nav.orbit.course]);
    if (nav.comms) ship.push([COPY.comms, nav.comms]);
    out.push(this.kv(ship));
    if (nav.combat) out.push(h('p', { class: 'note t-alert' }, COPY.combatNote));
    out.push(...this.lines(nav.crippled, 'nv-crippled'));

    // ┤UNDER WAY├
    const uw = nav.under_way;
    if (uw) {
      out.push(this.head(COPY.hUnderWay));
      const bar = h('div', { class: 'prog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(uw.frac * 100)), 'data-testid': 'nv-progress' }, h('i', { style: `width:${(uw.frac * 100).toFixed(1)}%` }));
      const progress = h('span', { class: 'progrow' }, bar, h('span', { class: 'pct' }, `${Math.round(uw.frac * 100)}%`));
      out.push(h('div', { class: 'man', 'data-testid': 'nv-maneuver' }, uw.maneuver));
      out.push(this.kv([
        [COPY.phase, uw.label || uw.phase],
        [COPY.progress, progress],
        [uw.pass ? COPY.passIn : COPY.eta, fmtDur(uw.eta)],
        [COPY.hBurn, fmtG(uw.g)],
        ...(uw.route ? [[COPY.route, COPY.via(uw.route)] as [string, string]] : []),
        ...(uw.replan ? [[COPY.replan, uw.replan] as [string, string]] : []),
      ]));
      out.push(...this.lines(uw.warnings, 'nv-warning'));
      out.push(h('div', { class: 'acts' }, h('button', { class: `${css.cmd} warn`, type: 'button', 'data-testid': 'nv-abort', onclick: () => send(COPY.cmd.abort) }, COPY.abort)));
    }

    // ┤FLIGHT PLAN├
    const p = nav.plan;
    if (!uw) {
      out.push(this.head(COPY.hCourse, p && p.target.id ? (() => { const b = h('button', { class: `${css.cmd} ${css.sq ?? 'sq'}`, type: 'button', 'data-testid': 'nv-show-target', title: COPY.onMap, onclick: () => this.deps.show(p.target.id) }, '⌕'); return b; })() : null));
      if (!p) {
        out.push(h('p', { class: `${css.empty} awaiting`, 'data-testid': 'nv-no-course' }, COPY.noCourse));
        out.push(...this.lines(nav.coast, 'nv-coast'));
      } else if (p.lost) {
        out.push(h('p', { class: 'note t-alert', 'data-testid': 'nv-lost' }, COPY.lostTarget(p.target.name)));
        out.push(h('div', { class: 'acts' }, h('button', { class: css.cmd, type: 'button', 'data-testid': 'nv-cancel', onclick: () => send(COPY.cmd.cancel) }, COPY.cancel)));
      } else {
        out.push(h('div', { class: `man${p.blocked ? ' blocked' : ''}`, 'data-testid': 'nv-maneuver' }, p.maneuver));
        const rows: [string, string, string?][] = [];
        if (Number.isFinite(p.dist_m)) rows.push([COPY.distance, fmtDist(p.dist_m / 1000 / AU_KM)]);
        if (p.eta !== null) rows.push([p.pass ? COPY.passIn : COPY.eta, fmtDur(p.eta)]);
        rows.push([COPY.hBurn, fmtG(p.g)]);
        if (Number.isFinite(p.pct)) rows.push([COPY.fuel, `${(p.pct * 100).toFixed(1)}%`, p.pct > 1 ? 't-alert' : p.pct > 0.5 ? 't-gold' : '']);
        if (p.closing_kms !== null) rows.push([COPY.closing, fmtKms(p.closing_kms)]);
        if (p.vp_kms !== null) rows.push([COPY.passSpeed, fmtKms(p.vp_kms)]);
        if (p.route) rows.push([COPY.route, COPY.via(p.route)]);
        out.push(this.kv(rows));
        out.push(...this.lines(p.errors, 'nv-error'), ...this.lines(p.warnings, 'nv-warning'));
        const acts = h('div', { class: 'acts' });
        if (p.blocked) acts.append(h('span', { class: `${css.plate} alert`, 'data-testid': 'nv-blocked' }, COPY.blocked));
        else if (p.confirm) acts.append(h('button', { class: `${css.cmd} primary`, type: 'button', 'data-testid': 'nv-execute-confirm', disabled: nav.combat ? true : undefined, onclick: () => send(COPY.cmd.confirm) }, COPY.executeAnyway));
        else acts.append(h('button', { class: `${css.cmd} primary`, type: 'button', 'data-testid': 'nv-execute', disabled: nav.combat ? true : undefined, onclick: () => send(COPY.cmd.execute) }, COPY.execute));
        acts.append(h('button', { class: css.cmd, type: 'button', 'data-testid': 'nv-cancel', onclick: () => send(COPY.cmd.cancel) }, COPY.cancel));
        out.push(acts);
        if (p.confirm && !p.blocked) out.push(h('p', { class: 'hint' }, COPY.confirmNeeded));
      }
    }

    // ┤BURN├
    const b = nav.burn;
    const g = this.draftG ?? clampG(b.g, b.min, b.max);
    const val = h('span', { class: 'gval', 'data-testid': 'nv-burn-value' }, fmtG(g));
    const range = h('input', { class: 'rng', type: 'range', min: String(b.min), max: String(Math.max(b.min, b.max)), step: '0.01', value: String(g), 'aria-label': COPY.burnLabel, 'data-testid': 'nv-burn' }) as HTMLInputElement;
    const pct = (v: number) => (b.max > b.min ? ((v - b.min) / (b.max - b.min)) * 100 : 100);
    range.style.setProperty('--p', `${pct(g)}%`);
    const set = h('button', { class: css.cmd, type: 'button', 'data-testid': 'nv-burn-set', disabled: Math.abs(g - b.g) < 0.005 ? true : undefined, onclick: () => { const v = Number(range.value); this.draftG = null; send(COPY.cmd.burn(v)); } }, COPY.setBurn) as HTMLButtonElement;
    range.addEventListener('input', () => {
      const v = Number(range.value);
      this.draftG = v; val.textContent = fmtG(v); range.style.setProperty('--p', `${pct(v)}%`);
      set.disabled = Math.abs(v - b.g) < 0.005;
    });
    range.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); set.click(); } });
    if (!uw) {
      out.push(this.head(COPY.hBurn));
      out.push(h('div', { class: 'burn' }, range, val, set));
      out.push(h('p', { class: 'hint' }, COPY.burnRange(fmtG(b.min), fmtG(b.max))));
    }

    // ┤PLOT A COURSE├
    if (!uw) {
      out.push(this.head(COPY.hTarget));
      const intents = h('div', { class: 'acts' });
      if (nav.orbit.body) {
        intents.append(
          h('button', { class: css.cmd, type: 'button', 'data-testid': 'nv-orbit-low', onclick: () => send(COPY.cmd.orbit('low')) }, COPY.orbitLow),
          h('button', { class: css.cmd, type: 'button', 'data-testid': 'nv-orbit-high', onclick: () => send(COPY.cmd.orbit('high')) }, COPY.orbitHigh),
          h('button', { class: css.cmd, type: 'button', 'data-testid': 'nv-leave', onclick: () => send(COPY.cmd.leave) }, COPY.leave));
        out.push(intents);
      }
      const field = h('input', { class: css.field, type: 'search', value: this.filter, placeholder: COPY.filter, 'aria-label': COPY.filter, autocomplete: 'off', 'data-testid': 'nv-filter' }) as HTMLInputElement;
      const list = h('div', { class: 'targets', role: 'list' });
      const fill = () => {
        const rows = targetRows(nav, cat, this.filter);
        const groups: TargetRow['group'][] = ['contacts', 'destinations', 'bodies'];
        const kids: HTMLElement[] = [];
        for (const gname of groups) {
          const rs = rows.filter((r) => r.group === gname);
          if (!rs.length) continue;
          kids.push(h('div', { class: `${css.label} glabel` }, COPY[gname]));
          for (const r of rs) {
            const cur = p && !p.lost && p.target.id && p.target.id === r.id;
            const row = h('div', { class: 'trow', role: 'listitem', 'data-testid': 'nv-target', 'data-id': r.id },
              h('button', { class: `${css.row} tbtn${cur ? ' hot' : ''}`, type: 'button', 'data-testid': 'nv-target-plot', 'aria-current': cur ? 'true' : undefined, onclick: () => send(COPY.cmd.target(r.name)) },
                h('span', { class: 'l1' }, h('span', { class: 'nm' }, r.name), r.label ? h('span', { class: 'lb' }, r.label) : null, h('span', { class: 'sp' }), Number.isFinite(r.dist_au) ? h('span', { class: 'ds' }, fmtDist(r.dist_au)) : null, h('span', { class: `${css.plate} ${css.dim}` }, COPY.kind[r.kind] ?? r.kind))),
              r.kind === 'ship' ? h('button', { class: css.cmd, type: 'button', 'data-testid': 'nv-target-pass', onclick: () => send(COPY.cmd.pass(r.name)) }, COPY.pass) : null);
            kids.push(row);
          }
        }
        list.replaceChildren(...(kids.length ? kids : [h('p', { class: `${css.empty} awaiting` }, COPY.noMatch)]));
      };
      field.addEventListener('input', () => { this.filter = field.value; fill(); });
      fill();
      out.push(h('div', { class: 'filter' }, field), list);
    }
    return out;
  }
}
