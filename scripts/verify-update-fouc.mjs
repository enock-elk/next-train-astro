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
import { applyRetention, retainPreviousAstro } from './retain-previous-astro.mjs';

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

assert(FORCE_UPDATE_REQUIRED === true, 'this synchronized build enables the guarded forced-update path');

const config = readFileSync(new URL('../src/lib/config.js', import.meta.url), 'utf8');
assert(config.includes('reachability preflight succeeds'), 'force update remains gated by a successful reachability preflight');
assert(config.includes('keeps the current shell offline'), 'force update preserves the current shell while offline');

const lifeline = readFileSync(new URL('../src/components/RecoveryLifeline.astro', import.meta.url), 'utf8');
assert(lifeline.includes('id="nt-recovery-lifeline"'), 'lifeline has a stable id');
assert(lifeline.includes('{SUPPORT_FACEBOOK_URL}'), 'lifeline links Facebook support');
assert(lifeline.includes('facebook.com/enock.kazembe') || lifeline.includes('SUPPORT_FACEBOOK_URL'), 'lifeline uses the Facebook support URL');
assert(lifeline.includes('{SUPPORT_EMAIL}'), 'lifeline prints the support email');
assert(SUPPORT_FACEBOOK_URL === 'https://www.facebook.com/enock.kazembe', 'support Facebook URL stays the owner profile');
assert(SUPPORT_EMAIL === 'admin@nexttrain.co.za', 'support email stays admin@nexttrain.co.za');
assert(lifeline.includes('help.html'), 'lifeline links Reset and Recover');
assert(!/\shidden[\s>]/.test(lifeline), 'lifeline is not hidden=');
assert(!/display:\s*none/.test(lifeline), 'lifeline has no inline display:none');
assert(!/class="[^"]*hidden/.test(lifeline), 'lifeline is not Tailwind-hidden');

const guard = readFileSync(new URL('../src/components/StuckUpdateGuard.astro', import.meta.url), 'utf8');
assert(guard.includes('is:inline'), 'recover script is inline so it runs when modules 404');
assert(guard.includes("addEventListener('error'"), 'guard listens for resource errors');
assert(guard.includes(', true)'), 'resource errors are captured (they do not bubble)');
assert(guard.includes('/_astro/'), 'guard only recovers hashed Astro assets');
assert(guard.includes('nt_shell'), 'guard cache-busts with nt_shell');
assert(guard.includes("setProperty('display', 'block', 'important')"), 'guard can reveal the lifeline');
assert(guard.includes('navigator.onLine === false'), 'offline boot reveals the number instead of looping');
assert(!guard.includes('.sheet'), 'guard does not infer failure from a null stylesheet handle');

const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert(ui.includes('!hasReloaded && !onboardingVisible'), 'visible Welcome skips the silent runtime-error reload');

const css = readFileSync(new URL('../src/styles/appearance.css', import.meta.url), 'utf8');
assert(/#nt-recovery-lifeline \{\s*display: none !important;/.test(css), 'hashed CSS is what hides the lifeline');
assert(css.includes('Do not move this to an inline style'), 'appearance warns not to hide the lifeline inline');

const layout = readFileSync(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8');
const content = readFileSync(new URL('../src/layouts/ContentLayout.astro', import.meta.url), 'utf8');
assert(layout.includes('<StuckUpdateGuard />'), 'app layout wires the inline guard');
assert(content.includes('<StuckUpdateGuard />'), 'map layout wires the inline guard');
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
const hubJs = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
assert(hubJs.includes("performHardCacheClear('check_updates')"), 'Check for Updates restarts when online');
assert(hubJs.includes('You must be online to check for updates'), 'Check for Updates stays put when offline');
assert(!hubJs.includes('No new updates; still'), 'Check for Updates does not skip restart when already current');
assert(!hubJs.includes('peekIncomingVersion'), 'Check for Updates does not peek CDN version before restart');

const deploy = readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
const productionBuild = readFileSync(new URL('../.github/workflows/production-build.yml', import.meta.url), 'utf8');
assert(deploy.includes('Snapshot current /_astro/ before sweep'), 'production deploy snapshots hashed assets before rsync');
assert(deploy.includes('retain-previous-astro.mjs'), 'production deploy runs the retain helper');
assert(deploy.includes('astro-retained-generation.json'), 'production deploy records the retained generation');
assert(deploy.includes('rsync -a --delete'), 'production deploy still sweeps obsolete host files');
for (const [name, workflow] of [['production deploy', deploy], ['production build', productionBuild]]) {
    assert(workflow.includes('npm run verify:update-fouc'), `${name} gates on update recovery`);
    assert(workflow.includes('npm run verify:safe-nuke'), `${name} gates on safe cache reset`);
    assert(
        workflow.includes('PUBLIC_COMMUNITY_WORKER_URL: https://nexttrain-community.enock.workers.dev'),
        `${name} wires the deployed community Worker`
    );
}

const plan = retainPreviousAstro({
    snapshotFiles: ['old-a.css', 'old-b.js', 'shared.css', 'two-ago.css'],
    destFiles: ['new-a.css', 'shared.css'],
    previousManifestFiles: ['two-ago.css'],
});
assert(plan.restored.join(',') === 'old-a.css,old-b.js', `retain keeps only the last generation, got ${plan.restored}`);
assert(plan.dropped === 1, 'retain drops the generation before last');
assert(!plan.restored.includes('shared.css'), 'retain does not overwrite a file the new build shipped');
assert(!plan.restored.includes('new-a.css'), 'retain does not invent new-build files');

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
        previousManifestFiles: [],
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
