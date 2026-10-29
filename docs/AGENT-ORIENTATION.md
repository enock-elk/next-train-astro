# Next Train — agent orientation

**Start here if you are new to this repo.** Cursor Cloud Agents also auto-load [`AGENTS.md`](../AGENTS.md) (same body as [`instructions.md`](../instructions.md)). Those two files are the **rules and pitfalls**. This page is the **map**: what the product is, where code lives, and which doc to open next.

Owner ships from **`main`**. Prefer small reversible changes. If product copy, timetable rules, holiday behaviour, or visual treatment is unclear, **stop and ask**.

---

## What this product is

**Next Train** is an unofficial South African **Metrorail / PRASA commuter PWA** (Astro + client JS). Commuters pick a region and route, see upcoming trains, trip-plan, browse maps and SEO landings, and (behind flags) use community / alerts / ride features.

| Surface | URL / entry | Notes |
| --- | --- | --- |
| Live app | `https://nexttrain.co.za` | Hosted by sibling repo `enock-elk/metrorail-app` |
| This repo | `enock-elk/next-train-astro` | Source of truth, schedule dump, GitHub Pages preview |
| Preview | `https://enock-elk.github.io/next-train-astro/` | Auto from `main` |
| Branch lab | `https://<id>.next-train-lab.pages.dev` | Cloudflare Pages Git preview — use for PR testing |
| Long-lived lab | `lab.nexttrain.co.za` | Branch `lab` — do not wholesale-merge into `main` |

Production app code is **not** live from a `main` push alone. Push `main`, then run **Deploy production → metrorail-app** (`confirm=DEPLOY`). Schedule JSON overlay is a separate workflow (**Sync schedule data**).

---

## Read order for a new agent

1. [`AGENTS.md`](../AGENTS.md) — hard rules, gold freezes, FOUC, versioning, testing.
2. This file — layout and “where does X live?”.
3. Topic docs below when your task touches that area.
4. Comment headers in the files you edit (especially FOUC / map / ads / live-board).

---

## Repository map

```
AGENTS.md / instructions.md   # Agent rules (keep identical)
docs/                         # Human + agent topic guides (you are here)
src/pages/                    # Astro routes (app shell, SEO landings, guide, map…)
src/components/               # Astro UI (LiveBoard, TripPlanner, Alerts, SEO*, recovery…)
src/layouts/                  # App Layout vs ContentLayout (map/SEO pages)
src/lib/                      # Client logic (board, planner, alerts, admin bridges, SEO…)
src/lib/_extract/             # DORMANT SPA scrape leftovers — do not re-assemble casually
public/js/admin.js            # Large admin / Dev Hub script
public/js/map-app.js          # Network map runtime (gold)
public/data/                  # Schedule dump fallback (full-database.json, region JSON)
public/tracks/                # Baked rail GeoJSON + GOLD.json (map gold)
public/images/schedules/      # Printed timetable JPG catalogue + manifest
public/images/alerts/         # Alert catalog posters (separate from schedules)
workers/                      # Cloudflare Workers (cache, community, reply, edge, telemetry)
scripts/                      # verify:*, tracks:*, SEO fetch, retain-previous-astro, sync helpers
.github/workflows/            # deploy-production, sync-schedule-data, lab, workers, scheduled-alerts
firebase-database.rules.json  # RTDB security rules (deploy separately: npm run firebase:rules)
```

### Important `src/lib` clusters

| Cluster | Files (examples) | Role |
| --- | --- | --- |
| Config / routes | `config.js` | `APP_VERSION`, `ROUTES`, regions, corridors, fares, `SATURDAY_PLACEHOLDER_ROUTES`, What’s New data |
| Live board | `live-board.js`, `live-board-paint.js`, `live-board-ui.js`, `logic.js`, `renderer.js` | Upcoming trains, day type, grid export |
| Planner | `planner-core.js`, `planner-ui.js` | Trip plans, transfers, Saturday / ban rules |
| Map | `rail-tracks.js`, `map-tab.js`, `map-viewer.js` + `public/js/map-app.js` | Baked geometry paint (gold) |
| Alerts | `alerts-feed.js`, `alerts-channel.js`, `alert-poll.js` | Bell overlay feed, reactions, expiry, scoping |
| Community / rides | `community.js`, `ride-pings.js`, `rider-marks.js` | Route chat, presence, “I’m on it” (feature-flagged) |
| Admin / Co-Pilot | `admin-bridge.js`, `reply-suggest.js`, `reply-knowledge.js`, `operator-brief.js` | Dev Hub, suggest-a-reply, inbox |
| SEO | `seo-routes.js`, `seo-station-allowlist.js`, `seo-timetable.js` | SSG landings, phased station pages |
| Ads | `clever-ads.js`, `clever-ad-lifecycle.js` | CleverAds overlay (advert gold) |
| Shell / update | `app-update.js`, `recovery.js` | SW update, stuck update / lifeline behaviour |

`src/lib/_extract/` is **not imported**. It is leftover from a one-time scrape. Edit assembled modules under `src/lib/` directly. Re-running `assemble-live-board.mjs` needs `FORCE_ASSEMBLE=1` and wipes hand patches.

---

## Runtime architecture (short)

```
Commuter PWA (Astro shell + hashed /_astro/ JS/CSS)
    │
    ├─ Schedules: Firebase RTDB region files
    │       → fallback Cloudflare Worker nexttrain-cache
    │       → fallback GitHub dump public/data/ (jsDelivr @main)
    │
    ├─ Dynamic (bans, notices, exclusions, features): always Firebase (DYNAMIC_BASE_URL)
    │
    ├─ Maps: baked public/tracks/*.geojson + map-app.js / rail-tracks.js
    │
    └─ Workers: community, reply (Gemini drafts), edge, telemetry, cache
```

- RTDB schedule paths look like `schedules/gauteng.json` (region files), **not** a single `full-database.json` on Firebase.
- **Never invent** a `trains/` RTDB tree. Allowed live nodes are listed in `AGENTS.md` → Do not break.
- Image schedule JPGs under `public/images/schedules/` are an **archive**, not the live board.

---

## Deploy and environments

| What | How |
| --- | --- |
| Code + static assets to production host | Workflow **Deploy production → metrorail-app** with `confirm=DEPLOY` |
| Schedule JSON overlay only | Workflow **Sync schedule data → metrorail-app** (does not publish the whole app) |
| GitHub Pages preview | Automatic from `main` |
| Cloudflare Pages branch preview | Push a branch; open `*.next-train-lab.pages.dev` |
| Lab site | Branch `lab` / `deploy-lab.yml` |
| RTDB rules | `npm run firebase:rules` (needs Firebase CLI auth) — app code push does **not** deploy rules |
| After production deploy | Purge Cloudflare cache for `nexttrain.co.za` (HTML + service worker) |

Secrets: production and schedule-sync use `METRORAIL_APP_DEPLOY_TOKEN`. Do not mint a new PAT unless a run gets 403 / expired. `PUBLIC_CARTO_API_KEY` must exist at **build** time (GitHub Actions secrets **and** Cloudflare Pages vars for lab previews). Never commit the key.

Sibling host repo `metrorail-app`: overlay `public/data/*.json` only; never `--delete` host-only files; never force-push.

---

## Cloudflare Workers

| Worker | Folder | Purpose |
| --- | --- | --- |
| Schedule cache / origin firewall | `workers/nexttrain-cache/` | Edge cache for region schedule JSON; CORS allowlist |
| Community | `workers/nexttrain-community/` | Community API / Admin-assisted writes |
| Suggest reply | `workers/nexttrain-reply/` | Gemini drafts for Dev Hub (never auto-sends) |
| Edge | `workers/nexttrain-edge/` | Edge helpers / cache rules companions |
| Telemetry | `workers/nexttrain-telemetry/` | Operator telemetry intake |

Each folder has its own README for deploy (`wrangler`, secrets). Reply worker setup: Gemini key on Cloudflare only; see that README.

---

## Admin, Co-Pilot, and feedback

- Large admin UI: `public/js/admin.js` (Dev Hub, inbox, notices, schedule QA, system health).
- Suggest-a-reply pure logic: `src/lib/reply-suggest.js` + knowledge `src/lib/reply-knowledge.js`.
- Regional PRASA phones must stay in **guide** (`src/pages/guide.astro`) **and** `reply-suggest.js` contact blocks; `guardDraft` blocks cross-region numbers. Verify: `npm run verify:reply-suggest`.
- Station reviews: pending list needs RTDB rules that allow admin list + pending create; public mirror is `station_reviews_public`. Deploying rules is operator-side.
- Operator build notes: `ADMIN_CHANGELOG` in `src/lib/admin-changelog.js` (keyed by `APP_VERSION`). Commuter What’s New is `CHANGELOG_DATA` in `config.js` — optional and competitor-visible; see Versioning in `AGENTS.md`.

---

## SEO and content sites

- Route / region / corridor landings: `src/pages/routes|regions|corridors/`, copy in `seo-routes.js`.
- Station pages: phased allowlist `seo-station-allowlist.js` — do not SSG every WC/KZN/EC mid-corridor stop early.
- Build pulls live sheets when possible: `scripts/fetch-live-schedules-for-seo.mjs` (`SEO_REQUIRE_LIVE=1` on production builds).
- Guide / legal / status: `guide.astro`, `privacy.astro`, `terms.astro`, `status.astro`.
- Map page uses **ContentLayout**, not the app `Layout` — both must expose CARTO helper / shell fallbacks as required by FOUC rules.

---

## Maps and ads (gold)

Treat as locked unless the owner asks for a proven improvement:

- Tracks + map runtime → branch `map-gold`, hashes in `public/tracks/GOLD.json`.
- CleverAds path → same gold snapshot (`clever-ads.js`, `clever-ad-lifecycle.js`).

Full do/don’t lists: `AGENTS.md` → Map gold / Advert gold. Verifiers: `verify:map-lines`, `verify:map-hops`, `verify:map-gold`, `verify:clever-ads`.

---

## Image timetable catalogue

Printed PRASA sheets: `public/images/schedules/` + `manifest.json`. Detailed naming and intake: [`public/images/schedules/README.md`](../public/images/schedules/README.md). Pitfalls and known gaps: `AGENTS.md` → Image schedules.

Filing JPGs does **not** change live Firebase times.

---

## Feature flags and hidden surfaces

Many surfaces are live in code but **hidden from What’s New and some UI** while operators test (Alerts bell, community chat, ride sharing, Trains near me, etc.). Do not advertise them in commuter changelog. Flags often come from RTDB `config/features` — see `features.js` and `docs/config-features-pilot.json`.

Bottom nav has **four** tabs only: Home, Trip Planner, Community, More. Alerts is the bell overlay, not a tab.

---

## Local development

```bash
npm install
npm run dev          # Astro dev server
npm run build        # check + build (prebuild fetches SEO schedules + sitemap)
npm run preview      # preview dist/
```

Copy env from `.env.example` as needed. Never commit secrets.

Pick verifiers that match your change (`package.json` `verify:*` scripts). Examples:

| Change touches | Run |
| --- | --- |
| Alerts channel / reactions | `verify:alerts` |
| Schedule dump / pipeline URLs | `verify:schedule`, `verify:urls` |
| Image catalogue | `verify:schedule-images` |
| Any app update the owner will deploy | `verify:map-gold` first (Deploy production fails the job before the build), then `verify:schedule`, `verify:update-fouc`, `verify:safe-nuke` |
| Map tracks / paint | `verify:map-lines`, `verify:map-hops`, `verify:map-gold` |
| Ads | `verify:clever-ads` |
| FOUC / SW / retention | `verify:update-fouc` |
| Co-Pilot / guide phones | `verify:reply-suggest` |
| Station / route SEO | `verify:station-seo`, `verify:route-seo` |
| RTDB rules shape | `verify:rtdb-security` |

Shell / FOUC changes: also prove `dist/` with `/_astro/*.css` returning 404 still readable. Do not add walkthrough videos unless the owner asks.

---

## Topic docs in this folder

| Doc | When to open |
| --- | --- |
| [ADMIN-GUIDE.md](./ADMIN-GUIDE.md) | Operator / Dev Hub behaviour |
| [USER-GUIDE.md](./USER-GUIDE.md) | Commuter-facing product explanation |
| [FCM-NOTIFICATIONS-SETUP.md](./FCM-NOTIFICATIONS-SETUP.md) | Push notification setup |
| [facebook-login-setup.md](./facebook-login-setup.md) | Facebook auth |
| [PHASE-0-CUTOVER.md](./PHASE-0-CUTOVER.md) | Historical Astro cutover notes |
| [PHASE-LAB-LINE.md](./PHASE-LAB-LINE.md) | Lab line strategy |
| [PHASE-LIVE-STRATEGY.md](./PHASE-LIVE-STRATEGY.md) | Live features strategy |
| [PHASE-COMMUNITY-REALTIME.md](./PHASE-COMMUNITY-REALTIME.md) | Community realtime |
| [SPA-ASTRO-PARITY.md](./SPA-ASTRO-PARITY.md) | Old SPA vs Astro parity checklist |

Worker READMEs under `workers/*/README.md` for deploy steps.

---

## Common pitfalls (index)

Details and absolute bans live in `AGENTS.md`. Skim these before large edits:

- **FOUC / serif shell** → asset retention, not “fix the CSS”. Read FOUC section + `ShellFallbackStyles` / `StuckUpdateGuard` / `RecoveryLifeline` headers.
- **Map opens over the ocean** → missing lat/lon must stay `null`, not `Number(null) === 0`.
- **Map geometry** → never whole-region Overpass refresh; never smooth KZN; never silence `verify:map-gold` by editing hashes only.
- **Deploy production fails at Verify map gold** → a listed file differs from `GOLD.json`. Diff `origin/map-gold`. Freeze a proven improvement (update hashes and `frozenAt`, fast-forward `map-gold`). Do not hash-bump an unproved edit. Run `verify:map-gold` before every app push, even when the edit is not a map.
- **About black box misses the waterfall** → production `drop_console` strips bundled `console.*`. Log through `window.ntTrace`. Admin lines still appear because `admin.js` is not bundled.
- **Ads** → overlay from bottom; no reserved blank gap; advert gold.
- **Exclusions** → `DEFAULT_EXCLUSIONS` stays `{}`; bans in RTDB.
- **Saturday empty routes** → `herc-koed`, `ec-berlin` are expected empty.
- **What’s New** → no admin/SEO/alerts/community spoilers; no emoji; no em/en dashes; `forceShow` false.
- **Thandeka** stays on admin allowlists.
- **Grid PNG export** → light mode only; do not restyle timetable extracts unless asked.
- **Manifest / schedules** → surgical JSON edits; hash before filing; keep older dated sheets.

---

## Versioning reminder

Every ship that bumps the app: sync `APP_VERSION` (`config.js`), `package.json` `version`, `public/app-version.json`, and add `ADMIN_CHANGELOG[APP_VERSION]`. Commuter What’s New is optional. Scheme: `V{major}_{MM.DD}.{n}`.

---

## Maintaining this orientation

When you add a major subsystem, worker, or deploy path, update **this file** and the matching hard rule in `AGENTS.md` / `instructions.md` (keep those two identical). Do not put secrets here.
