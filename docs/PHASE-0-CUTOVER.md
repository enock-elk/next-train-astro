# Phase 0 — Astro cutover + SEO seed

Ship checklist for today’s production cutover. Expand SEO later (Phase 2); this phase only proves the pattern.

## URL scheme

| Kind | Pattern | Example |
|------|---------|---------|
| App (interactive) | `/?rt={routeId}` | `/?rt=pta-pien` |
| SEO landing (static) | `/routes/{slug}.html` | `/routes/pretoria-to-pienaarspoort.html` |
| SEO index | `/routes.html` | Lists seed landings |

- `routeId` = existing `ROUTES` key in `src/lib/config.js` (unchanged for deeplinks/shares).
- `slug` = human SEO path in `src/lib/seo-routes.js` (only seed entries for now).
- Keep `.html` so output matches `astro.config` `build.format: 'file'` and current sitemap style.

## Seed routes (ship today)

| Slug | Route ID | Region | Why |
|------|----------|--------|-----|
| `pretoria-to-pienaarspoort` | `pta-pien` | GP | Flagship / highest brand association |
| `pretoria-to-kempton-park` | `pta-kempton` | GP | Classic long-tail (“Pretoria to Kempton Park”) |
| `pretoria-to-mabopane` | `pta-mabopane` | GP | High-volume Pretoria corridor |
| `cape-town-to-bellville` | `ct-bellv` | WC | Flagship WC pair |
| `durban-to-umlazi` | `kzn-umlazi` | KZN | Flagship KZN pair |

Source of truth: `src/lib/seo-routes.js` → pages via `src/pages/routes/[slug].astro`.

## Files

| File | Role |
|------|------|
| `docs/PHASE-0-CUTOVER.md` | This checklist |
| `src/lib/seo-routes.js` | Seed catalog + helpers |
| `src/pages/routes/[slug].astro` | One HTML page per seed slug |
| `src/pages/routes.astro` | `/routes.html` index + internal links |
| `public/sitemap.xml` | Core pages + seed route URLs |

Later (not today): province pages, station pages, auto-sitemap from all `ROUTES`, bulk generation.

## Cutover polish (must be green)

- [x] Fare card: no price/label overlap
- [x] Sunday day chip: red **No Service**
- [x] Weekend empty-state on routes with empty Saturday sheets
- [x] Terminus: pin + “You’re here”
- [x] Deeplinks: `?rt=` / `?plan=` open correct board/planner
- [x] Legacy SPA SW + caches cleared on first Astro boot
- [x] `APP_VERSION` / `public/app-version.json` = **V8_08.02**
- [x] Guide FAQ: holidays ≠ always Saturday
- [x] SEO seed: `/routes.html` + 5 route landings + sitemap
- [x] Maintenance banner (`config/maintenance.json`) ported
- [ ] Preview (`github.io`) stays `noindex`; production indexes
- [ ] Production deploy + GSC sitemap submit

## Deploy steps

1. Merge/push production Astro build to the host that serves `nexttrain.co.za`.
2. Confirm build emits `dist/routes/*.html` and `dist/routes.html`.
3. Smoke test mobile: GP home, one WC route, one KZN route, share link, guide.
4. In GSC: submit updated sitemap; URL-inspect 1–2 seed landings.
5. Watch Sentry/Clarity 48–72h (Phase 1).

## Done when

- Production runs Astro; WhatsApp `?rt=` / `?plan=` links still work.
- Five seed landings return 200 with unique title/H1 and CTA into `/?rt=…`.
- Sitemap lists those five URLs.
- No P0 blank-board / SW reload loops in first day.

## Explicitly later

- Full 20–50 route SEO farm (Phase 2)
- TWA / Play Store (Phase 3)
- Community retention (Phase 4)
