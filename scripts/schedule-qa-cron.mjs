/**
 * Hourly Schedule Data QA. Reads the public GitHub dump and prints a small
 * summary. The workflow posts that summary to the community worker.
 * Run: node scripts/schedule-qa-cron.mjs
 */
import { runScheduleQaReport } from '../src/lib/schedule-qa.js';

const url = 'https://cdn.jsdelivr.net/gh/enock-elk/next-train-astro@main/public/data/full-database.json';
const res = await fetch(url);
if (!res.ok) {
    console.error(`schedule dump HTTP ${res.status}`);
    process.exit(1);
}
const raw = await res.json();
const regions = ['gauteng', 'westerncape', 'kzn', 'easterncape'];
const nested = regions.some((key) => raw?.[key] && typeof raw[key] === 'object');
const db = nested
    ? Object.assign({}, ...regions.map((key) => raw[key] || {}))
    : raw;
/** Skip the "Last Updated" banner row so train columns are the headers. */
function parsePublicSheet(rows) {
    if (!Array.isArray(rows)) return null;
    const body = rows.filter((row) => {
        const station = String(row?.STATION || '').trim();
        return station && !/^last updated/i.test(station) && !/^updated:/i.test(station);
    });
    const headers = [];
    body.forEach((row) => {
        Object.keys(row || {}).forEach((key) => {
            if (key !== 'row_index' && !headers.includes(key)) headers.push(key);
        });
    });
    return { headers, rows: body, stationColumnName: 'STATION' };
}
const report = runScheduleQaReport(db, null, parsePublicSheet);
const lines = (report.findings || [])
    .filter((row) => row.severity === 'error')
    .slice(0, 5)
    .map((row) => `${row.code || ''} ${row.routeId || ''} ${row.message || ''}`.replace(/\s+/g, ' ').trim().slice(0, 160))
    .join('\n')
    .slice(0, 900);
const summary = {
    errors: report.summary?.errors || 0,
    warnings: report.summary?.warnings || 0,
    sheets: report.summary?.sheetsScanned || 0,
    at: Date.now(),
    lines,
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
