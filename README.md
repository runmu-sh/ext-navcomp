# Navcomp (`@runmu.sh/ext-navcomp`, id `navcomp`)

Torchship's solar system as a live map, plus a navigation console that works like the in-game `=nav` text interface. Wizards can always see the whole system and every ship in it. A player sees the map while seated at a powered pilot console, limited to the public catalog, their own ship and their sensor contacts. The navigation panel only sends the real `=nav` commands, so every action also shows up in the terminal as usual.

## System map
```
 [ SUN 3◆ ] [ › EARTH 3◆ ] · [ MARS 1◆ ] [ SATURN ]    [ SHIP ] ■TERRITORY ■SHIPS □LIST − + ↺
 ┌──────────────────────────────────────────────┬─────────────────────────────┐
 │                 ▣ MERIDIAN RING    ◉ LUNA    │ Meridian Ring     STATION   │
 │            ➤                                 │ ORBITS   Earth              │
 │         ➤ ▣ DRIFTWATER                       │ ORBIT    153,760 km         │
 │       V-O444  ●  EARTH                       │ PERIOD   6d 22h             │
 │             ▣ TORCHSHIP                      │ OWNER    independent        │
 │                                              │ [ PLOT COURSE ]             │
 └──────────────────────────────────────────────┴─────────────────────────────┘
 IC 2365-03-04 03:28:43  ■1× □1M/S □1H/S □1D/S □30D/S [ NOW ]     PILOT · V-O444
```

- **Frames.** Each body with moons or stations has its own frame. The breadcrumbs show the chain from the Sun to the current frame, followed by the featured bodies and your ship's frame. `n◆` is the number of charted stations in a frame. Click a body twice, or double-click it, to enter its frame. Press Esc to go back up.
- **Moving around.** Drag to pan, scroll to zoom about the cursor, and use `−` `+` `↺` or the arrow and `+`/`−` keys. Distances are compressed (r^0.42) so that a whole frame fits on screen. Labels that would overlap are dropped, keeping the more important ones (selected or hovered first, then the frame's body, your ship, planets, moons, stations, other ships).
- **Time.** Bodies, stations and coasting ships are propagated from their Kepler elements on the game's clock. Burning ships are extrapolated from their last position and velocity. The warp buttons run the clock forward at up to 30 game days per second, and `[ NOW ]` returns to live time. The IC clock in the footer shows the game date at the time you are looking at.
- **Territory.** Each faction's reach is drawn as a tinted circle: around a station from its owner and `influence_au`, around a body from its `Rsys`. A dashed circle means several factions share that space. The faction legend appears in the Sun frame when the stage has room for it. Turn the circles off with `■TERRITORY`.
- **Ships.** Ships are drawn as arrows pointing along their velocity. Yours is green and burning ships are gold. A course is drawn as the path the ship really flies, computed from the game's own burn profile and shown in the frame you are looking at. A plotted course is dashed, a limb route's second leg (re-solved by the game at the waypoint) is dotted, and a blocked plan is red. Under way, the flown part is solid and the ship rides the line, under time warp too. There is a tick at the flip, a diamond at a limb waypoint, a crosshair at the aim with the time to go, and a hollow square where the target will be on arrival when the ship stops short of it. An admin sees every other burning ship's path in faint gold. A server that does not send burn legs gets the old straight dashed line. `■SHIPS` hides them. `[ SHIP ]` jumps to your ship's frame and selects it.
- **Details.** A click selects a body, station, landing site or ship, and the facts open in a side panel (along the bottom when the map is narrow). From there, **Plot course** sends `=nav <name>` and, for ships, **Pass** sends `=nav pass <name>`. These are only offered at a console with no burn under way and clear comms. `□LIST` lists everything in the current frame.

## Navigation
```
 ┤SHIP├──────────────────────────────────────── ⌕
 V-o444  altair-class torchship
 ORBITING  Earth · alt 500 km · 7.61 km/s · 1h 34m
 COMMS     CLEAR via DRIFTWATER, lag 0.03s
 ┤FLIGHT PLAN├───────────────────────────────── ⌕
 COURSE to Mars -- low orbit, 400km
 DISTANCE 0.920 AU   ETA 2d 17h   BURN 1.00 G   PROPELLANT 35.5%
 WARNING  THRUSTERS DAMAGED: 55% CONDITION
 [ EXECUTE ANYWAY ] [ CANCEL ]
 ┤BURN├───────────────────────────────────────────
 ━━━━━━━━━━━━━━━━■────────────  1.00 G  [ SET ]
 ┤PLOT A COURSE├──────────────────────────────────
 [ ORBIT LOW ] [ ORBIT HIGH ] [ LEAVE ORBIT ]
 filter targets
 CONTACTS      FDRF  Driftwater      10,193 km  STATION
 DESTINATIONS  CGTW  Gateway Orbital 360,989 km STATION
 BODIES        Mars                             BODY
```

| Button | Sends |
|---|---|
| a target row, or **Plot course** on the map | `=nav <name>` |
| **Pass** (a ship on the map) | `=nav pass <name>` |
| **Orbit low** / **Orbit high** / **Leave orbit** | `=nav orbit low` / `=nav orbit high` / `=nav leave` |
| **Set** (burn slider) | `=nav burn <g>` |
| **Execute** / **Execute anyway** | `=nav execute` / `=nav execute confirm` |
| **Abort burn** | `=nav abort` |
| **Cancel** | `=nav cancel` |

Errors and warnings from the console are shown as plates. A plan with errors is **Blocked**. A plan with warnings offers **Execute anyway**, which is disabled in combat. While a burn is under way the panel shows the maneuver, its phase and progress, the ETA, the route and any replan. With scrambled comms only the console's own lines are shown. `⌕` shows your ship, or the plan's target, on the map.

## The server contract
| Direction | Message | Payload |
|---|---|---|
| in | `Space.System` | `{ active, admin, now, ic, rate, root_id, bodies: [{ id, name, type, parent, o, mu, r_km, featured, influence }], stations: [{ id, name, parent, o, owner, influence_au, blurb }], landing_sites: [{ id, name, parent, owner, blurb }], factions: [{ id, name, color }] }`. `o` = `{ a (AU), e, om, M0, ep, rate, dir? }`. `now` is the game's real unix time at send, and `ic` the IC clock at `now`. Admins get it on login. A player gets it while seated at a powered cockpit, and `{ active: false }` on standing |
| in | `Space.Traffic` | `{ admin, now, ic, rate, vessels: [{ id, name, hull?, burning, pos, vel, parent?, o?, self?, target?, burn? }] }`. `pos` in AU, `vel` in m per real second. `burn` is a burning ship's leg (below). Admins see every ship; a pilot sees their own ship and sensor contacts |
| in | `Ship.Nav` | `{ active, console, ship, orbit, comms, combat, crippled, burn: { g, min, max }, plan, under_way, contacts, destinations, coast, pos, vel }`, the state of the console the player is seated at. `plan` and `under_way` are 0 when absent. `plan.legs` holds the legs `=nav execute` would fly (on a limb route, leg 2 is an estimate marked `est`). `under_way.burn` is the leg being flown, and on a limb route `under_way.leg` (1 or 2) and `t_final` (real s) |
| | a leg | `{ tbody, opos, tpos0, tvel0, t_start, init_dist, stop_m, t1, coast, a, v0, vl, ve, pass, inertial, toff, est? }`, Torchship's `#4709:_burn_desc`: a straight accelerate / coast / brake profile in the target's frame plus a lateral blend. Positions in AU, times in real unix s, metres and m per real s (and s²). The client recomputes `$space:_burn_state` from it (`src/burn.ts`) |
| out | `Space.Get` | `{}`: asks for the catalog and traffic again. Sent once per session when the map opens with no catalog |

The manifest declares `Space 1` and `Ship 1`, so the client lists them in `Core.Supports` and the host checks inbound messages against `schema/`. The extension activates on the first `Space.*` or `Ship.*` message, so it stays idle on games that don't speak them. Both panels are `show: 'auto'`: the System map is offered (and added once) the first time a catalog arrives in a session, and the Navigation panel the first time a console state arrives.

## Settings
| Key | Scope | Default | What |
|---|---|---|---|
| `map.territory` | world | on | Draw faction territory on the map |
| `map.traffic` | world | on | Draw ships on the map |

## Developing
```
npm install
npm run dev        # serves src/ on :5199 for ?ext-dev=http://localhost:5199/
npm run build      # dist/index.js + manifest check
npm test           # orbit maths, the parsers against captured payloads, and both panels in the headless host
```

`test/fixtures/` holds payloads captured from Torchship: the catalog as an admin, the traffic, a console in a 500 km Earth orbit, and plans to Mars and Meridian Ring.

Made with `npm create @runmu.sh/extension`.
