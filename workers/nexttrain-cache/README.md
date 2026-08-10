# nexttrain-cache (Cloudflare Edge schedule proxy)

Worker URL: `https://nexttrain-cache.enock.workers.dev/`

## Why V2

Live worker rejects requests without an allowlisted `Origin`. After the Astro cutover, admin diagnostics on **GitHub Pages** (`https://enock-elk.github.io`) received `403 Unauthorized Domain`, so Cache Propagation / Deep Network Scan showed Cloudflare **Fetch Failed**.

V2 keeps the origin gate (do not use `*`) and adds:

- `https://enock-elk.github.io`
- local Astro ports (`4321`, `3000`, `5500`)
- production `https://nexttrain.co.za`

## Deploy

1. Cloudflare Dashboard → Workers → `nexttrain-cache` (or create it).
2. Paste / sync [`worker.js`](./worker.js).
3. Bind env `PURGE_SECRET` (same value admin purge uses).
4. Confirm route: `nexttrain-cache.enock.workers.dev/*`.

Verify from preview:

```bash
curl -sS -H 'Origin: https://enock-elk.github.io' \
  'https://nexttrain-cache.enock.workers.dev/schedules/gauteng.json' | head -c 80

curl -sS -H 'Origin: https://evil.example' \
  'https://nexttrain-cache.enock.workers.dev/schedules/gauteng.json'
# → {"error":"Access Denied: Unauthorized Domain"}
```

## Note on SPA `cache.txt`

`metrorail-app/tools/Cloudflare-Workers/cache.txt` still documents `Access-Control-Allow-Origin: *` without an origin gate. **Production already runs a hardened allowlist** — this folder is the Astro-era source of truth for that live behavior plus the GitHub Pages origin.
