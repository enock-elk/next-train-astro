# nexttrain-telemetry

Worker URL: `https://nexttrain-telemetry.enock.workers.dev/`

## Routes

- `GET /region` — first-visit province → product region guess
- GET `/` (Bearer admin) — GA / Sentry / Clever telemetry payload (V1.11: INTRADAY through latest GA4 bucket; ALL-time months from Jan 2026; regional `sessions` alongside unique users)
- `POST /admin/purge-cloudflare-cache` (Bearer Firebase admin) — Cloudflare zone **Purge Everything** (dashboard equivalent)
- `POST /admin/purge` (Bearer Firebase admin) — clears this Worker’s short telemetry cache only (legacy admin path; does **not** purge the zone CDN)

## Secrets

| Name | Purpose |
|---|---|
| `GA_PRIVATE_KEY` | GA Data API service account key |
| `SENTRY_AUTH_TOKEN` | Sentry stats |
| `CF_API_TOKEN` | Cloudflare API token with **Zone → Cache Purge → Purge** on `nexttrain.co.za` |

Create the cache-purge token: Cloudflare Dashboard → My Profile → API Tokens → Create Token → custom token with Zone.Cache Purge on `nexttrain.co.za`, then:

```bash
cd workers/nexttrain-telemetry
npx wrangler secret put CF_API_TOKEN
```

## Deploy

```bash
cd workers/nexttrain-telemetry
npx wrangler deploy
```
