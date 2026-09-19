# nexttrain-img (stub)

Not deployed. Do not add this to production or lab workflows until the R2 bucket and `/img/` route exist.

Future contract:

- `GET https://nexttrain.co.za/img/alerts/feed/{id}.jpg` — 720px baked poster for the Alerts feed and full view
- `GET /img/alerts/original/{id}.jpg` — operator-only original
- R2 key prefix `alerts/`
- Long cache, same-origin, no Firebase Storage on the commuter path

Catalog posters stay at `/images/alerts/` in this repo.

See `docs/R2-AND-TRIP-PLANS.md`.
