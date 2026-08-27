# Changelog

Longer release notes for the repo. The in-app “What’s New” modal uses the short bullets in `src/lib/config.js` (`CHANGELOG_DATA`). That modal is a **commuter surface**: never mention admin mode, Dev Hub, or internal / IP work there — only benefits commuters can see. Keep `APP_VERSION`, `CHANGELOG_DATA[0].id`, `package.json` `version`, and `public/app-version.json` aligned on each release.

## V8_08.27.5 — Hide Welcome bar; 24.01 pin chrome (27 Aug 2026)

- Port V8_08.23.12 pin chrome: hide the bottom bar while Welcome is open (`nt-onboarding` / `syncInAppChrome`), and point Welcome copy at Options.
- Maintenance strip: switch header title and day chip to `--nt-text` so Classic light ink stays readable on the flattened surface.
- Stamp `viewedAt` when opening the messages thread (same-day 24.01 follow-up).

## V8_08.27.4 — 24.01 chrome onto lab (27 Aug 2026)

- Port V8_08.24.01 header bell (larger icon, unread dot at the outer corner) and Lucide route Plan / menu Options icons.
- Map and Community bottom-nav items, plus hub Account and Notifications, stay hidden until allowlisted admin auth (`admin-chrome.js`). Commuter bar is three columns; five after sign-in.
- Lab Map tab still opens after admin auth (not the old PRASA map modal). Keep Classic blue chrome and weekday middot.

## V8_08.27.3 — Main onto lab, Classic blue chrome, Crossmoor (27 Aug 2026)

- Port production planner train sheet, Saturday notices, Recent Trips, telemetry indexes, and Crossmoor from `main` onto lab.
- Classic light: blue header + nav with white title. Classic dark: navy chrome with blue title.
- Earthy/Ember: more canvas vs card vs nav separation; lower saturation.
- OG share columns follow in-app grid order; truncated sheets say so. Admin insights stay all-time.
- Optional `PUBLIC_CARTO_API_KEY` on Voyager raster tiles (CARTO now watermarks unkeyed requests).

## V8_08.26.2 — KZN Crossmoor corridor (26 Aug 2026)

- Register `kzn-crossmoor` (Durban ↔ Crossmoor) as an active KZN Inland route with map yellow (`text-yellow-500`).
- Sheet keys match the KZN Apps Script sanitize: `durbn_to_cross_{weekday,sat}` / `cross_to_durbn_{weekday,sat}`.
- Merge Crossmoor sheets + `_meta` / `_zone` from the RTDB export into `public/data/full-database.json` (nested `kzn` and top-level).
- Map path: Durban trunk → Rossburgh → Clairwood → Montclair → Merebank → Havenside → Bayview → Westcliff → Chatsglen → Crossmoor.
- destA is `DURBAN STATION` (sheets end at DURBAN, not DURBAN YARD). Saturday columns 9612/9620/9672/9680 outbound and 9613/9621/9673/9681 inbound; weekday sheets in this dump are station rows only.

## V8_08.26.1 — Production boot/safety onto lab (26 Aug 2026)

- Admin session is an operator email only (`isAdminEmail` / Thandeka + Enock). Anonymous iPhone Firebase is ignored so telemetry does not 403-loop.
- IndexedDB cache paints before the IP region guess; region check only gates the network waterfall.
- PWA `navigateFallback` serves the precached `index.html` (no navigation StaleWhileRevalidate on an empty `pages` cache). Lab FCM SW bridge is kept.
- Incoming service-worker toast + 30s skipWaiting fallback (never hard-reload a half-downloaded build).
- Facebook / PWA `launchQueue` ingest + OG `/og/share` 302 for humans.
- Native Back pop-lock: one overlay per Back; on-screen Close does not race the next sheet.
- CleverAds: vendor snippet on `document.body` (sticky-top), occupancy + leftover-gap reclaim, ease `#main-content` (never transform `#nt-shell`). Lab bottom nav stays inside the shell.
- Saturday planner placeholders (`herc-koed`, `ec-berlin`), header No Service chip, planner train sheet, Recent Trips union, cancelled 7628 dropped from grid order, fresher schedule dump.

## V8_08.18.1 — Merge main into lab (18 Aug 2026)

- Lab now includes this week’s live-site work from `main`: Alerts channel (hold-to-react, photo posters, Close, reaction breakdown), quiet board paint, schedule dump / grid-extractor, Digital Asset Links, CWV / guide fares, and agent instructions.
- Lab-only work is kept: Map tab, Community chat, live tracker / ride pings, colour packs, brand-left header, Messages thread, and the pinned bottom nav.
- Bell chrome stays inline on the lab header (not the production hamburger layout).

## V8_08.17.1 — Hold-to-react on photo notices (17 Aug 2026)

- Holding a catalog / GitHub poster on an Alerts card opens the reaction picker (tap still zooms). Photo buttons were previously treated as non-reactable, so image-only posts could not be reacted to.

## V8_08.16.5 — Unified What’s New; grid station column; save toast (16 Aug 2026)

- In-app What’s New is one short **V8_08.16.5** card (alerts, Kempton Park, region). Older 16.x / 15.1 commuter cards were folded in.
- Timetable station column is slightly darker in the app grid and in downloaded images.
- “Saved to gallery” toast uses a check SVG and smaller text so it fits the screen.

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

## V8_08.24 — Bans, region pick, weekday sim (16 Aug 2026)

- Live timetable bans come only from Firebase `exclusions`. The hardcoded Kempton Park 0618/0619 “Tue–Thu only” fallback is gone, so an expired admin limit no longer keeps painting NO SVC. Global State Monitor lists the same tree (plus any remaining app-default fallbacks).
- After a region change, Select Route opens only when no route is active. Picking a route no longer reopens the modal.
- Admin Time Simulation “Weekday (Mon)” no longer inherits today’s leftover date from the hidden Specific Date field, so Sunday no longer overrides the weekday timetable.

## V8_08.23 — Parked trains, nearby labels, stable chat (14 Aug 2026)

- I’m on it asks whether the train is moving. Parked: share location, poll GPS every 15s until heading-consistent movement, then attach. Closing the app aborts GPS; on resume a modal offers Continue or Close.
- Map tab Locate button removed (Trains near you + Share my location stay).
- Device id and local inbox survive updates / cache flush so commuter ↔ admin Messages stay linked.
- Trains near you: “Train 9106 → Pretoria”, plus Real-time: — or last seen Mears - 16:32 with early / on time / late.
- Options drawer no longer repeats the Account section heading above the Account row.

## V8_08.22 — Live tracker, check toasts, named admin chat (14 Aug 2026)

- Admin replies in Messages use `fromName` (Enock / Thandeka / Admin). The grey “- Name” HTML signoff is gone; commuter bubbles read the name field.
- Nearby / I’m-on-it distance gate is 2 km. Corridors without station coordinates show that live sharing is off.
- I’m on it starts GPS immediately and uses dismissable check toasts (location, distance, speed, heading). Attach only when within 2 km, moving, and heading agrees with the ghost.
- The public “N commuters last seen” chip is gone. Verified live sharing is a pulsing location button on **Next train to …**. Tap it for a station-list tracker. Multiple verified pings: rank (heading, proximity, speed, freshness) — one clock driver, count on the badge.

## V8_08.21 — Locate, reports button, original cards, Messages chat (13 Aug 2026)

- Next Train locate button is back beside the station field.
- Commuter reports is a tappable button that opens that train’s status sheet.
- Description boxes use the original Direct / Shuttle / Connect train labels again. Flags stay on the name.
- Messages & Feedback shows the full commuter ↔ admin thread in the Community chat layout.

## V8_08.20 — Pinned bottom bar, light Classic default (13 Aug 2026)

- The bottom navigation is locked to the bottom of the viewport. Header and main content scroll together above it.
- Short tabs (Planner inputs, Map) fill the space above the bar on tall phones so the bar never rides up with the card.
- Default appearance is **light mode + Classic**. The OS colour scheme is no longer used when the user has not chosen a theme. An explicit dark / pack choice is kept.

## V8_08.19 — Quieter Next Train board (13 Aug 2026)

- Next Train no longer shows locate, share location, Report status, or I’m on this train. Those live on Map (share / locate) or the train-name **flag** (status + I’m on it / waiting).
- Train labels include destination and timetable position. Reports are sightings (last seen + status). On-train share refreshes location every 45s.
- Status colours: early = yellow, on time = green, late = red, cancelled stays grey. Earthy backgrounds are brighter. Ride pings always re-fetch so other devices can see a share.

## V8_08.18 — Earthy retuned to editorial cream + sage (13 Aug 2026)

- Earthy matches the Understanding Burnout palette: eggshell `#F5F1E9`, muted sage `#6B705C`, dusty terracotta `#A58E74`, charcoal `#353535`.
- Surfaces and the browser theme colour are light cream (not tan paper / dark olive chrome). Type is soft charcoal, not near-black. Dark mode is warm grey, not cave-black.

## V8_08.17 — Options on the right, Classic look, honest sharing (13 Aug 2026)

- Hamburger is gone. **Options** is the rightmost bottom-nav item (Next Train logo), to the right of Community. The hub slides in from the **right**.
- The bottom bar stays visible except in immersive full-screen views (sidenav Network Map).
- Sharing while **far** from that train’s path, or **waiting** at the station, shows a commuter online — not linked to the train and not on the Next Train dashboard clocks.
- On-train **and moving** (within 400 m of the ghost) attaches the ping and can update estimates.
- Default colour pack is **Classic** again (one-time revert of the lab Ember seed).

## V8_08.16 — Safer messages (13 Aug 2026)

- User text (community, feedback, messages, delay notes) is checked **before send**. Non-`nexttrain.co.za` URLs and profanity (English + common ZA slang) are refused with a prompt.
- Unsure / ambiguous wording is **held** in the admin Moderation tab and is not shown publicly until Approve. Reject leaves it unpublished.
- Rate limits explain **why** you are waiting and show a live countdown until the next send.

## V8_08.15 — Trains near you, trip share, late vs skipped (13 Aug 2026)

- **Trains near you** opens as a modal (Next Train + Map) with distance and whether you can attach as a tracker.
- Choosing a train more than **400 m** from its path still shares you as a person. Copy explains others can see you, not as a train tracker.
- Planner: departure within **15 minutes** and near the from-station → share this trip (quick sign-in if needed). Far from the station → presence only.
- After attaching to a train, if you’re still at the departure station when it should have left, we ask **late / didn’t board / I’m on it**. Late becomes a dashboard report; didn’t board stops tracking. If your position matches the train ghost, we keep using it.

## V8_08.14 — Show where I am (13 Aug 2026)

- Next Train **Show where I am** is a 10-minute presence share (one GPS fix). You do not have to be on a train. **I’m on this train** still vets and attaches to a timetable column.
- Board chip lists people at stations separately from live trains. Map **Share my location** uses the same sheet. **Stop sharing** ends the ping.
- Notifications: Settings toggle plus optional ask after pin / delay confirm. Official notices and verified delays only — not presence pings.

## V8_08.13 — Live deltas, map pulse, rider marks (13 Aug 2026)

- Timetable columns are the simulated fleet: ride pings compute a delay delta and shift only stations the ghost has not reached yet.
- Next Train cards get a blue live pulse (and a corridor “Train XXXX is live” button) that opens the map Join popup.
- “I’m on this train” / Share my ride: 30s vet, closest-train confirm if we disagree, then a 10-minute public ping.
- After Locate, if you are within 50 m of the rails and a ghost is nearby, we ask if you are on that train.
- Private Bronze → Platinum marks (share / confirm / 3-day streak). No public leaderboard.

## V8_08.12 — Premium packs, live reports, map trains (13 Aug 2026)

- Earthy and Ember (and other non-classic packs) colour cards, inputs, and chrome — leftover `bg-white` stickers are gone. Service alerts stay red / amber / blue.
- Train titles show a flag; tap to report early / on time / late / cancelled-no-show and update your own report.
- Overdue-station and on-train riders can confirm a live report; people behind the train are not asked.
- Messages & Feedback opens the commuter’s inbox thread with a composer.
- Map contribute vets GPS for 30s (track, station, speed, heading), then draws joinable blue train glyphs with a sharing count.

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

