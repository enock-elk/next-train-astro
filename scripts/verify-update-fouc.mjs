/**
 * Stuck-update FOUC guard: lifeline, inline recover, asset retention, quiet SW.
 * Run: node scripts/verify-update-fouc.mjs
 *
 * FORCE_UPDATE_REQUIRED is release-controlled and must still use the guarded
 * update coordinator. The FOUC fix remains retained hashed /_astro/ assets.
 */
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORCE_UPDATE_REQUIRED, SUPPORT_FACEBOOK_URL, SUPPORT_EMAIL } from '../src/lib/config.js';
import { isAppVersionNewer } from '../src/lib/app-update.js';
import {
    applyRetention,
    readManifestGenerations,
    retainPreviousAstro,
    DEFAULT_KEEP,
    DEFAULT_KEEP_CSS,
} from './retain-previous-astro.mjs';

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

assert(FORCE_UPDATE_REQUIRED === true, 'this synchronized build enables the guarded forced-update path');

const config = readFileSync(new URL('../src/lib/config.js', import.meta.url), 'utf8');
assert(config.includes('reachability preflight succeeds'), 'force update remains gated by a successful reachability preflight');
assert(config.includes('keeps the current shell offline'), 'force update preserves the current shell while offline');

const lifelineSource = readFileSync(new URL('../src/components/RecoveryLifeline.astro', import.meta.url), 'utf8');
// Assert against the emitted markup only. The frontmatter explains why the
// lifeline is not an <h1> and not hidden=, and would otherwise match itself.
const lifeline = lifelineSource.split('---').slice(2).join('---') || lifelineSource;
assert(lifeline.includes('id="nt-recovery-lifeline"'), 'lifeline has a stable id');
assert(lifeline.includes('{SUPPORT_FACEBOOK_URL}'), 'lifeline links Facebook support');
assert(lifeline.includes('facebook.com/enock.kazembe') || lifeline.includes('SUPPORT_FACEBOOK_URL'), 'lifeline uses the Facebook support URL');
assert(lifeline.includes('{SUPPORT_EMAIL}'), 'lifeline prints the support email');
assert(SUPPORT_FACEBOOK_URL === 'https://www.facebook.com/enock.kazembe', 'support Facebook URL stays the owner profile');
assert(SUPPORT_EMAIL === 'admin@nexttrain.co.za', 'support email stays admin@nexttrain.co.za');
assert(lifelineSource.includes('help.html') && lifeline.includes('{helpHref}'), 'lifeline links Reset and Recover');
assert(!/\shidden[\s>]/.test(lifeline), 'lifeline is not hidden=');
assert(!/display:\s*none/.test(lifeline), 'lifeline has no inline display:none');
assert(!/class="[^"]*hidden/.test(lifeline), 'lifeline is not Tailwind-hidden');
// It ships on every indexed page, so an <h1> here would outrank the real one.
assert(!/<h1[\s>]/.test(lifeline), 'lifeline headline is not an <h1>');
assert(lifeline.includes('Next Train could not finish updating'), 'lifeline copy is unchanged');

const fallback = readFileSync(new URL('../src/components/ShellFallbackStyles.astro', import.meta.url), 'utf8');
assert(fallback.includes('is:inline'), 'shell fallback styles are inline so they cannot 404');
assert(
    /#nt-recovery-lifeline \{ display: none !important; \}/.test(fallback),
    'inline CSS — not the hashed bundle — is what hides the lifeline'
);
assert(
    fallback.includes('html[data-nt-shell="broken"] #nt-recovery-lifeline'),
    'inline CSS reveals the lifeline only once the guard marks the shell broken'
);
assert(
    fallback.includes('html[data-nt-style="missing"] :where(body)'),
    'a missing stylesheet gets readable fallback typography'
);
assert(
    fallback.includes('html[data-nt-style="missing"] :where(table)'),
    'timetables stay readable without the hashed bundle'
);
assert(
    /:where\(/.test(fallback) && !/html\[data-nt-style="missing"\] (body|table|th|td|h1)\b/.test(fallback),
    'fallback element rules use :where() so the real bundle still wins'
);
assert(
    fallback.includes('html[data-nt-shell="broken"][data-nt-style="missing"] :where(body) > *:not(#nt-recovery-lifeline)'),
    'the app shell only hides its unstyled dump when the stylesheet is the thing missing'
);

const guard = readFileSync(new URL('../src/components/StuckUpdateGuard.astro', import.meta.url), 'utf8');
assert(guard.includes('is:inline'), 'recover script is inline so it runs when modules 404');
assert(guard.includes("addEventListener('error'"), 'guard listens for resource errors');
assert(guard.includes(', true)'), 'resource errors are captured (they do not bubble)');
assert(guard.includes('/_astro/'), 'guard only recovers hashed Astro assets');
assert(guard.includes('nt_shell'), 'guard cache-busts with nt_shell');
assert(guard.includes("setProperty('display', 'block', 'important')"), 'guard can reveal the lifeline');
assert(guard.includes('navigator.onLine === false'), 'offline boot reveals the number instead of looping');
assert(!guard.includes('.sheet'), 'guard does not infer failure from a null stylesheet handle');
assert(guard.includes("setAttribute('data-nt-shell', 'broken')"), 'guard marks a broken shell for the inline fallback');
assert(guard.includes("setAttribute('data-nt-style', 'missing')"), 'guard marks a missing stylesheet separately');
assert(guard.includes('function isStylesheet'), 'guard tells a dead stylesheet apart from a dead module');
assert(
    /if \(isStylesheet\(node\)\) markStyleMissing\(\);\s*\n\s*recover\(\);/.test(guard),
    'the FOUC is marked before the reload, so this paint is readable too'
);

const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert(ui.includes('!hasReloaded && !onboardingVisible'), 'visible Welcome skips the silent runtime-error reload');

const css = readFileSync(new URL('../src/styles/appearance.css', import.meta.url), 'utf8');
assert(/#nt-recovery-lifeline \{\s*display: none !important;/.test(css), 'hashed CSS still hides the lifeline as a backstop');
assert(css.includes('Do not make this the only copy again'), 'appearance warns the hashed rule is not the only copy');

const layout = readFileSync(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8');
const content = readFileSync(new URL('../src/layouts/ContentLayout.astro', import.meta.url), 'utf8');
assert(layout.includes('<StuckUpdateGuard />'), 'app layout wires the inline guard');
assert(content.includes('<StuckUpdateGuard />'), 'map layout wires the inline guard');
assert(layout.includes('<ShellFallbackStyles surface="app" />'), 'app layout wires the inline fallback styles');
assert(content.includes('<ShellFallbackStyles surface="content" />'), 'content layout wires the inline fallback styles');
// Both must sit in <head> ahead of the guard, so the hide rule is parsed
// before any error handler can reveal the lifeline.
for (const [name, source] of [['app', layout], ['content', content]]) {
    const head = source.split('</head>')[0] || '';
    assert(head.includes('<ShellFallbackStyles'), `${name} layout puts the fallback styles in <head>`);
    assert(
        head.indexOf('<ShellFallbackStyles') < head.indexOf('<StuckUpdateGuard'),
        `${name} layout parses the hide rule before the guard`
    );
}
assert(/<body[^>]*>\s*<RecoveryLifeline \/>/.test(layout), 'lifeline is the first node in the app body');
assert(/<body[^>]*>\s*<RecoveryLifeline \/>/.test(content), 'lifeline is the first node in the map body');

const appUpdate = readFileSync(new URL('../src/lib/app-update.js', import.meta.url), 'utf8');
assert(appUpdate.includes('Incoming update waiting (quiet)'), 'onNeedRefresh is quiet');
assert(appUpdate.includes('armQuietSkipWaiting'), 'idle skipWaiting is armed');
assert(appUpdate.includes('QUIET_SKIP_WAITING_HIDDEN_MS = 5 * 60 * 1000'), 'idle skipWaiting waits 5 minutes hidden');
const needRefresh = appUpdate.split('async onNeedRefresh()')[1]?.split('onRegisteredSW')[0] || '';
assert(!needRefresh.includes('showCrucialUpdateToast'), 'onNeedRefresh does not toast');
assert(!needRefresh.includes('__ntPendingUpdateToken'), 'onNeedRefresh does not force a reload token');
assert(appUpdate.includes('it is not how FOUC is fixed'), 'app-update comments that force-update is not the FOUC fix');
assert(appUpdate.includes('export async function peekIncomingVersion'), 'incoming version peek is shared');
assert(appUpdate.includes('return null;'), 'failed version peek does not pretend this shell is incoming');
assert(appUpdate.includes('markLatestVersionToast'), 'current-version reset schedules a distinct post-reload toast');
assert(appUpdate.includes('maybeShowLatestVersionToast'), 'current-version toast is shown after the reset reload');
assert(isAppVersionNewer('V9_09.12.2', 'V9_09.12.1'), 'same-day higher release is newer');
assert(isAppVersionNewer('V9_09.13.1', 'V9_09.12.9'), 'later release date is newer');
assert(!isAppVersionNewer('V9_09.12.1', 'V9_09.12.1'), 'same release is not newer');
assert(!isAppVersionNewer('V9_09.11.9', 'V9_09.12.1'), 'older release is not newer');
const hubJs = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
const hubModals = readFileSync(new URL('../src/components/HubModals.astro', import.meta.url), 'utf8');
assert(hubJs.includes("performHardCacheClear('check_updates', {"), 'Check for Updates restarts when online');
assert(hubJs.includes('openNetworkSlowConfirm'), 'Check for Updates asks before swapping on a slow probe');
assert(hubJs.includes('installIncomingServiceWorker'), 'Check for Updates installs the incoming worker before reload');
assert(hubModals.includes('bg-orange-500'), 'slow-network Proceed is orange');
assert(hubModals.includes('can affect offline access'), 'slow-network confirm warns about offline access');
assert(hubJs.includes('skipNetworkPreflight'), 'confirmed Check for Updates can skip the probe');
assert(hubModals.includes('id="network-slow-confirm-modal"'), 'slow-network confirm lives next to region confirm');
assert(hubModals.includes('Your network seems slow. Are you sure?'), 'slow-network confirm copy is a question, not a hard stop');
assert(hubJs.includes('peekIncomingVersion'), 'Check for Updates probes the published version before restart');
assert(hubJs.includes('latestVersion: !!(incomingVersion && !isAppVersionNewer(incomingVersion, APP_VERSION))'), 'Check for Updates always resets and classifies the post-reload toast');
assert(hubJs.includes("policy.systemKillswitch || (source === 'check_updates' && !skipNetworkPreflight)"), 'Check for Updates still preflights unless the commuter confirmed');
assert(appUpdate.includes('You’re on the latest version'), 'current release gets a grey informational toast after restart');
assert(appUpdate.includes("'info', 3000"), 'latest-version toast uses the grey info style');
assert(appUpdate.includes('lastSavedTimesToastAt'), 'forced-update saved-times toast has a session cooldown');
assert(appUpdate.includes('You are offline. Using saved times until you reconnect.'), 'offline saved-times copy is unchanged');
assert(appUpdate.includes('Network is slow. Using saved times until you reconnect.'), 'a slow probe is not called offline');
assert(appUpdate.includes('return preflight === \'ok\''), 'force update only proceeds when the probe is ok');

const deploy = readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
const productionBuild = readFileSync(new URL('../.github/workflows/production-build.yml', import.meta.url), 'utf8');
assert(deploy.includes('Snapshot current /_astro/ before sweep'), 'production deploy snapshots hashed assets before rsync');
assert(deploy.includes('retain-previous-astro.mjs'), 'production deploy runs the retain helper');
assert(deploy.includes('astro-retained-generation.json'), 'production deploy records the retained generation');
assert(deploy.includes('rsync -a --delete'), 'production deploy still sweeps obsolete host files');
assert(/--keep 8/.test(deploy), 'production deploy retains 8 hashed generations for in-flight readers');
assert(/--keep-css 30/.test(deploy), 'production deploy retains 30 stylesheet generations for Clarity replay');
assert(deploy.includes('Clarity re-fetches'), 'deploy records why stylesheets outlive modules');
for (const [name, workflow] of [['production deploy', deploy], ['production build', productionBuild]]) {
    assert(workflow.includes('npm run verify:update-fouc'), `${name} gates on update recovery`);
    assert(workflow.includes('npm run verify:safe-nuke'), `${name} gates on safe cache reset`);
    assert(
        workflow.includes('PUBLIC_COMMUNITY_WORKER_URL: https://nexttrain-community.enock.workers.dev'),
        `${name} wires the deployed community Worker`
    );
}

// Retaining a single generation was the bug: several releases a day meant any
// reader holding two-build-old HTML 404d its CSS.
assert(DEFAULT_KEEP > 1, 'default retention covers more than one generation');
assert(DEFAULT_KEEP_CSS > DEFAULT_KEEP, 'stylesheets outlive modules for replay fidelity');

const plan = retainPreviousAstro({
    snapshotFiles: ['old-a.css', 'old-b.js', 'shared.css', 'two-ago.css'],
    destFiles: ['new-a.css', 'shared.css'],
    previousGenerations: [['two-ago.css']],
});
assert(
    plan.restored.join(',') === 'old-a.css,old-b.js,two-ago.css',
    `retain keeps older generations too, got ${plan.restored}`
);
assert(plan.dropped === 0, 'nothing is dropped while inside the retention window');
assert(!plan.restored.includes('shared.css'), 'retain does not overwrite a file the new build shipped');
assert(!plan.restored.includes('new-a.css'), 'retain does not invent new-build files');
assert(plan.generations.length === 2, 'the demoted generation is recorded ahead of the older ones');
assert(plan.generations[0].join(',') === 'old-a.css,old-b.js', 'newest retained generation is first');

// Ageing: past --keep, only stylesheets survive; past --keep-css, nothing does.
const aged = retainPreviousAstro({
    snapshotFiles: ['gen1.css', 'gen1.js'],
    destFiles: ['new.js'],
    previousGenerations: [['gen2.css', 'gen2.js'], ['gen3.css', 'gen3.js'], ['gen4.css', 'gen4.js']],
    keep: 2,
    keepCss: 3,
});
assert(aged.restored.includes('gen2.js'), 'a module inside --keep survives');
assert(!aged.restored.includes('gen3.js'), 'a module past --keep is dropped');
assert(aged.restored.includes('gen3.css'), 'a stylesheet past --keep still survives to --keep-css');
assert(!aged.restored.includes('gen4.css'), 'a stylesheet past --keep-css is dropped');
assert(aged.dropped === 3, `aged run drops gen3.js, gen4.js and gen4.css, got ${aged.dropped}`);

// A rebuild of the same commit demotes nothing and must not age the window.
const rebuild = retainPreviousAstro({
    snapshotFiles: ['same.js', 'held.js'],
    destFiles: ['same.js'],
    previousGenerations: [['held.js']],
    keep: 1,
    keepCss: 1,
});
assert(rebuild.restored.join(',') === 'held.js', 'a no-op republish keeps what it was already holding');
assert(rebuild.generations.length === 1, 'a no-op republish does not push a blank generation');

// The legacy flat `{files:[]}` manifest must still be readable mid-rollout.
const legacyDir = mkdtempSync(join(tmpdir(), 'nt-legacy-'));
try {
    const legacyPath = join(legacyDir, 'astro-retained-generation.json');
    writeFileSync(legacyPath, JSON.stringify({ files: ['legacy.css'], kept: 1 }));
    const generations = readManifestGenerations(legacyPath);
    assert(generations.length === 1 && generations[0][0] === 'legacy.css', 'legacy manifest shape still parses');
} finally {
    rmSync(legacyDir, { recursive: true, force: true });
}

const dir = mkdtempSync(join(tmpdir(), 'nt-retain-'));
try {
    mkdirSync(join(dir, 'snap'), { recursive: true });
    mkdirSync(join(dir, 'dest'), { recursive: true });
    writeFileSync(join(dir, 'snap', 'old.css'), 'old');
    writeFileSync(join(dir, 'snap', 'keep.css'), 'keep-old');
    writeFileSync(join(dir, 'dest', 'keep.css'), 'keep-new');
    writeFileSync(join(dir, 'dest', 'new.css'), 'new');
    const applied = applyRetention({
        snapshotDir: join(dir, 'snap'),
        destDir: join(dir, 'dest'),
        previousGenerations: [],
    });
    assert(applied.restored.join(',') === 'old.css', `apply restores missing old hashes, got ${applied.restored}`);
    assert(readFileSync(join(dir, 'dest', 'keep.css'), 'utf8') === 'keep-new', 'apply does not clobber a new-build file');
    assert(readFileSync(join(dir, 'dest', 'old.css'), 'utf8') === 'old', 'apply copies the previous hash back');
} finally {
    rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
    console.error(`verify-update-fouc: ${failures.length} failed`);
    for (const f of failures) console.error(' -', f);
    process.exit(1);
}
console.log('verify-update-fouc: ok');
