# Changelog

Longer release notes for the repo. The in-app “What’s New” modal uses the short bullets in `src/lib/config.js` (`CHANGELOG_DATA`). That modal is a **commuter surface**: never mention admin mode, Dev Hub, or internal / IP work there — only benefits commuters can see. Keep `APP_VERSION`, `CHANGELOG_DATA[0].id`, `package.json` `version`, and `public/app-version.json` aligned on each release.

## V8_08.23.1 — Ad scroll-gap + Saturday planner notices (23 Aug 2026)

- Same-session leftover top-ad strip: remasure occupancy on `scroll` / `scrollend`, and watch only while `--nt-ad-shift` is still applied. Resume/visibility path from 21.1 is unchanged.
- Planner Saturday placeholders: hardcoded `herc-koed` and `ec-berlin` only. Live `*_sat` times automatically restore normal planning.
- Intra-line / Eastern Cape: `ERR_NO_SATURDAY_SERVICE` advisory modal + See Next Available Day.
- Dest on the Koed–Herc stub: Line Severed — cannot reach, showing trains terminating at the junction.
- Origin on the stub: boarding blocked — cannot depart, showing trains from the junction.
- East↔North that only works via the herc-koed bridge: same modal when no other Saturday path exists.

## V8_08.21.1 — Drop leftover top-ad gap on return (21 Aug 2026)

- Port of the #27 occupancy fix onto current `main` (after #28). Do not merge conflicted #27 as-is — it still pins `V8_08.19.7`.
- Measure whether a Clever unit actually occupies space (live iframe / media), not the leftover wrapper box. `visibility: hidden` does not keep `--nt-ad-shift`.
- Empty leftovers get `data-nt-ad-idle` and collapse with max-height 0 (not `display:none`, not vendor `left`/`top`/`transform`).
- Re-measure on `visibilitychange`, `pageshow`, and Capacitor `resume` so a vanished sticky unit drops the gap without a second ease.

## V8_08.20.1 — Offline shell, Back, fonts, telemetry display (20 Aug 2026)

- Planner telemetry **display** only: fetch `limitToLast=400` batches, paginate corridor cards, lazy-load hit history. Collection and `sys_logs/trip_plans` storage are unchanged.
- Alert Verdana / Times: composer writes `<font face>` plus `nt-font-*` with `font-family !important`. Commuter CSS (alerts feed, notice modal, admin replies) actually applies those faces; Inter no longer swallows them as a tiny size change.
- Admin inbox replies stay on the banner until Got it, or until 3 days after the commuter opens Read (`viewedAt`). No user-facing copy for this rule.
- PWA: drop navigation `StaleWhileRevalidate` on the empty `pages` cache (that waited on captive wifi forever). `navigateFallback` is the precached `index.html`. IndexedDB schedules still paint before the network waterfall.
- Native Back: stop swallowing `popstate` while `_isModalAnimating`. On-screen Close arms a short pop-lock so `history.back()` does not close the next overlay. Hub overlay listeners pass `fromPopState`.

## V8_08.19.6 — Stop ad ease from trapping commuter overlays (19 Aug 2026)

- Root cause of distorted Feedback / About / Privacy / Map: `#nt-shell { transform }` from the CleverAds ease created a containing block for every `position: fixed` overlay inside the shell. Overlays grew to the page height, so Close Map sat below the fold, cards stuck to the top, and inner text could not scroll against `body.modal-active`.
- Ad motion now translates `#main-content` only. `#nt-shell` keeps the shift CSS variables and never gets a transform. Overlays inside the shell are pinned to `100dvh`.
- Legal body is `flex-1 min-h-0` so Privacy/Terms scroll above Close. Map header/footer are `shrink-0`.
- Commuter What’s New adds a menus bullet. Admin-only 19.5 notes stay in this file.

## V8_08.19.5 — Admin / modal scroll unlock (19 Aug 2026)

- `body.modal-active` no longer sets `touch-action: none` (that value intersects with every descendant and blocked pan inside Dev Hub and nested admin dialogs). Overlays use `touch-action: pan-y`.
- `#nt-shell` applies `transform` only while `.nt-ad-shifted` / `html.nt-ads-entering`. Cloak and `modal-active` force `transform: none` so `position: fixed` overlays are viewport-sized again and can scroll against the locked board.
- Commuter What’s New is unchanged (still the folded 19.4 ads / overlay / links / photo / grid bullets).

## V8_08.19.4 — Ad entrance ease, composer toolbar, poster picker (19 Aug 2026)

- CleverAds entrance: hide the unit (`html.nt-ads-entering`), paint `#nt-shell` at 0, ease it down, then reveal. Exit still eases back. Double-rAF FLIP for in-flow units. Duration 420ms.
- Alert composer toolbar rows use `justify-evenly` so controls are not clustered left; Font is a compact premium menu (not a native `<select>`).
- Channel poster uses the same premium trigger + list as Severity (hidden native `<select>` kept for value).

## V8_08.19.3 — Ad motion, Dev Hub split, composer, posters (19 Aug 2026)

- CleverAds: ease `#nt-shell` when a unit fills or the commuter dismisses it (`--nt-ad-shift` for out-of-flow overlays, FLIP `--nt-ad-flip` for in-flow). No reserved gap, no vendor `left`/`top`/`transform`, cloak still `visibility` only.
- System Controls: **Publish live site**, **Cloudflare Purge**, then **Nuclear Cache Wipe** as three separate accordions (purge no longer nested in nuke).
- Service alert / reply composer: Media stays far right on row 1; Font dropdown + A-/A+ on row 2 with the hyperlink at far right.
- Alert catalog: ten new poster files wired in `manifest.json` + admin fallback. Drop the JPGs into `public/images/alerts/` if they are not on this machine yet.
- Commuter What’s New: ads bullet mentions ease in/out. Admin / catalog / purge stay out of that card.

## V8_08.19.2 — Dev Hub live publish (19 Aug 2026)

- System Controls → **Publish live site** dispatches `deploy-production.yml` via the telemetry Worker (Firebase admin Bearer). Status polls GitHub jobs; after success, use the existing **Purge Cloudflare Cache** control.
- Worker secret `GH_ACTIONS_TOKEN` is Actions read/write on `next-train-astro` only. Do not put `METRORAIL_APP_DEPLOY_TOKEN` on the Worker (that PAT can rewrite the live host).
- Commuter What’s New copy is unchanged (still the folded 19.1 bullets).

## V8_08.19.1 — Analytics restore + unified What’s New (19 Aug 2026)

- One commuter What’s New card (`V8_08.19.1`) folds Ads, overlay return, shared links, photo hold-to-react, and route timetable grids. Engineering notes for those ships stay in the 18.x / 17.x headings below.
- Custom events go through `src/lib/analytics.js`: `queueMicrotask`, offline queue, gtag, and Clarity `event` (Clarity is not skipped when region is empty). Live-board local gtag-only wrappers are gone.
- Restored lost pings: station/route/share/maps/about/guide/legal/feedback/coming-soon form, plus `open_feedback_modal` on every feedback open with a `location` param.
- PWA: `install_app_accepted` is `appinstalled` only (not prompt-yes). WebView “Open in Browser to Install” is `install_app_webview_click`.

## Admin telemetry, GSM tabs, Clear DB (18 Aug 2026)

- TODAY regional breakdown is **unique users** (GA4 `activeUsers` by last selected `crm_region`), not sessions. Modal now shows TODAY unique + TODAY sessions, per-region sessions, and a note that region cards will not add up to TODAY.
- ALL-time trend plots every month from **Jan 2026** (no 7-point MAU slice). INTRADAY plots through the latest GA4 30-min bucket instead of hiding a fixed 3 hours.
- Planner telemetry opens on **Trip Plans**. Clear DB is two pop-ups (continue, then type CLEAR).
- Global State Monitor splits Alerts / Incidents / Grid / Exclusions / Maint. System Controls → Maintenance Mode starts collapsed like the other inner accordions.

## CleverAds vendor snippet + no flex squeeze (18 Aug 2026)

- `#clever-core` is again Clever’s `SCRIPT` tag (Pedro: last thing in `<head>`). Guardian only delays the original `insertBefore` loader IIFE.
- Body is no longer a flex row. The app lives in `#nt-shell`, so a sticky/in-flow Hollywoodbets unit cannot sit as a second column and squeeze the board.
- Do not force `left`/`top`/`transform` on vendor overlays. Safe-zone hide uses `html.nt-ads-cloaked` visibility only.

## Route SEO landings + OG grid order (18 Aug 2026)

- Route / region / corridor pages first-paint light (`forceLight`) so Googlebot screenshots are not dark.
- Route titles and H1 include both directions (e.g. Johannesburg to Naledi & Naledi to Johannesburg).
- SSG weekday grids + first/last times from `public/data/full-database.json` (column order = `MANUAL_GRID_ORDER`). Saturday sheets sit in `<details>`. All rows stay in the DOM inside a 22rem scroller.
- FAQPage + terminus departure ItemList JSON-LD. Home footer / noscript and the guide link the high-impression OD landings.
- nexttrain-og `extractGridPreview` uses the same column order; cache bust `wa7`.
- `robots.txt` disallows `/index.html` so it cannot cannibalize `/`. Lab hostname sets `noindex` in the layout script.

## V8_08.18.3 — Route timetable grids (18 Aug 2026)

- SEO / corridor landings union train columns from every station row (not the first row only) and prefer the region nest sheet over a stale top-level dump.
- Ghost / coordinate-only stations (Fonteine, Kloofsig, …) are dropped; skip-stops on trains that do run stay as `-`.
- Landing tables follow the in-app grid (sticky Station column, ~70px train columns, zebra, wider `max-w-6xl` block). CTA opens `/?rt=&v=g` so Download / Share / live NO SVC stay in-app.
- nexttrain-og `extractGridPreview` uses the same nest overlay, column union, and ghost drop; cache bust `wa8`.
- Commuter What’s New: route pages show the full grid; tap through for the live sheet.

## V8_08.18.2 — Ads to the top (18 Aug 2026)

- Commuter What’s New: ads moved to the top to make way for future bottom navigation.
- Home board footer no longer dumps the compact “Route timetables · Naledi · …” SEO row. Guide + noscript still keep the real timetable cards. Route / corridor / region landings keep their related-route lists.
- Service Alerts Manager posts the same notice to multiple routes and/or regions in one go.
- Feedback quotes of a service alert or transit incident open a rebuilt preview (live, archive, or reconstructed from the quote) instead of “original message not in this thread view”.
- Posted dates use `18 Aug 2026` (with time where needed), not `18/8/2026`.
- Vibrations default off for new users (opt-in in Settings).

## V8_08.18.1 — Overlay back-stack (18 Aug 2026)

- Closing What's New now reopens the sidenav (`#sidenav`) instead of dumping the commuter on home.
- Alert Reply → Feedback Cancel restores the alerts feed (no park + restore before `history.back()`).
- Black Box PIN is once per session; Close returns to About, not the PIN sheet. PIN / terminal stay off the hash stack.

## V8_08.17.3 — Admin session must be an operator email (17 Aug 2026)

- iPhone feedback / community / alerts persist an **anonymous** Firebase user. Dev Hub treated any `currentUser` as admin, then polled telemetry every 10s with a token that has no email → Worker **403** forever, and `feedback.json` failed rules.
- Dev Hub and telemetry now require `enockelk@gmail.com` or `thandeka05nxumalo@gmail.com`. 401/403 stops the poll. CleverAds “Tracker ID not found” is their SDK, not ours.

## V8_08.17.2 — Facebook / first-open share links (17 Aug 2026)

- Installed PWA uses `launch_handler: focus-existing` but never read `launchQueue.targetURL`, so the first Facebook tap opened the app at `/` with no `?rt=` / `?plan=`. Second tap worked after the webview closed.
- Humans hitting `/og/share` now 302 to the app URL (crawlers still get OG HTML). Service worker no longer caches `/og/share`.
- Share snapshot refreshes when a new launch URL arrives; Welcome skips if a snapshot exists.
- Extractor + `grid-order.js` emit `export const MANUAL_GRID_ORDER` so the Astro build can import it.

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

