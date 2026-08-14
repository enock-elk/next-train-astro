# nexttrain-edge

Sets long `Cache-Control` on hashed `/_astro/*` chunks and `/icons/*` for `nexttrain.co.za`. GitHub Pages otherwise sends `max-age=600`, which PageSpeed flags as "Use efficient cache lifetimes".

HTML, `sw.js`, and `app-version.json` are **not** on these routes. Admin NUKE still:

1. Writes `config/killswitch.json` (online clients wipe SW + Cache Storage)
2. Purges Cloudflare (`POST /admin/purge-cloudflare-cache`)

## Deploy

```bash
cd workers/nexttrain-edge
npx wrangler deploy
```

Requires a Cloudflare account that can attach routes on the `nexttrain.co.za` zone.
