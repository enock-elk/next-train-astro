# Lab line — independent test URL for realtime features

## Purpose

Ship **community chatroom + realtime alerts** on a long-lived `lab` branch without blocking live fixes on `main` / `nexttrain.co.za`.

| Line | Branch | URL | Role |
|------|--------|-----|------|
| Live | `main` | https://nexttrain.co.za | Production (via `metrorail-app`) |
| Preview | `main` | https://enock-elk.github.io/next-train-astro/ | Auto preview of live line |
| Lab | `lab` | https://lab.nexttrain.co.za | Experiment / tester link |

## One-time setup (lab URL)

### A. Cloudflare Pages (recommended)

1. Cloudflare → **Workers & Pages** → Create → Connect `enock-elk/next-train-astro`.
2. Project name: `next-train-lab`.
3. Production branch: `lab`.
4. Build command: `npm ci && npm run build`
5. Build env vars:
   - `PUBLIC_SITE_URL=https://lab.nexttrain.co.za`
   - `PUBLIC_BASE_PATH=/`
   - `PUBLIC_LAB_MODE=true`
   - `PUBLIC_FIREBASE_VAPID_KEY=` (Web Push key from Firebase Console → Project settings → Cloud Messaging)
   - `PUBLIC_CARTO_API_KEY=` (CARTO Voyager raster key — Production **and** Preview; never commit)
6. Output directory: `dist`
7. Custom domain: `lab.nexttrain.co.za` (CNAME as Cloudflare instructs).

### B. GitHub Actions direct upload (optional)

Workflow: [`.github/workflows/deploy-lab.yml`](../.github/workflows/deploy-lab.yml)

Repo secrets:

- `CLOUDFLARE_API_TOKEN` — Pages Edit
- `CLOUDFLARE_ACCOUNT_ID`
- `PUBLIC_FIREBASE_VAPID_KEY` (optional until push is fully wired)
- `PUBLIC_CARTO_API_KEY` (CARTO Voyager raster; also set on the Pages project for Git previews)

Without Cloudflare secrets the workflow still **builds + uploads a `lab-dist` artifact**.

## Parallel local folders (worktrees)

```bash
# From the Astro repo root (Source Code / this checkout)
git fetch origin
git branch lab origin/lab 2>/dev/null || git branch lab main
git worktree add ../lab lab
```

Result:

```text
.../Metrorail Next Train/Source Code   → main   (live fixes)
.../Metrorail Next Train/lab           → lab    (new features)
```

In this Cloud Agent checkout a worktree also lives at `.worktrees/lab`.

## Git hygiene

1. Weekly (or before big lab work): merge `main` → `lab`.
2. When features are ready: PR `lab` (or feature branch) → `main`.
3. Production deploy as today (`deploy-production.yml` → `metrorail-app`).
4. Keep prod **feature flags off**, then enable pilot corridors in RTDB (see below).

## Feature flags (`config/features`)

Client: [`src/lib/features.js`](../src/lib/features.js)

- **Lab** (`PUBLIC_LAB_MODE=true` or host `lab.*`): missing config → all features **on**.
- **Production**: missing config → all features **off** (safe merge).

Paste the default pilot seed: [`config-features-pilot.json`](./config-features-pilot.json) (3 corridors). Full ops: [`PHASE-LIVE-STRATEGY.md`](./PHASE-LIVE-STRATEGY.md).

Nationwide later: set `"routeIds": ["*"]`. Killswitch: `"enabled": false`.

Deploy rules after pulling this branch so `config/features` is publicly readable and `push_subscriptions` / `ride_pings` accept device writes.

## Pilot corridors (default)

| Region | routeId | Why |
|--------|---------|-----|
| GP | `pta-pien` | Flagship / brand |
| GP | `pta-mabopane` | High volume / WhatsApp culture |
| WC | `ct-bellv` | WC flagship |

Add `kzn-umlazi` later if Clarity/GA shows density.

## Merge to main checklist

1. Lab smoke: board, community realtime, delay report UI, notify toggle.
2. PR into `main` — flags still default **off** on prod hostname.
3. Deploy production → `metrorail-app`.
4. Write `config/features` allow-list for pilot routes.
5. Measure 1–2 weeks → widen to `"*"`.

## Tracking (deferred)

GPS / `train_positions` is **out of scope** until chat + alerts show sustained engagement on pilot corridors. Crowd delay reports are the soft-live layer for now. Resume tracking design on `lab` after a post-merge reset from `main`.

## Firebase

Lab shares the production Firebase project so rooms and notices feel real. Tester posts appear in the same `route_community` paths. If noise becomes a problem, add a `PUBLIC_COMMUNITY_ROOT` prefix later.
