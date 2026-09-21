# nexttrain-edge (detached)

Hashed `/_astro/*` and `/icons/*` on `nexttrain.co.za` now get long `Cache-Control` from **Cloudflare Cache Rules + response header transforms**, not this Worker. GitHub Pages still sends `max-age=600`; the zone rules override that without a Worker invocation.

HTML stays off these rules. `/sw.js` and `/app-version.json` are **bypass + no-store** so PWA/TWA Check for Updates and NUKE are not stuck on a 10-minute origin cache.

Admin NUKE still:

1. Writes `config/killswitch.json` (online clients wipe SW + Cache Storage)
2. Purges Cloudflare (`POST /admin/purge-cloudflare-cache`)

## Apply (once, or after editing `zone-rules.json`)

Token needs **Zone → Cache Rules → Edit** and **Zone → Transform Rules → Write** on `nexttrain.co.za`. Detach also needs **Zone → Workers Routes → Edit**.

```bash
# Preview merge only
node scripts/apply-nexttrain-edge-cache-rules.mjs --dry-run

CLOUDFLARE_API_TOKEN=… node scripts/apply-nexttrain-edge-cache-rules.mjs --detach-worker
```

Or GitHub Actions: **Apply nexttrain-edge cache rules** (`workflow_dispatch`).

`wrangler.jsonc` routes stay **empty**. Do not re-attach this Worker unless rolling back.

## Rollback

1. Put the four routes back in `wrangler.jsonc`.
2. `cd workers/nexttrain-edge && npx wrangler deploy`
3. Disable or delete the `nt-edge-*` Cache Rules and transforms in the dashboard (or re-run the apply script after removing them from `zone-rules.json`).
