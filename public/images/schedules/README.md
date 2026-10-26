# Image schedules (PRASA / Metrorail sheets)

Canonical **printed timetable images** that back the in-app schedule dump. Keep the JPGs here; the live board still reads Firebase / Cloudflare / `public/data/`. These pictures are the human-readable source we can check against and, later, post from Alerts.

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
{region}-{corridor}-{day}-{direction}[-{effective}][-{part}].jpg
```

| Part | Values |
| --- | --- |
| `region` | `wc`, `gp`, `kzn`, `ec` |
| `corridor` | `southern`, `northern`, `central`, `cape-flats`, `monte-vista`, `stellenbosch`, `berea-kwamashu`, `crossmoor`, `pinetown`, `naledi`, `leralla`, `lenz`, … |
| `day` | `weekday`, `saturday`, `sunday`, `weekend`, `public-holiday` (GP “Saturday & Public Holidays” notices use `saturday` and say so in notes) |
| `direction` | `inbound` (toward Cape Town / Durban / Pretoria / Johannesburg hub), `outbound` (away), `combined` (both directions on one poster or notice) |
| `effective` | `YYYY-MM-DD` when the sheet says “Effective from …”; `YYYY-MM` when only a month is printed; omit when the sheet has no date |
| `part` | Optional. Booklet page (`p32`); `early` / `later` when one service is split across posters; **`grid`** (full station×train table) or **`departures`** (train number + origin departure list only) |

Examples:

- `wc/wc-southern-weekday-inbound-2026-02-02.jpg`
- `wc/wc-stellenbosch-weekday-outbound-2026-10-12-early.jpg`
- `wc/wc-northern-public-holiday-2026.jpg` (combined in+out on one poster)
- `kzn/kzn-berea-kwamashu-weekday-outbound-2026-10-05-p32.jpg`
- `kzn/kzn-umlazi-weekday-outbound-2026-10-05-p52.jpg`
- `gp/gp-naledi-saturday-combined-2026-09-12-grid.jpg`
- `gp/gp-leralla-saturday-combined-2026-08-22-departures.jpg`

## Adding more sheets

1. Drop the JPG under the region folder with the naming rule above.
2. Add one object to `manifest.json` `sheets` (see fields there).
3. Commit and push `main` so GitHub Pages / the dump host get the files.
4. **Effective dates:** if a newer sheet arrives for the same corridor / day / direction, keep the old file and add the new dated name. Prefer the newest effective date when comparing to the live dump.
5. **KZN (and multi-page books):** when two pages cover the same route and day but different train columns, platforms, or detail, **keep both** (use `p{N}` or `early`/`later`). Do not drop a page because another “looks the same.”
6. **Grid vs departure notices:** GP (and any region) often ships a full station grid and a separate departure-only list for the same corridor / day. **Keep both.** Never replace a `grid` with a `departures` sheet or the reverse; tag `part` as `grid` or `departures`.
7. Exact byte duplicates of an already-filed sheet can be skipped (note in the commit).

## Alerts (later)

Catalog safety posters stay in `public/images/alerts/`. Schedule sheets are allowlisted under `/images/schedules/` so a notice can use them once the compose picker lists this manifest.

Do not copy schedule JPGs into `alerts/` (duplicate bytes and drift). Point at `/images/schedules/...` instead.
