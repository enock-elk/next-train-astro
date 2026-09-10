import { bootFirebase } from './firebase-boot.js';
import { safeStorage } from './utils.js';

export const DEFAULT_AUTH_PROVIDERS = Object.freeze({
    google: true,
    email: true,
    facebook: false,
});

export const AUTH_PROVIDERS_PATH = 'config/auth_providers';
const AUTH_PROVIDERS_CACHE_KEY = 'nt_auth_providers_v1';

export function normalizeAuthProviders(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        google: typeof source.google === 'boolean' ? source.google : DEFAULT_AUTH_PROVIDERS.google,
        email: typeof source.email === 'boolean' ? source.email : DEFAULT_AUTH_PROVIDERS.email,
        facebook: typeof source.facebook === 'boolean' ? source.facebook : DEFAULT_AUTH_PROVIDERS.facebook,
    };
}

function readCachedAuthProviders() {
    try {
        const raw = safeStorage.getItem(AUTH_PROVIDERS_CACHE_KEY);
        return raw ? normalizeAuthProviders(JSON.parse(raw)) : { ...DEFAULT_AUTH_PROVIDERS };
    } catch {
        return { ...DEFAULT_AUTH_PROVIDERS };
    }
}

let _authProviders = readCachedAuthProviders();
let _loadPromise = null;
let _loaded = false;

export function getAuthProviders() {
    return { ..._authProviders };
}

export function isAuthProviderActionDisabled(provider, providers = _authProviders, busy = false) {
    if (busy) return true;
    return provider in DEFAULT_AUTH_PROVIDERS && providers?.[provider] !== true;
}

export async function loadAuthProviders({ force = false } = {}) {
    if (typeof window === 'undefined') return getAuthProviders();
    if (_loaded && !force) return getAuthProviders();
    if (_loadPromise && !force) return _loadPromise;

    _loadPromise = (async () => {
        try {
            await bootFirebase();
            if (!window.firebaseDb || !window.firebaseDbGet || !window.firebaseDbRef) {
                return getAuthProviders();
            }
            const snap = await window.firebaseDbGet(
                window.firebaseDbRef(window.firebaseDb, AUTH_PROVIDERS_PATH)
            );
            _authProviders = normalizeAuthProviders(snap.exists() ? snap.val() : null);
            safeStorage.setItem(AUTH_PROVIDERS_CACHE_KEY, JSON.stringify(_authProviders));
            _loaded = true;
            window.dispatchEvent(new CustomEvent('authproviderschange', {
                detail: getAuthProviders(),
            }));
        } catch (e) {
            console.warn('Auth provider config unavailable; using cached defaults', e?.message || e);
        }
        return getAuthProviders();
    })();

    try {
        return await _loadPromise;
    } finally {
        _loadPromise = null;
    }
}
