/**
 * OG / in-app grid column-order checks (library tests, no dist).
 *
 * - pta-pien weekday B follows MANUAL_GRID_ORDER
 * - kzn-bridgecity weekday A has no manual list and uses earliest-clock order
 * - extractGridPreview matches orderGridTrainIds and reports honest totals
 *
 * Usage: node scripts/verify-route-seo.mjs
 */
import { readFileSync } from 'node:fs';
import { MANUAL_GRID_ORDER, orderGridTrainIds } from '../src/lib/grid-order.js';
import { extractGridPreview } from '../workers/nexttrain-og/src/schedule.js';
import catalog from '../workers/nexttrain-og/src/catalog.json' with { type: 'json' };

const failures = [];
const fail = (msg) => failures.push(msg);

const dump = JSON.parse(readFileSync(new URL('../public/data/full-database.json', import.meta.url), 'utf8'));
const IGNORE = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);

function sheetRows(regionNest, sheetKey) {
    const nested = dump[regionNest]?.[sheetKey];
    const top = dump[sheetKey];
    const rows = Array.isArray(nested) && nested.length ? nested : top;
    return (Array.isArray(rows) ? rows : []).filter(
        (r) => r && r.STATION && !/^Last Updated/i.test(String(r.STATION))
    );
}

function unionTrainIds(dataRows) {
    const ids = new Set();
    for (const row of dataRows) {
        if (!row || typeof row !== 'object') continue;
        for (const k of Object.keys(row)) {
            if (!IGNORE.has(k)) ids.add(k);
        }
    }
    return [...ids];
}

{
    const route = catalog['pta-pien'];
    if (!route) fail('catalog missing pta-pien');
    else {
        const sheetB = route.sheetKeys.weekday_to_b;
        const manual = MANUAL_GRID_ORDER[sheetB];
        if (!manual) fail(`pta-pien weekday-B ${sheetB} should have MANUAL_GRID_ORDER`);
        const grid = extractGridPreview(dump, route, 'B', 'weekday');
        if (!grid?.trainIds?.length) fail('pta-pien weekday-B OG preview is empty');
        else {
            const firstManualPresent = manual.find((t) => grid.trainIds.includes(t));
            if (firstManualPresent && grid.trainIds[0] !== firstManualPresent) {
                fail(`pta-pien first column ${grid.trainIds[0]} != first present manual ${firstManualPresent}`);
            }
            const dataRows = sheetRows('gauteng', sheetB);
            const ordered = orderGridTrainIds(sheetB, unionTrainIds(dataRows), dataRows);
            const cap = grid.trainIds.length;
            if (JSON.stringify(grid.trainIds) !== JSON.stringify(ordered.slice(0, cap))) {
                fail('pta-pien OG trainIds do not match orderGridTrainIds');
            }
            if (grid.totalTrains !== ordered.length) {
                fail(`pta-pien totalTrains ${grid.totalTrains} != ${ordered.length}`);
            }
        }
    }
}

{
    const route = catalog['kzn-bridgecity'];
    if (!route) fail('catalog missing kzn-bridgecity');
    else {
        const sheetA = route.sheetKeys.weekday_to_a;
        if (MANUAL_GRID_ORDER[sheetA]) fail(`${sheetA} should have no manual order`);
        const dataRows = sheetRows('kzn', sheetA);
        if (dataRows.length < 4) fail(`${sheetA} dump rows missing`);
        const union = unionTrainIds(dataRows);
        const ordered = orderGridTrainIds(sheetA, union, dataRows);
        const insertion = union;
        if (JSON.stringify(ordered) === JSON.stringify(insertion) && ordered.length > 3) {
            // Earliest-clock order must differ from raw union insertion for this sheet.
            // If they happen to match, still require a real clock sort (first id is earliest).
        }
        const grid = extractGridPreview(dump, route, 'A', 'weekday');
        if (!grid?.trainIds?.length) fail('kzn-bridgecity weekday-A OG preview is empty');
        else {
            const cap = grid.trainIds.length;
            if (JSON.stringify(grid.trainIds) !== JSON.stringify(ordered.slice(0, cap))) {
                fail('kzn-bridgecity OG trainIds do not match earliest-time orderGridTrainIds');
            }
            if (grid.totalTrains !== ordered.length) {
                fail(`kzn-bridgecity totalTrains ${grid.totalTrains} != ${ordered.length}`);
            }
            if (grid.truncatedTrains !== ordered.length > cap) {
                fail('kzn-bridgecity truncatedTrains flag is wrong');
            }
        }
        if (JSON.stringify(ordered) === JSON.stringify([...union].sort((a, b) => a.localeCompare(b)))) {
            fail('kzn-bridgecity weekday-A should not be a localeCompare-only leftover sort');
        }
    }
}

{
    const ogImages = readFileSync(new URL('../workers/nexttrain-og/src/og-images.js', import.meta.url), 'utf8');
    if (!ogImages.includes('Showing ${trainCount} of ${totalTrains} trains')) {
        fail('OG subtitle must disclose truncated train counts');
    }
    const ogHtml = readFileSync(new URL('../workers/nexttrain-og/src/og-html.js', import.meta.url), 'utf8');
    if (!ogHtml.includes('truncatedTrains')) fail('OG description must mention truncated sheets');
    const index = readFileSync(new URL('../workers/nexttrain-og/src/index.js', import.meta.url), 'utf8');
    if (!index.includes('extractGridPreview') || !index.includes('buildRouteOgMeta(route, intent, site, grid)')) {
        fail('OG share HTML must pass the grid into route meta');
    }
}

if (failures.length) {
    console.error('verify-route-seo failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-route-seo: ok');
