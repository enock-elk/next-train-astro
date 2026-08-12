# Changelog

Longer release notes for the repo. The in-app “What’s New” modal uses the short bullets in `src/lib/config.js` (`CHANGELOG_DATA`). Keep `APP_VERSION`, `CHANGELOG_DATA[0].id`, `package.json` `version`, and `public/app-version.json` aligned on each release.

## V8_08.11 — Lab line: board-first live + lean chat (11 Aug 2026)

- Long-lived `lab` branch + `lab.nexttrain.co.za` deploy workflow (independent of `main` / production).
- Board live alerts: pending (n/3) → verified chip with EXP time + thumbs; RTDB listeners by route.
- RTDB `config/features` corridor gates (`delayReportsUi`, `communityRealtime`, `pushNotify`, `rideCheckIn`) — pilot seed for `pta-pien`, `pta-mabopane`, `ct-bellv`.
- Lean route chat: `limitToLast(10)`, 24h TTL, listener teardown off-tab; optional Cloudflare write bouncer (`workers/nexttrain-community`).
- Station check-in / last-seen chips (`ride_pings`) — no GPS trails.
- Docs: `docs/PHASE-LIVE-STRATEGY.md`, `docs/config-features-pilot.json`, lab/community phase notes.

## V8_08.10.1 — Cape Town Public Holidays (10 Aug 2026)

- Western Cape public holidays no longer reuse Saturday timetables automatically.
- Cape Town corridors load dedicated `*_pub` holiday schedules from Firebase.
- Timetable grid and Trip Planner Travel Day expose a standalone Public Holiday option for Western Cape only.
- Other regions keep the existing Saturday / holiday behaviour.

## V8_08.08 — Map, Fares & Home Board (08 Aug 2026)

- Trip planner map: toggle station times on route labels.
- Fares: weekend and public-holiday tickets no longer show weekday off-peak discounts.
- Network map: region picker stays on-screen; side-nav map opens without a white flash.
- Region switch opens route selection (no auto-pin of a random route).
- Service alerts and public-holiday notices only auto-open on Next Train / Trip Planner after stabilize + route selected.
- Planner results chrome polish; timetable wording; holiday eve overrides week preview; Dev Mode tile tap/colour polish.

## V8_08.06 — Holiday Notice & Travel Day (06 Aug 2026)

- Holiday notice: upcoming public holidays shown once in stacked dismissible cards.
- Trip Planner Travel Day: single clean date control (no second native date field).
- Polish: smoother drawer and tab gestures.

## V8_08.05 — Planner UI & Bugfix (05 Aug 2026)

- Cleared planner and navigation bugs (guide/map sheet return, alert ranking, notice glitches).
- Redesigned the Trip Planner results UI for clearer chrome and notices.
- Stability polish around About and in-app sheets.



## V8_08.04 — Next Train: System Upgrade (04 Aug 2026)

- Massive under-the-hood upgrade for a faster, more reliable Next Train (**V8** platform line).
- Weekend clarity: no-Saturday-service notices + next weekday train on the board.
- Sunday & holidays: red “No Service” day chip; guide clarifies holiday vs Saturday schedules.
- “You’re here” location pin at terminus stops.



## V7_07.28 — Performance Polish Edition (28 Jul 2026)

- Smoother navigation under rapid taps and screen transitions.
- Stronger connectivity checks with safer offline schedule fallback.
- Cleaner route cards and trip timeline visuals.
- Leaner background data engine for battery and sync reliability.



## V7_07.11 — Performance & Precision Polish (11 Jul 2026)

- Incident warnings only when the journey actually crosses a disruption zone.
- “See Next Available Day” syncs the day dropdown correctly.
- Trip Planner result-card visual polish.



## V7_06.29 — Trip Planner Polish (29 Jun 2026)

- Tighter planner timeline and clearer severance callouts.
- Official rebrand to Next Train.



## V7_06.24 — The Corporate Glass Update (24 Jun 2026)

- Icon/timeline redesign, layover warnings, and clearer impossible-route messaging.



## V7_06.17 — The Precision Update (17 Jun 2026)

- Trip Planner surfaces overnight and extended weekend connections that were previously filtered out.
- Journey timeline colours unified; small-screen text clipping fixed.
- Impossible-trip messaging now explains incident, timetable gap, or disconnected-line causes.



## V7_05.31 — Performance Polish (31 May 2026)

- Welcome screen no longer freezes on “Loading Route”.
- Side menu and small-screen typography tightened; ads no longer leak onto the welcome surface.
- Background schedule sync hardened for patchy mobile networks.



## V7_05.16 — Western Cape Expansion (16 May 2026)

- Six new Cape Town routes for Central and Northern Line coverage.
- Dropdown menus dim the background for a clearer focus state.



## V7_05.12 — KZN & EC Launch (12 May 2026)

- Launch in KwaZulu-Natal and Eastern Cape.
- Region switching from the main menu.



## V6_05.01 — Growth Edition (1 May 2026)

- Optional non-intrusive ads to support server costs.
- Timetable scrolling and delayed/severed route legibility improvements.



## V6_04.26 — Guardian Edition (26 Apr 2026)

- Holiday-aware weekend routing in the Trip Planner.
- Clearer “Line Severed” disruption blocks.
- Time-menu and clipping polish.



## V6_00 — Western Cape Launch (Apr 2026)

- Full Western Cape offline schedules and planning.
- Consolidated side menu for settings, sync, and region.
- Hardware back closes modals instead of exiting.



## V5_0 — The Timetable Update (Mar 2026)

- Full-day timetable grids.
- WhatsApp trip sharing.
- Recent-search memory for offline use.



## V4_0 — The Trip Planner (Feb 2026)

- Origin/destination planner with transfers.
- Fare calculator with scholar, pensioner, and off-peak discounts.

