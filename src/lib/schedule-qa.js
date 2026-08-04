/**
 * Schedule data quality assurance scanner.
 * Used by the admin Schedule QA panel to flag impossible / suspicious cells.
 */
import { ROUTES } from './config.js';
import { isRealTime, timeToSeconds, normalizeStationName } from './utils.js';

/** Issue codes available in the admin filter dropdown. */
export const QA_ISSUE_TYPES = [
    { code: 'DUPLICATE_ADJACENT', label: 'Identical adjacent times', defaultOn: true },
    { code: 'TIME_REGRESSION', label: 'Time goes backwards', defaultOn: true },
    { code: 'DELTA_VARIANCE', label: 'Inconsistent deltas', defaultOn: true },
    { code: 'MISSING_COORDS', label: 'Missing coordinates', defaultOn: true },
    { code: 'INVALID_COORDS', label: 'Invalid coordinates', defaultOn: true },
    { code: 'DUPLICATE_STATION', label: 'Duplicate station rows', defaultOn: true },
    { code: 'NON_TIME_CELL', label: 'Non-time cells', defaultOn: true },
    { code: 'EMPTY_TRAIN', label: 'Empty train columns', defaultOn: true },
    { code: 'SINGLE_STOP', label: 'Single-stop trains', defaultOn: false },
    { code: 'SPARSE_TRAIN', label: 'Sparse trains (≤3 stops)', defaultOn: false },
    { code: 'LARGE_GAP', label: 'Large inter-stop gaps', defaultOn: false },
    { code: 'DAY_STATION_MISMATCH', label: 'Weekday↔Saturday station mismatch', defaultOn: true },
    { code: 'MISSING_SHEET', label: 'Missing sheets', defaultOn: true },
    { code: 'MISSING_DEST_A', label: 'Missing origin station', defaultOn: true },
    { code: 'MISSING_DEST_B', label: 'Missing destination station', defaultOn: true },
    { code: 'NO_TRAINS', label: 'No train columns', defaultOn: true },
    { code: 'EMPTY_SHEET', label: 'Empty sheets', defaultOn: true },
];

/** Strip " STATION" for display. */
function stationShort(name) {
    return String(name || '').replace(/\s+STATION$/i, '').trim();
}

function parseCoords(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s === '-' || s === '—' || s === '–') return null;
    const parts = s.split(',').map((p) => parseFloat(p.trim()));
    if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
    return { lat: parts[0], lon: parts[1] };
}

/** Rough Southern Africa bounds — catches swapped lon/lat and zeros. */
function coordsInSaBounds(lat, lon) {
    return lat >= -35.5 && lat <= -22 && lon >= 16 && lon <= 33.5;
}

/**
 * Parse a sheet (array of row objects or {headers,rows}) into a scan-friendly shape.
 */
export function normalizeSheet(sheet, meta, parseJSONSchedule) {
    if (!sheet) return null;
    if (sheet.headers && sheet.rows) return sheet;
    if (Array.isArray(sheet) && typeof parseJSONSchedule === 'function') {
        return parseJSONSchedule(sheet, meta);
    }
    if (Array.isArray(sheet) && sheet.length) {
        const headers = Object.keys(sheet[0] || {}).filter((k) => k !== 'row_index');
        return { headers, rows: sheet, stationColumnName: 'STATION' };
    }
    return null;
}

function trainCols(schedule) {
    const stationCol = schedule.stationColumnName || 'STATION';
    return (schedule.headers || []).filter(
        (h) => h && h !== stationCol && h !== 'STATION' && h !== 'COORDINATES' && h !== 'KM_MARK' && h !== 'row_index'
    );
}

/**
 * Scan one parsed schedule sheet.
 * @returns {{ findings: object[], pairDeltas: Map<string, number[]>, stationNames: string[] }}
 */
export function scanScheduleSheet(schedule, ctx = {}) {
    const findings = [];
    const pairDeltas = new Map();
    const stationNames = [];

    if (!schedule?.rows?.length) {
        findings.push({
            severity: 'error',
            code: 'EMPTY_SHEET',
            message: 'Sheet is empty or unreadable',
            ...ctx,
        });
        return { findings, pairDeltas, stationNames };
    }

    const stationCol = schedule.stationColumnName || 'STATION';
    const cols = trainCols(schedule);
    if (!cols.length) {
        findings.push({
            severity: 'error',
            code: 'NO_TRAINS',
            message: 'No train columns found',
            ...ctx,
        });
        return { findings, pairDeltas, stationNames };
    }

    // Station-level structure: coords + duplicate rows
    const seenStations = new Map();
    for (const row of schedule.rows) {
        const station = row[stationCol];
        if (!station) continue;
        const key = normalizeStationName(station);
        if (!key) continue;
        stationNames.push(key);

        if (seenStations.has(key)) {
            findings.push({
                severity: 'warn',
                code: 'DUPLICATE_STATION',
                message: `Station "${stationShort(station)}" appears more than once in this sheet`,
                station: stationShort(station),
                ...ctx,
            });
        } else {
            seenStations.set(key, true);
        }

        const coords = parseCoords(row.COORDINATES ?? row.coordinates);
        if (!coords) {
            findings.push({
                severity: 'warn',
                code: 'MISSING_COORDS',
                message: `${stationShort(station)} has no coordinates`,
                station: stationShort(station),
                ...ctx,
            });
        } else if (!coordsInSaBounds(coords.lat, coords.lon)) {
            findings.push({
                severity: 'warn',
                code: 'INVALID_COORDS',
                message: `${stationShort(station)} coordinates look invalid (${coords.lat}, ${coords.lon})`,
                station: stationShort(station),
                value: `${coords.lat},${coords.lon}`,
                ...ctx,
            });
        }
    }

    for (const train of cols) {
        const stops = [];
        for (let i = 0; i < schedule.rows.length; i++) {
            const row = schedule.rows[i];
            const station = row[stationCol];
            const cell = row[train];
            if (cell == null || String(cell).trim() === '' || String(cell).trim() === '-') continue;

            if (!isRealTime(cell)) {
                findings.push({
                    severity: 'warn',
                    code: 'NON_TIME_CELL',
                    message: `Train ${train}: non-time value "${cell}" at ${stationShort(station)}`,
                    train,
                    station: stationShort(station),
                    value: String(cell),
                    ...ctx,
                });
                continue;
            }

            stops.push({ i, station: stationShort(station), sec: timeToSeconds(cell), raw: String(cell).trim() });
        }

        if (stops.length === 0) {
            findings.push({
                severity: 'warn',
                code: 'EMPTY_TRAIN',
                message: `Train ${train}: no timed stops`,
                train,
                ...ctx,
            });
            continue;
        }
        if (stops.length === 1) {
            findings.push({
                severity: 'info',
                code: 'SINGLE_STOP',
                message: `Train ${train}: only one timed stop (${stops[0].station})`,
                train,
                ...ctx,
            });
        } else if (stops.length <= 3) {
            findings.push({
                severity: 'info',
                code: 'SPARSE_TRAIN',
                message: `Train ${train}: only ${stops.length} timed stops`,
                train,
                ...ctx,
            });
        }

        for (let s = 1; s < stops.length; s++) {
            const prev = stops[s - 1];
            const cur = stops[s];
            let deltaSec = cur.sec - prev.sec;
            if (deltaSec < 0 && prev.sec >= 18 * 3600 && cur.sec <= 6 * 3600) {
                deltaSec += 24 * 3600;
            }
            const pairKey = `${normalizeStationName(prev.station)}→${normalizeStationName(cur.station)}`;

            if (deltaSec < 0) {
                findings.push({
                    severity: 'error',
                    code: 'TIME_REGRESSION',
                    message: `Train ${train}: time goes backwards ${prev.station} ${prev.raw} → ${cur.station} ${cur.raw}`,
                    train,
                    from: prev.station,
                    to: cur.station,
                    ...ctx,
                });
            } else if (deltaSec === 0) {
                findings.push({
                    severity: 'error',
                    code: 'DUPLICATE_ADJACENT',
                    message: `Train ${train}: identical times at ${prev.station} and ${cur.station} (${cur.raw})`,
                    train,
                    from: prev.station,
                    to: cur.station,
                    value: cur.raw,
                    ...ctx,
                });
            } else {
                const deltaMin = Math.round(deltaSec / 60);
                if (!pairDeltas.has(pairKey)) pairDeltas.set(pairKey, []);
                pairDeltas.get(pairKey).push({ train, deltaMin, from: prev.station, to: cur.station });
                if (deltaMin > 45) {
                    findings.push({
                        severity: 'info',
                        code: 'LARGE_GAP',
                        message: `Train ${train}: ${deltaMin} min between ${prev.station} and ${cur.station}`,
                        train,
                        from: prev.station,
                        to: cur.station,
                        deltaMin,
                        ...ctx,
                    });
                }
            }
        }
    }

    return { findings, pairDeltas, stationNames };
}

/** Flag station-pair deltas that vary across trains (e.g. 5 vs 6 min). */
export function findingsFromPairDeltas(pairDeltas, ctx = {}, opts = {}) {
    const minSpread = opts.minSpreadMinutes ?? 1;
    const findings = [];
    for (const [, samples] of pairDeltas) {
        if (samples.length < 2) continue;
        const mins = samples.map((s) => s.deltaMin);
        const lo = Math.min(...mins);
        const hi = Math.max(...mins);
        if (hi - lo < minSpread) continue;
        const from = samples[0].from;
        const to = samples[0].to;
        const byTrain = samples.map((s) => `${s.train}:${s.deltaMin}m`).join(', ');
        findings.push({
            severity: 'warn',
            code: 'DELTA_VARIANCE',
            message: `${from} → ${to}: deltas vary ${lo}–${hi} min across trains (${byTrain})`,
            from,
            to,
            lo,
            hi,
            samples,
            ...ctx,
        });
    }
    return findings;
}

/**
 * Run QA across all active routes in a regional DB object.
 */
export function runScheduleQaReport(db, region, parseJSONSchedule) {
    const findings = [];
    let sheetsScanned = 0;
    let routesScanned = 0;

    if (!db || typeof db !== 'object') {
        return {
            findings: [{ severity: 'error', code: 'NO_DB', message: 'No database payload to scan' }],
            summary: { routesScanned: 0, sheetsScanned: 0, errors: 1, warnings: 0, infos: 0 },
        };
    }

    Object.values(ROUTES).forEach((route) => {
        if (!route?.isActive || route.id === 'special_event') return;
        if (region && route.region !== region) return;
        routesScanned++;

        const keys = route.sheetKeys || {};
        /** @type {Record<string, Set<string>>} */
        const stationsByDay = {};

        Object.entries(keys).forEach(([dayDir, sheetKey]) => {
            const sheet = db[sheetKey];
            const meta = db[`${sheetKey}_meta`];
            const parsed = normalizeSheet(sheet, meta, parseJSONSchedule);
            const ctx = {
                region: route.region,
                routeId: route.id,
                routeName: route.name,
                sheetKey,
                dayDir,
            };

            if (!parsed) {
                findings.push({
                    severity: 'error',
                    code: 'MISSING_SHEET',
                    message: `Missing sheet ${sheetKey}`,
                    ...ctx,
                });
                return;
            }

            sheetsScanned++;
            const { findings: sheetFindings, pairDeltas, stationNames } = scanScheduleSheet(parsed, ctx);
            findings.push(...sheetFindings);
            findings.push(...findingsFromPairDeltas(pairDeltas, ctx, { minSpreadMinutes: 1 }));

            const dayKey = String(dayDir).startsWith('saturday') ? 'saturday'
                : String(dayDir).startsWith('weekday') ? 'weekday'
                : String(dayDir).split('_')[0] || dayDir;
            if (!stationsByDay[dayKey]) stationsByDay[dayKey] = new Set();
            stationNames.forEach((s) => stationsByDay[dayKey].add(s));

            const stationCol = parsed.stationColumnName || 'STATION';
            const stations = parsed.rows.map((r) => normalizeStationName(r[stationCol]));
            const destA = normalizeStationName(route.destA);
            const destB = normalizeStationName(route.destB);
            const hasA = stations.some((s) => s.includes(destA) || destA.includes(s));
            const hasB = stations.some((s) => s.includes(destB) || destB.includes(s));
            if (!hasA) {
                findings.push({
                    severity: 'error',
                    code: 'MISSING_DEST_A',
                    message: `Sheet missing origin ${stationShort(route.destA)}`,
                    ...ctx,
                });
            }
            if (!hasB) {
                findings.push({
                    severity: 'error',
                    code: 'MISSING_DEST_B',
                    message: `Sheet missing destination ${stationShort(route.destB)}`,
                    ...ctx,
                });
            }
        });

        // Weekday vs Saturday station-set mismatch (once per route)
        const wd = stationsByDay.weekday || stationsByDay.weekdays;
        const sat = stationsByDay.saturday || stationsByDay.sat;
        if (wd?.size && sat?.size) {
            const onlyWd = [...wd].filter((s) => !sat.has(s));
            const onlySat = [...sat].filter((s) => !wd.has(s));
            if (onlyWd.length || onlySat.length) {
                const bits = [];
                if (onlyWd.length) bits.push(`weekday-only: ${onlyWd.slice(0, 4).map(stationShort).join(', ')}${onlyWd.length > 4 ? '…' : ''}`);
                if (onlySat.length) bits.push(`saturday-only: ${onlySat.slice(0, 4).map(stationShort).join(', ')}${onlySat.length > 4 ? '…' : ''}`);
                findings.push({
                    severity: 'warn',
                    code: 'DAY_STATION_MISMATCH',
                    message: `${route.name}: station list differs weekday↔Saturday (${bits.join('; ')})`,
                    routeId: route.id,
                    routeName: route.name,
                    region: route.region,
                });
            }
        }
    });

    const severityRank = { error: 0, warn: 1, info: 2 };
    findings.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));

    return {
        findings,
        summary: {
            routesScanned,
            sheetsScanned,
            errors: findings.filter((f) => f.severity === 'error').length,
            warnings: findings.filter((f) => f.severity === 'warn').length,
            infos: findings.filter((f) => f.severity === 'info').length,
        },
    };
}
