# Image schedules (PRASA / Metrorail sheets)

Canonical **printed timetable images** that back the in-app Western Cape (and later GP / KZN / EC) schedule dump. Keep the JPGs here; the live board still reads Firebase / Cloudflare / `public/data/`. These pictures are the human-readable source we can check against and, later, post from Alerts.

## Layout

```
public/images/schedules/
  README.md
  manifest.json          # index of every filed sheet
  wc/                    # Western Cape
  gp/                    # Gauteng (add when sheets arrive)
  kzn/
  ec/
```

## File names

```
{region}-{corridor}-{day}-{direction}[-{effective}].jpg
```

| Part | Values |
| --- | --- |
| `region` | `wc`, `gp`, `kzn`, `ec` |
| `corridor` | `southern`, `northern`, `central`, `cape-flats`, `monte-vista`, … |
| `day` | `weekday`, `saturday`, `sunday`, `public-holiday` |
| `direction` | `inbound` (toward Cape Town / main hub), `outbound` (away) |
| `effective` | `YYYY-MM-DD` when the sheet says “Effective from …”; `YYYY-MM` when only a month is printed; omit when the sheet has no date |

Examples already filed:

- `wc/wc-southern-weekday-inbound-2026-02-02.jpg`
- `wc/wc-monte-vista-weekday-outbound-2025-10.jpg`
- `wc/wc-central-saturday-outbound.jpg` (no effective date on the sheet)

## Adding more sheets

1. Drop the JPG under the region folder with the naming rule above.
2. Add one object to `manifest.json` `sheets` (see fields there).
3. Commit and push `main` so GitHub Pages / the dump host get the files.
4. Do **not** overwrite an older effective date in place — keep the old file and add a new dated name when PRASA reissues a sheet.

## Alerts (later)

Catalog safety posters stay in `public/images/alerts/`. Schedule sheets are allowlisted under `/images/schedules/` so a notice can use them once the compose picker lists this manifest. Until that UI lands, operators can still attach a sheet by path if the alert image allowlist accepts it.

Do not copy schedule JPGs into `alerts/` (duplicate bytes and drift). Point at `/images/schedules/...` instead.
