# Changelog

Longer release notes for the repo. The in-app “What’s New” modal uses the short bullets in `src/lib/config.js` (`CHANGELOG_DATA`). That modal is a **commuter surface**: never mention admin mode, Dev Hub, or internal / IP work there — only benefits commuters can see. Keep `APP_VERSION`, `CHANGELOG_DATA[0].id`, `package.json` `version`, and `public/app-version.json` aligned on each release.

## V9_08.28.4 — Floating pill nav; timetable CTA grid (28 Aug 2026)

- Bottom nav: `position: absolute` over `#app-scroll` so the oval sits on `--nt-canvas` with no shell tray. Views pad `4.75rem` (compact on short screens). Offline dock sits above the pill.
- Timetable CTA: `grid-cols-[3rem_1fr_3rem]` — calendar left, centred label + effective date, chevron right.

## V9_08.28.3 — PWA/TWA bottom nav inset; cache-first board; lock-screen recovery (28 Aug 2026)

- Bottom nav: `#nt-shell` uses `--nt-app-h` (visual viewport) and `--nt-sys-bottom` (env inset, clip, or 48px Android standalone fallback when Chrome reports 0). Pill margin no longer double-counts `env(safe-area-inset-bottom)`. SEO → installed PWA / TWA (`android-app://`) keeps the standalone flag in sessionStorage.
- Short screens (`max-height: 740px` / `620px`): compact pill item height, icon, and label.
- Every colour pack: selected tab uses `--nt-chrome-fg` plus a `color-mix` wash (not transparent `--nt-primary` on a near-black bar).
- Planner instructions: “Germiston or Bellville” (other Koedoespoort copy unchanged).
- Boot: IndexedDB paints and `_appStabilized` immediately; same-origin `data/full-database.json` dump if IDB is empty; SW runtime cache `schedule-dump`. Force-update no longer unregisters the worker or deletes Cache Storage. No idle skipWaiting hard-reload after pocket lock.
- Recovery: auto-lifeboat counts visible time only, and only while `#loading-overlay` still covers the board. Planner / lock-screen is not “stuck”.

## V9_08.28.2 — Options scrim lock; SEO Park Station, app header, timetable hoist (28 Aug 2026)

- Options: `body.sidenav-open #app-scroll` overflow hidden; `#sidenav-overlay` `touch-action: none` so iOS does not scroll the board through the scrim. Drawer list still scrolls.
- SEO landings: `SeoPageHeader` matches in-app chrome (Next Train + day). Compact `Open Next Train · {region}` on the right. Theme toggle removed. `forceLight` unchanged.
- SEO display: `stationLabel('JOHANNESBURG')` → Johannesburg Park Station. `slugifyStation` still emits `johannesburg`. Gauteng region blurb updated. Live-board `ROUTES.destA` unchanged.
- Route landings only: weekday `<table>` grids sit above “When trains run” so crawlers see train numbers and times early.
- `robots.txt` Disallow `/index.html` (homepage duplicate).

## V9_08.28.1 — Generation 9; lab chrome on main; fold post-18.1 What’s New (28 Aug 2026)

- Major bump: production tree is the lab shell (left title, floating pill nav, no top tabs).
- What’s New: one V9 card for everything after `V8_08.18.1` (28.5–26.1). Keep `V8_08.18.1` as the previous card.
- Quiet board paint stays on the minute tick (`__ntQuietBoardPaint` + `tryPatchLiveBoardCountdown`) so Next Train clocks patch countdown text instead of remounting.

## V8_08.28.5 — Lab chrome on main; yellow maintenance bar above header (28 Aug 2026)

- Production tree is the lab app (left title, floating pill nav, no top tabs) plus V8_08.28.4.
- Maintenance strip: peach/yellow gradient with wrench SVG; insert as previous sibling of `#app-header` inside `#app-scroll` so it scrolls away with the name.
- Do not overlay `nt-maint-active` on the title. Do not use hazard-stripe `repeating-linear-gradient`.

## V8_08.28.4 — Feedback contact, Select Route Close, Mutual–Maitland, Map tab pane (28 Aug 2026)

- Feedback Hub: `paintThreadContactRow()` always shows `#messages-thread-contact-row` and the privacy lock. Signed-in email still prefills; the row is no longer `hidden`.
- Select Route: `#route-modal-close-btn` is hidden when `$currentRouteId` is null. `closeSmoothModal('route-modal')` re-pushes `#route` so Back cannot land on the empty “Select a route” board.
- Leaflet: WC static paths put **MAITLAND** next to **MUTUAL** on Central / Cape Flats / Bellville–Mutual. Dynamic extracts splice the pair; a fallback `wc-maitland-mutual` edge is drawn if still missing.
- Map tab: iframe no longer treats parent `__ntCloseInAppSheet` as the sidenav sheet (that opened `#nt-inapp-sheet` full-screen). Tab stays in the app chrome. Full screen control sits under the theme toggle (`html.nt-map-tab #map-fullscreen-btn`) and calls `__ntOpenNetworkMapSheet`.

## V8_08.28.3 — Upcoming title, map iframe, region pin, recents caps, compressed What’s New (28 Aug 2026)

- Upcoming trains modal: route line (`Devenish Street → Pienaarspoort`) is nowrap and shrink-to-fit; day suffix (`Tomorrow`) is a second row.
- Map tab iframe loads `/map.html?embed=1` (not extensionless `/map`). Workbox `navigateFallback` denylists `/map` so the SPA shell cannot nest a second header + bottom bar. Layout bounces a nested SPA iframe to `map.html`.
- First route pick in a region with no `defaultRoute_${region}` pins that corridor. Region swap still restores a pin without reopening Select Route.
- Planner recents: unique from→to pair, saved as soon as a plan is viewed, newest first. Labels stay board caps (`JOHANNESBURG`); `Johannesburg Park` / Bosman remain resolve aliases only.
- What’s New folds 28.2–26.1 into one commuter card.

## V8_08.28.2 — Alerts dates, planner recents/aliases, swipe, sidenav, feedback (28 Aug 2026)

- Alerts: time-only stamps (`7:19 AM`) with Today / Yesterday / date chips; region/scope label is admin-only. Admins can long-press Delete for everyone (archives via `Admin.archiveActiveNotice`). Hold-to-react on catalog posters is unchanged.
- Planner: `STATION_ALIASES` (Johannesburg Park → JOHANNESBURG, Bosman → PRETORIA). Recents save canonical names as soon as a plan starts; do not wipe `plannerHistory_*` to empty on a filter miss.
- Swipe: Home → Trip Planner → Options (`openAppHub`). Skip swipe from inputs. Theme accordion always starts collapsed; subtitle follows pack + Light/Dark. Drop Earthy blurb and per-row sidenav hairlines.
- Timetable calendar SVG spans both CTA lines. Feedback Hub privacy is lock-only; send aligns with the composer; textarea grows to ~10 rows (viewport-capped). Empty-board headlines drop the duplicated time (`No service today · first tomorrow:`).
- Production-only one-shot `ntProdClassicPackV1`: non-classic packs remap to Classic. Keep `theme` and `next_train_device_id`. Lab packs are unchanged.

## V8_08.28.1 — Travel Day scroll, offline strip actions, floating pill nav (28 Aug 2026)

- Travel Day: keep `#app-scroll` `overflow-y: auto` while `dropdown-escape` is on; planner inline scrim is `pointer-events-none` so the page can scroll; header-day-list gets a max-height.
- Offline dock: 4s visible hold, then auto-hide at 7s. Compact row with Refresh (`location.reload`) and Close (X). Dismissed strip stays down until the next online → offline cycle. Copy: “Refresh when signal returns.”
- Bottom nav: inset solid pill (`border-radius: 999px`, no `backdrop-filter`). Active tab wash is a rounded rect. Still 3 commuter tabs (Map/Community admin-gated). Timetable CTA has a chevron; effective date stays on the button.

## V8_08.27.9 — Feedback Hub composer, offline dock, timetable date (27 Aug 2026)

- Options → Feedback Hub: WhatsApp-style composer (pill + paperclip inside, circular send). Contact row has Privacy Policy; same `openLegal('privacy')` as the long form.
- Offline dock (`#offline-wrapper`) sits above `#bottom-nav`, outside `#app-scroll`. Visible tab + 4s hold; stays until online. Copy: “You are offline.” Do not overwrite innerHTML with WORKING OFFLINE. Boot already-offline calls `scheduleOfflineChrome()`.
- Maintenance tape is a sibling before `#app-scroll` so it does not cover the Next Train title.
- Effective from date lives inside `#view-full-timetable-btn`. Hide `#ride-presence-row` unless nearby (admin) or sharing chip is shown. Tighter home gaps.

## V8_08.27.8 — Empty-board one-liner, modal nav clearance, map chrome (27 Aug 2026)

- Merge “No more trains today” / “First train tomorrow is at:” into one line (`No more trains today · first tomorrow 04:49`). Same phrasing on no-service and no-weekend empty states.
- “Trains near you” only after allowlisted admin auth (`isAdminAuthed` + CSS). Not in What’s New.
- Messages thread: paperclip (same Storage upload as the form) and optional email/WhatsApp contact. Keep the long form for About → In-app message.
- Map: Back / GP / theme / Network Lines share 2.25rem height and pack tokens (`--nt-surface`, `--nt-text`). Network Lines is a `map-chrome-btn`.
- About: drop sticky-bar blur + logo glow; Unofficial & Independent pill uses surface + strong text.
- Non-fullscreen modals: raise `#schedule-modal` / `#notice-modal` / `#redirect-modal` above `#bottom-nav` (z-110) and pad cards `4.5rem + safe-area` so lists are not under the bar.

## V8_08.27.7 — Timetable row, Share in Options, ship to lab (27 Aug 2026)

- Match production **View full timetable**: calendar SVG + label on one row; effective date sits under the route pill, not inside the button.
- Share App moves to Options (next to Messages & Feedback). Drop the duplicate Share / Feedback pair from the home and planner footers. Install stays a footer CTA when the browser is installable — not a Daily Maverick-style top chip (that fights CleverAds sticky-top and iOS has no `beforeinstallprompt`).
- Land lab PRs: polish (URL-only timetable/planner share, Alerts card chrome, tap NO SVC, tappable map warnings) plus this themes branch (dark surfaces, admin-only train flags, 24.01 chrome, Crossmoor).

## V8_08.27.6 — Timetable SVG, admin-only train flags, dark surfaces (27 Aug 2026)

- Restore the calendar SVG on **View full timetable** (`currentColor` / `--nt-primary-fg`). Keep the effective-date line under the title.
- Train title flags / report button only after allowlisted admin auth (`isAdminAuthed`). CSS hides `.nt-train-flag` unless `html[data-admin-authed="1"]`.
- Dark packs: canvas is near-black; cards use a lighter `--nt-surface`. Remap `dark:bg-gray-900` → canvas and `dark:bg-gray-800` → surface so they no longer collapse to the same colour.
- Alerts sheet (`#alerts-channel`) uses canvas; `.nt-alert-card` uses surface + shadow so posts separate from the sheet.

## V8_08.27.5 — Hide Welcome bar; 24.01 pin chrome (27 Aug 2026)

- Port V8_08.23.12 pin chrome: hide the bottom bar while Welcome is open (`nt-onboarding` / `syncInAppChrome`), and point Welcome copy at Options.
- Maintenance strip: switch header title and day chip to `--nt-text` so Classic light ink stays readable on the flattened surface.
- Stamp `viewedAt` when opening the messages thread (same-day 24.01 follow-up).
- Wire `PUBLIC_CARTO_API_KEY` through lab/preview/production builds (never commit the key). Set it on GitHub Actions **and** Cloudflare Pages Production + Preview, then rebuild so Voyager tiles drop the watermark.

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

## V8_08.27.1 — Commuter UI polish (27 Aug 2026)

- Planner header Share and grid Share send `{ url }` only; clipboard copies the URL. Share App marketing copy is unchanged.
- Alerts channel is slightly darker so white cards read as surfaces. Card header is signature (left) + Info/Warning/Critical chip (right); posted time sits above Reply. Trailing `- SIGNATURE` spans are stripped from the body.
- `mergeUnionNotices` collapses the same notice `id` across `all` / `all_GP` / route buckets (keeps the more specific source). Optional scope label on the card. Union keys stay route ∪ region ∪ `all` — Kempton does not inherit Irene.
- In-app grid `NO SVC` is a button that opens the advisory sheet with RTDB `reason` (fallback “No service on this day”) and expiry. PNG export stays a static span. `DEFAULT_EXCLUSIONS` remains `{}`.
- Standalone map paints disruption chords as soon as station coords exist, then refines onto OSM tracks. Warning badges and dashed segments open a popup. Planner trip-map warnings call `openDisruptionModal`.
- Planner Departs-in uses `text-xs font-bold` to match Total Time; countdown wording uses `formatDuration` when the wait is an hour or more.

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

