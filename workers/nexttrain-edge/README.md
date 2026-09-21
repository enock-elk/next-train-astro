# nexttrain-edge

Sets long `Cache-Control` on hashed `/_astro/*` chunks and `/icons/*` for `nexttrain.co.za`. GitHub Pages otherwise sends `max-age=600`, which PageSpeed flags as "Use efficient cache lifetimes".

`/sw.js` and `/app-version.json` are on this Worker with **no-store**. HTML is **not** on these routes. Admin NUKE still:

1. Writes `config/killswitch.json` (online clients wipe SW + Cache Storage)
2. Purges Cloudflare (`POST /admin/purge-cloudflare-cache`)

## Deploy

```bash
cd workers/nexttrain-edge
npx wrangler deploy
```

Requires a Cloudflare account that can attach routes on the `nexttrain.co.za` zone.

`zone-rules.json` and `scripts/apply-nexttrain-edge-cache-rules.mjs` are a later Cache Rules cutover. **Do not run the apply script** while this Worker is attached — the two would fight.
