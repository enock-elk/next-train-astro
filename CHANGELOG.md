# Changelog

Longer release notes for the repo. The in-app “What’s New” modal uses the short bullets in `src/lib/config.js` (`CHANGELOG_DATA`). That modal is a **commuter surface**: never mention admin mode, Dev Hub, or internal / IP work there — only benefits commuters can see. Keep `APP_VERSION`, `CHANGELOG_DATA[0].id`, `package.json` `version`, and `public/app-version.json` aligned on each release.

## V8_08.16.6 — No ad gap, delayed offline chrome, corridor SVGs (16 Aug 2026)

- Ads overlay from the bottom and no longer reserve 108px under the home footer.
- WORKING OFFLINE / “You are offline” only after the app is visible and still offline for 4s (screen-lock no longer flashes it).
- Shared-corridor “To …” pills use the warning SVG on the home board and See Upcoming Trains.
- Admin alert posters are a walking-friendly dropdown of `/images/alerts/` files (manifest + fallback list).

## V8_08.16.5 — Live 0619 ban, region picker, weekday sim (16 Aug 2026)

- `DEFAULT_EXCLUSIONS` is empty. Kempton 0618/0619 no-service tags come only from Firebase `exclusions/`.
- Region swap no longer reopens Select Route when a pinned route was restored.
- Weekday/Sat/Sun time-sim ignores leftover `#sim-date` (often “today” on Sunday).

## V8_08.16.4 — Alerts Close label & photo order (16 Aug 2026)

- Alerts header Close is a short blue **Close** text button (same language as the in-app sheet Back), not a faint X.
- Empty state copy no longer mentions PRASA: “When Next Train posts a notice for your region or route, it will show up here.”
- Notice cards render title (if provided or a leading heading) → image(s) → body text.

## V8_08.16.3 — Reaction breakdown & install label (16 Aug 2026)

- Tapping the existing reaction chips on an alert opens a WhatsApp-style bottom sheet with a per-emoji count.
- Home and Trip Planner install buttons say **Install Next Train (1 MB)**.

## V8_08.16.2 — Alerts close, hold-to-react, quiet board (16 Aug 2026)

- Alerts header has Back plus a Close (X). Closing parks the home board the same way the sidenav map sheet does — no switchTab remount.
- Reaction emojis stay hidden until touch-and-hold (WhatsApp-style picker). Count chips still show after a reaction.
- Next Train minute tick patches countdown text instead of wiping and rebuilding the cards.
- Firebase rules file is a merge of live RTDB (`features`, `push_subscriptions`, `ride_pings`) plus `notices/*/reactions` (like/love/laugh/wow/sad/pray, increment-only) and public-read `notices_meta`.

## V8_08.16.1 — Alerts channel (16 Aug 2026)

- Bell opens a full-page Alerts channel (`#alerts`), not the old single-notice modal. No sixth bottom-nav tab.
- Feed is a WhatsApp-style column (newest at the bottom). Last 10 live posts load first; Show earlier reveals more.
- Reader scoping is a union: current route ∪ `all_{region}` ∪ `all`. Route posts no longer hide region/global.
- Critical posts pin at the top and can auto-open the channel once per notice id. Warning = amber bell; info = bell only.
- Admin composer attaches up to 2 posters from `public/images/alerts/` (`imageUrls`) and has a bullet-list toolbar control.
- New posts write to `notices/{target}/{id}` so a target can hold a channel, not one overwritten notice. Expired/resolved posts archive under `notices_archive/{target}/…`.
- Reactions (👍❤️🙏😂) store counts on the notice; “already tapped” stays in localStorage. Deploy updated Firebase rules for `notices/*/reactions` and `notices_meta`.

## V8_08.15.1 — Admin feedback & incidents (15 Aug 2026)

- Feedback Options button is pinned to the top-right of the open thread (label is now **Options**).
- After an admin reply, if the commuter left email or WhatsApp, a modal offers outreach links that open in a new tab. The thread still archives and the current Inbox/Archive tab is unchanged.
- Thread paperclip chip now covers commuter attachments and admin-inserted media.
- Transit Incident Manager uses the same rich-text toolbar as alerts; commuter incident modal keeps size/font/title tags.
- Schedule Data QA lives under System Health Diagnostics as an accordion (home tile removed).

## V8_08.14 — Alert formatting & preview (14 Aug 2026)

- User alert modal keeps admin size/font/title/underline tags (`<font size>`, Verdana, Times New Roman) instead of stripping them.
- Admin **Preview Alert** opens the exact commuter notice modal with **Edit | Post**.
- Long URLs wrap; emails and phone numbers autolink in alerts and admin replies.
- Offline analytics stay queued until GA4 actually loads, then flush on reconnect.
- Also on this live line: cache-first SW + online NUKE, and Clarity idle-boot / unpin persistence.

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

