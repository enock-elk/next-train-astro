# SPA vs Astro parity checklist

Legend: **DONE** · **PARTIAL** · **MISSING** · **ASTRO-ONLY**

## Shipped

| ID | Item | Status |
|----|------|--------|
| GAP-001 | Exit modal + PWA `#exit` trap | **DONE** |
| GAP-002 / 015 | OfflineTracker | **DONE** |
| GAP-003 / 019 | Notice polls | **DONE** |
| GAP-004 | Leave-app redirect modal | **DONE** |
| GAP-005 | Share: “Say Goodbye to Waiting…” | **DONE** |
| GAP-006 | Planner schedule share (day + dest) | **DONE** |
| GAP-007 | Clipboard toast (no `alert`) | **DONE** |
| GAP-008 / 017 | Clarity re-identify + `crm_region` | **DONE** |
| GAP-009 | Ad 8-strike + one-shot foreground reset | **DONE** |
| GAP-010–014 | About edition/email analytics; welcome polish | **DONE** |
| GAP-016 | Escalate safe payloads | **DONE** |
| GAP-018 | Boot overlay / hide main until ready | **DONE** |
| UI | Sidenav width, fare height, Plan Trip, maint strip, route SVG | **DONE** |
| Admin | Ban lookup, mojibake, blackbox copy/full escalate, diag errors modal | **DONE** |
| Admin | Dead-ends day/time, export-all, trip-plan batches | **DONE** |
| Planner | Specific calendar day option; sim mode store bridge | **DONE** |

## Remaining

| Item | Status |
|------|--------|
| Expand SEO route pages 20–50 | ASTRO-ONLY |
| More grid `↔` → SVG | PARTIAL |
| TWA / Play | PARTIAL — DAL + Bubblewrap config in-repo (`docs/TWA-PLAY-STORE.md`); Play Console listing / signed AAB upload still ops |

## Ops notes

- **Maintenance banner:** Relative strip *under* the header (not absolute under translucent header) — full hazard text, hamburger unmoved and clickable.
- **Sim mode:** Admin `window.isSimMode` / `simTimeStr` / `simDayIndex` bridged into `$isSimMode` / `$simTime`; `updateTime` reads sim day + optional `#sim-date` for holidays.
- **Dead-ends double-count:** Client debounces identical fails for 45s; hits = logged attempts after debounce. Aggregation key includes `dayType`.
- **Trip plan flush @ 10:** Yes — good write-cost strategy. Batches land in `sys_logs/trip_plans/` (Dead Ends → Trip Plans tab).
