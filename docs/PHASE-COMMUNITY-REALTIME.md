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

## Tracking later

Do not build `train_positions` until pilot metrics (posts/day, delay confirms, push opt-in, moderation load) look healthy. See [PHASE-LAB-LINE.md](./PHASE-LAB-LINE.md).
