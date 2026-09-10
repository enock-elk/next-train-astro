/**
 * Runtime checks for leftover 0619 default, sim weekday date, region picker guard.
 * Run: node scripts/verify-debug-fixes.mjs
 */
import { DEFAULT_EXCLUSIONS, APP_VERSION } from '../src/lib/config.js';
import { simUsesSpecificDate, resolveOperatingDayType, resolvePlannerStationInput, plannerStationDisplayName, formatThreadDateLabel, formatAppTime, STATION_ALIASES, pruneExclusionsTree } from '../src/lib/utils.js';

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        failed += 1;
        console.error('FAIL', msg);
    } else {
        console.log('ok  ', msg);
    }
}

assert(APP_VERSION === 'V9_09.10.11', `APP_VERSION is ${APP_VERSION}`);
assert(
    !DEFAULT_EXCLUSIONS['pta-kempton']
    && !Object.keys(DEFAULT_EXCLUSIONS).length,
    'DEFAULT_EXCLUSIONS no longer hardcodes Kempton 0618/0619'
);

// Mirror isTrainExcluded after the fix: store only, no DEFAULT fallback.
function isTrainExcluded(store, trainNumber, routeId, dayIdx) {
    const rules = store?.[routeId] || null;
    if (rules && rules[trainNumber]) {
        const rule = rules[trainNumber];
        if (rule.expiresAt && Date.now() > rule.expiresAt) return false;
        const days = Array.isArray(rule.days) ? rule.days : null;
        if (days && days.length) {
            const idx = Number(dayIdx);
            if (!days.some((d) => Number(d) === idx)) return false;
        }
        return rule.type || 'banned';
    }
    return false;
}

const firebaseEmpty = {};
assert(
    isTrainExcluded(firebaseEmpty, '0619', 'pta-kempton', 1) === false,
    'empty Firebase exclusions do not ban 0619 on Monday'
);

function getTrainExclusionRule(store, trainNumber, routeId, dayIdx, now = Date.now()) {
    const rules = store?.[routeId] || null;
    if (!rules || !rules[trainNumber]) return null;
    const rule = rules[trainNumber];
    if (rule.expiresAt && now > rule.expiresAt) return null;
    const days = Array.isArray(rule.days) ? rule.days : null;
    if (days && days.length) {
        const idx = Number(dayIdx);
        if (!days.some((d) => Number(d) === idx)) return null;
    }
    return rule;
}

const liveBan = {
    'pta-kempton': { '0619': { days: [1, 5], type: 'banned', reason: 'Admin', expiresAt: Date.now() + 60_000 } },
};
assert(
    getTrainExclusionRule(liveBan, '0619', 'pta-kempton', 1)?.reason === 'Admin',
    'getTrainExclusionRule returns live reason'
);
assert(
    getTrainExclusionRule(liveBan, '0619', 'pta-kempton', 1, Date.now() + 120_000) === null,
    'getTrainExclusionRule honours expiresAt'
);
assert(
    getTrainExclusionRule({}, '0619', 'pta-kempton', 1) === null,
    'empty store has no hardcoded exclusion rule'
);
assert(
    isTrainExcluded(liveBan, '0619', 'pta-kempton', 1) === 'banned',
    'Firebase ban still applies when present'
);
assert(
    isTrainExcluded(liveBan, '0619', 'pta-kempton', 2) === false,
    'Firebase ban honours days[] (Tue not banned)'
);

const longBan = {
    'herc-koed': {
        '1220': {
            type: 'banned',
            reason: 'Cancelled',
            expiresAt: Date.now() + 10 * 24 * 60 * 60 * 1000,
        },
    },
};
assert(
    getTrainExclusionRule(longBan, '1220', 'herc-koed', 4) !== null,
    'long-lived ban with no days[] still applies'
);

{
    const now = 1_000_000;
    const pruned = pruneExclusionsTree({
        r: {
            keep: { type: 'banned', expiresAt: now + 10 * 24 * 60 * 60 * 1000 },
            drop: { type: 'banned', expiresAt: now - 1 },
            notice: { text: 'hi' },
        },
    }, now);
    assert(pruned.r?.keep && pruned.r?.notice && !pruned.r?.drop, 'cache keeps far-future bans and drops expired');
}

// Sim weekday must not inherit leftover Sunday from #sim-date.
globalThis.window = { __ntSimUseSpecificDate: false };
assert(simUsesSpecificDate() === false, 'Weekday sim does not use leftover specific date');
window.__ntSimUseSpecificDate = true;
assert(simUsesSpecificDate() === true, 'Specific Date sim still uses #sim-date');

assert(resolveOperatingDayType(0, null, 'GP') === 'sunday', 'calendar Sunday → sunday');
assert(resolveOperatingDayType(1, null, 'GP') === 'weekday', 'calendar Monday → weekday');
assert(resolveOperatingDayType(5, null, 'GP') === 'weekday', 'calendar Friday → weekday');

// Region picker: only open when no route is active after the same swap generation.
function shouldOpenRoutePicker({ swapGen, currentGen, currentRouteId }) {
    if (swapGen !== currentGen) return false;
    if (currentRouteId) return false;
    return true;
}
assert(shouldOpenRoutePicker({ swapGen: 1, currentGen: 1, currentRouteId: null }) === true, 'open picker when no route');
assert(shouldOpenRoutePicker({ swapGen: 1, currentGen: 1, currentRouteId: 'pta-kempton' }) === false, 'do not reopen after route pick');
assert(shouldOpenRoutePicker({ swapGen: 1, currentGen: 2, currentRouteId: null }) === false, 'ignore stale swap generation');

{
    const { readFileSync } = await import('node:fs');
    const board = readFileSync(new URL('../src/lib/live-board.js', import.meta.url), 'utf8');
    assert(board.includes('export function getTrainExclusionRule'), 'getTrainExclusionRule is exported');
    assert(board.includes('export function openTrainExclusionSheet'), 'exclusion sheet opener is exported');
    const renderer = readFileSync(new URL('../src/lib/renderer.js', import.meta.url), 'utf8');
    assert(renderer.includes('data-excl-open="1"'), 'cancelled columns open the exclusion sheet');
    assert(renderer.includes('exclHeadAttrs'), 'NO SVC header cell is the hit target');
    assert(renderer.includes('exclCellAttrs'), 'banned time cells open the same advisory');
    assert(renderer.includes('top-[2px]'), 'in-app NO SVC sits above the train number');
    assert(!renderer.includes('bottom-[2px]'), 'NO SVC is not anchored to the bottom of the header');
    assert(renderer.includes('export-banned-stack'), 'PNG export NO SVC sits above the train number');
    assert(!renderer.includes('bottom:2px'), 'PNG export NO SVC is not on the train number');
    assert(renderer.includes('decoration-dotted'), 'NO SVC uses a dotted underline');
    assert(!renderer.includes('nt-excl-col'), 'banned columns do not use extra nt-excl-col padding');
    assert(!renderer.includes('nt-excl-head'), 'NO SVC number uses the same header box as other trains');
    assert(renderer.includes("isExport ? 'border-gray-200'"), 'PNG export uses softer grid lines');
    assert(renderer.includes('isExport ? " font-mono font-bold" : " font-mono font-medium"'), 'PNG export times are bold; in-app times stay medium');
    assert(renderer.includes("td.style.fontWeight = '700'"), 'PNG snapshot paints times at 700');
    assert(board.includes('[data-excl-open="1"]'), 'NO SVC column taps open the advisory');
    assert(board.includes('[data-focus-train]'), 'live dots do not steal the cancellation tap');
    assert(board.includes("openFeedbackReplyFromOverlay('disruption-modal', replyOptions)"), 'exclusion Reply keeps an advisory preview');
    assert(renderer.includes('export-no-svc'), 'PNG export NO SVC stays a static span');
    assert(!/export-banned-col[\s\S]{0,80}position:absolute/.test(renderer), 'PNG export NO SVC is not absolutely positioned');
    const grid = readFileSync(new URL('../src/lib/timetable-grid.js', import.meta.url), 'utf8');
    assert(grid.includes('ensureOpsOverlaysReady'), 'full timetable waits for exclusions before relying on the first paint');
    assert(grid.includes('paintOpenGridBody'), 'open timetable re-paints when cancellations arrive');
    const logic = readFileSync(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
    assert(logic.includes('writeCachedExclusions'), 'successful exclusion fetch is cached for offline');
    assert(logic.includes('readCachedExclusions'), 'boot hydrates last-good exclusions');
    const map = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
    assert(map.includes('attachMapDisruptionPopup'), 'map warnings open a popup');
    assert(map.includes('Promise.all'), 'map parallelises disruptions and tracks');
    assert(!map.includes('interactive: false'), 'map warning markers are tappable');
}

{
    const gp = ['JOHANNESBURG', 'PRETORIA', 'KEMPTON PARK', 'ELLIS PARK'];
    assert(resolvePlannerStationInput('Johannesburg Park Station', gp) === 'JOHANNESBURG', 'Johannesburg Park Station → JOHANNESBURG');
    assert(resolvePlannerStationInput('Bosman Station', gp) === 'PRETORIA', 'Bosman Station → PRETORIA');
    assert(resolvePlannerStationInput('JHB Park', gp) === 'JOHANNESBURG', 'JHB Park → JOHANNESBURG');
    assert(resolvePlannerStationInput('Park Station', gp) === 'JOHANNESBURG', 'bare Park Station → JOHANNESBURG');
    assert(resolvePlannerStationInput('park station', gp) === 'JOHANNESBURG', 'park station → JOHANNESBURG');
    assert(resolvePlannerStationInput('Kempton Park', gp) === 'KEMPTON PARK', 'Kempton Park stays Kempton Park');
    assert(resolvePlannerStationInput('Ellis Park', gp) === 'ELLIS PARK', 'Ellis Park stays Ellis Park');
    const gpNorth = ['PRETORIA', 'PRETORIA-N', 'PRETORIA WES', 'MABOPANE', 'KEMPTON PARK'];
    assert(resolvePlannerStationInput('Pretoria North', gpNorth) === 'PRETORIA-N', 'Pretoria North → PRETORIA-N');
    assert(resolvePlannerStationInput('Pretoria West', gpNorth) === 'PRETORIA WES', 'Pretoria West → PRETORIA WES');
    assert(resolvePlannerStationInput('Pretoria Wes', gpNorth) === 'PRETORIA WES', 'Pretoria Wes → PRETORIA WES');
    assert(STATION_ALIASES.BOSMAN === 'PRETORIA', 'Bosman alias map');
    assert(STATION_ALIASES['PRETORIA NORTH'] === 'PRETORIA N', 'Pretoria North alias map');
    assert(STATION_ALIASES['PRETORIA WEST'] === 'PRETORIA WES', 'Pretoria West alias map');
    assert(plannerStationDisplayName('JOHANNESBURG') === 'JOHANNESBURG', 'Johannesburg recents stay in caps');
    assert(!/Park Station/i.test(plannerStationDisplayName('JOHANNESBURG')), 'Park Station is not a display label');
    const stamp = new Date(2026, 7, 25, 7, 19, 0);
    assert(formatAppTime(stamp) === '7:19 AM', `formatAppTime ${formatAppTime(stamp)}`);
    const today = new Date(2026, 7, 28, 12, 0, 0);
    assert(formatThreadDateLabel(today, today) === 'Today', 'thread date Today');
    const yest = new Date(2026, 7, 27, 8, 0, 0);
    assert(formatThreadDateLabel(yest, today) === 'Yesterday', 'thread date Yesterday');
    assert(formatThreadDateLabel(new Date(2026, 7, 25, 8, 0, 0), today) === '25 Aug 2026', 'thread date calendar');
}

{
    const { readFileSync } = await import('node:fs');
    const admin = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
    assert(admin.includes('openAliasModal'), 'alias modal helper exists');
    assert(admin.includes('nt-pack-wallpaper'), 'admin thread wallpaper uses the shared pack');
    assert(admin.includes('editedAt: Date.now()'), 'in-place edit writes editedAt');
    assert(admin.includes("method: 'PATCH'") && admin.includes('inbox/${encodeURIComponent(replyDeviceId)}'), 'edit PATCHes the inbox node');
    assert(!/setCommuterAlias[\s\S]{0,500}prompt\(/.test(admin), 'alias no longer uses window.prompt');
    assert(admin.includes('parseAdminSignoff'), 'admin bubbles parse hyphen signoffs');
    assert(admin.includes('formatAdminBubbleLabel'), 'admin bubbles show Name in the header');
    assert(!admin.includes('return `- ${n}`'), 'admin bubble label has no leading hyphen');
    assert(!admin.includes('data-fb-edit-btn'), 'admin replies have no visible Edit control');
    assert(admin.includes('p-3 bg-white dark:bg-gray-800 border-b border-transparent'), 'collapsed feedback headers are white');
    assert(admin.includes('syncAdminReplyModalViewport'), 'admin reply modal pins to visualViewport');
    const hyphenHtml = 'Sinkhole update<br><br><span style="color: #9ca3af; font-style: italic;">- Enock</span>';
    const signoffRe = /(?:<br\s*\/?>|\n)*\s*<span[^>]*>\s*(?:\u2014|\u00E2\u20AC\u201D|\u00E2\u0080\u0094|&mdash;|[-–—])\s*([^<]*?)\s*<\/span>\s*$/i;
    const match = hyphenHtml.match(signoffRe);
    assert(!!match && match[1].trim() === 'Enock', 'hyphen italic signoff parses as Enock');
}

{
    const { readFileSync } = await import('node:fs');
    const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
    assert(ui.includes('xbrowser'), 'crash shield ignores xbrowser extension noise');
    assert(ui.includes('swbrowser'), 'crash shield ignores swbrowser extension noise');
    assert(ui.includes("text === 'Uncaught'"), 'crash shield ignores empty Uncaught');
    assert(ui.includes("className of #<SVGElement>"), 'crash shield ignores SVG className getter');
    assert(ui.includes('.at is not a function'), 'crash shield ignores missing .at from third-party');
    const store = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
    assert(store.includes('safeStorage.getItem'), 'hydrateStores does not touch raw localStorage');
    const layout = readFileSync(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8');
    const content = readFileSync(new URL('../src/layouts/ContentLayout.astro', import.meta.url), 'utf8');
    assert(layout.includes('Uint8Array') && content.includes('Uint8Array'), '.at polyfill covers typed arrays on app and map layouts');
    const planner = readFileSync(new URL('../src/lib/planner-ui.js', import.meta.url), 'utf8');
    assert(planner.includes('export function bindPlannerInputZoomGuard'), 'planner zoom guard is exported');
    const renderer = readFileSync(new URL('../src/lib/renderer.js', import.meta.url), 'utf8');
    assert(renderer.includes('export-banned-stack'), 'export NO SVC is stacked text');
    assert(!/headerCell\.className = headerCell\.className/.test(renderer), 'export snapshot does not assign SVG className');
    const rules = readFileSync(new URL('../firebase-database.rules.json', import.meta.url), 'utf8');
    assert(rules.includes('start|stop|session'), 'ride_share_log allows session updates');
    assert(rules.includes('thandeka05nxumalo@gmail.com'), 'Thandeka stays on ride_share_log rules');
}

if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll debug-fix checks passed');
