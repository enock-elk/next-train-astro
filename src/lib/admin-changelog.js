/**
 * Operator-only build notes. Not shown in commuter What’s New.
 * Keyed by APP_VERSION (V9_MM.DD.n). Older chips fall back to CHANGELOG_DATA.
 */
import { CHANGELOG_DATA } from './config.js';

export const ADMIN_CHANGELOG = {
    'V9_09.19.10': [
        'Replaced public/data/full-database.json with the operator export as-is (lastUpdated 19 Sep 2026 17:54). SEO SSG and the GitHub waterfall read that dump. WC zone fields updated (Cape Town-Wellington and Strand Z3, Malmesbury Z3, most Cape Town metros Z2). Public-holiday nest is whatever the export contained. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.19.9': [
        'Planner trip fare distance uses baked destA to destB km and drops --- fork rows from shared WC sheets (Cape Town-Wellington ~72 km, not 156 km via Strand/Stellenbosch). Same static-map hop graph as the zone audit. loadRegionBundle is exported from rail-tracks.js for that lookup. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.19.8': [
        'Zone km follows static PRASA network maps (network-map_wc.png forks: Century City vs Mutual, Strand vs Stellenbosch vs Northern Line) via baked stationNames and STATIC_ROUTE_PATHS, then painted-rail destA to destB. Cape Town-Wellington is ~72 km, not the 144 km sheet union. Live trains always sit on the painted corridor. Leaflet train tooltip and wake chevrons are gone; tap a train for the tracking card, tap the map to close it, share pill is green while sharing. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.19.7': [
        'Live share OG: ?live= + rt= is a live card not a timetable. Canonical URL is /og/l/{train}/{route}/{dest} so WhatsApp does not wrap the query and scrape the grid. Worker HTML is no-store. Humans 302 to /?live= and open Map. Train glyph snaps to the painted rail, yaw follows local tangent with the tip toward travel, interpolation still station-slows. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.19.6': [
        'Planner trip fare is always on. canShowTripPrice returns true. isFeatureEnabled(tripPrice) ignores leftover RTDB config/features and device grants. Trip price is removed from GRANTABLE_FEATURES and the System Controls experimental accordion. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.19.5': [
        'Live trains glide along the painted rail between commuter GPS fixes (source of truth). They slow in the last ~160m of an active station and dwell briefly when the ping is at the platform, then leave with the next GPS. Installed PWA/TWA eagerly locates on startup even when Permissions API says prompt/unknown (denied still blocks). Failed silent locates retry instead of sitting on the 120s debounce. Welcome close kicks auto-locate. Next Train Found: toast uses force so Locating’s 1.2s gap cannot swallow it. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.19.4': [
        'Service Alerts drill titles: Notifications (not push-notifications-panel), In-app alerts, Service Alerts. Header id is push-notifications-header-btn so tile chrome hides. applyAlertHubView runs before the quiet Back return so hub tiles cannot sit above compose. Inbox Options stays top-right; long emails/phones wrap in the left column (break-all, no 220px cap). No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.19.3': [
        'Alert lightbox: Close lives in a bottom bar so an empty img cannot center it. Full view copies the decoded poster currentSrc/blob instead of refetching. Pinch/pan is CSS transform on the image stage with touch-action none and gesture preventDefault so the Close chrome does not page-zoom. tripPrice defaults enabled + * for lab, prod, and seed; enabled with an empty routeIds list still means all corridors. Matching fare vote thanks only; ticket photo stays on the disagree path. Planner telemetry Fares tab no longer inherits Trip Plans infinite-scroll (load-more and paint are trips-tab only). No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.19.2': [
        'SEO insights: Randfontein / Lenz / Naledi Langlaagte manual-authorisation and Croesus turnback; De Wildt connection tips plus off-peak test-train caveat (no pasted clock list). SeoFareTable states weekday 09:30 to 14:30 40% adult and 50% pensioner, military veteran, scholar. Window stays 09:30 to 14:30 (not the 09:00 to 14:00 WhatsApp shorthand). No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.19.1': [
        'SEO: keep View and download SERP copy. Regenerated sitemap lastmod. Pretoria–JHB corridor page (gauteng-pretoria-jhb-line) adds three-train Pretoria to Johannesburg copy plus a trip-planner link without removing the existing blurb or route list. Route landings add SEO_INSIGHTS after station serves (KZN maintenance/speed, Randfontein shuttle, Pienaarspoort mix, Saulsville frequency, Midway/Lenz rehab, Kempton sinkhole and 0618/0619 Blue Train/Rovos, Irene as a subset). Constants dl shows calculated along-published-stops km. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.15': [
        'SERP copy leads with View and download PRASA Metrorail train timetables, plus free/works offline. Route/region/corridor metas match that download intent. No live train tracking in public meta. Titles stay destA-first 2026 Train Times. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.14': [
        'Startup auto-locate on installed PWA / Play TWA: treat missing Permissions API as already granted, remember nt_geo_granted after GPS, one-shot overwrite of a restored last station, pageshow kick, fused GPS (enableHighAccuracy false). The green Found: {station} ({km}km) toast now also fires on silent auto-locate (Locating / errors stay tap-only). App stuck? Get help stays hidden until 15s of visible Starting Next Train. help.html is a light Next Train shell and no longer paints device id / version / URL. Styles stay inline in the document (no hashed /_astro/ CSS). With CSS off, headings, lists, real buttons, Facebook, mailto, and the honeypot hidden= attribute still work. Play Store users are twa_open (app_source: twa, za.co.nexttrain.app). No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.13': [
        'Every SEO route landing now shows a weekday 10:00 Next Train tab screenshot for that corridor (captured from the live board, Devenish Street kept for pta-pien). Regenerator: node scripts/capture-seo-app-previews.mjs. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.12': [
        'Live train share URL (?live=) with Worker OG /og/live.png. Headboard uses timetable last stop (0823 → Mabopane), never corridor destB. Tracking pill drag is finger-aligned to the map pane; locate recentres the sharer on the train; card opens from the pill. Pause-aware header/card/popup (Restart vs Stop). Sharer GPS keeps running off Map and auto-resumes when the path is good; user Pause does not. Listeners drop the ride_pings RTDB watch off Map. Tracking card share top-right. Planner View Trip Plan on Map is slightly blue. No What’s New (live location stays operator-hidden). forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.11': [
        'Dev Hub Notifications: audience Everyone / region / pinned route / notify-list route / user id, plus Type (incidents, delays, community, nearby, feedback). Worker matches pinnedRouteIds, accountUid/uid, and categories (legacy tokens still get incidents+delays). FCM icon/badge are notification-icon.png and a dense white notification-badge.png; tag is nt-push-{category}. Account notification types are live (incidents/delays on by default). Rider points slower (share 2, join 1, delay 2, validate 1, first post 5, streaks 5/8; Silver 80, Gold 250, Platinum 600). History dedupes by key. Contributions group by day. Badge fill uses shareStreak. Community chip shows marksLabel when signed-in and showMarksInCommunity (default on). No contribution toasts. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.10': [
        'Dev Hub Service Alerts is a hub: two home-style tiles for In-app alerts (existing channel composer) and Notifications (existing FCM sender). The Notifications home-grid tile is gone (data-admin-subview). Review / GSM still skip the hub and open Compose. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.9': [
        'Auto-locate reuses weekday COORDINATES when a later-day sheet (WC public holiday *_pub) omitted them. Station index fills missing lat/lon from weekday_to_a/b; findNearestStation and planner From locate skip invalid coords and fall back to weekday rows. Stations do not move. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.8': [
        'Live board and Trip Planner From silently pick the nearest station only when OS geolocation is already granted, Welcome is done, Next Train or Trip Planner is visible, and a route is pinned. Auto-locate never opens a permission prompt, never overwrites a From field the commuter is picking or has already set, and re-checks that gate after GPS returns. Signed-in users/{uid} PATCHes lastSeenAt, region, lastRouteId, appVersion (throttled). No GPS on the account. Privacy copy drops the promised cookie banner and stops calling device-id diagnostics anonymous. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.6': [
        'Admin Feedback inbox ticks: 1 grey sent, 2 grey when the commuter app fetched the inbox (delivered), 2 blue when they opened Messages (read). Auth-backed PATCH on inbox/{deviceId}/{msgId}. No R chip. Opening a thread no longer writes acknowledged. Commuter Messages stays tick-free. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.5': [
        'SEO route landings: destA-first titles `{A} to {B} 2026 Train Times`. Meta is Updated + in-app route name + Metrorail (PRASA) train schedule + current train ids + max adult single + Next Train next-train/timetable/ticket prices/trip planner. Grid H2 is From {far end} towards {terminus}. Homepage/routes/region/corridor metas pick up PRASA, train times, schedule, updated/current, ticket prices. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.4': [
        'CleverAds top units dock into #nt-ad-scroll-host as one wrapper (pushdown iframe + vendor Close.png). They sit in the Next Train frame and scroll with the board. The vendor X stays tappable; pointer-events are not disabled. Scroll-away is not dismiss. Loaded iframes are never reparented. Already-painted units, including body-level in-flow pushdowns, follow #app-scroll via CSS translate plus a host spacer. #main-content is not translateY-pinned. Occupancy still needs a loaded creative; empty leftovers collapse. What’s New is the ad scroll bullet. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.3': [
        'Toasts are rate-limited: same copy waits, at most four in 30s, 1.2s gap. Red Network is slow / saved-times at most once per 10 minutes. Connection is very slow at most once per 2 minutes. Forced-update retries no longer re-announce every minute. FCM prune 401 does not fail a delivered send. Fallback Worker URL stays. Live V9_09.17.12 update path unchanged: quiet SW, retain --keep 8 --keep-css 30, inline lifeline hide, FORCE_UPDATE still gated by reachability. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.2': [
        'Dev Hub Notifications shows the first FCM error when send fails (Sent 0 of N with tokens kept). Typical cause is the telemetry service account missing Firebase Cloud Messaging API Admin. Fallback Worker URL stays. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.18.1': [
        'Lab FCM Count devices: Dev Hub uses PUBLIC_COMMUNITY_WORKER_URL when the Pages build inlines it, and falls back to https://nexttrain-community.enock.workers.dev when Cloudflare Git omits the var. Fallback stays. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.16': [
        'FCM notification delivery: push_subscriptions records authenticated owner uid, region, route ids, environment, enabled state, and refresh time. Turning Notifications off marks the registration disabled. nexttrain-community adds an allowlisted-admin-only HTTP v1 sender with all / region / route targeting, production / lab separation, TTL and urgency, invalid-token cleanup, and Next Train-only click links. Dev Hub adds a Notifications panel with audience count and confirmed send. Production, GitHub preview, and lab workflows inject PUBLIC_FIREBASE_VAPID_KEY. Firebase rules bind each subscription to auth.uid and its device key. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.15': [
        'Applied operator gold-track patches into public/tracks: GP pta-dewildt (refined export 571 verts, PRETORIA > … > WINTERSNEST > ROSSLYN > GA-RANKUWA > TAILLARDSHOOP > DE WILDT), herc-koed (214→218; HERCULES > CAPITAL PARK > GEZINA > DEERNESS > VILLIERIA > PIERNEEFSRUS > QUEENSWOOD > KOEDOESPOORT), germ-kwesine (340 verts; GERMISTON > … > KWESINE), pta-saul (402 verts; PRETORIA > PRETORIA WES > MITCHELLSTRAAT > KALAFONG > ATTERIDGEVILLE > SAULSVILLE, Schuttestraat dropped to match the export), jhb-soweto (full Park Station to Naledi gold, 558 verts; JOHANNESBURG > BRAAMFONTEIN > MAYFAIR > GROSVENOR > LANGLAAGTE > … > NALEDI). KZN kzn-bridgecity (1095→980 verts; BEREA ROAD > … > BRIDGE CITY). Exports take priority over STATIC. fill-chords / smooth / audit stay held. No What’s New. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.14': [
        'Live-board Ticket Prices (#fare-confirm-note): Z1 keeps “Prices are subject to change. Confirm at station.” Z2+ / unknown: “Shorter Trips may cost less. Confirm at station.” Planner experimental note unchanged. Account signed-in order: Points, Community identity (display name, photo default off, Passenger Type), flat Theme rows (nt-prefs-flat hides accordion on Account only), disabled Notifications accordion. Badge cells are buttons opening #account-badge-how-sheet; streak_5day requires streak_3day. Vibrations renamed Haptic feedback with two offset phone outlines. Delete requires typing DELETE. Display names run checkContentSafety({ allowLinks: false }) plus URL block; toast “Choose a different name.” Signed-in users/{uid}/prefs hydrates remote-wins then write-through (theme, colourPack, hapticsEnabled, passengerType, showPhotoInAlerts, updatedAt). getThreadDeviceId prefers $account.chatDeviceId = oldest linked device; local next_train_device_id is still minted and recorded. What’s New is the ticket note only. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.13': [
        'Planner Trip fare on a single route (direct or same-route shuttle) is min(km zone, confirmed corridor long zone). Gauteng dump {sheet}_zone is confirmed until config/route_fares/{routeId}.confirmed is false. Other regions stay km-estimated until an operator confirms. OD Approve (config/planner_fares) still wins. Optional ticket photo after Yes/Send is a create-once sidecar at sys_logs/fare_ticket_photos/{voteId}; the vote does not wait. Fares tab has Confirmed corridor fares + ticket thumbs. Deploy firebase-database.rules.json. Storage must allow fare_tickets/ like feedback_attachments/. No What’s New (trip price is still a pilot). forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.12': [
        'Saturday placeholder classification: junction↔junction (Hercules ↔ Koedoespoort) no longer short-circuits as NO_SERVICE, so Dijkstra can use other-route walkarounds (via Pretoria). Stubs like Gezina stay NO_SERVICE / DEST_CUT / ORIGIN_CUT. Same rule for every SATURDAY_PLACEHOLDER_ROUTES id. Planner error Open Network Map calls __ntOpenNetworkMapSheet (sidenav GPS map.html), not switchTab(map). forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.11': [
        'Planner fare sheet hides Straight-line and Zone behind data-admin-authed-only. Scholar uses alwaysDiscount (50% any time trains run). Trip fare on planner results is text-xs gray-800. Fares tab Approve writes config/planner_fares/$key (public read, operator write); the planner quotes that price for the same OD, profile, peak slot, and day. Deploy firebase-database.rules.json or commuters cannot read the live prices. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.10': [
        'Deep Network Scan, Schedule QA, Zone Distance Audit, grid-order fetch, and exclusion station walks flatten westerncape/public_holidays so WC *_pub sheets resolve next to weekday/Saturday keys. SEO dump getSheet does the same. Ember colour pack is gone; saved ember (and paper) map to Earthy. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.9': [
        'Replaced public/data/full-database.json with the operator export. SEO SSG and the GitHub fallback read that file. Live boards still prefer Firebase for clocks, bans, and killswitch.',
        'Play TWA za.co.nexttrain.app: persist nt_twa in localStorage, list related_applications (prefer_related_applications stays false), confirm via getInstalledRelatedApps, send app_source/twa_package on page_view, and fire twa_open once per session. The native “Google Play is enabled” dialog is Play Integrity/Billing in the Android wrapper, not map.html. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.8': [
        'In-app route name for ct-flats is Cape Town <-> Retreat (corridor label stays Cape Flats Line).',
        'SEO: regions/western-cape-public-holidays.html lists 2026 WC Public Holiday vs no-service days from SPECIAL_DATES. WC region hub, WC route landings, routes.html WC section, and guide FAQ link it. SeoCrossLinks wires route/region/corridor/index pages. GP/KZN/EC have no *_pub sheets so they get no holiday landing.',
        'Gold-track editor and npm run tracks:apply-patch accept KZN. fill-chords / smooth / audit stay held. Planner smoothPathFromStops cover is 2000 m (same as the map) and still hop-slices with dropOutAndBack.',
        'ContentLayout fires one SEO event, seo_page_view. View_astro_pages is gone. map.html and guide.html pass trackSeo={false} so in-app opens do not get SEO dimensions or that event. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.7': [
        'Account panel copy is commuter-facing: guest pitch no longer names route rooms, delay reports, or trip sharing. Delete confirm and the public delete-help page no longer mention operators. Privacy section 3 drops route rooms and operator logins. Operator emails still cannot use in-app Delete. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.6': [
        'Applied the operator gold-track patch for Cape Town ↔ Bellville (ct-bellv) into public/tracks/rail-tracks-WC.geojson. Station list is unchanged (Esplanade / Ysterplaat / Kentemade / Century City). Vertex count stays 396; worst vertex move ~213 m. KZN untouched. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.5': [
        'Applied a second operator gold-track patch for Pretoria ↔ Pienaarspoort (pta-pien) into public/tracks/rail-tracks-GP.geojson. Station list is unchanged (Greenview still on, Waltloo still off). Vertex count stays 525; worst vertex move vs the previous bake ~136 m. KZN untouched. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.4': [
        'Applied seven operator WC gold-track patches into public/tracks/rail-tracks-WC.geojson: bellville-mutual, ct-well, ct-malm, ct-chrishani, ct-kapteinsklip, ct-nolu, ct-eerst. Geometry is the editor export. ct-well and ct-eerst keep the previous station lists (the Save JSON dumped the shared Northern Line sheet, Stellenbosch/Strand included, which would paint the 194 km skeleton again). bellville-mutual bake now ends at Mutual to match the drawn line. Kapteinsklip station order is still Mutual, not Ndabeni/Pinelands. KZN untouched. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.3': [
        'Applied the operator gold-track patch for Cape Town ↔ Chris Hani (ct-chrishani) into public/tracks/rail-tracks-WC.geojson. Station order is now CAPE TOWN > WOODSTOCK > SALT RIVER > KOEBERG RD > MAITLAND > MUTUAL > LANGA > … > CHRIS HANI (bake had skipped Woodstock, Salt River, Koeberg Rd). Vertex count stays 929; worst vertex move ~1110 m. Kapteinsklip and Nolungile bakes are untouched. KZN untouched. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.2': [
        'Applied the operator gold-track patch for Pretoria ↔ Pienaarspoort (pta-pien) into public/tracks/rail-tracks-GP.geojson. GREENVIEW is back on the baked station list. Geometry is the editor export (max vertex move ~287 m). One Walker→Loftus vertex grazes the Dougall Gautrain probe at 34 m; the hop is not rewritten further. KZN untouched. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.17.1': [
        'Manual gold-track editor on the full /map (Network Lines, operator only). Select a line, Edit line, then Move / Add / Delete dots. Stations is a tap-to-open list so Kapteinsklip can be MAITLAND > NDABENI > PINELANDS > LANGA instead of Mutual. Save downloads a JSON patch; npm run tracks:apply-patch writes public/tracks/rail-tracks-{GP,WC,EC}.geojson and sets stationOrderOverride. KZN is refused. Bake geometry is not rewritten in this ship.',
        'Paint uses geojson stationOrderOverride after the bake loads, otherwise STATIC still wins (which is why Kapteinsklip currently climbs via Mutual: STATIC and the Aug-29 bake both list MUTUAL, while the timetable is Ndabeni then Pinelands). forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.16.8': [
        'Nolungile only: the Kapteinsklip working is sliced from Philippi, so selecting Cape Town ↔ Nolungile no longer paints a second Cape Town → Mutual line via Woodstock (that was the whole ct-kapteinsklip bake). Main STATIC path is Stock Road after Philippi; Lentegeur / Mitchells Plain / Kapteinsklip stay on the spur.',
        'Bonteheuwel → Netreg and Nyanga → Philippi follow the Cape Flats rails the basemap draws. OSM tags those ways abandoned and splits them into islands, so the tube drape had been a diagonal chord. Fill walks one connected island, including abandoned/yard ways, for those two hops only. Chris Hani and Kapteinsklip bakes are untouched.',
        'forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.16.7': [
        'Gold tracks: fill only the screenshot hops (allowlist). A full-network stray pass had flattened Tembisa and Saulsville. Walker Street jumps the OSM bridge void along the Metro corridor instead of walking onto Gautrain. Hercules leaves on the Mabopane through rails (north, then east) instead of a 430 m pin chord. De Wildt stays a chord.',
        'Cape Town ↔ Nolungile bake is restitched via Esplanade / Ysterplaat (from ct-bellv). Cape Town → Esplanade is forced onto the northern tracks so the MacGregor Street peel across the Woodstock yard is gone. Nyanga → Philippi is draped. Philippi still forks like Duff’s Road (Stock Road vs Kapteinsklip spur). KZN is not rewritten.',
        'forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.16.6': [
        'Map gold tracks: stripStationPins now also drops one-sided station-pin hooks (Loftus 11 m, Rissik 34 m). Those were kept because the other side of the pin is a 900 m chord (bridge > 600 m). KZN is not rewritten.',
        'npm run tracks:fill-chords drapes leftover short chords (200 m–2 km, 0–1 verts between stops) onto OSM rails from api.openstreetmap.org, ignoring Gautrain-named ways. True OSM gaps (De Wildt) stay chords. npm run tracks:audit is read-only. npm run tracks:repair = smooth + fill, GP WC EC only.',
        'Schedule QA GHOST_STATION flags junk STATION cells (12, 7.20, Last Updated). They no longer count as missing-coord stops or weekday-only stations.',
        'forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.16.5': [
        'Blank slab under the Feedback Hub composer: appearance.css keeps non-fullscreen cards clear of the bottom nav with padding-bottom 4.5rem plus a card capped at --nt-app-h - 5.5rem !important. That was harmless while Hub was a centred sheet. Making it full view in 16.2 left the cap in place, so the card stopped 88px short. A keyboard cycle hid the URL bar, --nt-app-h grew, the cap cleared the sheet and the slab closed, which is why it looked like a measuring bug. #messages-thread-modal is now excluded from both selectors.',
        'Feedback Hub is sized like the Community tab and nothing else: position: absolute; inset: 0 over #nt-shell. No JS geometry, no --nt-app-h / --nt-shell-h / visualViewport copy (16.2, 16.3 and 16.4 each chased the wrong cause with those).',
        'HubModals and index.astro put #messages-thread-modal next to #main-content inside #nt-shell, so inset:0 is exactly the box Community fills. The chrome strip above the shell is still covered by html.nt-full-overlay::before.',
        'Composer keeps the Community dock (position: fixed; bottom: var(--nt-kb-h)) and ntFitAppViewport keeps the shell at lastShellH while Hub has the IME open (hubOn, same branch as communityOn).',
        'forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.16.4': [
        'Feedback Hub slab: 16.3 copied --nt-shell-h into inline height on open. Chrome’s first visualViewport is shorter than the painted frame, so the composer sat above a blank strip until a keyboard cycle remeasured. Hub CSS is now top: --nt-shell-top; bottom: 0; height: auto. JS removes leftover inline geometry. Keyboard still docks the composer to --nt-kb-h and keeps lastShellH like Community.',
        'forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.16.3': [
        'Check for Updates copy: drop “so you leave any stuck copy behind”. Body is download-then-restart; small line is pinned route stays, look goes back to Classic light.',
        'Admin Build notes card (#admin-changelog-modal) is max 85dvh, notes overflow-y auto with overscroll-contain. Backdrop touchmove/wheel preventDefault unless the pan is on #admin-changelog-notes, so Feedback Hub behind does not scroll.',
        'Feedback Hub stays in the #nt-shell visual hole (not --nt-app-h). nt-full-overlay paints only a ::before strip over --nt-shell-top; html/body stay the chrome colour so there is no white slab under the composer.',
        'Feedback Hub composer docks like Community: position:fixed; bottom: var(--nt-kb-h). iOS ignores visualViewport height on fixed overlays, so shrinking the sheet left the field behind the keyboard. Inner card transform is none so the dock is viewport-relative.',
        'forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.16.2': [
        'Feedback Hub is a full-screen overlay (covers the blue chrome). Keyboard still shrinks it from the bottom. Dev Mode drops the p-4 inset the same way.',
        'Approved holiday notices can change dayType (Save) or move back to Pending.',
        'Feedback version chips (V9_09.15.9 · pta-pien and every other V-key) open that build’s internal notes. Capture + inline click + deferred skipHash modal so the same tap cannot dismiss it.',
        'Check for Updates opens cache-clear-modal first (what it does / Cancel / Update). Slow-network confirm still follows when the probe fails.',
        'ct-nolu keeps the main Philippi → Stock Road → Nolungile line and paints a second spur Philippi → Lentegeur → Mitchell’s Plain → Kapteinsklip (prefers the ct-kapteinsklip bake). BRANCH_TRAIN_THRESHOLD still holds for pta-kempton. KZN untouched.',
        'Alerts Reply matches footer Close: --nt-primary fill, --nt-primary-fg text. forceShow stays false. FORCE_UPDATE_REQUIRED stays true.',
    ],
    'V9_09.16.1': [
        'iOS Safari zooms the page when a focused input/textarea/select computes under 16px. Commuter fields used text-sm / text-xs / text-[13px] (and text-lg can dip under 16px on a shrunk phone rem). Floor those controls to max(16px, 1em), keep text-lg at max(16px, 1.125rem) and text-base at max(16px, 1rem). Viewport stays maximum-scale=5. Do not bring back PLANNER_VIEWPORT_NO_ZOOM.',
        'Commuter What’s New: typing in a box stays full size on iPhone. forceShow stays false. FORCE_UPDATE_REQUIRED stays true so existing shells hard-reload onto this version.',
    ],
    'V9_09.15.9': [
        'Mutual no longer claims Cape Town \u2194 Retreat. No Cape Flats train calls there; ensureMaitlandMutualAdjacency spliced Mutual in for geometry and the injected stop registered as a served stop. It is now geometry-only.',
        'Philippi is treated as a fork, like Duff\u2019s Road. One Nolungile working of ten (train 9408) detours Stock Road \u2192 Kapteinsklip \u2192 Mitchell\u2019s Plain \u2192 Lentegeur and rejoins at Philippi. A stop carried by a single train on a sheet running four or more is a branch working, not the corridor shape, so it keeps its marker but no longer bends the line. Only ct-nolu and pta-kempton are affected; KZN and EC are untouched.',
        'Trip planner alignment: ct_to_nolu now runs CAPE TOWN > ESPLANADE > YSTERPLAAT > MUTUAL, but the August bake still runs via Woodstock and Salt River, so every Nolungile trip was drawn down the wrong side of the city. sliceBakedHop only slices a bake that carries both of the hop\u2019s stations; anything else falls through to the merged rail graph, which has the Esplanade alignment from ct-bellv. The trip now passes 33 m from Esplanade and 0 m from Ysterplaat.',
        'Still outstanding: some hops have no OSM rail in the Aug-29 bake and are drawn straight (pta-pien Loftus Versfeld Park \u2192 Rissik 937 m, Nyanga \u2192 Philippi 3.2 km). Those need a re-bake. Overpass 504s on every mirror right now; api.openstreetmap.org answers in 3 s, so the bake fetcher should move onto it.',
    ],
    'V9_09.15.8': [
        'Map lines: a timetable sheet carries the whole line\u2019s station skeleton but only one corridor\u2019s train columns. The WC Northern Line sheets list the Wellington, Stellenbosch/Strand and Eerste River branches together, and the map painted through the rows with no times. Cape Town \u2194 Wellington ran STIKLAND \u2192 DU TOIT \u2192 Stellenbosch \u2192 Strand \u2192 Kuils River \u2192 BELLVILLE (194 km). It now paints only the stops its trains serve, so Stikland joins Bellville and the corridor is 73 km. Same fix for ct-kraai, ct-eerst, ct-strnd and eerst-dtoit.',
        'The bake used to push the raw station coordinate on both ends of every hop, so every off-rail station left a spike (Rissik 908 m, Mzimhlope 1122 m, Mayfair 554 m, Kliptown 413 m). build-rail-tracks.mjs no longer injects them, and npm run tracks:smooth applies the same clean-up plus a despike to existing bakes without re-downloading OSM. GP, WC and EC are now spike-free.',
        'Network map prefers the baked corridor when it covers the served stops, instead of re-deriving it hop by hop and re-entering yard throats. Planner and live tracking no longer stub sideways to an off-track station pin (rail-tracks.js appendSeg).',
        'KZN is held as the reference shape: rail-tracks-KZN.geojson is untouched, GHOST_GEOMETRY_REGIONS keeps it painting ghost rows, and verify-map-lines asserts the Duff\u2019s Road fork (kwaMashu 3.3 km branch) survives.',
        'Trip planner and the Duff\u2019s Road fork: a baked corridor is one LineString, so kzn-bridgecity runs Duff\u2019s Road \u2192 Tembalihle \u2192 kwaMashu and doubles back to reach Bridge City. Slicing Duff\u2019s Road \u2192 Bridge City walked that branch, so Durban \u2192 Bridge City drew itself through kwaMashu (27.1 km, 0 m from kwaMashu). sliceBakedHop now drops any part of a hop that leaves the corridor and returns to the same point: Durban \u2192 Bridge City is 18.0 km and stays 2.7 km clear of kwaMashu, while Durban \u2192 kwaMashu still reaches kwaMashu and stays 1.8 km clear of Bridge City. verify-map-lines runs both trips for real.',
        'Known: ct-nolu still falls back to the graph smoother (one 1.5 km kink). Its Aug-29 bake predates the current pattern, where train 9408 detours via Kapteinsklip. A re-bake of WC clears it once Overpass is reachable.',
    ],
    'V9_09.15.7': [
        'Feedback version chips open Build notes above Dev Hub (skipHash, z-260). Older chips still resolve V9_09.11.2 · route to the version key.',
        'Admin image replies hoist duplicate <img> srcs so the commuter sees one poster. Feedback posters use the Alerts spinner-until-ready loader. Alerts poll no longer rewrites a feed whose cards did not change.',
        'Map tab fullscreen toggles exit; the control becomes minimize. Per-account points use users/{uid}/marks and ntRiderMarksV1:{uid} (no merge from the previous sign-in). Community hides the avatar on consecutive messages from the same person. Account display name defaults to first name + surname initials (Enock LK) and can be edited.',
    ],
    'V9_09.15.6': [
        'Community: other people can see message reactions (parent post_reactions is public-read, plus a live listener and per-post REST fallback). Swipe-to-reply no longer switches to Map. Leaving a non-pinned room keeps that room and drops a quote that belongs to another corridor. Unread badge names the room and the route list shows a count per chat. Remaining send quota sits as tiny unformatted “n left” above the composer.',
        'Deploy firebase-database.rules.json so post_reactions/.read is live. Until then the client still loads reactions per post.',
    ],
    'V9_09.15.5': [
        'Route landings: Durban Yard stays a distinct grid row (no longer labelled Durban). First/last times use the destination row so joiners count. Corridor pages get verified nearby/POI commentary (no invented stops). Ghosts such as Eersterust are named as areas passed, not calling points.',
        'Feedback Hub: admin bubble version (V9_09.15.2 · route) is the same Build notes button as the commuter chip. V9_09.15.2 notes are backfilled so that chip opens notes instead of an empty modal.',
        'Agent rule: every APP_VERSION bump must add an ADMIN_CHANGELOG entry. Distinct from optional commuter What’s New.',
    ],
    'V9_09.15.4': [
        'Restore legacy CleverAds injection and shell handling. Units stay outside the max-w-md phone frame. A wrapper stays collapsed until its iframe finishes loading; nested wrapper+iframe count as one unit.',
    ],
    'V9_09.15.2': [
        'Schedule dump refresh from live RTDB region files. KZN lastUpdated 15 Sep 2026. Grid column order overlay matches the board (Apps Script _columnOrder into MANUAL_GRID_ORDER).',
        'This repo remains the dump source of truth (public/data/), not the old OneDrive SPA tree.',
    ],
    'V9_09.15.1': [
        'CleverAds stickies stay document-level (full viewport). Do not reparent filled units into #nt-ad-scroll-host or force position:static there. --nt-ad-shift still eases sticky-top only.',
    ],
    'V9_09.14.2': [
        'Scheduled alerts: worker cron always publishes due jobs (no exact */5 string match) and awaits the run. github.io / pages.dev can call the worker.',
        'Scheduled Refresh posts due jobs itself when the worker is skipped, so a Monday 00:00 Pretoria-Kempton weekly does not sit at PUBLISH SKIPPED.',
    ],
    'V9_09.14.1': [
        'System Controls Experimental features: accordion per type (Map, Community, I\'m on it / live share, Delay reports, Community realtime, Push notifications, Trip price). Open a type to allow routes. Save still merges into config/features.',
        'Trip price follows the route allow-list (or a device grant). Planner fare sheet states the algorithm is still being tested, floors R7.50 to R7 like the board fare button, money SVG on Trip fare, and Adult opens the passenger profile picker.',
        'Also ships smooth live tracking: 5-10s moving publishes, local pill interpolation, wake, heading clamp, and interchange direction grace.',
    ],
    'V9_09.13.7': [
        'Active share uses each accepted fused fix locally and coalesces Firebase writes to 5-10s moving or a 25s stationary heartbeat.',
        'Remote pills interpolate in place. Number stays within -90 to 90 degrees. Direction warnings need sustained moving samples; interchange hubs get grace.',
    ],
    'V9_09.13.6': [
        'Train oval yaw is bearing minus 90 so the long axis follows the rail tangent. Number still flips along the oval.',
        'Projection bearing prefers snapToRail / path trackBearing, aligned to scheduled travel.',
        'Map tab uses one fused watchPosition (not Leaflet high-accuracy watch). Hidden or no holders drop the watch. Locate recenters the last fix.',
    ],
    'V9_09.13.5': [
        'Community Monitor Delete removes the RTDB post/reply and its community_activity key. Hide stays.',
        'Live sharing cards have Stop share: expire ride_pings and write ride_share_log stop (source admin_stop).',
        'Alert composer: size 4 in between, A+ is 2-3-4-5, size 5 is not auto-bold. Title stays h3 heavy. Toolbar has a gap above the editor. Editor wraps.',
        'Saved sources copy says shared for both operators. Panel open refreshes from Firebase. Online/fail toasts unchanged.',
        'Scheduled tab always lists notices_scheduled. Worker publish is optional and no longer blanks the list as Failed.',
        'Archive loads and paints first with a timeout, then sweeps in the background.',
        'Planner fare sheet adds straight-line km first to last station. Track km stays.',
        'Community error sits above the composer. Worker post cooldown skips Enock and Thandeka.',
    ],
    'V9_09.12.13': [
        'Slow network Proceed is orange. Copy warns that a weak connection can affect offline access until the signal is stronger.',
        'Check for Updates downloads/installs the incoming SW first. Failed install keeps the cached app. No cache wipe before that install.',
        'Admin nearby: Share on the map as this train. GPS is published as that train, off-track allowed. Corridor rideCheckIn gate skipped for admin override. Map tab still listens so someone away can see the pin.',
        'Map tab opens on the pinned corridor / selected region (not the GPS map session). Full GPS network map locate behaviour is unchanged.',
        'Offline map (tab iframe, sidenav sheet, static PNG, map.html cold-start) shows a saved-copy message instead of a broken page.',
    ],
    'V9_09.12.12': [
        'Alert sources save as an id-keyed Firebase map (admin_state/alert_sources). Object payloads from RTDB hydrate on every device.',
        'Feedback Archive paints headers only and hydrates the full thread on first expand. List insert uses a document fragment.',
        'Zone hops are one station pair per line. Zone max km (Z1/Z2/Z3) is a closed accordion.',
        'Schedule QA skips expected empty Saturday placeholders (herc-koed, ec-berlin). Live Saturday trains still scan.',
        'DELTA_VARIANCE cards preview trains on separate rows and open a Train / From / To / Delta table.',
        'Feedback version chips (V9_08.29.2 · route) open Build notes. Capture click; hold-to-react ignores the chip.',
    ],
    'V9_09.12.11': [
        'Welcome fades, then hides. Overlays and the alerts lightbox spring from scale-95. Close fades, then pops history.',
        'Check for Updates: slow/failed probe opens Your network seems slow. Proceed skips only the check_updates preflight. Killswitch still always probes.',
        'Forced-update saved-times toast has a 60s cooldown. Timeouts say the network is slow, not that you are offline.',
        'showToast wraps two lines (no truncate). Account Back closes Account before Options.',
        'Sidenav and What’s New paint APP_VERSION. Unread badge still uses CHANGELOG_DATA[0].id.',
        'Admin nearby sheet: weekday train id + free text, Publish as this train → ride_pings with adminOverrideRole train. Empty-day guard bypassed only for that admin override.',
    ],
    'V9_09.12.10': [
        'Export version is out of flow (top-right overlay). Footer height is the two paired rows only. Type sizes unchanged.',
        'Export NOTE copy is vertically centered (table-cell, html2canvas-safe).',
    ],
    'V9_09.12.9': [
        'See Next Available Day updates the day dropdown to the presented results (Saturday click → Weekday).',
        'Export footer: version top-right, GENERATED balances NextTrain.co.za, PRASA / Metrorail balances the unofficial line. Date has no weekday.',
        'No scheduled trains matches You are here (no card chrome, calendar SVG). Track Occupation sits beside See Monday Schedule.',
        'Grid Column Order tile title uses the same muted uppercase as other Dev Hub home tiles.',
    ],
    'V9_09.12.8': [
        'Two-station cuts include both named stations. TRAIN TERMINATES is the last safe stop before the first affected station (Pretoria→Kempton Park → Irene, not Olifantsfontein).',
        'Tap TRAIN TERMINATES to open the Line Severed modal. Marker look is unchanged.',
        'Result banner SVG is higher-right. Details is far bottom-right, below the icon.',
        'Departed · Show Next Train is blue again.',
    ],
    'V9_09.12.7': [
        'Trip map paints LINE SEVERED only when this itinerary contacts the danger zone (Pretoria–Rissik no longer inherits Olifantsfontein–Kempton Park).',
        'TRAIN TERMINATES at first contact is restored (origin injection was double-called).',
        'Live-share marker is two merged ovals that rotate with the rail; number stays upright.',
        'Target Route closed preview is the name only. Setting chips stay in the open list.',
        'Export grids use lighter cell borders. Footer left column has a quiet APP_VERSION.',
        'Departed + Show Next Train is one muted enclosed button.',
    ],
    'V9_09.10.4': [
        'Commuter reports dock as an accordion under the board.',
        'Account points hydrate from users/{uid}/marks.',
    ],
    'V9_09.10.5': [
        'Expired Reports keeps same-day stale items.',
        'Map Stop sharing. Live sharing admin panel writes ride_share_log.',
    ],
    'V9_09.10.6': [
        'Map train glyphs scale with zoom. Share idle TTL is 30 minutes.',
        'Map popup Timetable opens the planner train sheet.',
    ],
    'V9_09.10.7': [
        'Check for Updates always restarts when online (clears SW / cache, then App updated toast).',
        'Live oval on rails; GPS pulse hidden while you share a train. Same-train pings averaged on-path.',
        'GPS vet enforced. Lab no longer skips path / speed / heading.',
        'Red live dots on train numbers and VIEW FULL TIMETABLE open the train sheet.',
        'System Health build notes. Account points merge on sign-in across devices.',
    ],
    'V9_09.10.8': [
        'NO SVC sits above the train number. The whole cancelled column opens the advisory.',
        'Full timetable waits for exclusions and keeps long-lived bans in local cache for offline.',
        'Downloaded PNG uses the older timetable type (bolder times, softer lines).',
    ],
    'V9_09.10.9': [
        'Map train oval is longer, shows the train number, and a faint ring pulses around it.',
        'PNG export NO SVC is stacked text (no SVG slash).',
        'Alert posters keep loading until the image is ready. Clicks before then do not open the lightbox.',
        'Live sharing admin groups start/stop into one expandable session. Deploy RTDB rules so session PATCH is allowed.',
        'Crash shield ignores extension noise (xbrowser/swbrowser), empty Uncaught, SVG className, and missing .at. Planner zoom guard is defined. Store hydrate uses safeStorage.',
    ],
    'V9_09.10.10': [
        'Feedback thread wallpaper is darker than the white commuter bubbles.',
        'Feedback Options can grant experimental features per device (Add to beta) and search that device trip plans on demand.',
        'Community presence totals unique people across lab and production (host-scoped sessions).',
        'Hercules-Koedoespoort no longer follows the Daspoort spur past Hercules.',
        'Build notes open from feedback version chips and fall back to What’s New copy.',
    ],
    'V9_09.10.11': [
        'Live train fixes require trusted rail within 100 m and stay inside the scheduled journey.',
        'Tracking pauses at the last accepted location on stale, offline, reverse, or off-track fixes. The map never simulates movement.',
        'Train markers are numbered circles with direction and detailed tracking metrics. Next Train sharing dots and pulses are removed.',
        'Community language safety shares one multilingual classifier between the client and Worker. Held posts and replies can be approved or rejected.',
        'Community Monitor groups route conversations by latest activity with a separate unread cursor for each operator.',
        'Sign-in provider availability is controlled from System Controls. Facebook defaults unavailable; Google and email remain enabled.',
    ],
};

function stripHtml(html) {
    return String(html || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

export function versionSortKey(v) {
    const m = String(v || '').match(/^V(\d+)_(\d+)\.(\d+)(?:\.(\d+))?/i);
    if (!m) return 0;
    return ((((Number(m[1]) * 100) + Number(m[2])) * 100 + Number(m[3])) * 100) + Number(m[4] || 0);
}

export function normalizeAdminChangelogKey(version) {
    return String(version || '')
        .split(' - ')[0]
        .split(' · ')[0]
        .split(' ·')[0]
        .trim();
}

export function lookupAdminChangelog(version) {
    const key = normalizeAdminChangelogKey(version);
    if (!key) return null;
    const notes = ADMIN_CHANGELOG[key];
    if (Array.isArray(notes) && notes.length) return notes;
    const row = CHANGELOG_DATA.find((item) => item.id === key || item.version === key);
    if (!row) return null;
    const features = Array.isArray(row.features) ? row.features : [row.features];
    const cleaned = features.map(stripHtml).filter(Boolean);
    return cleaned.length ? cleaned : null;
}

export function listAdminChangelogVersions() {
    const keys = new Set([
        ...Object.keys(ADMIN_CHANGELOG),
        ...CHANGELOG_DATA.map((item) => item.id).filter(Boolean),
    ]);
    return [...keys].sort((a, b) => versionSortKey(b) - versionSortKey(a));
}
