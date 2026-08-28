# Next Train — project system prompt (`instructions.md`)

This is the standing brief for humans and agents. **Cursor Cloud Agents automatically load [`AGENTS.md`](./AGENTS.md)** (the usual filename). Keep this file and `AGENTS.md` the same.

This is a **commuter PWA**. Prefer small, reversible changes. Do not “clean up” core behaviour you do not fully understand.

**No unsolicited changes.** Only change what was asked. Do not rewrite adjacent copy, layout, or behaviour. Do not “improve” strings, presence labels, or UI that was not in the request.

## Product and repos

- **This repo (`enock-elk/next-train-astro`)** is the Astro source of truth, GitHub Pages preview, and GitHub schedule dump (`public/data/`).
- **Live site** is `https://nexttrain.co.za`, hosted by **`enock-elk/metrorail-app`** (GitHub Pages + CNAME). Production publish is `.github/workflows/deploy-production.yml`.
- **Do not** treat the old vanilla SPA checkout (`Train Schedule` / a stale `metrorail-app` working tree) as something to rebase onto live. That pull deletes `css/` and old icon folders and fights OneDrive locks. Abort those rebases (`git rebase --abort`). Never force-push `metrorail-app`.
- **Lab** is the long-lived `lab` branch (lab.nexttrain.co.za). Do not wholesale-merge lab (or PR #8) into `main`.

Work from **`main`**. The owner ships by pushing `main` and running the production deploy workflow. Do not leave them a pile of draft PRs they must merge unless they ask. Do not force-push. Do not amend published commits unless they ask.

## Do not break

- **No sixth bottom-nav tab.** Tabs are Home, Trip Planner, Community, More. Alerts is the **bell overlay** (`#alerts-channel`, z-115), not a tab.
- **No `trains/` tree** on Firebase. Do not invent RTDB paths. Live nodes that must remain include `config/features`, `push_subscriptions`, `ride_pings`, `notices`, `notices_meta`, `exclusions`, `disruptions`, `schedules`.
- **Do not remove Thandeka** from admin allowlists. Operator emails in rules/admin are `enockelk@gmail.com` and `thandeka05nxumalo@gmail.com`.
- **`DEFAULT_EXCLUSIONS` stays `{}`.** Corridor bans live in RTDB `exclusions/`. Do not hardcode Kempton 0618/0619 (or any train) in the client.
- **Do not drop** alert expiry, union scoping (route ∪ region ∪ `all`), park-home on Alerts Close (`history.back()` after hide), quiet board paint, hold-to-react, reaction breakdown sheet, or photo hold-to-react.
- **Do not reserve a blank ad gap.** Ads overlay from the bottom (`#clever-core`). Footer stays `nt-board-footer mt-auto`.
- **Do not flash WORKING OFFLINE** on screen-lock. Offline chrome only if the app is **visible** and still offline for **4s**.
- **Do not point `PIPELINE_SOURCES.GITHUB` back at `metrorail-app`.** The dump is this repo: `public/data/full-database.json` via jsDelivr `@main/public/data/`.
- **Do not empty `metrorail-app/data/`.** Deploy overlays `public/data/*.json` only. Never `--delete` host-only files (e.g. `sanitize.py`).
- **Do not create a new deploy PAT.** Production and schedule-sync both use repo secret `METRORAIL_APP_DEPLOY_TOKEN` (Contents write on `metrorail-app`). Rotate only if a run gets 403 or the token expired.

## Data pipeline

Live boards try **Firebase → Cloudflare (`nexttrain-cache`) → GitHub dump**.

- Schedules on RTDB are region files (`schedules/gauteng.json`, etc.), not `full-database.json`.
- Dynamic data (bans, alerts, maintenance, killswitch) **always** uses `DYNAMIC_BASE_URL` (Firebase).
- Updating `public/data/full-database.json` refreshes the **fallback**, not the live board while Firebase is up. Push `main`; workflow **Sync schedule data → metrorail-app** overlays JSON onto the host. A full site publish still needs **Deploy production → metrorail-app** (`confirm=DEPLOY`).
- After a real production deploy, purge Cloudflare cache for `nexttrain.co.za` (HTML + service worker).
- **CARTO Voyager tiles** need `PUBLIC_CARTO_API_KEY` at **build** time (Astro inlines it into `window.ntCartoVoyagerUrl`). The **map page** uses `ContentLayout` (not the app `Layout`) — both layouts must expose the helper. GitHub **Actions** repository secrets are the right place for Actions-built deploys (`deploy-lab.yml`, production). They do **not** reach Cloudflare Pages Git previews (`*.next-train-lab.pages.dev`). Also set the same name as a Cloudflare Pages variable on `next-train-lab` (Production **and** Preview), then retry that deployment. Do not use GitHub Environment secrets unless a workflow has `environment:`. Never commit the key.

## Alerts

- Channel: WhatsApp-style feed, last 10 + Show earlier, union scoping, critical pin, hold-to-react, tap counts for the breakdown sheet.
- Close is labeled **Close** (not a faint X). Empty copy: “When Next Train posts a notice for your region or route, it will show up here.”
- Card order: **title → image → text**.
- Catalog posters live in `public/images/alerts/` (manifest + JPGs). Preview and Post use the same path; posting does **not** upload images to Storage.
- **Hold-to-react must work on catalog photos.** Poster buttons are lightbox on **tap**, picker on **hold**. Do not put `[data-alert-lightbox]` back in the long-press ignore list. Do not use inline `onclick` + `stopPropagation` on those posters (it fires before the hold can cancel the click).

## UI / SEO that already bit us

- Region swap must **not** reopen Select Route when a pin is restored.
- Weekday/Sat/Sun sim must ignore leftover `#sim-date` unless the user picked a specific date.
- Shared-corridor “To …” uses the warning **SVG**, not emoji.
- Google Search favicon: first `<link rel="icon">` is the square **48×48 PNG** (`/icons/icon-48.png`). Do not put `favicon.ico` first with `sizes="any"` (that attribute is for SVG). Browser tab ≠ SERP chip; SERP lag after deploys is normal (days). Request indexing of `https://nexttrain.co.za/` in Search Console after production deploy.

## Versioning

Scheme: `V{major}_{MM.DD}.{n}` (example `V8_08.17.1`). Same calendar day → increment `n`. New calendar day → today’s `MM.DD` and `n=1`.

Keep in sync on every version bump: `APP_VERSION`, `package.json` `version`, and `public/app-version.json`.

**Changelog is optional.** You may ship a version bump with no What’s New card and no `CHANGELOG.md` heading, or with a heading that is only **no release notes.** When you skip commuter notes, leave `CHANGELOG_DATA[0]` as the last public card. Do not invent What’s New bullets for admin-only, instruction-only, or operator-only ships.

When you do write notes: add a `CHANGELOG.md` heading and, only if there is obvious commuter-facing behaviour, a matching `CHANGELOG_DATA[0]` card.

**What’s New is a public commuter list. Competitors read it.** Only obvious in-app behaviour a commuter can tap and see in the build they have (board, planner, map, timetable, Options). Short bullets. Do not explain strategy or “we fixed.” Engineering detail stays in `CHANGELOG.md`.

Never mention:
- admin, Account, password, sign-in, Face ID, Dev Hub, deploy, workers, NUKE, analytics, SEO, Google, indexing, route landing pages, or app configuration
- Alerts, the bell, notices, hold-to-react, Trains near me, I’m on it, live location, ride sharing, community chat, or route chat. Those stay hidden while operators test them. Do not list what commuters cannot open today.

Never use emoji in What’s New (including ↔ arrows). Never use emoji on commuter buttons (SVG only).
Never use em dashes (—) or en dashes (–) in What’s New. Use a comma, a period, or a hyphen.
Leave `forceShow` **false**. Do not auto-open What’s New. Never open it over the welcome screen (region/route pick). Commuters open it from Options.

## How to update the Firebase dump (Windows)

PowerShell is not `cmd`. Do not use `copy /Y`.

```powershell
New-Item -ItemType Directory -Force -Path public\data | Out-Null
Copy-Item -Force "C:\Users\enock\OneDrive\Documents\GitHub\Train Schedule\Source Code\data\full-database.json" "public\data\full-database.json"
git add public/data/full-database.json
git commit -m "Update Firebase schedule dump."
git push origin main
```

## Testing

Run the existing verify scripts that match the change (`npm run verify:alerts`, `verify:schedule`, `verify:urls`, …). Do not add walkthrough videos or screenshot demos unless the owner asks.

Production is **not** updated by a `main` push of app code until **Deploy production → metrorail-app** runs. Preview (github.io) deploys from `main` automatically.
