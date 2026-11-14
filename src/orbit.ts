/**
 * Two-body Kepler propagation and the formatting the panels share. Pure: no DOM, no `mu`.
 *
 * Elements are the server's netsat orbit summary `o = {a (AU), e, om (rad), M0 (rad), ep, rate, dir?}`. Time is
 * real unix seconds (the payload's `now`, ftime); game time runs `rate`× faster, so the mean anomaly advances by
 * `n · rate · (t − ep)` where `n = √(μ / a³)` is the parent's mean motion in game seconds (negated for retrograde).
 */

export const AU_M = 149_597_870_700;
export const AU_KM = AU_M / 1000;
const LY_AU = 63_241.077;
const TWO_PI = Math.PI * 2;

export interface Elements { a: number; e: number; om: number; M0: number; ep: number; rate: number; dir?: number }
export interface Vec { x: number; y: number }

/** Mean motion in rad per game second, signed by `dir`. */
export function meanMotion(o: Elements, mu: number): number {
  const a = Math.abs(o.a) * AU_M;
  const n = Math.sqrt(mu / (a * a * a));
  return (o.dir ?? 1) < 0 ? -n : n;
}

/** Eccentric anomaly for mean anomaly `M` (Newton; E₀ = π for high e). */
export function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 100; i++) {
    const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
}

/** Position relative to the parent, in AU, at real time `t`. */
export function localPos(o: Elements, mu: number, t: number): Vec {
  let M = (o.M0 + meanMotion(o, mu) * (o.rate || 1) * (t - o.ep)) % TWO_PI;
  if (M < 0) M += TWO_PI;
  const E = solveKepler(M, o.e);
  const nu = Math.atan2(Math.sqrt(1 - o.e * o.e) * Math.sin(E), Math.cos(E) - o.e);
  const r = o.a * (1 - o.e * Math.cos(E));
  const th = o.om + nu;
  return { x: r * Math.cos(th), y: r * Math.sin(th) };
}

/** Period in game seconds (0 for an open orbit). */
/** Speed relative to the parent at game time `t`, m per game second (vis-viva). */
export function orbitSpeed(o: Elements, mu: number, t: number): number {
  const a = Math.abs(o.a) * AU_M;
  const p = localPos(o, mu, t);
  const r = Math.hypot(p.x, p.y) * AU_M || a;
  return Math.sqrt(Math.max(0, mu * (2 / r - 1 / a)));
}

export function period(o: Elements, mu: number): number {
  if (o.e >= 1 || o.a <= 0) return 0;
  const a = o.a * AU_M;
  return TWO_PI * Math.sqrt((a * a * a) / mu);
}

/** Points of the orbit ellipse around the parent, AU, relative to the parent. */
export function ellipse(o: Elements, steps = 128): Vec[] {
  const out: Vec[] = [];
  const p = o.a * (1 - o.e * o.e);
  for (let i = 0; i <= steps; i++) {
    const nu = (i / steps) * TWO_PI;
    const r = p / (1 + o.e * Math.cos(nu));
    out.push({ x: r * Math.cos(o.om + nu), y: r * Math.sin(o.om + nu) });
  }
  return out;
}

const n0 = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

/** A distance given in AU: km below a million km, AU below a light year, then ly. */
export function fmtDist(au: number): string {
  if (!Number.isFinite(au)) return '—';
  const km = Math.abs(au) * AU_KM;
  if (km < 1_000_000) return `${n0(km)} km`;
  if (Math.abs(au) < LY_AU) return `${n0(au, Math.abs(au) < 10 ? 3 : 2)} AU`;
  return `${n0(au / LY_AU, 2)} ly`;
}

/** A duration in game seconds, as the console writes it: "2d 18h", "1h 34m", "4m 10s", "12s". */
export function fmtDur(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  s = Math.round(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** An IC clock (unix-scale game seconds) as "2365-03-04 02:33:24" (UTC, Torch Standard). */
export function fmtIC(ic: number): string {
  if (!Number.isFinite(ic)) return '—';
  const d = new Date(ic * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** A speed in km/s with two decimals. */
export const fmtKms = (v: number) => (Number.isFinite(v) ? `${n0(v, 2)} km/s` : '—');
/** A G rating with two decimals. */
export const fmtG = (g: number) => (Number.isFinite(g) ? `${g.toFixed(2)} G` : '—');
