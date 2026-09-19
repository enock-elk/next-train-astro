# R2 images and trip-plan RTDB bloat

Later implementation plan. **This build does not change the live write path.** Commuter trip plans still PUT `sys_logs/trip_plans/$batchId` every 10 searches. Catalog posters still live at `/images/alerts/`. Operator-posted Storage URLs still load as they do today.

Do this in a dedicated follow-up after the live board, Map yaw, and Alerts full-view fixes have shipped and been watched.

## Why RTDB is bloating

Planner telemetry is create-once and never expires:

- `sys_logs/trip_plans/$batchId` — full trip objects, flush of 10 (`src/lib/planner-telemetry.js`)
- `sys_logs/trip_plan_users/$deviceId` — first/last seen index
- `sys_logs/trip_plan_pairs/$origin~$dest` — unique OD index

Admin Dead Ends → Trip Plans does a full `GET sys_logs/trip_plans.json`. Around 20 000 batches makes that download huge, slow, and easy to time out. Indexes are small; the batch bodies are the problem.

Fare votes (`sys_logs/fare_votes`) and routing fails are separate. Do not mix them into this cleanup.

## Trip plans — later, without dropping live writes

Keep the client PUT exactly where it is until a dual-write has been proven.

1. **Export once.** Operator download of `trip_plans.json` (existing CSV/TXT in Dev Hub) plus a one-shot script to R2 prefix `telemetry/trip-plans/YYYY/MM/{batchId}.json`. Do not delete RTDB until the R2 copy checksums.
2. **Cold archive.** After export, a Worker cron (allowlisted admin / secret) copies batches older than 90 days to R2 and deletes those RTDB nodes. Keep `trip_plan_users` and `trip_plan_pairs` in RTDB (tiny, useful).
3. **Admin read.** Dev Hub Trip Plans lists recent RTDB (e.g. last 14 days via `orderByChild('flushedAt')` + index) and an “Older” button that reads R2 through the Worker. Never `GET` the whole `trip_plans.json` again.
4. **Rules.** Add `.indexOn: ["flushedAt"]` on `trip_plans`. Deletion only from the Worker secret / operator emails. Client create-once stays.
5. **Only then** consider writing new batches straight to R2. Dual-write RTDB+R2 for a week first. If R2 fails, RTDB still lands. Do not stop the current PUT in the same change as the archive job.

Suggested shape (later, not now):

```
sys_logs/trip_plans/$batchId     // hot, ~14–90 days
r2://nexttrain-telemetry/trip-plans/2026/09/{batchId}.json
```

Out of scope for that follow-up: changing `TRIP_FLUSH_SIZE`, dropping anonymous create-once, or rewriting fare votes.

## Alert / catalog images — R2 later

Today:

- Catalog JPGs: GitHub `public/images/alerts/` (same-origin, fine).
- Operator / WhatsApp posters: Firebase Storage URLs, often large, CORS-tainted, slow on mobile data. Full view was re-encoding those with `canvas.toDataURL` (fixed in V9_09.19.12 to reuse the feed `currentSrc`).

Target (do not cut over in this build):

1. **R2 bucket** `nexttrain-media` (custom domain later, not a new public `img.` host on day one).
2. **Upload in Dev Hub** writes the original to `alerts/original/{id}.jpg` and a baked **720px wide ~70–80 quality JPEG** to `alerts/feed/{id}.jpg`. Feed and full view both use the 720px object. Original is operator-only.
3. **Same-origin Worker** on `nexttrain.co.za/img/alerts/...` (see `workers/nexttrain-img/` stub). Cache-Control 30 days, immutable hash in the path. No Firebase Storage on the commuter path.
4. **Catalog stays** `/images/alerts/` in this repo. Do not put catalog on R2 until the operator path is proven.
5. **Do not** add a second CDN hostname until Cloudflare cache + Worker are green. Extra DNS/CORS cost for little gain.
6. Cloudflare Images (resize on the fly) is optional after R2 originals exist. Skip it for the first cutover.

Client change when ready: composer `imageUrl` becomes `/img/alerts/feed/{id}.jpg` (or the GitHub catalog path). Notices already in RTDB keep their Storage URLs until an operator re-save or a one-time rewrite script.

## What this repo may contain now (foundation only)

- This document.
- `workers/nexttrain-img/` stub Worker: documents the `/img/` contract, returns 404, **not** in production workflows.
- Comment on the live trip_plans PUT so nobody “helpfully” moves it.

## Must not happen in the foundation pass

- Changing `DYNAMIC_BASE_URL` trip_plans writes.
- Emptying `sys_logs/trip_plans`.
- Pointing Alerts at a bucket that is not created yet.
- A new public image subdomain.
- Shrinking `/_astro/` retention or touching FOUC plumbing.
