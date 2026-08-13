# nexttrain-community — write bouncer + TTL wipe

Cloudflare Worker that:

1. **`POST /community/post`** — verifies Firebase ID token, rate-limits, refuses non-`nexttrain.co.za` URLs and profanity, writes via service-account Admin access to RTDB.
2. **Hourly cron** — deletes `route_community/*/posts/*` older than 24h (pilot TTL).

## Deploy

```bash
cd workers/nexttrain-community
npx wrangler deploy
# Secret (same SA private key used by telemetry is fine if it has RTDB Admin):
npx wrangler secret put FIREBASE_PRIVATE_KEY
```

Optional: set `FIREBASE_CLIENT_EMAIL` in `wrangler.jsonc` / dashboard if different from the telemetry SA.

## App wiring

Build with:

```bash
PUBLIC_COMMUNITY_WORKER_URL=https://nexttrain-community.<account>.workers.dev
```

Empty URL → client writes RTDB directly (lab/dev).

## Kill switch

Pause the Worker in Cloudflare, or clear `PUBLIC_COMMUNITY_WORKER_URL` and rebuild. Corridor UI still gated by `config/features.communityRealtime`.
