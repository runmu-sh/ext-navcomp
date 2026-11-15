# Changelog

## 0.2.0

- **Real flight paths.** Courses are drawn along the path the game flies: Torchship's turn-and-burn profile is ported to `src/burn.ts`, and it matches `$space:_burn_state` to within 10 m on live legs. The line rides the target and is shown relative to the frame you are viewing. A plotted course is dashed, the flown part solid; there is a flip tick, a limb waypoint, an aim crosshair with an ETA, and the target's arrival position. A limb route's leg 2 is dotted. A blocked plan is red.
- **Burning ships fly their legs.** Burning ships are positioned on the map by their burn leg rather than straight-line extrapolation, so they stay right under time warp. An admin sees every burning ship's path. A burning ship is shown in its target's local frame (Earth for Luna or a station on Earth) while it is near it.
- Server contract, additive: `Ship.Nav` `plan.legs`, `under_way.burn`, `under_way.leg`, `under_way.t_final`, and `Space.Traffic` `vessels[].burn`. Without them the straight line is still drawn.

## 0.1.0

- First version, for Torchship (`Space 1`, `Ship 1`).
- **System map.** The solar system propagated live from Kepler elements, one frame at a time, with breadcrumbs, pan and zoom, and a time warp up to 30 days per second. Shows faction territory with a legend, charted stations, landing sites and ships (yours highlighted, burning ships with a trail), and draws your plotted course. A click opens the facts, and Plot course / Pass send `=nav`. Admins always see the whole system and every ship. A seated pilot sees the public catalog, their own ship and their contacts.
- **Navigation.** A panel for the pilot console: ship and orbit, the flight plan with its error and warning plates, Execute / Execute anyway / Cancel, the burn under way with Abort, a burn slider, orbit and leave buttons, and a filterable list of contacts, destinations and bodies. Every button sends the real `=nav` command.
- Settings `map.territory` and `map.traffic`.
