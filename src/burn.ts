/**
 * Torchship's burn profile, ported from $space (#4394) so the map flies and draws a burning ship exactly as the
 * game does. Pure arithmetic, no DOM. The game's model (design 17, "gamified turn-and-burn"):
 *
 *   The ship flies a straight line in the TARGET's frame: from its closing speed v0, accelerate `a` for t1, coast
 *   `coast` s (the flip), brake to rest at the aim point (or carry `ve` through it, on a limb route's first leg; or,
 *   on a pass, keep accelerating and fly through). A sideways offset Y = vl·τ·(1 − τ/tf)² blends out the ship's
 *   own lateral speed. Position = target(t) + toff + u·R + w·Y, u = unit launch offset from the aim point at
 *   ignition (fixed: it never swings), w = u turned +90°. Gravity is not part of it.
 *
 * A leg is what Ship.Nav (`under_way.burn`, `plan.legs[]`) and Space.Traffic (`vessels[].burn`) carry: the
 * #4709:_burn_desc keys. Times are real unix seconds (ftime), lengths m, speeds m per real s, accel m per real s².
 */
import { AU_M, type Vec } from './orbit';

export interface BurnLeg {
  /** The body/station/ship the leg rides ('' when unknown: the ignition snapshot is extrapolated). */
  tbody: string;
  /** Ship and target at ignition, AU; the target's velocity then, m per real s. */
  opos: Vec; tpos0: Vec; tvel0: Vec;
  t_start: number; init_dist: number; stop_m: number;
  t1: number; coast: number; a: number; v0: number; vl: number; ve: number;
  pass: boolean; inertial: boolean;
  /** Fixed AU offset of the aim point from the target (a limb waypoint, nav leave). */
  toff: Vec;
  /** A plan's later leg: an estimate the game re-solves at the handoff. */
  est: boolean;
}

/** The 1D profile at τ s after ignition: range R from the aim along u, its rate, side offset Y along w, its rate. */
export function burnProfile(L: BurnLeg, tau: number): { R: number; Rd: number; Y: number; Yd: number } {
  let D = L.init_dist - L.stop_m;
  const sg = D < 0 ? -1 : 1;
  D = Math.abs(D);
  const { v0, vl, ve, pass, t1, coast: dc } = L;
  const a = Math.abs(L.a);
  const vp = v0 + a * t1;
  const tf = pass ? t1 : t1 + dc + (a > 0 ? (vp - ve) / a : 0);
  let s: number, sd: number;
  if (tau <= 0) { s = 0; sd = v0; }
  else if (tau < t1) { s = v0 * tau + 0.5 * a * tau * tau; sd = v0 + a * tau; }
  else if (pass) { s = D + vp * (tau - t1); sd = vp; }
  else if (tau < t1 + dc) { s = v0 * t1 + 0.5 * a * t1 * t1 + vp * (tau - t1); sd = vp; }
  else if (tau < tf) { const q = tf - tau; s = D - ve * q - 0.5 * a * q * q; sd = ve + a * q; }
  else { s = D + ve * (tau - tf); sd = ve; }
  let Y = 0, Yd = 0;
  if (vl !== 0 && tau <= 0) Yd = vl;
  else if (vl !== 0 && tau < tf) { const x = tau / tf; Y = vl * tau * (1 - x) * (1 - x); Yd = vl * (1 - x) * (1 - 3 * x); }
  return { R: L.init_dist - sg * s, Rd: -sg * sd, Y, Yd };
}

/** Seconds from ignition to arrival at the aim (the end of the brake; a pass: the end of the thrust). */
export function burnDuration(L: BurnLeg): number {
  const a = Math.abs(L.a), vp = L.v0 + a * L.t1;
  return L.pass ? L.t1 : L.t1 + L.coast + (a > 0 ? (vp - L.ve) / a : 0);
}

/** The real time of the flip (the end of the acceleration); a pass has none. */
export const burnFlip = (L: BurnLeg): number | null => (L.pass ? null : L.t_start + L.t1);

/** Unit launch offset u of a leg from its aim point (target frame, fixed at ignition). */
export function burnAxis(L: BurnLeg): Vec {
  const bx = L.opos.x - L.tpos0.x - L.toff.x, by = L.opos.y - L.tpos0.y - L.toff.y;
  const n = Math.hypot(bx, by);
  return n > 0 ? { x: bx / n, y: by / n } : { x: 0, y: 0 };
}

/** Where the leg's target is at `t`: `target(t)` when the map knows it, else the ignition snapshot carried on. */
export type TargetAt = (id: string, t: number) => { pos: Vec; vel: Vec } | null;
const carried = (L: BurnLeg, t: number) => { const k = (t - L.t_start) / AU_M; return { pos: { x: L.tpos0.x + L.tvel0.x * k, y: L.tpos0.y + L.tvel0.y * k }, vel: L.tvel0 }; };

/** The ship's state at real time `t` on a leg ($space:_burn_state): position AU, velocity m per real s. */
export function burnState(L: BurnLeg, t: number, target?: TargetAt): { pos: Vec; vel: Vec } {
  const { R, Rd, Y, Yd } = burnProfile(L, t - L.t_start);
  const tg = (!L.inertial && L.tbody && target?.(L.tbody, t)) || carried(L, t);
  const u = burnAxis(L);
  const k = R / AU_M, j = Y / AU_M;
  return {
    pos: { x: tg.pos.x + L.toff.x + u.x * k - u.y * j, y: tg.pos.y + L.toff.y + u.y * k + u.x * j },
    vel: { x: tg.vel.x + Rd * u.x - Yd * u.y, y: tg.vel.y + Rd * u.y + Yd * u.x },
  };
}

/** Positions along a leg at `n` + 1 evenly spaced times from `from` (clamped to the leg) to its arrival. */
export function sampleLeg(L: BurnLeg, from: number, n: number, target?: TargetAt): { t: number; pos: Vec }[] {
  const end = L.t_start + burnDuration(L);
  const t0 = Math.max(L.t_start, Math.min(from, end));
  const out: { t: number; pos: Vec }[] = [];
  for (let i = 0; i <= n; i++) { const t = t0 + ((end - t0) * i) / n; out.push({ t, pos: burnState(L, t, target).pos }); }
  return out;
}
