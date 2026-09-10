/**
 * Auth-provider defaults, client gating, RTDB scope, and admin controls.
 * Run: node scripts/verify-auth-providers.mjs
 */
import { readFileSync } from 'node:fs';
import {
    AUTH_PROVIDERS_PATH,
    DEFAULT_AUTH_PROVIDERS,
    isAuthProviderActionDisabled,
    normalizeAuthProviders,
} from '../src/lib/auth-providers.js';

const failures = [];
const ok = (condition, message) => {
    if (!condition) failures.push(message);
};

const defaults = normalizeAuthProviders(null);
ok(defaults.google === true, 'Google defaults enabled');
ok(defaults.email === true, 'email defaults enabled');
ok(defaults.facebook === false, 'Facebook defaults disabled');
ok(DEFAULT_AUTH_PROVIDERS.facebook === false, 'exported defaults keep Facebook disabled');

const partial = normalizeAuthProviders({ google: false, futureProvider: true });
ok(partial.google === false, 'explicit provider flags override defaults');
ok(partial.email === true && partial.facebook === false, 'missing flags use per-provider defaults');

const scoped = normalizeAuthProviders({ google: true, email: true, facebook: false });
ok(!isAuthProviderActionDisabled('google', scoped, false), 'disabled Facebook does not disable Google');
ok(!isAuthProviderActionDisabled('email', scoped, false), 'disabled Facebook does not disable email');
ok(isAuthProviderActionDisabled('facebook', scoped, false), 'disabled provider action is blocked');
ok(isAuthProviderActionDisabled('google', scoped, true), 'busy state temporarily disables enabled providers');
ok(isAuthProviderActionDisabled('facebook', scoped, true), 'busy state also disables inactive providers');
ok(isAuthProviderActionDisabled('facebook', scoped, false), 'busy cleanup does not re-enable inactive providers');

const rules = JSON.parse(readFileSync(new URL('../firebase-database.rules.json', import.meta.url), 'utf8'));
const configRules = rules.rules?.config || {};
ok(AUTH_PROVIDERS_PATH === 'config/auth_providers', 'client reads the required RTDB path');
ok(configRules.auth_providers?.['.read'] === true, 'auth provider config is publicly readable');
ok(String(configRules.auth_providers?.['.write']).includes('enockelk@gmail.com'), 'Enock can write auth provider config');
ok(String(configRules.auth_providers?.['.write']).includes('thandeka05nxumalo@gmail.com'), 'Thandeka can write auth provider config');

const account = readFileSync(new URL('../src/lib/account.js', import.meta.url), 'utf8');
const modals = readFileSync(new URL('../src/components/HubModals.astro', import.meta.url), 'utf8');
ok(account.includes("querySelectorAll('[data-account-provider]')"), 'provider state is scoped to provider buttons');
ok(account.includes('syncAuthProviderUi(getAuthProviders(), _accountUiBusy)'), 'busy cleanup reapplies provider configuration');
ok(account.includes("code === 'auth/operation-not-allowed'"), 'operation-not-allowed fallback remains');
for (const provider of ['google', 'email', 'facebook']) {
    ok(modals.includes(`data-account-provider="${provider}"`), `${provider} buttons declare their provider scope`);
}
ok(modals.includes('nt-account-provider-disabled'), 'inactive provider styling is present');
ok(modals.includes('cursor: not-allowed'), 'inactive provider cursor is blocked');
ok(modals.includes('Not available yet'), 'inactive providers explain availability');
ok(modals.includes('aria-disabled="true"'), 'default inactive provider is exposed to assistive technology');

const admin = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
for (const id of [
    'auth-providers-header',
    'auth-provider-google',
    'auth-provider-email',
    'auth-provider-facebook',
    'auth-providers-save',
]) {
    ok(admin.includes(`id="${id}"`), `System Controls exposes #${id}`);
}
ok(admin.includes('config/auth_providers.json'), 'admin reads and saves the auth provider path');
const saveStart = admin.indexOf('if (authProvidersSave)');
const saveEnd = admin.indexOf('if (schedOverrideSave', saveStart);
const saveHandler = admin.slice(saveStart, saveEnd);
ok(saveHandler.includes("method: 'PATCH'"), 'admin patches provider flags without wiping unknown fields');
ok(!saveHandler.includes("method: 'PUT'"), 'admin does not replace the auth provider object');

if (failures.length) {
    console.error('verify-auth-providers FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-auth-providers: ok');
