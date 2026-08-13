# Changelog

Longer release notes for the repo. The in-app “What’s New” modal uses the short bullets in `src/lib/config.js` (`CHANGELOG_DATA`). Keep `APP_VERSION`, `CHANGELOG_DATA[0].id`, `package.json` `version`, and `public/app-version.json` aligned on each release.

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

