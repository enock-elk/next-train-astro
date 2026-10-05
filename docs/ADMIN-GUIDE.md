# Next Train — Admin / Operator Guide

**Audience:** Allowlisted operators only (`enockelk@gmail.com`, `thandeka05nxumalo@gmail.com`).  
**App:** Production [https://nexttrain.co.za](https://nexttrain.co.za) · Lab `lab.nexttrain.co.za` · Branch previews `*.next-train-lab.pages.dev`  
**Source:** `enock-elk/next-train-astro` (`main`). Live host: `enock-elk/metrorail-app`.  
**Commuter guide:** `docs/USER-GUIDE.md` (do not publish this admin doc in What’s New).

This document describes the Dev Hub tiles and the usual operating paths. Button labels match the admin UI.

---

## 1. How to open admin

1. Open the live app while signed out or as yourself.
2. Tap the header title **Next Train** five times.
3. **Admin Gateway:** email + password → **Sign In**.
4. Non-allowlisted accounts are signed out with *Not an operator account*.
5. On success, **Developer Mode** (Dev Hub) opens. An existing allowlisted session can reopen Dev Hub without the gateway.

Admin chrome also reveals pilot tabs (Map / Community / Account) for that session. Sign out to hide them again.

**Rules:** Firebase RTDB and workers gate writes on the two operator emails. Do not remove Thandeka from allowlists. Do not invent a `trains/` RTDB tree.

---

## 2. Dev Hub mental model

Tiles open drill panels (`#dev-<panel-id>`). Use the hub Back control to return to the grid. Unread badges sync via `admin_state/{uid}/*_last_checked`.

Typical daily path:

1. **Global State Monitor** — what is live right now  
2. **Service Alerts** — post / review notices  
3. **Commuter Feedback** — reply  
4. **User Trust & Bans** — lookup / shadow ban  
5. **Planner Telemetry** — fails, fare votes, ticket photos  
6. **System Health** — Build notes for the version chip you see in feedback/crashes  
7. **System Controls** — deploy / purge / nuke only when shipping

---

## 3. Service Alerts

**Tile:** Service Alerts → **In-app alerts** (Notifications is a separate FCM drill).

**Tabs:** New Alert | Active Alerts | Scheduled | Archived

### Compose (New Alert)

1. **Audience** — chips for Entire Network / regions; route checkboxes under the dropdown. Multi-select. Deselecting a region updates the Channel poster line immediately (stale fetches are ignored).
2. **Severity** — Info (General) / Warning (Delays) / Critical (Suspended); **Sign-off Name**.
3. **Message** — WYSIWYG body.
4. **Channel poster** — catalog under `public/images/alerts/` (**Add a poster…**). Posting does **not** upload images to Storage; Preview and Post use the same catalog path. Live-count line under the poster reflects current targets.
5. **Options** — Force Popup Alert; **Pin to bottom of feed**; Interactive Poll Mode.
6. **Poll** (optional) — question, Option A/B, **+ Add third option**, poll close, Show results / Allow multiple / Show raw counts; **Live Poll Results** + **Refresh**.
7. **When** — Now / Later / Weekly / Monthly + Expiry.
8. **Preview Alert** → post. **Clear** resets the composer.

**Card order in the feed:** title → image → text.  
**Close** on the channel is labeled **Close** (not a faint X).  
Hold-to-react must work on catalog photos (tap = lightbox, hold = reactions).

**Active / Scheduled / Archive:** Refresh, edit/update/repost/delete, schedule save (worker every ~5 minutes).

**RTDB:** `notices`, `notices_meta`, `polls`, `notices_scheduled`, `notices_archive`.

### Push notifications

From Service Alerts hub → **Notifications**: audience (Everyone / region / pinned / notify-list / user), type, **Count devices**, **Send notification** (community worker FCM).

---

## 4. User Trust & Bans

**Tile:** User Trust & Bans

**Tabs:** Active bans | Lookup

### Lookup
1. Paste UID, `usr_…` device id, email, or alias → **Lookup**.
2. Structured card shows email/contacts (mailto / tel), joined / last seen, devices, role / trust, shadow ban, feedback, trip plans, fare votes (with ticket photo count), fails, crashes, live location, community.
3. Actions:
   - **Open chat** / **Reply** or **Start chat**
   - **Open trip plans**
   - **Open fare votes** (Planner Telemetry → Fares, filtered to that device)
   - **Open fails** / **Open crashes**
   - **Open bans**
   - **Edit alias**
   - **Shadow ban** / **Lift ban**

### Shadow ban
Duration: 1h / 6h / 24h / 7d / 30d / Permanent.  
Experience modes: Fake offline / Freeze / FOUC / 404.  
Writes `users/{uid}/flags` and/or `devices/{id}/flags`.

### Active bans
List + **Refresh** + **Lift**.

---

## 5. Commuter Feedback

**Tile:** Commuter Feedback

- Tabs: Inbox / Archive; search; **Export All**; **Refresh**.
- Thread: **Reply to Commuter** → **Send Reply** / **Save**; Resolve; Delete; alias; attachments; hold-to-react.
- After reply: optional **WhatsApp** / **Email** / **Not now**.
- Version chips open **Build notes** (`ADMIN_CHANGELOG` for that `APP_VERSION`).

**RTDB:** `feedback`, `inbox`, `admin_state/aliases`.

---

## 6. Planner Telemetry

**Tile:** Planner Telemetry (“Silent Routing Telemetry”)

**Chrome:** **Sort: Recent**, Users/hits toggle, **Refresh**, **Export**, **Clear DB**  
**Tabs:** Trip Plans | Fails | Fares

### Trip Plans
Filters: Region, Day type, User ID. Corridor cards, insights strip, infinite scroll. Indexes: `sys_logs/trip_plan_users`, `trip_plan_pairs`, batches under `trip_plans`.

### Fails
Aggregated routing fails. Expand contributors (full user ids + app version). Device filter when deep-linked from Trust.

### Fares (corrections + ticket photos)
- Each disagree vote can show Peak/Off-peak, ticket type, Quoted Single, km, default route, **Approve {R…}** (Single only).
- **Ticket photos:** stored in Firebase Storage `fare_tickets/`; sidecar `sys_logs/fare_ticket_photos`. On the card: thumbnail + **Open ticket**.
- From Trust → **Open fare votes**: filter bar *Showing fare votes for …* + **Clear**.
- Weekly / Monthly / Return corrections are **collect-only**. Do **not** Approve them into live Single overrides. Peak/off-peak on the card is the board the user viewed, not the ticket period.
- CSV export includes `ticketType` and `quotedTicketType` (quoted is always Single).
- Corridor long fares: **Confirm** / Unconfirm → `config/route_fares`.
- Single Approve → `config/planner_fares/{key}`.

**Payload note:** Client always stores `quotedTicketType: 'single'`. Commuter modal UI for voting stays as shipped; ticket-type select already collects weekly/monthly amounts.

---

## 7. Crash Analytics

**Tile:** Crash Analytics

- Tabs: Inbox | Distress | Archive.
- **Refresh**, **Export**, **Purge BB** (blackbox only), **Clear DB**.
- Per crash: Reply, Resolve, Delete; device **Resolve All**.
- App version chip → Build notes.
- **RTDB:** `sys_logs/crashes`, `sys_logs/blackbox`.

---

## 8. Schedule exceptions, incidents, holidays

| Tile | Use |
|------|-----|
| **Schedule Exceptions** | Load trains; **Ban Train** / **Mark Special**; **Apply Exceptions**. Specials stay on boards/planner; bans hide service. `DEFAULT_EXCLUSIONS` in client stays `{}` — corridor bans live in RTDB `exclusions/`. |
| **Transit Incident Manager** | CRITICAL/WARNING; stations; badge + notice; days; map; **Deploy Incident** / **Resolve** → `disruptions` |
| **Special Event Route** | Temporary event corridor → `config/special_event` |
| **Holiday Notices** | Pending / Approved regional holiday day-type sheets |
| **System Controls → Maintenance Mode** | Scoped banners; master pause |
| **System Controls → Force schedule type** | Per-region timetable override |

---

## 9. System Health Diagnostics

**Tile:** System Health Diagnostics

- **Build notes** — operator changelog keyed by `APP_VERSION` (`src/lib/admin-changelog.js`). Distinct from public What’s New.
- Cache Propagation Matrix → **Probe Edge Caches**
- Deep Network Scan → **Run Deep Scan**
- Zone Distance Audit → **Run Distance Audit** / Export
- Schedule Data QA → **Run QA report** / Export
- Time Simulation Engine — sim time/day; pipeline override AUTO / CF / GitHub / Firebase

---

## 10. System Controls / ship checklist

Inside **System Controls** (order matters):

1. **Publish live site** — optional dry-run; type `DEPLOY`; **Publish live**; **Refresh status**; **Open GitHub**. Dispatches `deploy-production.yml` via telemetry worker (`GH_ACTIONS_TOKEN`). Does **not** use `METRORAIL_APP_DEPLOY_TOKEN` in the browser.
2. **Cloudflare Purge** — **Purge Cloudflare Cache** (HTML + SW after a real production deploy).
3. **Nuclear Cache Wipe** — type `NUKE` → `config/killswitch` (clients wipe caches). Last resort.

Also here: account provider toggles, experimental feature grants (Map/Community/etc.), shadow-ban default mode, Growth QR.

### Shipping app code (operators)

1. Land on `main` in `next-train-astro`.
2. Preview: Cloudflare Pages Git preview URL for the branch/PR, or github.io after `main` (github.io alone is not production).
3. Schedule JSON only: push `public/data/*.json` → workflow **Sync schedule data → metrorail-app** overlays host data. Live boards still prefer Firebase when up.
4. Full site: Dev Hub **Publish live** (or Actions **Deploy production → metrorail-app** with `confirm=DEPLOY`).
5. Purge Cloudflare for `nexttrain.co.za`.
6. Retention: deploy keeps prior `/_astro/` hashes (`retain-previous-astro.mjs --keep 8 --keep-css 30`). Do not shrink this.

Version bumps must sync `APP_VERSION`, `package.json`, `public/app-version.json`, and add `ADMIN_CHANGELOG[APP_VERSION]`. Commuter What’s New is optional and must not mention admin, alerts bell, community, live tracking, etc.

---

## 11. Live Telemetry & Global State Monitor

**Live Telemetry:** Last 5/30 mins, Today (regional), WAU, MAU, All-Time, system errors 24h, trend charts, PNG export. Worker: `workers/nexttrain-telemetry`.

**Global State Monitor:** live Alerts / Incidents / Grid notices / Exclusions / Maint. **Resolve**, **Extend**, **Review →**. Swipe between tabs.

---

## 12. Other tiles

| Tile | Notes |
|------|--------|
| **Delay Reports** | Rider delay reports; mark closed |
| **Live sharing** | Active GPS shares by region; **Stop share** |
| **Community Monitor** | Moderate route feeds; Approve held posts; Hide/Delete; Shadow ban |
| **Grid Column Order** | Drag train columns; **Save order** / **Reset to fallback** → `config/grid_order` |
| **Operations Roadmap** | Kanban; **New Ticket**; link back to feedback/crash/telemetry |

---

## 13. Data pipeline (quick reference)

Live boards try **Firebase → Cloudflare (`nexttrain-cache`) → GitHub dump**.

- Schedules on RTDB: region files (`schedules/gauteng.json`, …), not `full-database.json`.
- Dynamic (bans, alerts, maintenance, killswitch): always `DYNAMIC_BASE_URL` (Firebase).
- GitHub dump: this repo `public/data/full-database.json` via jsDelivr `@main/public/data/`. Do not point `PIPELINE_SOURCES.GITHUB` at `metrorail-app`.
- Deploy overlays `public/data/*.json` onto the host; never `--delete` host-only files (e.g. `sanitize.py`).
- CARTO Voyager tiles need `PUBLIC_CARTO_API_KEY` at **build** time (GitHub Actions secrets + Cloudflare Pages vars for lab previews).

---

## 14. Map / Advert gold (do not casually rewrite)

- Track GeoJSON + map runtime are frozen to branch `map-gold` (`public/tracks/GOLD.json`).
- CleverAds path (`clever-ads.js` / `clever-ad-lifecycle.js`) is the same gold snapshot.
- Ads overlay from the bottom (`#clever-core`). Do not reserve a blank ad gap.
- Before track/map changes: diff vs `origin/map-gold`, then `verify:map-lines`, `verify:map-hops`, `verify:map-gold`, `verify:clever-ads`.

---

## 15. Alerts / FOUC / tabs — hard rules

- **No sixth bottom-nav tab.** Alerts is the bell overlay, not a tab. Tabs: Home, Trip Planner, Community, More (Options).
- Do not flash WORKING OFFLINE on screen-lock; offline chrome only if visible + offline ~4s.
- Do not shrink `/_astro/` retention; do not hide `#nt-recovery-lifeline` only from the hashed CSS bundle (see `ShellFallbackStyles.astro` / `StuckUpdateGuard`).
- Hold-to-react on catalog alert photos must keep working.

---

## 16. Verify scripts (before you merge operator-facing changes)

```bash
npm run verify:admin-allowlist
npm run verify:admin-panels
npm run verify:admin-telemetry
npm run verify:alerts
npm run verify:fare-votes
npm run verify:schedule
# plus the verify:* that matches your change
```

---

## 17. Ticket photos — where admins look

1. **Planner Telemetry → Fares** — thumb + **Open ticket** on each vote that uploaded a photo.  
2. **User Trust → Lookup → Open fare votes** — same list, filtered to that device.  

There is no separate gallery tile. Storage path: `fare_tickets/`. Metadata: `sys_logs/fare_ticket_photos`.

---

## 18. Peak / off-peak vs weekly corrections (operator judgment)

Commuters often:

- View an **off-peak** board (cheaper Single), then report the **peak** cash price they paid earlier, or  
- Enter a **weekly/monthly** ticket amount while the quote is Single.

Admin cards now spell **Board was Peak/Off-peak**, **Quoted Single**, and ticket type. Approve **only** clear Single disagreements. Leave weekly/monthly as collect-only until a dedicated fare-period workflow exists.

---

*Aligned to admin surfaces as of V9_10.05.x. Prefer small reversible changes. When unsure about product copy, holiday rules, or visual treatment, ask the owner before shipping.*
