# Next Train live strategy — board-first ops

Winning loop: **structured delay reports on the board → lean route chat → station check-in**. Do not rush continuous GPS / Mapbox fleets.

## Default pilot corridors

| routeId | Region | Why |
|---------|--------|-----|
| `pta-pien` | GP | Flagship / brand density |
| `pta-mabopane` | GP | High WhatsApp culture |
| `ct-bellv` | WC | WC flagship |

Seed file: [`config-features-pilot.json`](./config-features-pilot.json) (also exported as `PILOT_FEATURES_SEED` from [`src/lib/features.js`](../src/lib/features.js)).

## Wave status

| Wave | What | Status |
|------|------|--------|
| 1 | Board live chips (pending / verified / thumbs / EXP) + RTDB listeners | Shipped (lab on; prod via flags) |
| 1 flags | `config/features` allow-list for 3 pilots | Ops: paste seed JSON |
| 2 | Community Worker write bouncer + `limitToLast(10)` + 24h TTL | Shipped in repo (`workers/nexttrain-community`) |
| 3 | Station-first `ride_pings` last-seen chips | Shipped (flag `rideCheckIn`) |
| 4 | Historical delay index, FCM fanout, TWA | **Deferred** — only after density metrics |

## Enable pilots in production RTDB

1. Deploy rules from this branch (`firebase deploy --only database`).
2. Firebase Console → Realtime Database → `config/features` → paste [`config-features-pilot.json`](./config-features-pilot.json).
3. Smoke on `nexttrain.co.za`: open `pta-pien` → Report status chip; Community tab realtime; optional check-in chip.
4. Kill switch: set any feature `"enabled": false` (or clear `routeIds`).

Lab (`lab.nexttrain.co.za` / `PUBLIC_LAB_MODE=true`) defaults **all features on** even if RTDB is empty.

## Community Worker (Wave 2)

See [`workers/nexttrain-community/README.md`](../workers/nexttrain-community/README.md).

- Client posts to `PUBLIC_COMMUNITY_WORKER_URL` when set; otherwise direct RTDB (lab/dev).
- Feed uses `limitToLast(10)`; listener torn down on Community leave / tab hide.
- Cron wipes posts older than **24h** (pilot TTL).

## Ride check-in (Wave 3)

- Node: `ride_pings/{routeId}/{deviceId}` — station-first, ~18 min TTL, one ride per device.
- Board shows soft “Last seen at {station} · Xm ago” (no GPS trails).
- Gated by `rideCheckIn`.

## Wave 4 — deferred moat (do not build yet)

Only after pilot metrics look healthy (reports/day, verify rate, chat posts, moderation load, check-in density):

1. **Historical Delay Index** — nightly anonymized aggregates → D1/R2 (“Typically ~7 min late”).
2. **FCM fanout** — Worker/Cloud Function: `delay_reports` / notices → `push_subscriptions` by `routeIds` (client token registration already exists).
3. **TWA / Play Foreground Service** — background tracking wrapper **only if** Waves 1–3 prove demand; POPIA + battery cost otherwise.

## Kill-switch checklist

1. RTDB `config/features` → disable flag(s).
2. Optional: undeploy / pause `nexttrain-community` Worker.
3. Optional: set `PUBLIC_COMMUNITY_WORKER_URL=` empty and rebuild (falls back to direct writes).
4. Rules stay strict; turning flags off hides UI and stops new listeners.
