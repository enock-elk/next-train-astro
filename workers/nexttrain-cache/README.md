# nexttrain-cache (Cloudflare Edge schedule proxy)

Worker URL: `https://nexttrain-cache.enock.workers.dev/`

This folder tracks the **active production worker** (origin firewall + 24h schedule cache + `/admin/purge`), with one Astro-era addition:

- Allowlist entry: `https://enock-elk.github.io`  
  so GitHub Pages preview can run admin Cache Propagation / Deep Network Scan against Cloudflare.

Everything else matches the live Guardian firewall worker (Referer fallback, `startsWith` localhost allowlist, reflected `Access-Control-Allow-Origin`, purge server-to-server only).

## Deploy

1. Cloudflare Dashboard → Workers → `nexttrain-cache`.
2. Replace script with [`worker.js`](./worker.js) (keep env `PURGE_SECRET`).
3. Verify:

```bash
# Preview origin — must be 200
curl -sS -D - -o /dev/null -H 'Origin: https://enock-elk.github.io' \
  'https://nexttrain-cache.enock.workers.dev/schedules/gauteng.json' | head -15

# Random origin — must be 403 Unauthorized Domain
curl -sS -H 'Origin: https://evil.example' \
  'https://nexttrain-cache.enock.workers.dev/schedules/gauteng.json'
```
