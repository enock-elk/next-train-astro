#!/usr/bin/env node
/**
 * Image schedule archive: every manifest sheet file exists, names match the
 * region folder, and the alert image allowlist accepts schedule paths.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeAlertImageUrl } from '../src/lib/alerts-feed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

const manifestPath = join(ROOT, 'public/images/schedules/manifest.json');
assert(existsSync(manifestPath), 'schedules manifest exists');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert(Array.isArray(manifest.sheets) && manifest.sheets.length >= 10, `manifest lists ${manifest.sheets?.length || 0} sheets`);

const ids = new Set();
for (const sheet of manifest.sheets || []) {
    assert(sheet.id && sheet.file && sheet.region && sheet.day && sheet.direction, `${sheet.id || '?'} has required fields`);
    assert(!ids.has(sheet.id), `unique id ${sheet.id}`);
    ids.add(sheet.id);
    const abs = join(ROOT, 'public/images/schedules', sheet.file);
    assert(existsSync(abs), `file on disk: ${sheet.file}`);
    const regionFolder = String(sheet.file).split('/')[0];
    assert(regionFolder === String(sheet.region || '').toLowerCase(), `${sheet.id} region folder matches region`);
    const path = `/images/schedules/${sheet.file}`;
    assert(sanitizeAlertImageUrl(path) === path, `allowlist accepts ${path}`);
}

assert(
    sanitizeAlertImageUrl('/images/schedules/wc/wc-southern-weekday-inbound-2026-02-02.jpg')
        === '/images/schedules/wc/wc-southern-weekday-inbound-2026-02-02.jpg',
    'southern inbound sheet is allowlisted'
);
assert(sanitizeAlertImageUrl('/images/schedules/evil.png') === null, 'flat schedules path blocked');
assert(sanitizeAlertImageUrl('/images/schedules/wc/../alerts/x.jpg') === null, 'schedule traversal blocked');

const readme = readFileSync(join(ROOT, 'public/images/schedules/README.md'), 'utf8');
assert(readme.includes('{region}-{corridor}-{day}-{direction}'), 'README documents naming');
assert(readme.includes('Do not copy schedule JPGs into `alerts/`'), 'README keeps schedules out of alerts copies');

const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
const instructions = readFileSync(join(ROOT, 'instructions.md'), 'utf8');
assert(agents.includes('public/images/schedules/'), 'AGENTS documents image schedules');
assert(instructions.includes('public/images/schedules/'), 'instructions.md stays in sync with AGENTS');

if (failures.length) {
    console.error('verify-schedule-images failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log(`verify-schedule-images: ok (${manifest.sheets.length} sheets)`);
