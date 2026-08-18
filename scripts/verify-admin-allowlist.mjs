/**
 * Operator allowlist + Dev Hub must not treat anonymous Firebase as admin.
 * Run: node scripts/verify-admin-allowlist.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_EMAILS, isAdminEmail } from '../src/lib/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

ok(ADMIN_EMAILS.includes('enockelk@gmail.com'), 'Enock is an operator');
ok(ADMIN_EMAILS.includes('thandeka05nxumalo@gmail.com'), 'Thandeka is an operator');
ok(isAdminEmail('thandeka05nxumalo@gmail.com'), 'isAdminEmail accepts Thandeka');
ok(isAdminEmail('EnockElk@gmail.com'), 'isAdminEmail is case-insensitive');
ok(!isAdminEmail(''), 'empty email is not admin');
ok(!isAdminEmail(null), 'null email is not admin');
ok(!isAdminEmail(' commuter@gmail.com '), 'random email is not admin');

const adminJs = readFileSync(join(ROOT, 'public/js/admin.js'), 'utf8');
ok(adminJs.includes('isAllowlistedAdmin'), 'admin.js gates on allowlisted email');
ok(adminJs.includes('Non-admin Firebase session ignored'), 'anonymous session is ignored');
ok(adminJs.includes('stopTelemetryPolling'), '403 stops the 10s telemetry loop');
ok(adminJs.includes('isAllowlistedAdmin(Admin.currentUser) || window.isSimMode'), '5-tap does not open Dev Hub for anonymous');

const bridge = readFileSync(join(ROOT, 'src/lib/admin-bridge.js'), 'utf8');
ok(bridge.includes('isAdminEmail(window.Admin?.currentUser?.email)'), 'bridge skips login only for operators');

const worker = readFileSync(join(ROOT, 'workers/nexttrain-telemetry/worker.js'), 'utf8');
ok(worker.includes('thandeka05nxumalo@gmail.com'), 'telemetry worker still allowlists Thandeka');

if (failures.length) {
    console.error('verify-admin-allowlist FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-admin-allowlist: ok');
