# Image schedules (PRASA / Metrorail sheets)

Canonical **printed timetable images** that back Next Train in-app schedules. Keep the JPGs here; the live board still reads Firebase / Cloudflare / `public/data/`. These pictures are the human-readable source we can check against and, later, post from Alerts.

Agents: `AGENTS.md` / `instructions.md` summarise intake pitfalls and known gaps. This README is the naming and filing detail.

## Layout

```
public/images/schedules/
  README.md
  manifest.json          # index of every filed sheet
  wc/                    # Western Cape
  gp/                    # Gauteng
  kzn/
  ec/                    # Eastern Cape (no JPGs filed yet as of Oct 2026)
```

## File names

```
{region}-{corridor}-{day}-{direction}[-{effective}][-{part}].jpg
```

| Part | Values |
| --- | --- |
| `region` | `wc`, `gp`, `kzn`, `ec` |
| `corridor` | `southern`, `northern`, `central`, `cape-flats`, `monte-vista`, `stellenbosch`, `berea-kwamashu`, `crossmoor`, `pinetown`, `naledi`, `leralla`, `lenz`, `pienaars`, … |
| `day` | `weekday`, `saturday`, `sunday`, `weekend`, `public-holiday` (GP “Saturday & Public Holidays” notices use `saturday` and say so in notes) |
| `direction` | `inbound` (toward Cape Town / Durban / Pretoria / Johannesburg hub), `outbound` (away), `combined` (both directions on one poster or notice) |
| `effective` | `YYYY-MM-DD` when the sheet says “Effective from …”; `YYYY-MM` when only a month is printed; omit when the sheet has no date |
| `part` | Optional. Booklet page (`p32`); `early` / `later` when one service is split across posters; **`grid`** (full station×train table) or **`departures`** (train number + origin departure list only) |

Examples:

- `wc/wc-southern-weekday-inbound-2026-02-02.jpg`
- `wc/wc-cape-flats-weekend-outbound-2025-10.jpg`
- `wc/wc-central-weekday-inbound-2026-03-02.jpg` (kept beside newer `…-2026-06-08.jpg`)
- `wc/wc-stellenbosch-weekday-outbound-2026-10-12-early.jpg`
- `wc/wc-northern-public-holiday-2026.jpg` (combined in+out on one poster)
- `kzn/kzn-berea-kwamashu-weekday-outbound-2026-10-05-p32.jpg`
- `kzn/kzn-umlazi-weekday-outbound-2026-10-05-p52.jpg`
- `gp/gp-naledi-saturday-combined-2026-09-12-grid.jpg`
- `gp/gp-leralla-saturday-combined-2026-08-22-departures.jpg`
- `gp/gp-pienaars-weekday-combined-2025-08-21-grid.jpg`

## Adding more sheets

1. Identify title, corridor, day, direction, effective date. Skip non-timetable attachments (Facebook profiles, contact flyers).
2. SHA-256 compare against every existing file under this tree. Exact byte duplicate → skip.
3. Drop the JPG under the region folder with the naming rule above.
4. Add one object to `manifest.json` `sheets` (see fields there). **Insert surgically** — do not reformat the whole JSON file.
5. Commit and push `main` so GitHub Pages / the dump host get the files.
6. Run `npm run verify:schedule-images`.
7. **Effective dates:** if a newer sheet arrives for the same corridor / day / direction, keep the old file and add the new dated name. Prefer the newest effective date when comparing to the live dump.
8. **Same effective date / undated re-export:** skip (WhatsApp recompress, lower resolution). Prefer higher-res only when replacing an undated sheet the owner asked to refresh.
9. **KZN (and multi-page books):** when two pages cover the same route and day but different train columns, platforms, or detail, **keep both** (use `p{N}` or `early`/`later`). Do not drop a page because another “looks the same.”
10. **Grid vs departure notices:** GP (and any region) often ships a full station grid and a separate departure-only list for the same corridor / day. **Keep both.** Never replace a `grid` with a `departures` sheet or the reverse; tag `part` as `grid` or `departures`.

## Day naming gotchas

- Sheets titled **WEEKEND** (Northern, Cape Flats) → `day: "weekend"`.
- Sheets titled **SATURDAY** (Central Line Saturday) → `day: "saturday"`.
- Public-holiday posters that show both directions → `day: "public-holiday"`, `direction: "combined"`.

## Known gaps (image archive only)

Refresh this list when new posters land. Live Firebase may already have times for some of these.

| Region | Still missing printed sheets |
| --- | --- |
| WC | Southern Saturday / weekend in + out; Malmesbury all days |
| EC | East London ↔ Berlin weekday in + out (`ec/` has no JPGs yet) |
| KZN | Cato Ridge; Winklespruit (weekday + Saturday) |
| GP | Irene weekday grid (Saturday departures exist) |

Not gaps: `ec-berlin` and `herc-koed` Saturday (no Saturday service by design).

## Alerts (later)

Catalog safety posters stay in `public/images/alerts/`. Schedule sheets are allowlisted under `/images/schedules/` so a notice can use them once the compose picker lists this manifest.

Do not copy schedule JPGs into `alerts/` (duplicate bytes and drift). Point at `/images/schedules/...` instead.
