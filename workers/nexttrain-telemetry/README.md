# nexttrain-telemetry

Worker URL: `https://nexttrain-telemetry.enock.workers.dev/`

## Routes

- `GET /region` — first-visit province → product region guess
- GET `/` (Bearer admin) — GA / Sentry / Clever telemetry payload (V1.11: INTRADAY through latest GA4 bucket; ALL-time months from Jan 2026; regional `sessions` alongside unique users)
- `POST /admin/deploy-production` (Bearer Firebase admin, body `{ "confirm": "DEPLOY", "dryRun": false }`) — start GitHub Actions **Deploy production → metrorail-app**
- `GET /admin/deploy-status` (Bearer Firebase admin, optional `run_id` / `since`) — GitHub job status + `metrorail-app` `astro-deploy.json`
- `POST /admin/purge-cloudflare-cache` (Bearer Firebase admin) — Cloudflare zone **Purge Everything** (dashboard equivalent)
- `POST /admin/purge` (Bearer Firebase admin) — clears this Worker’s short telemetry cache only (legacy admin path; does **not** purge the zone CDN)

## Secrets

| Name | Purpose |
|---|---|
| `GA_PRIVATE_KEY` | GA Data API service account key |
| `SENTRY_AUTH_TOKEN` | Sentry stats |
| `CF_API_TOKEN` | Cloudflare API token with **Zone → Cache Purge → Purge** on `nexttrain.co.za` |
| `GH_ACTIONS_TOKEN` | Fine-grained GitHub PAT: **Actions: Read and write** on **`enock-elk/next-train-astro` only** |

Create the cache-purge token: Cloudflare Dashboard → My Profile → API Tokens → Create Token → custom token with Zone.Cache Purge on `nexttrain.co.za`, then:

```bash
cd workers/nexttrain-telemetry
npx wrangler secret put CF_API_TOKEN
```

### GitHub Actions token (one-time, required for Publish live)

This is **not** the existing `METRORAIL_APP_DEPLOY_TOKEN` (that one can rewrite the live host). The Worker only needs permission to **start and read** the workflow; the workflow still uses the repo secret to push `metrorail-app`.

1. Sign in to GitHub as Enock.
2. Click your avatar → **Settings** (your account, not the repo).
3. Left sidebar: **Developer settings** → **Personal access tokens** → **Fine-grained tokens**.
4. **Generate new token**.
5. Name: `nexttrain-telemetry-deploy-dispatch`. Expiration: 90 days or 1 year (set a calendar reminder to rotate).
6. Resource owner: **enock-elk**.
7. Repository access: **Only select repositories** → **next-train-astro** (do **not** add `metrorail-app`).
8. Repository permissions:
   - **Actions:** Read and write
   - **Contents:** Read-only (helps GitHub list the workflow file)
9. Generate and **copy the token once** (GitHub will not show it again).
10. On your PC, in a terminal:

```bash
cd path/to/next-train-astro/workers/nexttrain-telemetry
npx wrangler login
npx wrangler secret put GH_ACTIONS_TOKEN
```

Paste the token when prompted. Then deploy this Worker:

```bash
npx wrangler deploy
```

If Publish live returns 502 / “GitHub Actions API failed” with 403, edit the token and confirm Actions is Read and write on `next-train-astro`.

## Deploy

```bash
cd workers/nexttrain-telemetry
npx wrangler deploy
```
