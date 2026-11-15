/**
 * `npm test`: the model and orbit maths in plain node, and the extension in the headless μClient host
 * (@runmu.sh/dev/test) with a happy-dom document for the panels. Fixtures in test/fixtures are payloads captured from
 * Torchship's $gmcp (Space.System as an admin; Ship.Nav at a powered cockpit in a 500 km Earth orbit; plans to Mars
 * and to the Meridian Ring).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function find() {
  if (process.env.MUCLIENT_DEV_TEST) return process.env.MUCLIENT_DEV_TEST;
  try { return createRequire(join(ROOT, 'package.json')).resolve('@runmu.sh/dev/test'); } catch { /* next */ }
  throw new Error('@runmu.sh/dev/test was not found. Run npm install (it is in the @runmu.sh/dev devDependency).');
}
const { createHost } = await import(pathToFileURL(find()).href);
const { validate } = await import('./schema.mjs');

const win = new Window();
for (const k of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLCanvasElement', 'Node', 'MouseEvent', 'Event']) globalThis[k] = k === 'window' ? win : win[k];

const fx = (f) => JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', f), 'utf8'));
const SYSTEM = fx('system.json');
const TRAFFIC = fx('traffic.json');
const NAV = fx('nav.json');
const PLAN_MARS = fx('plan-mars.json');
const PLAN_KMER = fx('plan-kmer.json');
const PILOT_SYSTEM = { ...SYSTEM, admin: 0 };
const PILOT_TRAFFIC = { ...TRAFFIC, admin: 0, vessels: [{ ...TRAFFIC.vessels[0], self: 1 }, TRAFFIC.vessels[1]] };

// The pure parts, through esbuild (the host loader compiles src/index.ts the same way).
const esbuild = await import('esbuild');
const bundle = await esbuild.build({ entryPoints: [join(ROOT, 'src/index.ts')], bundle: true, format: 'esm', write: false, platform: 'neutral', external: ['@muclient/sdk'], logLevel: 'silent' });
const sdkStub = 'export const h = () => null; export const defineExtension = (x) => x;';
const code = bundle.outputFiles[0].text.replace(/from\s*["']@muclient\/sdk["']/g, `from "data:text/javascript,${encodeURIComponent(sdkStub)}"`);
const M = await import(`data:text/javascript,${encodeURIComponent(code)}`);

// ─── orbit maths ─────────────────────────────────────────────────────────────────────────────────────────────

test('orbit: Kepler solves for high eccentricity, positions keep |r| between periapsis and apoapsis, Earth\'s period a game year (half a real one at rate 2)', () => {
  for (const e of [0, 0.2, 0.68, 0.95]) for (const M0 of [0, 1, 3, 5.9]) {
    const E = M.solveKepler(M0, e);
    assert.ok(Math.abs(E - e * Math.sin(E) - M0) < 1e-9, `e=${e} M=${M0}`);
  }
  const earth = SYSTEM.bodies.find((b) => b.name === 'Earth');
  const sun = SYSTEM.bodies.find((b) => b.name === 'Sun');
  const o = M.elementsOf(earth.o);
  for (let t = 0; t < 4e7; t += 3.3e6) {
    const p = M.localPos(o, sun.mu, o.ep + t);
    const r = Math.hypot(p.x, p.y);
    assert.ok(r >= o.a * (1 - o.e) - 1e-9 && r <= o.a * (1 + o.e) + 1e-9, `r=${r}`);
  }
  // The period is in game seconds: a year. At rate 2 the mean anomaly makes a turn in half a real year.
  const yr = M.period(o, sun.mu);
  assert.ok(Math.abs(yr - 365.25 * 86400) / yr < 0.01, `period ${yr}`);
  const p0 = M.localPos(o, sun.mu, o.ep), p1 = M.localPos(o, sun.mu, o.ep + yr / 2);
  assert.ok(Math.hypot(p0.x - p1.x, p0.y - p1.y) < 1e-9, 'back after half a real year');
  // Retrograde: Triton goes the other way round.
  const triton = M.elementsOf(SYSTEM.bodies.find((b) => b.name === 'Triton').o);
  const nep = SYSTEM.bodies.find((b) => b.name === 'Neptune');
  const a = M.localPos(triton, nep.mu, triton.ep), b = M.localPos(triton, nep.mu, triton.ep + 600);
  assert.ok(a.x * b.y - a.y * b.x < 0, 'clockwise');
});

test('formatters: distances in km / AU / ly, durations, IC clock, speeds, G', () => {
  assert.equal(M.fmtDist(0.00003), '4,488 km');
  assert.match(M.fmtDist(1.52), /^1\.520 AU$/);
  assert.match(M.fmtDist(70000), /ly$/);
  assert.equal(M.fmtDur(90061), '1d 1h');
  assert.equal(M.fmtDur(3725), '1h 2m');
  assert.equal(M.fmtDur(65), '1m 5s');
  assert.equal(M.fmtDur(9), '9s');
  assert.equal(M.fmtIC(0), '1970-01-01 00:00:00');
  assert.match(M.fmtKms(7.6126), /7\.61 km\/s/);
  assert.match(M.fmtG(1), /1\.00 ?G/);
});

// ─── the model ───────────────────────────────────────────────────────────────────────────────────────────────

test('catalog: the captured Space.System parses (35 bodies, 14 stations, 7 sites, 7 factions); "#-1"/null are none; influence needs Rsys; {active:false} is null', () => {
  const c = M.catalogOf(SYSTEM);
  assert.equal(c.rootId, '4503');
  assert.deepEqual([c.bodies.size, c.stations.size, c.sites.size, c.factions.size], [35, 14, 7, 7]);
  const sun = c.bodies.get('4503');
  assert.equal(sun.parent, null); assert.equal(sun.o, null); assert.equal(sun.type, 'star');
  assert.deepEqual(c.bodies.get('4506').influence, { factions: ['NETSAT', 'NEXT'], r: 1.7 });
  assert.equal(c.bodies.get('4513').influence, null, 'Luna has a faction but no Rsys');
  assert.equal(c.stations.get('4865').owner, 'SPACER');
  assert.deepEqual(c.stations.get('4865').influence, { factions: ['SPACER'], r: 0.3 });
  assert.equal(c.stations.get('4592').owner, '');
  assert.equal(c.stations.get('4842').o.dir, -1);
  assert.equal(c.bodies.get('4506').featured, true);
  assert.equal(M.catalogOf({ ...SYSTEM, bodies: SYSTEM.bodies.map((b) => (b.id === '4503' ? { ...b, parent: '#-1', o: '#-1' } : b)) }).bodies.get('4503').parent, null, 'MOO-style "#-1"');
  assert.equal(M.catalogOf({ active: false }), null);
  assert.equal(M.catalogOf('nope'), null);
  assert.equal(M.catalogOf({ active: true, bodies: [] }), null, 'no root');
});

test('positions: Earth ~1 AU from the Sun, Luna ~384,000 km from Earth, a station on its parent, a site on its body; chains and extents', () => {
  const c = M.catalogOf(SYSTEM);
  const t = SYSTEM.now;
  const memo = new Map();
  const e = M.posOf(c, c.bodies.get('4506'), t, memo);
  assert.ok(Math.abs(Math.hypot(e.x, e.y) - 1) < 0.02);
  const l = M.posOf(c, c.bodies.get('4513'), t, memo);
  const km = Math.hypot(l.x - e.x, l.y - e.y) * M.AU_KM;
  assert.ok(km > 360000 && km < 410000, `${km}`);
  const site = M.posOf(c, c.sites.get('003DED-A01E6EA9F0'), t, memo);
  assert.deepEqual(site, e);
  assert.deepEqual(M.chainOf(c, '4523').map((b) => b.name), ['Sun', 'Saturn', 'Titan']);
  assert.ok(Math.abs(M.frameExtent(c, '4503') - 39.482 * 1.2488) < 1e-9, 'Pluto apoapsis is the Sol frame');
  assert.ok(M.frameExtent(c, '4506') > 0.0025, 'Luna sets Earth\'s frame');
});

test('traffic: ships parse; a coasting ship follows its elements, a burning one its velocity', () => {
  const c = M.catalogOf(SYSTEM);
  const tr = M.trafficOf(TRAFFIC);
  assert.equal(tr.vessels.length, 3);
  const me = tr.vessels[0];
  assert.equal(me.parent, '4506'); assert.equal(me.burning, false); assert.equal(me.self, false);
  const p = M.vesselPos(c, me, TRAFFIC.now, TRAFFIC.now);
  const e = M.posOf(c, c.bodies.get('4506'), TRAFFIC.now);
  const km = Math.hypot(p.x - e.x, p.y - e.y) * M.AU_KM;
  assert.ok(Math.abs(km - 6878) < 5, `500 km orbit: ${km}`);
  // Its speed about Earth is what the console reports (7.61 km/s), not the heliocentric speed it was sent with.
  const kms = M.orbitSpeed(me.o, c.bodies.get('4506').mu, TRAFFIC.now) / 1000;
  assert.ok(Math.abs(kms - 7.61) < 0.01, `orbital speed ${kms}`);
  // The reported pos agrees with the propagated one (same clock).
  assert.ok(Math.hypot(p.x - me.pos.x, p.y - me.pos.y) * M.AU_KM < 50, 'propagation matches the server');
  const burner = { ...me, burning: true, vel: { x: M.AU_M, y: 0 } };
  const q = M.vesselPos(c, burner, TRAFFIC.now + 2, TRAFFIC.now);
  assert.ok(Math.abs(q.x - me.pos.x - 2) < 1e-9);
  assert.equal(M.trafficOf({}), null);
});

const BURNS = fx('burns.json');
test('burn: the ported profile matches $space:_burn_state on live legs (a 0.92 AU body leg, a rendezvous with lateral speed, a limb leg riding Earth with toff)', () => {
  const c = M.catalogOf(SYSTEM);
  // The fixtures' targets are sampled positions; replay them as the target so only the profile is under test.
  for (const [name, b] of Object.entries(BURNS)) {
    const L = M.legOf(b.leg);
    assert.ok(L, `${name} parses`);
    const at = (id, t) => { const s = b.samples.reduce((m, x) => (Math.abs(x.t - t) < Math.abs(m.t - t) ? x : m)); return Math.abs(s.t - t) < 1e-3 ? { pos: { x: s.tpos[0], y: s.tpos[1] }, vel: { x: 0, y: 0 } } : null; };
    for (const s of b.samples) {
      const st = M.burnState(L, s.t, at);
      const km = Math.hypot(st.pos.x - s.pos[0], st.pos.y - s.pos[1]) * M.AU_KM;
      assert.ok(km < 0.01, `${name} at +${(s.t - L.t_start).toFixed(0)}s off by ${km} km`);
    }
    assert.ok(Math.abs(M.burnDuration(L) - b.tf) < 1e-3, `${name} duration ${M.burnDuration(L)} vs ${b.tf}`);
    assert.ok(Math.abs(M.burnFlip(L) - b.t_flip) < 1e-3, `${name} flip`);
  }
  // Velocity: with the target's true velocity the server's own vel comes back (Mars ignition, at rest relative to Mars' frame).
  const mars = M.legOf(BURNS.Mars.leg);
  const s0 = M.burnState(mars, mars.t_start, () => ({ pos: mars.tpos0, vel: mars.tvel0 }));
  assert.ok(Math.hypot(s0.vel.x - BURNS.Mars.samples[0].vel[0], s0.vel.y - BURNS.Mars.samples[0].vel[1]) < 1, 'ignition velocity');
  // The catalog's own Mars (no replayed target) lands within a few thousand km at arrival: the fixtures were
  // captured a few game hours after system.json, and Mars' orbit is the same elements.
  const end = mars.t_start + M.burnDuration(mars);
  const live = M.burnState(mars, end, M.targetAt(c, null, end));
  const mp = M.posOf(c, c.bodies.get('4507'), end);
  assert.ok(Math.abs(Math.hypot(live.pos.x - mp.x, live.pos.y - mp.y) * M.AU_KM - 3796.19) < 1, 'arrives at the parking radius (3,796 km) from Mars');
  // The KMER rendezvous ends on KMER (stop 0); the curve bows off the straight line (lateral vl and a moving target).
  const k = M.legOf(BURNS.KMER.leg), kEnd = BURNS.KMER.samples.at(-1);
  const mid = BURNS.KMER.samples[3], a0 = BURNS.KMER.samples[0];
  const dev = Math.abs((kEnd.pos[0] - a0.pos[0]) * (mid.pos[1] - a0.pos[1]) - (kEnd.pos[1] - a0.pos[1]) * (mid.pos[0] - a0.pos[0])) / Math.hypot(kEnd.pos[0] - a0.pos[0], kEnd.pos[1] - a0.pos[1]) * M.AU_KM;
  assert.ok(dev > 1000, `the KMER path bows ${dev} km off the chord`);
  assert.equal(k.tbody, '4850');
  // Garbage is not a leg.
  assert.equal(M.legOf({ a: 1 }), null);
  assert.equal(M.legOf(null), null);
});

test('burn: Ship.Nav carries plan.legs and under_way.burn; a burning ship in traffic flies its leg', () => {
  const c = M.catalogOf(SYSTEM);
  const L = BURNS.KMER.leg;
  const n = M.navOf({ ...NAV, plan: { ...PLAN_KMER.plan ?? PLAN_KMER, legs: [L, { ...BURNS.Luna.leg, est: true }] } });
  assert.equal(n.plan.legs.length, 2); assert.equal(n.plan.legs[1].est, true);
  const u = M.navOf({ ...NAV, plan: 0, under_way: { target: { id: '4850', name: 'KMER' }, phase: 'accel', frac: 0.2, eta: 100, g: 1, burn: L, leg: 0 } });
  assert.equal(u.under_way.burn.tbody, '4850'); assert.equal(u.under_way.leg, 0); assert.equal(u.under_way.t_final, null);
  const tr = M.trafficOf({ ...TRAFFIC, vessels: [{ ...TRAFFIC.vessels[0], burning: 1, o: null, parent: null, burn: L }] });
  const t = BURNS.KMER.samples[3].t;
  const p = M.vesselPos(c, tr.vessels[0], t, TRAFFIC.now, undefined, tr);
  const k = M.posOf(c, c.stations.get('4850'), t);
  const want = BURNS.KMER.samples[3], wantK = want.tpos;
  // Relative to its target the ship sits where the game put it (the catalog's KMER is propagated, not replayed).
  const rel = { x: p.x - k.x, y: p.y - k.y }, wrel = { x: want.pos[0] - wantK[0], y: want.pos[1] - wantK[1] };
  assert.ok(Math.hypot(rel.x - wrel.x, rel.y - wrel.y) * M.AU_KM < 1, 'burning ship rides its target');
  // A coasting ship ignores a stray burn record.
  assert.equal(M.trafficOf({ ...TRAFFIC, vessels: [{ ...TRAFFIC.vessels[0], burn: L }] }).vessels[0].burn, null);
});

test('course: a plan draws its legs from ignition; under way the flown leg, and on a limb route leg 1 the arrival at t_final; nothing flyable, none', () => {
  const L = BURNS.KMER.leg, L2 = { ...BURNS.Luna.leg, est: true };
  const plan = M.navOf({ ...NAV, plan: { ...PLAN_KMER, legs: [BURNS.Luna.leg, L2] } });
  const c = M.courseOf(plan, null);
  assert.equal(c.legs.length, 2); assert.equal(c.live, false); assert.equal(c.from, BURNS.Luna.leg.t_start);
  const uw = M.navOf({ ...NAV, plan: 0, under_way: { target: { id: '4513', name: 'Luna' }, phase: 'accel', frac: 0.1, eta: 1, g: 1, burn: L, leg: 1, t_final: 1794710000 } });
  const u = M.courseOf(uw, null);
  assert.equal(u.live, true); assert.equal(u.legs.length, 1); assert.deepEqual(u.then, { id: '4513', t: 1794710000 });
  const leg2 = M.courseOf(M.navOf({ ...NAV, plan: 0, under_way: { target: { id: '4513', name: 'Luna' }, burn: L, leg: 2, t_final: 1794710000 } }), null);
  assert.equal(leg2.then, null);
  assert.equal(M.courseOf(M.navOf({ ...NAV, plan: { ...PLAN_KMER } }), null), null, 'an old server: no legs, the straight line');
  assert.equal(M.courseOf(null, null), null);
});

test('nav: the captured Ship.Nav parses; plans to a body and to a station; console tags; inactive is null', () => {
  const n = M.navOf(NAV);
  assert.equal(n.ship.squawk, 'V-o444');
  assert.equal(n.orbit.body, 'Earth'); assert.equal(n.orbit.body_id, '4506');
  assert.equal(n.contacts.length, 3); assert.equal(n.destinations.length, 14);
  assert.equal(n.plan, null); assert.equal(n.under_way, null);
  assert.deepEqual(n.coast, ['[WARNING] DRIFTING: NO COURSE']);
  assert.ok(n.burn.max > 1.8 && n.burn.min === 0.01);
  const p = M.planOf(PLAN_MARS);
  assert.equal(p.target.id, '4507'); assert.equal(p.confirm, true); assert.equal(p.blocked, false);
  assert.equal(p.warnings.length, 2); assert.deepEqual(p.aim, { x: PLAN_MARS.aim[0], y: PLAN_MARS.aim[1] });
  assert.equal(M.planOf(PLAN_KMER).closing_kms, PLAN_KMER.closing_kms);
  assert.deepEqual(M.tagOf('[WARNING] DRIFTING: NO COURSE'), { tag: 'WARNING', text: 'DRIFTING: NO COURSE' });
  assert.deepEqual(M.tagOf('plain'), { tag: '', text: 'plain' });
  assert.equal(M.navOf({ active: false }), null);
  const s = M.navOf({ active: true, ship: { id: 'x', name: 'n', squawk: 'V-1' }, scrambled: ['[ERROR] CONSOLE SCRAMBLED'] });
  assert.deepEqual(s.scrambled, ['[ERROR] CONSOLE SCRAMBLED']);
});

test('targets: contacts nearest first, then destinations (deduplicated), then bodies (not the star, not the one orbited); filter by callsign or full name', () => {
  const c = M.catalogOf(SYSTEM);
  const n = M.navOf(NAV);
  const rows = M.targetRows(n, c);
  assert.deepEqual(rows.filter((r) => r.group === 'contacts').map((r) => r.name), ['FDRF', 'V-6T15', 'KMER']);
  const dest = rows.filter((r) => r.group === 'destinations').map((r) => r.name);
  assert.ok(!dest.includes('KMER') && !dest.includes('FDRF'), 'each id once');
  assert.equal(dest[0], 'CGTW', 'nearest first');
  const bodies = rows.filter((r) => r.group === 'bodies').map((r) => r.name);
  assert.ok(bodies.includes('Mars') && bodies.includes('Luna'));
  assert.ok(!bodies.includes('Sun') && !bodies.includes('Earth'));
  assert.equal(rows.find((r) => r.name === 'KMER').label, 'Meridian Ring');
  assert.deepEqual(M.targetRows(n, c, 'meridian').map((r) => r.name), ['KMER']);
  assert.deepEqual(M.targetRows(n, c, 'mars').map((r) => r.name), ['Mars']);
  assert.equal(M.clampG(5, 0.01, 1.83), 1.83);
});

test('navName: bodies and stations by name, ships by callsign, never the star, the orbited body, a site, yourself; nothing without a console', () => {
  const c = M.catalogOf(SYSTEM);
  const n = M.navOf(NAV);
  assert.equal(M.navName(c.bodies.get('4507'), n), 'Mars');
  assert.equal(M.navName(c.bodies.get('4503'), n), '');
  assert.equal(M.navName(c.bodies.get('4506'), n), '', 'already orbiting Earth');
  assert.equal(M.navName(c.stations.get('4850'), n), 'Meridian Ring');
  assert.equal(M.navName(c.sites.get('003CE5-A01E6C5406'), n), '');
  const tr = M.trafficOf(PILOT_TRAFFIC);
  assert.equal(M.navName(tr.vessels[0], n), '', 'yourself');
  assert.equal(M.navName(tr.vessels[1], n), 'V-l79q');
  assert.equal(M.navName(c.bodies.get('4507'), null), '');
});

test('projector: the frame centre at the panel centre, the extent at the edge radius, compressed between; zoom and pan', () => {
  const p = M.projector({ x: 0, y: 0 }, 10, 400, 300, 1, { x: 0, y: 0 });
  assert.deepEqual(p({ x: 0, y: 0 }), { x: 200, y: 150 });
  const edge = p({ x: 10, y: 0 });
  assert.ok(Math.abs(edge.x - (200 + 150 - 34)) < 1e-9);
  const mid = p({ x: 1, y: 0 });
  assert.ok(mid.x - 200 > (edge.x - 200) * 0.3, 'inner orbits get more room than linear');
  const up = p({ x: 0, y: 10 });
  assert.ok(up.y < 150, 'north is up');
  const z = M.projector({ x: 0, y: 0 }, 10, 400, 300, 2, { x: 5, y: 0 });
  assert.ok(Math.abs(z({ x: 10, y: 0 }).x - (205 + 2 * 116)) < 1e-9);
});

// ─── the extension in the host ───────────────────────────────────────────────────────────────────────────────

function fake(host) {
  const touches = [], opens = [];
  host.mu.panels.touch = (id, sid) => touches.push([id, sid]);
  host.mu.panels.open = (id, params, o) => opens.push([id, o?.sid]);
  host.mu.ui.css = { ...host.mu.ui.css, cmd: 'sh-cmd', toggle: 'sh-toggle', plate: 'sh-plate', count: 'sh-count', field: 'sh-field', row: 'sh-row', label: 'sh-label', secHead: 'sec-head', secClose: 'sec-close', empty: 'empty', sq: 'sq', dim: 'dim', ok: 'ok', gold: 'gold', hot: 'hot', warn: 'warn' };
  return { touches, opens };
}
async function setup() {
  const host = createHost({ root: ROOT, sessions: [{ id: 's1', worldId: 'w1' }] });
  const f = fake(host);
  await host.load('src/index.ts');
  const mount = (id, sid = 's1') => {
    const el = document.createElement('div');
    document.body.append(el);
    const off = host.panels.get(id).mount(el, { sid, worldId: 'w1', params: {} });
    return { el, off, q: (s) => el.querySelector(s), all: (s) => [...el.querySelectorAll(s)] };
  };
  const cmds = () => host.sends('command').map((s) => s.text);
  return { host, mount, cmds, ...f };
}

test('registration: two panels (map float 60, nav right-top 61, singleton, show auto); manifest declares Space 1 and Ship 1, onGmcp activation, send-commands; settings; everything disposed', async () => {
  const { host } = await setup();
  const pick = (id) => { const { title, defaultPosition, order, singleton, show } = host.panels.get(id); return { title, defaultPosition, order, singleton, show }; };
  assert.deepEqual(pick('navcomp.map'), { title: 'System map', defaultPosition: 'float', order: 60, singleton: true, show: 'auto' });
  assert.deepEqual(pick('navcomp.nav'), { title: 'Navigation', defaultPosition: 'right-top', order: 61, singleton: true, show: 'auto' });
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.muclient.contributes.gmcp.map((g) => g.package), ['Space 1', 'Ship 1']);
  assert.deepEqual(Object.keys(pkg.muclient.contributes.gmcp[0].messages), ['Space.System', 'Space.Traffic', 'Space.Get']);
  assert.deepEqual(pkg.muclient.activation, ['onGmcp:Space', 'onGmcp:Ship']);
  assert.deepEqual(pkg.muclient.capabilities, ['send-commands']);
  assert.deepEqual(pkg.muclient.categories, ['interface']);
  assert.deepEqual(host.settingsSchema.items.map((i) => [i.key, i.default, i.scope]), [['map.territory', true, 'world'], ['map.traffic', true, 'world']]);
  assert.equal(host.errors.length, 0);
  await host.unload();
  assert.deepEqual(host.live(), []);
});

test('schemas: the captured payloads validate; Space.Get is an empty object', () => {
  const schema = (f) => JSON.parse(readFileSync(join(ROOT, 'schema', f), 'utf8'));
  assert.equal(validate(schema('system.json'), SYSTEM), null);
  assert.equal(validate(schema('system.json'), { active: false }), null);
  assert.equal(validate(schema('traffic.json'), TRAFFIC), null);
  assert.equal(validate(schema('nav.json'), NAV), null);
  assert.equal(validate(schema('nav.json'), { ...NAV, plan: PLAN_MARS }), null);
  assert.equal(validate(schema('nav.json'), { active: false }), null);
  assert.equal(validate(schema('empty.json'), {}), null);
  assert.match(validate(schema('traffic.json'), { vessels: [{ id: 'x' }] }), /name|pos/);
});

test('map: waiting until a catalog; mounting asks once with Space.Get; then breadcrumbs, featured frames, IC clock, touched once', async () => {
  const { host, mount, touches } = await setup();
  const m = mount('navcomp.map');
  assert.equal(m.q('[data-testid=nc-empty]').hidden, false);
  assert.equal(m.q('[data-testid=nc-empty]').textContent, 'Waiting for navcomp');
  assert.deepEqual(host.sends('gmcp').map((s) => [s.pkg, s.data]), [['Space.Get', {}]]);
  mount('navcomp.map');
  assert.equal(host.sends('gmcp').length, 1, 'asked once per session');
  host.gmcp('s1', 'Space.System', SYSTEM);
  assert.equal(m.q('[data-testid=nc-empty]').hidden, true);
  const crumbs = m.all('[data-testid=nc-crumb]').map((b) => b.textContent);
  assert.deepEqual(crumbs, ['Sun3◆', 'Earth3◆', 'Mars1◆', 'Saturn']);
  assert.equal(m.q('[data-testid=nc-crumb][aria-current=true]').dataset.id, '4503');
  assert.equal(m.q('[data-testid=nc-mode]').textContent, 'admin · all traffic');
  host.gmcp('s1', 'Space.System', SYSTEM);
  assert.deepEqual(touches, [['navcomp.map', 's1']]);
  assert.equal(host.errors.length, 0);
});

test('map: frames, the In-frame list, detail with facts, territory legend in Sol only, warp buttons', async () => {
  const { host, mount } = await setup();
  host.gmcp('s1', 'Space.System', SYSTEM);
  const m = mount('navcomp.map');
  assert.ok(m.all('[data-testid=nc-faction]').length >= 5, 'legend in Sol');
  m.q('[data-testid=nc-crumb][data-id="4506"]').click();
  assert.equal(m.q('[data-testid=nc-crumb][aria-current=true]').dataset.id, '4506');
  assert.equal(m.q('[data-testid=nc-legend]').hidden, true, 'no territory outside Sol');
  m.q('[data-testid=nc-list]').click();
  const items = m.all('[data-testid=nc-item]').map((b) => b.querySelector('.nm').textContent);
  assert.deepEqual(items, ['Earth', 'Luna', 'Torchship', 'Meridian Ring', 'Driftwater', 'New California']);
  m.all('[data-testid=nc-item]').find((b) => b.dataset.id === '4513').click();
  assert.equal(m.q('[data-testid=nc-detail-name]').textContent, 'Luna');
  const facts = m.all('[data-testid=nc-facts] dt').map((d) => d.textContent);
  assert.deepEqual(facts.slice(0, 5), ['Type', 'Orbits', 'Radius', 'Orbit', 'Ecc.']);
  assert.ok(m.q('[data-testid=nc-enter]'), 'Luna has a frame (Gateway Orbital, Coldlight)');
  assert.equal(m.q('[data-testid=nc-plot]'), null, 'no console: no course to plot');
  m.q('[data-testid=nc-enter]').click();
  assert.deepEqual(m.all('[data-testid=nc-crumb]').slice(0, 3).map((b) => b.dataset.id), ['4503', '4506', '4513']);
  // Territory off.
  m.q('[data-testid=nc-crumb][data-id="4503"]').click();
  m.q('[data-testid=nc-territory]').click();
  assert.equal(m.q('[data-testid=nc-territory]').getAttribute('aria-pressed'), 'false');
  assert.equal(m.q('[data-testid=nc-legend]').hidden, true);
  // Warp.
  const warp = m.all('[data-testid=nc-warp-btn]');
  assert.deepEqual(warp.map((b) => b.textContent), ['1×', '1m/s', '1h/s', '1d/s', '30d/s']);
  assert.equal(m.q('[data-testid=nc-now]').disabled, true);
  warp[3].click();
  assert.equal(m.all('[data-testid=nc-warp-btn]')[3].getAttribute('aria-pressed'), 'true');
  assert.equal(m.q('[data-testid=nc-now]').disabled, false);
  m.q('[data-testid=nc-now]').click();
  assert.equal(m.all('[data-testid=nc-warp-btn]')[0].getAttribute('aria-pressed'), 'true');
  assert.equal(host.errors.length, 0);
});

test('map as a pilot: opens on the ship\'s frame; ship detail; PLOT COURSE on a body sends =nav <name>, PASS on a ship =nav pass', async () => {
  const { host, mount, cmds } = await setup();
  host.gmcp('s1', 'Space.System', PILOT_SYSTEM);
  host.gmcp('s1', 'Space.Traffic', PILOT_TRAFFIC);
  host.gmcp('s1', 'Ship.Nav', NAV);
  const m = mount('navcomp.map');
  assert.equal(m.q('[data-testid=nc-crumb][aria-current=true]').dataset.id, '4506', 'centred on Earth, where the ship is');
  assert.equal(m.q('[data-testid=nc-mode]').textContent, 'pilot · V-o444');
  m.q('[data-testid=nc-goto-ship]').click();
  assert.equal(m.q('[data-testid=nc-detail-name]').textContent, 'V-o444');
  assert.equal(m.q('[data-testid=nc-plot]'), null, 'not yourself');
  m.q('[data-testid=nc-list]').click();
  const ids = m.all('[data-testid=nc-item]').map((b) => b.dataset.id);
  assert.ok(ids.includes('2EB06E-A1A98368D7'), 'contact ship listed');
  m.all('[data-testid=nc-item]').find((b) => b.dataset.id === '2EB06E-A1A98368D7').click();
  m.q('[data-testid=nc-pass]').click();
  m.q('[data-testid=nc-plot]').click();
  m.q('[data-testid=nc-crumb][data-id="4503"]').click();
  m.q('[data-testid=nc-list]').click();
  m.all('[data-testid=nc-item]').find((b) => b.dataset.id === '4507').click();
  m.q('[data-testid=nc-plot]').click();
  assert.deepEqual(cmds(), ['=nav pass V-l79q', '=nav V-l79q', '=nav Mars']);
  assert.equal(host.errors.length, 0);
});

test('nav panel: SIT AT A POWERED PILOT CONSOLE until Ship.Nav; the ship block; no course; burn slider; target picker; touched once', async () => {
  const { host, mount, cmds, touches } = await setup();
  const n = mount('navcomp.nav');
  assert.equal(n.q('[data-testid=nv-empty]').textContent, 'Sit at a powered pilot console');
  host.gmcp('s1', 'Space.System', PILOT_SYSTEM);
  host.gmcp('s1', 'Ship.Nav', NAV);
  assert.equal(n.q('[data-testid=nv-squawk]').textContent, 'V-o444');
  assert.match(n.q('.kv').textContent, /Earth · alt 500 km · 7\.61 km\/s/);
  assert.match(n.q('.kv').textContent, /CLEAR via DRIFTWATER/);
  assert.ok(n.q('[data-testid=nv-no-course]'));
  assert.deepEqual(n.all('[data-testid=nv-coast]').map((l) => l.textContent), ['warningDRIFTING: NO COURSE']);
  // Burn.
  const r = n.q('[data-testid=nv-burn]');
  assert.equal(r.min, '0.01'); assert.equal(Number(r.value), 1);
  assert.equal(n.q('[data-testid=nv-burn-set]').disabled, true, 'unchanged');
  r.value = '1.5'; r.dispatchEvent(new Event('input'));
  assert.match(n.q('[data-testid=nv-burn-value]').textContent, /1\.50/);
  n.q('[data-testid=nv-burn-set]').click();
  // Orbit intents.
  n.q('[data-testid=nv-orbit-high]').click();
  n.q('[data-testid=nv-leave]').click();
  // Targets.
  const tg = n.all('[data-testid=nv-target]');
  assert.equal(tg[0].dataset.id, '4842');
  const filter = n.q('[data-testid=nv-filter]');
  filter.value = 'merid'; filter.dispatchEvent(new Event('input'));
  assert.deepEqual(n.all('[data-testid=nv-target] .nm').map((x) => x.textContent), ['KMER']);
  n.q('[data-testid=nv-target-plot]').click();
  filter.value = 'zzz'; filter.dispatchEvent(new Event('input'));
  assert.equal(n.q('.targets').textContent, 'No matching target');
  assert.deepEqual(cmds(), ['=nav burn 1.50', '=nav orbit high', '=nav leave', '=nav KMER']);
  host.gmcp('s1', 'Ship.Nav', NAV);
  assert.equal(n.q('[data-testid=nv-filter]').value, 'zzz', 'the filter survives a redraw');
  assert.deepEqual(touches.filter(([id]) => id === 'navcomp.nav'), [['navcomp.nav', 's1']]);
  host.gmcp('s1', 'Ship.Nav', { active: false });
  assert.equal(n.q('[data-testid=nv-empty]').textContent, 'Sit at a powered pilot console');
  assert.equal(host.errors.length, 0);
});

test('nav panel: a plotted course with warnings needs EXECUTE ANYWAY (=nav execute confirm); a clean one EXECUTE; CANCEL; a blocked one cannot run; errors as plates; the target row is current', async () => {
  const { host, mount, cmds } = await setup();
  host.gmcp('s1', 'Space.System', PILOT_SYSTEM);
  host.gmcp('s1', 'Ship.Nav', { ...NAV, plan: PLAN_MARS, coast: [] });
  const n = mount('navcomp.nav');
  assert.equal(n.q('[data-testid=nv-maneuver]').textContent, 'COURSE to Mars -- low orbit, 400km');
  const kv = n.all('.kv')[1].textContent;
  assert.match(kv, /0\.920 AU/); assert.match(kv, /2d 17h/); assert.match(kv, /35\.5%/);
  assert.equal(n.all('[data-testid=nv-warning]').length, 2);
  assert.equal(n.q('[data-testid=nv-execute]'), null);
  n.q('[data-testid=nv-execute-confirm]').click();
  n.q('[data-testid=nv-cancel]').click();
  assert.equal(n.q('[data-testid=nv-target-plot][aria-current=true] .nm').textContent, 'Mars');
  host.gmcp('s1', 'Ship.Nav', { ...NAV, plan: { ...PLAN_KMER, confirm: 0, warnings: [] } });
  assert.match(n.all('.kv')[1].textContent, /Closing/);
  n.q('[data-testid=nv-execute]').click();
  host.gmcp('s1', 'Ship.Nav', { ...NAV, plan: { ...PLAN_MARS, blocked: 1, errors: ['[ERROR] INSUFFICIENT PROPELLANT'] } });
  assert.ok(n.q('[data-testid=nv-blocked]'));
  assert.equal(n.q('[data-testid=nv-execute]'), null); assert.equal(n.q('[data-testid=nv-execute-confirm]'), null);
  assert.equal(n.q('[data-testid=nv-error] .tx').textContent, 'INSUFFICIENT PROPELLANT');
  host.gmcp('s1', 'Ship.Nav', { ...NAV, plan: { lost: true, target: { id: '', name: 'V-zz' } } });
  assert.equal(n.q('[data-testid=nv-lost]').textContent, 'V-zz is no longer on sensors');
  assert.deepEqual(cmds(), ['=nav execute confirm', '=nav cancel', '=nav execute']);
  assert.equal(host.errors.length, 0);
});

test('nav panel: under way shows phase, progress and ETA with ABORT BURN (=nav abort) and hides the planner; combat disables execute; scrambled withholds everything', async () => {
  const { host, mount, cmds } = await setup();
  const UW = { target: { id: '4507', name: 'Mars' }, maneuver: 'COURSE to Mars -- low orbit, 400km', phase: 'accel', label: 'Accelerating under thrust', frac: 0.25, eta: 200000, g: 1, pass: 0, route: '', replan: '', warnings: ['[WARNING] THRUSTERS DAMAGED: 55% CONDITION'], aim: [0, 1.5] };
  host.gmcp('s1', 'Ship.Nav', { ...NAV, orbit: { course: 'BURNING' }, under_way: UW });
  const n = mount('navcomp.nav');
  assert.equal(n.q('[data-testid=nv-progress]').getAttribute('aria-valuenow'), '25');
  assert.match(n.all('.kv')[1].textContent, /Accelerating under thrust/);
  assert.equal(n.q('[data-testid=nv-burn]'), null); assert.equal(n.q('[data-testid=nv-filter]'), null);
  n.q('[data-testid=nv-abort]').click();
  host.gmcp('s1', 'Ship.Nav', { ...NAV, combat: 1, plan: PLAN_KMER });
  assert.ok(n.q('[data-testid=nv-combat]'));
  assert.equal(n.q('[data-testid=nv-execute-confirm]').disabled, true);
  host.gmcp('s1', 'Ship.Nav', { active: true, ship: { id: 'x', name: 'altair', squawk: 'V-o444' }, scrambled: ['[ERROR] NAVCOMP SCRAMBLED'] });
  assert.equal(n.q('[data-testid=nv-burn]'), null);
  assert.equal(n.q('[data-testid=nv-scrambled] .tx').textContent, 'NAVCOMP SCRAMBLED');
  assert.deepEqual(cmds(), ['=nav abort']);
  assert.equal(host.errors.length, 0);
});

test('nav → map: the ⌕ on the plan opens the map and selects the target; selected later when the map was closed', async () => {
  const { host, mount, opens } = await setup();
  host.gmcp('s1', 'Space.System', PILOT_SYSTEM);
  host.gmcp('s1', 'Space.Traffic', PILOT_TRAFFIC);
  host.gmcp('s1', 'Ship.Nav', { ...NAV, plan: PLAN_MARS });
  const n = mount('navcomp.nav');
  n.q('[data-testid=nv-show-target]').click();
  assert.deepEqual(opens, [['navcomp.map', 's1']]);
  const m = mount('navcomp.map');
  assert.equal(m.q('[data-testid=nc-detail-name]').textContent, 'Mars');
  assert.equal(m.q('[data-testid=nc-crumb][aria-current=true]').dataset.id, '4507', 'Mars has a frame');
  n.q('[data-testid=nv-show-ship]').click();
  assert.equal(m.q('[data-testid=nc-detail-name]').textContent, 'V-o444');
  assert.equal(host.errors.length, 0);
});

test('session end: state goes; a remounted panel waits again', async () => {
  const { host, mount } = await setup();
  host.gmcp('s1', 'Space.System', SYSTEM);
  host.gmcp('s1', 'Space.System', { active: false });
  const m = mount('navcomp.map');
  assert.equal(m.q('[data-testid=nc-empty]').hidden, false);
  m.off();
  assert.equal(m.el.children.length, 0);
  assert.equal(host.errors.length, 0);
});
