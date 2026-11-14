# Changelog

## 0.1.0

- First version, for Torchship (`Space 1`, `Ship 1`).
- **System map.** The solar system propagated live from Kepler elements, one frame at a time, with breadcrumbs, pan and zoom, and a time warp up to 30 days per second. Shows faction territory with a legend, charted stations, landing sites and ships (yours highlighted, burning ships with a trail), and draws your plotted course. A click opens the facts, and Plot course / Pass send `=nav`. Admins always see the whole system and every ship. A seated pilot sees the public catalog, their own ship and their contacts.
- **Navigation.** A panel for the pilot console: ship and orbit, the flight plan with its error and warning plates, Execute / Execute anyway / Cancel, the burn under way with Abort, a burn slider, orbit and leave buttons, and a filterable list of contacts, destinations and bodies. Every button sends the real `=nav` command.
- Settings `map.territory` and `map.traffic`.
