# Community realtime + alerts — ops notes

## What shipped on lab

1. **Realtime route chat** — `communityRealtime` flag → Firebase `onValue` on `route_community/{routeId}/posts` ([`src/lib/community.js`](../src/lib/community.js)).
2. **Delay report UI** — corridor-gated via `delayReportsUi` ([`src/lib/delay-reports.js`](../src/lib/delay-reports.js)).
3. **Push wiring** — Settings notify → FCM token when `PUBLIC_FIREBASE_VAPID_KEY` is set ([`src/lib/push-notify.js`](../src/lib/push-notify.js)); tokens stored at `push_subscriptions/{deviceId}`.
4. **Feature gate** — [`src/lib/features.js`](../src/lib/features.js) + RTDB `config/features`.

## Server push (follow-up)

Client registration is in place. Sending pushes still needs a small Cloud Function / Worker that:

- listens to `delay_reports` / `notices` writes, and
- fans out to `push_subscriptions` tokens filtered by `routeIds`.

Until that sender exists, users still get in-app surfaces + browser permission; FCM delivery of remote events is incomplete.

## Chat fortress (Wave 2)

- Feed cap: `limitToLast(10)` in [`src/lib/community.js`](../src/lib/community.js); listener destroyed on Community leave / tab hide.
- Client filters posts older than **24h**; Worker cron deletes stale RTDB nodes.
- Write path: Cloudflare Worker [`workers/nexttrain-community`](../workers/nexttrain-community) (`POST /community/post`) when `PUBLIC_COMMUNITY_WORKER_URL` is set — rate limit, sanitize (strip HTML / foreign URLs; allow `nexttrain.co.za`), Admin RTDB write.
- Direct client RTDB writes remain as lab/dev fallback when the Worker URL is empty.

## Tracking later (Wave 4)

Do not build continuous GPS / `train_positions` / TWA until pilot metrics (posts/day, delay confirms, push opt-in, moderation load, check-ins) look healthy. See [PHASE-LIVE-STRATEGY.md](./PHASE-LIVE-STRATEGY.md) and [PHASE-LAB-LINE.md](./PHASE-LAB-LINE.md).
