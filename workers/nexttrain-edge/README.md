# nexttrain-edge

`/sw.js` and `/app-version.json` are on this Worker with **no-store**. HTML is **not** on these routes.

Hashed `/_astro/*` and `/icons/*` are **not** Worker routes. Each of those files was one Workers request, and that route was most of the account's 100,000 request day. Long `Cache-Control` for them lives in `zone-rules.json` (Cache Rules + header transforms). Until those rules are applied, GitHub Pages sends `max-age=600`. Observability is off on this Worker. Admin NUKE still:

1. Writes `config/killswitch.json` (online clients wipe SW + Cache Storage)
2. Purges Cloudflare (`POST /admin/purge-cloudflare-cache`)

## Deploy

```bash
cd workers/nexttrain-edge
npx wrangler deploy
```

Requires a Cloudflare account that can attach routes on the `nexttrain.co.za` zone.

`zone-rules.json` and `scripts/apply-nexttrain-edge-cache-rules.mjs` set the long browser cache without putting `/_astro/` or `/icons/` back on a Worker. The script leaves the `sw.js` and `app-version.json` routes in place.
