/**
 * Overlay back-stack contracts: What's New → sidenav, Black Box → About,
 * Alerts reply cancel → alerts feed.
 * Run: node scripts/verify-overlay-return.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

const blackbox = readFileSync(join(ROOT, 'src/lib/blackbox.js'), 'utf8');
ok(!/closeSmoothModal\('about-modal'\)/.test(blackbox), 'Black Box must not close About');
ok(blackbox.includes("skipHash: true"), 'PIN / Black Box stay off the hash stack');
ok(blackbox.includes('isSessionAuthed()'), 'PIN is session-scoped');
ok(blackbox.includes("replaceState({ modal: 'about-modal' }, '', '#about')"), 'stale #blackbox/#bb-pin normalize to About');

const renderer = readFileSync(join(ROOT, 'src/lib/renderer.js'), 'utf8');
const changelogFn = renderer.slice(
    renderer.indexOf('renderChangelogModal:'),
    renderer.indexOf('// --- 5. CANVAS GRID EXPORT')
);
ok(!changelogFn.includes('sidenav-open'), 'What\'s New must not tear down the sidenav');
ok(!changelogFn.includes("pushState({ modal: 'changelog' }"), 'What\'s New hash is owned by openSmoothModal');

const hub = readFileSync(join(ROOT, 'src/lib/hub.js'), 'utf8');
const openChangelog = hub.slice(hub.indexOf('function openChangelog()'), hub.indexOf('function maybeForceShowChangelog'));
ok(!openChangelog.includes('closeAppHub'), 'What\'s New keeps the sidenav under the modal');
ok(hub.includes("returnModalId !== 'alerts-channel'"), 'Alerts feed is not parked under feedback');

const ui = readFileSync(join(ROOT, 'src/lib/ui.js'), 'utf8');
const closeFn = ui.slice(ui.indexOf('export function closeSmoothModal'), ui.indexOf('export function openSmoothModal'));
ok(
    closeFn.includes('restoreFeedbackReturnOverlay')
        && closeFn.indexOf("if (modalId === 'feedback-modal')")
            < closeFn.indexOf('hideFixedModal(modalId)'),
    'Feedback cancel restores the previous overlay before history.back()'
);
ok(ui.includes("hashNow === '#sidenav'"), 'popstate reopens the hub on #sidenav');
ok(ui.includes("hashNow === '#alerts'"), 'popstate unhides the alerts feed on #alerts');
ok(ui.includes('__ntModalPopLockUntil'), 'on-screen Close arms a pop lock for history.back()');
{
    const popFn = ui.slice(ui.indexOf('export function bindHistoryBackNavigation'), ui.indexOf('// --- CINEMATIC SCRIM ENGINE'));
    ok(!/if \(window\._isModalAnimating\)/.test(popFn), 'popstate must not swallow native Back during modal animation');
}
ok(hub.includes("closeSmoothModal('developer-reply-modal', true)"), 'hub popstate closes inbox with fromPopState');
ok(hub.includes("closeSmoothModal('notice-modal', true)"), 'hub popstate closes notice with fromPopState');
ok(hub.includes("closeSmoothModal('alerts-channel', true)"), 'hub popstate closes alerts with fromPopState');

if (failures.length) {
    console.error('verify-overlay-return FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-overlay-return: ok');
