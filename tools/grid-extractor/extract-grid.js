/**
 * 🚅 METRORAIL NEXT TRAIN - GRID ORDER EXTRACTOR (GUARDIAN V3.5 - SHEET KEY ALIAS)
 * --------------------------------------------------------------
 * USAGE: node extract-grid.js [optional.xlsx | optional-dir ...]
 *
 * UPDATES (V3.5):
 * 1. Sheet-key aliases: Config uses `durbn-to-cross_weekday`; ROUTES.sheetKeys
 *    use `durbn_to_cross_weekday`. Write both so the board can look either up.
 * 2. Underscore filenames (browser/OneDrive uploads like NextTrain_KZN-Schedules_-_28_Aug.xlsx).
 * 3. Search the script folder, cwd, and argv paths — not cwd only.
 * 4. Auto-discover DURBN-to-CROSS_* (and other XXX-to-YYY_Weekday/Sat) tabs missing from Config_GridOrder.
 * 5. Merge into existing MANUAL_GRID_ORDER (do not wipe GP/WC/EC when only KZN is present).
 * 6. Preserve orderGridTrainIds helpers after the object (do not clobber grid-order.js).
 *
 * UPDATES (V3.4):
 * 1. Sheet Alias Interceptor: Maps legacy Config names (e.g., CTCEN-IN_Weekday) to new master tabs natively.
 * 2. Zero-Pad Fix: Restores leading zeros stripped by Excel for pure numbers (e.g., "5" -> "0005").
 *
 * UPDATES (V3.3):
 * 1. Region Expansion: Expanded the regex and file-grouping logic to natively support KZN and EC regions.
 *
 * UPDATES (V3.2):
 * 1. Auto-Seeker Logic: Scans the first 5 rows to automatically find the Train Numbers, ignoring the manual config row number.
 * 2. Batch Processing: Scans for ALL schedule files simultaneously.
 * 3. Smart Parsing: Automatically handles data pasted into Column A as comma-separated strings (no need for Text-to-Columns).
 * 4. Merges extracted data from all regions into a single config.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SCRIPT_DIR = __dirname;
const CONFIG_SHEET_NAME = 'Config_GridOrder';
const OUTPUT_FILENAME = 'grid-order.js';
const SCHEDULE_FILE_RE = /^(Next)?Train[_\s-]*(GP|WC|KZN|EC)?[_\s-]*Schedules.*\.xlsx$/i;
const TAB_KEY_RE = /^([A-Za-z0-9]+)-to-([A-Za-z0-9]+)_(Weekday|Sat)$/i;

const SHEET_ALIASES = {
    'CTCEN-IN_Weekday': 'CEN_IN_WK_MASTER',
    'CTCEN-OUT_Weekday': 'CEN_OUT_WK_MASTER',
    'CTCEN-IN_Sat': 'CEN_IN_SAT_MASTER',
    'CTCEN-OUT_Sat': 'CEN_OUT_SAT_MASTER'
};

const TARGET_DIRECTORIES = [
    '../../src/lib',
    '../../Source Code/js',
    './js',
    './'
];

const FALLBACK_TRAILER = `
const TRAIN_COL_RE = /^\\d{4}[a-zA-Z]*$/;
const CLOCK_RE = /^([01]?\\d|2[0-3]):([0-5]\\d)(?::([0-5]\\d))?$/;

function cellSeconds(val) {
    const s = String(val ?? '').trim();
    if (!s || s === '-' || s === '—' || s === '–') return 0;
    const m = s.match(CLOCK_RE);
    if (!m) return 0;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
}

function orderByEarliestTime(trainIds, rows) {
    const list = Array.isArray(rows) ? rows : [];
    const colStats = trainIds.map((colId) => {
        let earliestTime = 86400 * 2;
        let hasData = false;
        for (const row of list) {
            const t = cellSeconds(row?.[colId]);
            if (t > 0) {
                if (t < earliestTime) earliestTime = t;
                hasData = true;
            }
        }
        return { id: colId, time: earliestTime, hasData };
    });
    colStats.sort((a, b) => {
        if (!a.hasData && !b.hasData) return a.id.localeCompare(b.id);
        if (!a.hasData) return 1;
        if (!b.hasData) return -1;
        return a.time - b.time;
    });
    return colStats.map((c) => c.id);
}

function gridOrderLookupKeys(sheetName) {
    const name = String(sheetName || '');
    const keys = [name];
    if (name.includes('-to-')) keys.push(name.replace(/-to-/g, '_to_'));
    if (name.includes('_to_')) keys.push(name.replace(/_to_/g, '-to-'));
    return keys;
}

/** Stable column order: manual list, leftover IDs; no manual list → earliest clock. */
export function orderGridTrainIds(sheetName, trainIds, rows) {
    const trainCols = (trainIds || [])
        .map((id) => String(id).trim())
        .filter((id) => TRAIN_COL_RE.test(id));
    const unique = [];
    const seen = new Set();
    for (const id of trainCols) {
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
    }
    let manualOrder;
    for (const key of gridOrderLookupKeys(sheetName)) {
        if (MANUAL_GRID_ORDER[key]) {
            manualOrder = MANUAL_GRID_ORDER[key];
            break;
        }
    }
    if (!manualOrder) {
        return Array.isArray(rows) && rows.length ? orderByEarliestTime(unique, rows) : unique;
    }
    const sorted = [];
    const manualSet = new Set(manualOrder);
    for (const tNum of manualOrder) {
        if (unique.includes(tNum)) sorted.push(tNum);
    }
    const remaining = unique.filter((t) => !manualSet.has(t));
    remaining.sort((a, b) => a.localeCompare(b));
    return [...sorted, ...remaining];
}
`;

function isScheduleWorkbook(file) {
    const base = path.basename(file);
    return SCHEDULE_FILE_RE.test(base) && !base.startsWith('~$');
}

function regionFromFilename(file) {
    const lower = path.basename(file).toLowerCase();
    if (/(^|[^a-z])gp([^a-z]|$)/.test(lower) || lower.includes('gp-') || lower.includes('_gp')) return 'GP';
    if (lower.includes('kzn')) return 'KZN';
    if (/(^|[^a-z])wc([^a-z]|$)/.test(lower) || lower.includes('wc-') || lower.includes('_wc')) return 'WC';
    if (/(^|[^a-z])ec([^a-z]|$)/.test(lower) || lower.includes('ec-') || lower.includes('_ec')) return 'EC';
    return 'GENERAL';
}

function collectSearchDirs() {
    const dirs = [process.cwd(), SCRIPT_DIR];
    for (const arg of process.argv.slice(2)) {
        const abs = path.resolve(process.cwd(), arg);
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) dirs.push(abs);
    }
    return [...new Set(dirs.map((d) => path.resolve(d)))];
}

function collectExplicitFiles() {
    return process.argv.slice(2)
        .map((arg) => path.resolve(process.cwd(), arg))
        .filter((abs) => fs.existsSync(abs) && fs.statSync(abs).isFile() && /\.xlsx$/i.test(abs) && !path.basename(abs).startsWith('~$'));
}

function findAllScheduleFiles() {
    const latestFiles = {};
    const add = (absPath) => {
        if (!fs.existsSync(absPath) || !isScheduleWorkbook(absPath)) return;
        const region = regionFromFilename(absPath);
        const stats = fs.statSync(absPath);
        if (!latestFiles[region] || stats.mtimeMs > latestFiles[region].mtimeMs) {
            latestFiles[region] = { file: absPath, mtimeMs: stats.mtimeMs };
        }
    };

    collectExplicitFiles().forEach(add);
    collectSearchDirs().forEach((dir) => {
        fs.readdirSync(dir).forEach((name) => add(path.join(dir, name)));
    });

    return Object.values(latestFiles).map((item) => item.file);
}

function colToIndex(colStr) {
    let index = 0;
    const s = String(colStr || 'C').trim().toUpperCase();
    for (let i = 0; i < s.length; i++) {
        index = index * 26 + (s.charCodeAt(i) - 64);
    }
    return index - 1;
}

function aliasSheetKeys(key) {
    const name = String(key || '').trim();
    const keys = new Set();
    if (name) keys.add(name);
    if (name.includes('-to-')) keys.add(name.replace(/-to-/g, '_to_'));
    if (name.includes('_to_')) keys.add(name.replace(/_to_/g, '-to-'));
    return [...keys];
}

function parseConfigRow(row) {
    if (!row || row.length === 0) return null;
    let key;
    let sheetName;
    let startColStr;
    if (row.length === 1 && typeof row[0] === 'string' && row[0].includes(',')) {
        const parts = row[0].split(',').map((s) => s.replace(/(^"|"$)/g, '').trim());
        key = parts[0];
        sheetName = parts[1];
        startColStr = parts[3] || 'C';
    } else {
        key = String(row[0] || '').trim();
        sheetName = String(row[1] || '').trim();
        startColStr = String(row[3] || 'C').trim();
    }
    if (!key || key.toLowerCase() === 'key' || !sheetName) return null;
    return { key, sheetName, startColStr };
}

function inferMissingTabs(workbook, existingKeys) {
    const extra = [];
    for (const name of workbook.SheetNames) {
        const m = name.match(TAB_KEY_RE);
        if (!m) continue;
        if (/^(EVENT|ABC)$/i.test(m[1])) continue;
        const day = String(m[3]).toLowerCase() === 'sat' ? 'sat' : 'weekday';
        const key = `${m[1].toLowerCase()}-to-${m[2].toLowerCase()}_${day}`;
        const already = aliasSheetKeys(key).some((k) => existingKeys.has(k));
        if (already) continue;
        extra.push({ key, sheetName: name, startColStr: 'C' });
        console.log(`   ➕ Auto-discovered tab not in Config_GridOrder: ${name} → ${key}`);
    }
    return extra;
}

function extractTrainNumbers(sheet, startColStr) {
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const startColIdx = colToIndex(startColStr);
    for (let r = 0; r <= Math.min(4, range.e.r); r++) {
        const tempNumbers = [];
        let matchCount = 0;
        for (let C = startColIdx; C <= range.e.c; ++C) {
            const cell = sheet[XLSX.utils.encode_cell({ c: C, r })];
            if (!cell || cell.v == null || cell.v === '') continue;
            let val = String(cell.v).trim();
            if (/^\d{1,3}$/.test(val)) val = val.padStart(4, '0');
            if (/^\d{4}[a-zA-Z]*$/.test(val)) {
                tempNumbers.push(val);
                matchCount++;
            }
        }
        if (matchCount >= 1) return tempNumbers;
    }
    return [];
}

function loadExistingGridOrder(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const text = fs.readFileSync(filePath, 'utf8');
    const start = text.indexOf('export const MANUAL_GRID_ORDER =');
    if (start < 0) return {};
    const brace = text.indexOf('{', start);
    if (brace < 0) return {};
    let depth = 0;
    let end = -1;
    for (let i = brace; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end < 0) return {};
    try {
        return JSON.parse(text.slice(brace, end + 1));
    } catch (err) {
        console.warn(`   ⚠️  Could not parse existing MANUAL_GRID_ORDER (${err.message}). Starting fresh.`);
        return {};
    }
}

function writeGridOrderFile(savedPath, extractedData, headerComment) {
    const json = JSON.stringify(extractedData, null, 4);
    const block = `${headerComment}\n\nexport const MANUAL_GRID_ORDER = ${json};`;
    if (fs.existsSync(savedPath)) {
        const existing = fs.readFileSync(savedPath, 'utf8');
        const replaced = existing.replace(
            /(?:\/\*\*[\s\S]*?\*\/\s*)?export const MANUAL_GRID_ORDER = \{[\s\S]*?\n\};/,
            block
        );
        if (replaced !== existing && replaced.includes('export function orderGridTrainIds')) {
            fs.writeFileSync(savedPath, replaced);
            return;
        }
    }
    fs.writeFileSync(savedPath, `${block}\n${FALLBACK_TRAILER}`);
}

function resolveOutputPath() {
    const candidates = [];
    for (const base of [SCRIPT_DIR, process.cwd()]) {
        for (const relativePath of TARGET_DIRECTORIES) {
            const dir = path.resolve(base, relativePath);
            if (fs.existsSync(dir) && fs.lstatSync(dir).isDirectory()) {
                candidates.push(path.join(dir, OUTPUT_FILENAME));
            }
        }
    }
    const existing = candidates.find((p) => fs.existsSync(p));
    if (existing) return existing;
    const lib = path.resolve(SCRIPT_DIR, '../../src/lib', OUTPUT_FILENAME);
    if (fs.existsSync(path.dirname(lib))) return lib;
    return candidates[0] || null;
}

function run() {
    console.log('==============================================');
    console.log(' 🚅 NEXT TRAIN GRID EXTRACTOR (SHEET-KEY ALIAS V3.5)');
    console.log('==============================================');

    const sourceFiles = findAllScheduleFiles();
    if (sourceFiles.length === 0) {
        console.error('❌ ERROR: No schedule files found.');
        console.error('   Name files like "NextTrain KZN-Schedules - 28 Aug.xlsx" (spaces or underscores).');
        process.exit(1);
    }

    console.log(`\n🔍 Found ${sourceFiles.length} latest regional file(s) to process:`);
    sourceFiles.forEach((f) => console.log(`   - ${f}`));

    const savedPath = resolveOutputPath();
    const masterExtractedData = loadExistingGridOrder(savedPath);
    const existingCount = Object.keys(masterExtractedData).length;
    if (existingCount) {
        console.log(`\n📎 Merging into existing MANUAL_GRID_ORDER (${existingCount} keys).`);
    }

    let totalRouteCount = 0;

    sourceFiles.forEach((sourceFile) => {
        console.log(`\n📂 Processing File: ${path.basename(sourceFile)}`);
        const workbook = XLSX.readFile(sourceFile);
        const jobs = [];
        const configKeys = new Set();

        if (workbook.Sheets[CONFIG_SHEET_NAME]) {
            const rawConfigData = XLSX.utils.sheet_to_json(workbook.Sheets[CONFIG_SHEET_NAME], { header: 1 });
            for (let i = 0; i < rawConfigData.length; i++) {
                const parsed = parseConfigRow(rawConfigData[i]);
                if (!parsed) continue;
                jobs.push(parsed);
                aliasSheetKeys(parsed.key).forEach((k) => configKeys.add(k));
            }
        } else {
            console.warn(`   ⚠️ WARNING: Sheet '${CONFIG_SHEET_NAME}' not found. Inferring from tab names.`);
        }

        inferMissingTabs(workbook, configKeys).forEach((job) => jobs.push(job));

        let fileRouteCount = 0;
        jobs.forEach((job) => {
            let sheetName = job.sheetName;
            if (SHEET_ALIASES[sheetName]) sheetName = SHEET_ALIASES[sheetName];
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) {
                if (!String(sheetName).toLowerCase().includes('sun')) {
                    console.log(`   ⚠️  Missing sheet: ${sheetName}`);
                }
                return;
            }
            const trainNumbers = extractTrainNumbers(sheet, job.startColStr);
            if (!trainNumbers.length) {
                console.log(`   ℹ️  ${job.key}: No trains found on tab '${sheetName}' (Scanned rows 1-5)`);
                return;
            }
            aliasSheetKeys(job.key).forEach((aliasKey) => {
                masterExtractedData[aliasKey] = trainNumbers;
            });
            fileRouteCount++;
            totalRouteCount++;
            const aliases = aliasSheetKeys(job.key).filter((k) => k !== job.key);
            const extra = aliases.length ? ` (+ ${aliases.join(', ')})` : '';
            console.log(`   ✅ ${job.key}${extra}: ${trainNumbers.length} train(s)`);
        });

        console.log(`   ✅ Extracted ${fileRouteCount} grid configs from this file.`);
    });

    const today = new Date().toISOString().split('T')[0];
    const sourceNames = sourceFiles.map((f) => path.basename(f)).join(', ');
    const headerComment = `/**
 * METRORAIL NEXT TRAIN - GRID ORDER CONFIG
 * ---------------------------------------------------
 * This file defines the explicit column order for the Full Schedule Grid.
 * Generated from: ${sourceNames}
 * Date: ${today}
 */`;

    if (!savedPath) {
        console.error('\n❌ ERROR: Could not find target directory to save grid-order.js.');
        console.error('   Searched in:', TARGET_DIRECTORIES);
        process.exit(1);
    }

    writeGridOrderFile(savedPath, masterExtractedData, headerComment);

    const required = [
        'durbn_to_cross_weekday',
        'cross_to_durbn_weekday',
        'durbn_to_cross_sat',
        'cross_to_durbn_sat'
    ];
    const missing = required.filter((k) => !masterExtractedData[k]);
    if (missing.length) {
        console.warn(`\n⚠️  Still missing Crossmoor ROUTES.sheetKeys: ${missing.join(', ')}`);
    } else {
        console.log('\n✅ Crossmoor sheetKeys are in MANUAL_GRID_ORDER (underscore + hyphen).');
    }

    console.log(`\n🎉 SUCCESS! Processed ${totalRouteCount} grid rows this run (${Object.keys(masterExtractedData).length} keys in file).`);
    console.log(`💾 Master File Saved to: ${savedPath}`);
}

run();
