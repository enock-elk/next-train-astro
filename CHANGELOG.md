# Changelog

Longer release notes for the repo. The in-app “What’s New” modal uses the short bullets in `src/lib/config.js` (`CHANGELOG_DATA`). Keep `APP_VERSION`, `CHANGELOG_DATA[0].id`, `package.json` `version`, and `public/app-version.json` aligned on each release.

## V8_08.02 — Weekend Clarity Edition (02 Aug 2026)

- Clear empty state for routes with no Saturday timetable, plus next weekday CTA.
- Sunday / no-service holidays show red “No Service” in the day chip.
- Terminus board uses a location pin (“You’re here”).
- Guide FAQ: public holidays are not always Saturday; some routes have no weekend service.

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
