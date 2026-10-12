/**
 * Phase 4 — Passenger account foundation (Firebase Auth).
 * Guest mode remains fully usable; sign-in is optional.
 *
 * RTDB shape (design):
 *   users/{uid}: {
 *     displayName, photoURL, email?, createdAt,
 *     lastSeenAt, region, lastRouteId, appVersion,
 *     deviceIds: { [deviceId]: linkedAtMs | true },
 *     prefs: { showPhotoInAlerts, showMarksInCommunity, notifyCategories, theme, colourPack, hapticsEnabled, passengerType, updatedAt },
 *     flags: { shadowBanned: false, shadowBannedUntil: 0, role: 'user' },
 *     trustScore: 0
 *   }
 *   devices/{deviceId}: { uid, linkedAt }  — reverse link (migration, not a wipe)
 * GPS is never written to the account.
 */
import { atom } from 'nanostores';
import { bootFirebase } from './firebase-boot.js';
import { isAdminEmail, SUPPORT_EMAIL, APP_VERSION } from './config.js';
import { trackAnalyticsEvent } from './analytics.js';
import { safeStorage } from './utils.js';
import {
    getAuthProviders,
    isAuthProviderActionDisabled,
    loadAuthProviders,
} from './auth-providers.js';
import { $deviceId, $userProfile, $userRegion, $currentRouteId } from '../store.js';
import {
    formatAccountDisplayName,
    clampDisplayName,
    resolveAccountDisplayName,
    refuseDisplayName,
    DISPLAY_NAME_REFUSE_MSG,
} from './display-name.js';

/** @typedef {'guest' | 'loading' | 'signed-in'} AccountStatus */

export const $account = atom({
    status: /** @type {AccountStatus} */ ('guest'),
    uid: null,
    displayName: null,
    photoURL: null,
    email: null,
    emailVerified: false,
    authProvider: null,
    chatDeviceId: null,
});

let _inited = false;
let _unsubAuth = null;
let _accountUiBusy = false;
let _hydratingPrefs = false;

const PHOTO_PREF_KEY = 'ntShowPhotoInAlerts';
const MARKS_COMMUNITY_PREF_KEY = 'ntShowMarksInCommunity';

function getDeviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || null;
}

export function deviceIdAgeMs(id, linkedAt) {
    if (typeof linkedAt === 'number' && Number.isFinite(linkedAt) && linkedAt > 1e9) {
        return linkedAt < 1e12 ? linkedAt * 1000 : linkedAt;
    }
    const m = String(id || '').match(/_(\d{10,13})$/);
    if (!m) return Number.MAX_SAFE_INTEGER;
    const raw = Number(m[1]);
    if (!Number.isFinite(raw)) return Number.MAX_SAFE_INTEGER;
    return raw < 1e12 ? raw * 1000 : raw;
}

/** Oldest linked device wins for admin inbox. Local mint is still recorded. */
export function pickCanonicalChatDeviceId(deviceIds, localId) {
    const ids = [];
    if (deviceIds && typeof deviceIds === 'object' && !Array.isArray(deviceIds)) {
        Object.keys(deviceIds).forEach((id) => { if (id) ids.push(id); });
    }
    if (localId && !ids.includes(localId)) ids.push(localId);
    if (!ids.length) return localId || '';
    ids.sort((a, b) => {
        const ta = deviceIdAgeMs(a, deviceIds?.[a]);
        const tb = deviceIdAgeMs(b, deviceIds?.[b]);
        if (ta !== tb) return ta - tb;
        return String(a).localeCompare(String(b));
    });
    return ids[0];
}

export function readLocalAccountPrefs() {
    let notifyCategories = null;
    try {
        const raw = safeStorage.getItem('ntNotifyCategories');
        if (raw) notifyCategories = JSON.parse(raw);
    } catch { /* ignore */ }
    return {
        showPhotoInAlerts: safeStorage.getItem(PHOTO_PREF_KEY) === '1',
        showMarksInCommunity: safeStorage.getItem(MARKS_COMMUNITY_PREF_KEY) !== '0',
        notifyCategories,
        theme: (() => {
            const stored = safeStorage.getItem('theme');
            return stored === 'dark' || stored === 'system' ? stored : 'light';
        })(),
        colourPack: safeStorage.getItem('colourPack') || 'classic',
        hapticsEnabled: safeStorage.getItem('hapticsEnabled') === 'true',
        passengerType: safeStorage.getItem('userProfile') || $userProfile.get() || 'Adult',
        updatedAt: Date.now(),
    };
}

export const ACCOUNT_OPS_THROTTLE_MS = 60_000;
let lastOpsWriteAt = 0;
let _opsListenersBound = false;

/** Signed-in operational fields. Never includes GPS. */
export function accountOpsFields(now = Date.now()) {
    return {
        lastSeenAt: now,
        region: $userRegion.get() || null,
        lastRouteId: $currentRouteId.get() || null,
        appVersion: APP_VERSION,
    };
}

export async function pushSignedInOps({ force = false, now = Date.now() } = {}) {
    const user = window.firebaseAuth?.currentUser;
    if (!user || user.isAnonymous || !window.firebaseDb) return false;
    if (!force && now - lastOpsWriteAt < ACCOUNT_OPS_THROTTLE_MS) return false;
    lastOpsWriteAt = now;
    const patch = accountOpsFields(now);
    if ('lat' in patch || 'lon' in patch || 'latitude' in patch || 'longitude' in patch) return false;
    try {
        await window.firebaseDbUpdate(window.firebaseDbRef(window.firebaseDb, `users/${user.uid}`), patch);
        return true;
    } catch {
        return false;
    }
}

function bindSignedInOpsListeners() {
    if (_opsListenersBound || typeof window === 'undefined') return;
    _opsListenersBound = true;
    const kick = () => {
        pushSignedInOps().catch(() => {});
    };
    $userRegion.subscribe(kick);
    $currentRouteId.subscribe(kick);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') kick();
    });
}

export async function applyAccountPrefs(prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    const beforeDark = !!(root && root.classList.contains('dark'));
    const beforePack = (root && root.getAttribute('data-colour-pack')) || 'classic';
    _hydratingPrefs = true;
    try {
        if (prefs.theme === 'dark' || prefs.theme === 'light' || prefs.theme === 'system') {
            safeStorage.setItem('theme', prefs.theme);
            safeStorage.setResilientItem?.('theme', prefs.theme)?.catch?.(() => {});
            try {
                const themeMod = await import('./prefs.js');
                themeMod.paintThemeMode(prefs.theme);
            } catch { /* ignore */ }
        }
        if (prefs.colourPack) {
            try {
                const m = await import('./prefs.js');
                m.setColourPack(prefs.colourPack);
            } catch { /* ignore */ }
        }
        if (typeof prefs.hapticsEnabled === 'boolean') {
            safeStorage.setItem('hapticsEnabled', prefs.hapticsEnabled ? 'true' : 'false');
            const cb = document.getElementById('settings-haptics-checkbox');
            if (cb) cb.checked = prefs.hapticsEnabled;
        }
        if (prefs.passengerType) {
            $userProfile.set(prefs.passengerType);
            safeStorage.setItem('userProfile', prefs.passengerType);
            const display = document.getElementById('settings-profile-display');
            if (display) display.textContent = prefs.passengerType;
            const accountPax = document.getElementById('account-passenger-type-display');
            if (accountPax) accountPax.textContent = prefs.passengerType;
        }
        if (typeof prefs.showPhotoInAlerts === 'boolean') {
            safeStorage.setItem(PHOTO_PREF_KEY, prefs.showPhotoInAlerts ? '1' : '0');
            const box = document.getElementById('account-photo-alerts');
            if (box) box.checked = prefs.showPhotoInAlerts;
        }
        if (typeof prefs.showMarksInCommunity === 'boolean') {
            safeStorage.setItem(MARKS_COMMUNITY_PREF_KEY, prefs.showMarksInCommunity ? '1' : '0');
            const box = document.getElementById('account-marks-community');
            if (box) box.checked = prefs.showMarksInCommunity;
            import('./rider-marks.js').then((m) => m.paintCommunityMarksChip?.()).catch(() => {});
        }
        if (prefs.notifyCategories && typeof prefs.notifyCategories === 'object') {
            try {
                const { NOTIFY_CATEGORY_IDS, syncNotifyUi } = await import('./prefs.js');
                const next = {};
                for (const id of NOTIFY_CATEGORY_IDS) {
                    if (typeof prefs.notifyCategories[id] === 'boolean') next[id] = prefs.notifyCategories[id];
                }
                if (Object.keys(next).length) {
                    const { getNotifyCategories } = await import('./prefs.js');
                    safeStorage.setItem('ntNotifyCategories', JSON.stringify({ ...getNotifyCategories(), ...next }));
                    syncNotifyUi();
                }
            } catch { /* ignore */ }
        }
        try {
            const m = await import('./prefs.js');
            m.syncPrefsAccordionSummary();
        } catch { /* ignore */ }
    } finally {
        _hydratingPrefs = false;
        if (root) {
            const afterDark = root.classList.contains('dark');
            const afterPack = root.getAttribute('data-colour-pack') || 'classic';
            const themeTouched = prefs.theme === 'dark' || prefs.theme === 'light' || prefs.theme === 'system';
            const themeChanged = themeTouched && afterDark !== beforeDark;
            const packChanged = !!prefs.colourPack && afterPack !== beforePack;
            if ((themeChanged || packChanged) && typeof window !== 'undefined' && typeof window.showToast === 'function') {
                window.showToast('Look updated from your account.', 'info');
            }
        }
    }
}

export async function pushSignedInPrefs(partial = {}) {
    if (_hydratingPrefs) return;
    const user = window.firebaseAuth?.currentUser;
    if (!user || user.isAnonymous || !window.firebaseDb) return;
    const payload = { ...readLocalAccountPrefs(), ...partial, updatedAt: Date.now() };
    try {
        await window.firebaseDbUpdate(
            window.firebaseDbRef(window.firebaseDb, `users/${user.uid}/prefs`),
            payload,
        );
    } catch {
        /* local prefs still apply */
    }
}

function cleanPhotoUrl(value) {
    const url = String(value || '').trim();
    if (!url || url === 'null' || url === 'undefined') return '';
    return url;
}

/** Google often leaves the picture on providerData after user.photoURL is empty. */
export function resolveAuthPhotoURL(user) {
    const direct = cleanPhotoUrl(user?.photoURL);
    if (direct) return direct;
    const rows = Array.isArray(user?.providerData) ? user.providerData : [];
    for (const row of rows) {
        const url = cleanPhotoUrl(row?.photoURL);
        if (url) return url;
    }
    return '';
}

function publishUser(user, extras = {}) {
    if (!user || user.isAnonymous) {
        $account.set({
            status: 'guest',
            uid: null,
            displayName: null,
            photoURL: null,
            email: null,
            emailVerified: false,
            authProvider: null,
            chatDeviceId: null,
        });
        safeStorage.removeItem('authUid');
        return;
    }
    const photoURL = cleanPhotoUrl(extras.photoURL) || resolveAuthPhotoURL(user) || null;
    const providerId = Array.isArray(user.providerData)
        ? (user.providerData.find((row) => row?.providerId)?.providerId || null)
        : null;
    $account.set({
        status: 'signed-in',
        uid: user.uid,
        displayName: extras.displayName || formatAccountDisplayName(user.displayName || (user.email ? user.email.split('@')[0] : 'Passenger')),
        photoURL,
        email: user.email || null,
        emailVerified: !!user.emailVerified,
        authProvider: extras.authProvider || providerId,
        displayNameCustom: !!extras.displayNameCustom,
        chatDeviceId: extras.chatDeviceId || $account.get().chatDeviceId || null,
    });
    safeStorage.setItem('authUid', user.uid);
}

async function adoptProviderPhoto(user) {
    if (!user || user.isAnonymous) return '';
    let photoURL = resolveAuthPhotoURL(user);
    const google = (user.providerData || []).some((row) => row?.providerId === 'google.com' || row?.providerId === 'facebook.com');
    if (!photoURL && google && typeof user.reload === 'function' && !user.__ntPhotoReloaded) {
        user.__ntPhotoReloaded = true;
        try {
            await user.reload();
            photoURL = resolveAuthPhotoURL(user);
        } catch { /* keep the letter if the provider has no picture */ }
    }
    if (photoURL && photoURL !== cleanPhotoUrl(user.photoURL) && window.firebaseUpdateProfile) {
        try { await window.firebaseUpdateProfile(user, { photoURL }); } catch { /* RTDB still stores it */ }
    }
    return photoURL;
}

async function waitForFirebase(timeoutMs = 8000) {
    if (typeof window === 'undefined') return false;
    if (window.firebaseAuth) return true;
    await bootFirebase();
    if (window.firebaseAuth) return true;
    return new Promise((resolve) => {
        const t = setTimeout(() => {
            window.removeEventListener('firebase-auth-ready', onReady);
            resolve(!!window.firebaseAuth);
        }, timeoutMs);
        const onReady = () => {
            clearTimeout(t);
            window.removeEventListener('firebase-auth-ready', onReady);
            resolve(!!window.firebaseAuth);
        };
        window.addEventListener('firebase-auth-ready', onReady);
    });
}

/**
 * Ensure users/{uid} exists and link current device_id (additive — never wipes prefs).
 * @param {object} user
 * @param {{ customDisplayName?: string }} [opts]
 */
export async function ensureUserProfile(user, opts = {}) {
    if (!user || user.isAnonymous || !window.firebaseDb) return;
    const deviceId = getDeviceId();
    const userPath = `users/${user.uid}`;
    const now = Date.now();
    const refused = opts.customDisplayName ? refuseDisplayName(opts.customDisplayName) : { ok: true, name: '' };
    const customName = refused.ok ? refused.name : '';

    try {
        const snap = await window.firebaseDbGet(window.firebaseDbRef(window.firebaseDb, userPath));
        const existing = snap.exists() ? (snap.val() || {}) : null;
        const displayName = resolveAccountDisplayName(user, {
            displayName: customName || existing?.displayName,
            displayNameCustom: !!(customName || existing?.displayNameCustom),
        });
        const localPrefs = readLocalAccountPrefs();
        const mergedDeviceIds = { ...(existing?.deviceIds && typeof existing.deviceIds === 'object' ? existing.deviceIds : {}) };
        if (deviceId && mergedDeviceIds[deviceId] == null) {
            mergedDeviceIds[deviceId] = now;
        }
        const chatDeviceId = pickCanonicalChatDeviceId(mergedDeviceIds, deviceId);
        const ops = accountOpsFields(now);
        const photoURL = (await adoptProviderPhoto(user)) || cleanPhotoUrl(existing?.photoURL) || null;

        if (!existing) {
            await window.firebaseDbSet(window.firebaseDbRef(window.firebaseDb, userPath), {
                displayName,
                displayNameCustom: !!customName,
                photoURL,
                email: user.email || null,
                createdAt: now,
                deviceIds: deviceId ? { [deviceId]: now } : {},
                flags: {
                    shadowBanned: false,
                    shadowBannedUntil: 0,
                    role: 'user',
                },
                trustScore: 0,
                prefs: localPrefs,
                ...ops,
            });
        } else {
            const patch = {
                photoURL,
                email: user.email || existing.email || null,
                updatedAt: now,
                ...ops,
            };
            if (!existing.displayNameCustom) {
                patch.displayName = displayName;
            }
            if (deviceId && existing.deviceIds?.[deviceId] == null) {
                patch[`deviceIds/${deviceId}`] = now;
            }
            const flags = existing.flags;
            if (!flags) {
                patch.flags = { shadowBanned: false, shadowBannedUntil: 0, role: 'user' };
            } else if (flags.shadowBannedUntil === undefined) {
                patch['flags/shadowBannedUntil'] = 0;
            }
            if (existing.trustScore === undefined) {
                patch.trustScore = 0;
            }
            await window.firebaseDbUpdate(window.firebaseDbRef(window.firebaseDb, userPath), patch);

            const remotePrefs = existing.prefs && typeof existing.prefs === 'object' ? existing.prefs : {};
            const hasCloudLook = !!(remotePrefs.updatedAt || remotePrefs.theme || remotePrefs.colourPack
                || remotePrefs.passengerType || typeof remotePrefs.hapticsEnabled === 'boolean');
            if (hasCloudLook) {
                await applyAccountPrefs(remotePrefs);
            } else {
                if (typeof remotePrefs.showPhotoInAlerts === 'boolean') {
                    await applyAccountPrefs({ showPhotoInAlerts: remotePrefs.showPhotoInAlerts });
                }
                if (typeof remotePrefs.showMarksInCommunity === 'boolean') {
                    await applyAccountPrefs({ showMarksInCommunity: remotePrefs.showMarksInCommunity });
                }
                await pushSignedInPrefs();
            }
        }

        if (deviceId) {
            await window.firebaseDbUpdate(
                window.firebaseDbRef(window.firebaseDb, `devices/${deviceId}`),
                { uid: user.uid, linkedAt: typeof existing?.deviceIds?.[deviceId] === 'number' ? existing.deviceIds[deviceId] : now }
            );
        }

        publishUser(user, {
            displayName,
            displayNameCustom: !!(customName || existing?.displayNameCustom),
            chatDeviceId,
            photoURL,
        });
    } catch (e) {
        // RTDB rules may block until deployed — Auth session still valid locally
        console.warn('Account profile sync deferred', e?.message || e);
        const photoURL = await adoptProviderPhoto(user);
        publishUser(user, {
            chatDeviceId: pickCanonicalChatDeviceId({ [deviceId]: now }, deviceId),
            photoURL,
        });
    }
}

export async function updateAccountDisplayName(raw) {
    const user = window.firebaseAuth?.currentUser;
    if (!user || user.isAnonymous) throw new Error('Sign in to set a display name.');
    const check = refuseDisplayName(raw);
    if (!check.ok) throw new Error(check.message);
    const custom = check.name;
    const displayName = custom || formatAccountDisplayName(user.displayName || (user.email ? user.email.split('@')[0] : 'Passenger'));
    const photoURL = resolveAuthPhotoURL(user);
    if (window.firebaseUpdateProfile) {
        const profilePatch = { displayName };
        if (photoURL) profilePatch.photoURL = photoURL;
        try { await window.firebaseUpdateProfile(user, profilePatch); } catch { /* RTDB is source for chat */ }
    }
    if (window.firebaseDb) {
        const profileRow = {
            displayName,
            displayNameCustom: !!custom,
            updatedAt: Date.now(),
        };
        if (photoURL) profileRow.photoURL = photoURL;
        await window.firebaseDbUpdate(window.firebaseDbRef(window.firebaseDb, `users/${user.uid}`), profileRow);
    }
    publishUser(user, { displayName, displayNameCustom: !!custom, photoURL });
    window.dispatchEvent(new CustomEvent('accountchange', { detail: $account.get() }));
    return displayName;
}

export async function initAccount() {
    if (typeof window === 'undefined' || _inited) return;
    _inited = true;
    $account.set({ ...$account.get(), status: 'loading' });

    const ok = await waitForFirebase();
    if (!ok || !window.firebaseAuth) {
        $account.set({ ...$account.get(), status: 'guest' });
        return;
    }

    if (_unsubAuth) _unsubAuth();
    _unsubAuth = window.firebaseOnAuthStateChanged(window.firebaseAuth, async (user) => {
        // Ignore anonymous sessions used for feedback uploads — treat as guest UI
        if (user && user.isAnonymous) {
            publishUser(null);
            import('./rider-marks.js').then((m) => m.switchMarksAccount(null)).catch(() => {});
            return;
        }
        publishUser(user);
        if (user && !user.isAnonymous) {
            import('./rider-marks.js').then((m) => {
                m.switchMarksAccount(user.uid);
                return m.hydrateRemoteMarks({ persist: true });
            }).catch(() => {});
            await ensureUserProfile(user);
            lastOpsWriteAt = Date.now();
            bindSignedInOpsListeners();
        } else {
            import('./rider-marks.js').then((m) => m.switchMarksAccount(null)).catch(() => {});
        }
        window.dispatchEvent(new CustomEvent('accountchange', { detail: $account.get() }));
    });
}

export async function signInWithGoogle() {
    const ok = await waitForFirebase();
    if (!ok) throw new Error('Cloud sign-in unavailable offline.');
    const provider = new window.firebaseGoogleProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await window.firebaseSignInWithPopup(window.firebaseAuth, provider);
    await ensureUserProfile(cred.user);
    return cred.user;
}

export async function signInWithFacebook() {
    const ok = await waitForFirebase();
    if (!ok) throw new Error('Cloud sign-in unavailable offline.');
    if (typeof window.firebaseFacebookProvider !== 'function') {
        throw new Error('Facebook sign-in is not available yet.');
    }
    const provider = new window.firebaseFacebookProvider();
    const cred = await window.firebaseSignInWithPopup(window.firebaseAuth, provider);
    await ensureUserProfile(cred.user);
    return cred.user;
}

function deletionRequestDraft(user) {
    const email = user?.email || '';
    return `Please delete my Next Train account.${email ? `\n\n${email}` : ''}`;
}

function openDeletionMail(draft) {
    const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Account deletion request')}&body=${encodeURIComponent(draft)}`;
    try {
        window.open(href, '_blank', 'noopener');
    } catch {
        window.location.href = href;
    }
}

function notifyOperatorsOfDeletion(draft) {
    const ta = document.getElementById('feedback-text');
    if (ta) ta.value = draft;
    if (typeof window.openFeedbackModal === 'function') {
        window.openFeedbackModal({ location: 'account_delete', skipClear: true });
        const again = document.getElementById('feedback-text');
        if (again && !again.value.trim()) again.value = draft;
        return;
    }
    openDeletionMail(draft);
}

/** Flag the profile and email operators. Does not wipe Firebase Auth. */
export async function requestAccountDeletion() {
    const state = $account.get();
    if (isAdminEmail(state.email)) {
        throw new Error('This account cannot be deleted in the app.');
    }
    const ok = await waitForFirebase();
    if (!ok || !window.firebaseAuth || !window.firebaseDb) {
        throw new Error('Cloud sign-in unavailable offline.');
    }
    const user = window.firebaseAuth.currentUser;
    if (!user || user.isAnonymous) {
        throw new Error('Sign in first.');
    }
    const now = Date.now();
    const draft = deletionRequestDraft(user);
    try {
        await window.firebaseDbUpdate(window.firebaseDbRef(window.firebaseDb, `users/${user.uid}`), {
            deletionRequestedAt: now,
            deletionRequestedEmail: user.email || null,
            deletionRequestedReason: 'user_request',
        });
    } catch (e) {
        console.warn('Account deletion flag deferred', e?.message || e);
    }
    trackAnalyticsEvent('account_delete', { location: 'account_delete' });
    await signOutAccount();
    closeAccountModal();
    notifyOperatorsOfDeletion(draft);
}

export async function signInWithEmail(email, password) {
    const ok = await waitForFirebase();
    if (!ok) throw new Error('Cloud sign-in unavailable offline.');
    const cred = await window.firebaseSignIn(window.firebaseAuth, email.trim(), password);
    if (cred.user?.isAnonymous) throw new Error('Unexpected anonymous session.');
    await ensureUserProfile(cred.user);
    return cred.user;
}

export async function signUpWithEmail(email, password, displayName) {
    const ok = await waitForFirebase();
    if (!ok) throw new Error('Cloud sign-in unavailable offline.');
    if (password.length < 6) {
        throw new Error('Password must be at least 6 characters.');
    }
    if (displayName?.trim()) {
        const check = refuseDisplayName(displayName);
        if (!check.ok) throw new Error(check.message);
    }
    const cred = await window.firebaseCreateUser(window.firebaseAuth, email.trim(), password);
    try {
        if (cred.user && typeof window.firebaseSendEmailVerification === 'function') {
            await window.firebaseSendEmailVerification(cred.user);
        }
    } catch { /* non-fatal: they can resend from Account */ }
    if (displayName?.trim()) {
        const check = refuseDisplayName(displayName);
        if (!check.ok) throw new Error(check.message);
        try {
            await window.firebaseUpdateProfile(cred.user, { displayName: check.name });
        } catch (e) { /* non-fatal */ }
        await ensureUserProfile(cred.user, { customDisplayName: check.name });
        return cred.user;
    }
    await ensureUserProfile(cred.user);
    return cred.user;
}

export async function sendAccountPasswordReset(email) {
    const ok = await waitForFirebase();
    if (!ok) throw new Error('Cloud sign-in unavailable offline.');
    if (!email || !String(email).trim()) throw new Error('Enter your email first.');
    if (typeof window.firebaseSendPasswordResetEmail !== 'function') {
        throw new Error('Password reset is unavailable.');
    }
    await window.firebaseSendPasswordResetEmail(window.firebaseAuth, String(email).trim());
}

export async function resendAccountVerification() {
    const ok = await waitForFirebase();
    if (!ok || !window.firebaseAuth?.currentUser) throw new Error('Sign in first.');
    const user = window.firebaseAuth.currentUser;
    if (user.emailVerified) return true;
    if (typeof window.firebaseSendEmailVerification !== 'function') {
        throw new Error('Verification email is unavailable.');
    }
    await window.firebaseSendEmailVerification(user);
    return true;
}

export async function signOutAccount() {
    const ok = await waitForFirebase();
    if (!ok || !window.firebaseAuth) return;
    const user = window.firebaseAuth.currentUser;
    // Don't sign out anonymous if used mid-feedback — only passenger accounts
    if (user && !user.isAnonymous) {
        await window.firebaseSignOut(window.firebaseAuth);
    }
    publishUser(null);
    import('./rider-marks.js').then((m) => m.switchMarksAccount(null)).catch(() => {});
}

export function openAccountModal() {
    const modal = typeof document !== 'undefined' ? document.getElementById('account-modal') : null;
    if (modal) {
        modal.style.removeProperty('top');
        modal.style.removeProperty('height');
        modal.style.removeProperty('max-height');
        modal.style.removeProperty('--nt-feedback-vv-top');
        modal.style.removeProperty('--nt-feedback-vv-height');
    }
    if (typeof window.openSmoothModal === 'function') {
        window.openSmoothModal('account-modal');
    }
}

/** Wait until the commuter signs in, closes the account modal, or times out. */
export function waitForSignedIn(timeoutMs = 90000) {
    if ($account.get().status === 'signed-in') return Promise.resolve(true);
    return new Promise((resolve) => {
        let done = false;
        let obs = null;
        const finish = (ok) => {
            if (done) return;
            done = true;
            try { unsub(); } catch { /* ignore */ }
            try { obs?.disconnect(); } catch { /* ignore */ }
            clearTimeout(timer);
            resolve(ok);
        };
        const unsub = $account.subscribe((s) => {
            if (s.status === 'signed-in') finish(true);
        });
        const timer = setTimeout(() => finish($account.get().status === 'signed-in'), timeoutMs);
        const modal = typeof document !== 'undefined' ? document.getElementById('account-modal') : null;
        if (modal && typeof MutationObserver !== 'undefined') {
            setTimeout(() => {
                if (done) return;
                obs = new MutationObserver(() => {
                    if (modal.classList.contains('hidden') && $account.get().status !== 'signed-in') {
                        finish(false);
                    }
                });
                obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
            }, 400);
        }
    });
}

/** Keep in sync with ui.js ACCOUNT_SHEET_HASHES. */
const ACCOUNT_SHEET_HASH = {
    'account-points-sheet': '#account-points',
    'account-name-sheet': '#account-name',
    'account-badge-how-sheet': '#account-badge',
    'account-contrib-sheet': '#account-contrib',
};
const ACCOUNT_SHEET_ORDER = ['account-contrib-sheet', 'account-badge-how-sheet', 'account-name-sheet', 'account-points-sheet'];
const accountSheetStack = [];

function hideAccountSheetEl(id) {
    document.getElementById(id)?.classList.add('hidden');
    const at = accountSheetStack.lastIndexOf(id);
    if (at >= 0) accountSheetStack.splice(at, 1);
}

function topAccountSheetId() {
    const stacked = accountSheetStack[accountSheetStack.length - 1];
    if (stacked) {
        const el = document.getElementById(stacked);
        if (el && !el.classList.contains('hidden')) return stacked;
    }
    for (const id of ACCOUNT_SHEET_ORDER) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) return id;
    }
    return null;
}

function showAccountSheet(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    const at = accountSheetStack.indexOf(id);
    if (at >= 0) accountSheetStack.splice(at, 1);
    accountSheetStack.push(id);
    const hash = ACCOUNT_SHEET_HASH[id];
    if (hash && location.hash !== hash) {
        try { history.pushState({ accountSheet: id }, '', hash); } catch { /* ignore */ }
    }
}

function requestCloseAccountSheet(id) {
    const hash = ACCOUNT_SHEET_HASH[id];
    if (hash && location.hash === hash) {
        try { history.back(); return; } catch { /* hide below */ }
    }
    hideAccountSheetEl(id);
}

function accountSheetOnPop(hashNow) {
    const top = topAccountSheetId();
    if (!top) return false;
    if (ACCOUNT_SHEET_HASH[top] === hashNow) return false;
    hideAccountSheetEl(top);
    return true;
}

function closeAccountSheets() {
    for (const id of Object.keys(ACCOUNT_SHEET_HASH)) hideAccountSheetEl(id);
    accountSheetStack.length = 0;
}

function setAccountProfileOpen(open) {
    if (!open) closeAccountSheets();
}

export function closeAccountModal() {
    if (accountSheetStack.length || topAccountSheetId()) {
        const top = topAccountSheetId();
        if (top) requestCloseAccountSheet(top);
        return;
    }
    setAccountProfileOpen(false);
    if (typeof window.closeSmoothModal === 'function') {
        window.closeSmoothModal('account-modal');
    }
}

/** Sync Settings → Account row from $account */
export function syncAccountSettingsUi(state = $account.get()) {
    if (typeof document === 'undefined') return;
    const nameEl = document.getElementById('settings-account-name');
    const subEl = document.getElementById('settings-account-sub');
    const avatarEl = document.getElementById('settings-account-avatar');
    const avatarImg = document.getElementById('settings-account-avatar-img');
    const avatarPh = document.getElementById('settings-account-avatar-ph');
    const signedBlock = document.getElementById('account-signed-in');
    const guestBlock = document.getElementById('account-guest');
    const modalName = document.getElementById('account-modal-display-name');
    const modalEmail = document.getElementById('account-modal-email');

    const signed = state.status === 'signed-in';
    if (nameEl) nameEl.textContent = signed ? (state.displayName || 'Passenger') : 'Account';
    if (subEl) {
        subEl.textContent = state.status === 'loading'
            ? 'Checking…'
            : signed
                ? (state.email || 'Signed in')
                : 'Guest · Sign in optional';
    }
    if (avatarImg && avatarPh) {
        const photo = signed ? (state.photoURL || '') : '';
        const failed = avatarImg.dataset.ntPhotoFailed || '';
        if (photo && failed !== photo) {
            avatarImg.referrerPolicy = 'no-referrer';
            if (avatarImg.getAttribute('src') !== photo) avatarImg.src = photo;
            avatarImg.classList.remove('hidden');
            avatarPh.classList.add('hidden');
        } else {
            avatarImg.classList.add('hidden');
            avatarPh.classList.remove('hidden');
            avatarPh.textContent = signed
                ? (state.displayName || 'P').charAt(0).toUpperCase()
                : '?';
        }
    }
    if (avatarEl) avatarEl.setAttribute('data-signed-in', signed ? 'true' : 'false');
    if (signedBlock) signedBlock.classList.toggle('hidden', !signed);
    if (guestBlock) guestBlock.classList.toggle('hidden', signed || state.status === 'loading');
    const sessionActions = document.getElementById('account-session-actions');
    if (sessionActions) sessionActions.classList.toggle('hidden', !signed);
    document.getElementById('account-prefs-label')?.classList.toggle('hidden', !signed);
    document.getElementById('account-signin-create-hint')?.classList.add('hidden');
    const deleteWrap = document.getElementById('account-delete-wrap');
    const isOperator = signed && isAdminEmail(state.email);
    if (deleteWrap) {
        deleteWrap.classList.toggle('hidden', !signed || isOperator);
    }
    if (!signed) {
        document.getElementById('account-delete-confirm')?.classList.add('hidden');
        const typeInput = document.getElementById('account-delete-type');
        if (typeInput) typeInput.value = '';
        const confirmBtn = document.getElementById('account-delete-confirm-btn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.classList.add('opacity-40');
        }
        closeAccountSheets();
        setAccountProfileOpen(false);
        const photoBox = document.getElementById('account-photo-alerts');
        if (photoBox) delete photoBox.dataset.dirty;
        const marksBox = document.getElementById('account-marks-community');
        if (marksBox) delete marksBox.dataset.dirty;
        if (modalName) modalName.textContent = 'Passenger';
        if (modalEmail) modalEmail.textContent = '';
    } else {
        if (modalName) modalName.textContent = state.displayName || 'Passenger';
        if (modalEmail) modalEmail.textContent = state.email || '';
        const verifyRow = document.getElementById('account-verify-row');
        const verifyLabel = document.getElementById('account-verify-label');
        const needsVerify = !!state.email && state.authProvider === 'password' && !state.emailVerified;
        if (verifyRow) verifyRow.classList.toggle('hidden', !needsVerify);
        if (verifyLabel) verifyLabel.textContent = needsVerify ? 'Not verified' : 'Verified';
        const nameInput = document.getElementById('account-edit-display-name');
        if (nameInput && document.activeElement !== nameInput) {
            nameInput.value = state.displayName || '';
        }
    }
    const contribWrap = document.getElementById('account-contrib-wrap');
    if (contribWrap) contribWrap.classList.toggle('hidden', !signed);
    document.getElementById('account-guest-points-wrap')?.classList.add('hidden');
    const sidenavPoints = document.getElementById('settings-account-points');
    if (sidenavPoints) sidenavPoints.classList.toggle('hidden', !signed);
    const letterEl = document.getElementById('account-modal-avatar-letter');
    const modalImg = document.getElementById('account-modal-avatar-img');
    if (letterEl) {
        letterEl.textContent = signed
            ? (state.displayName || state.email || 'P').charAt(0).toUpperCase()
            : '?';
        const photo = signed ? (state.photoURL || '') : '';
        const failed = modalImg?.dataset.ntPhotoFailed || '';
        letterEl.classList.toggle('hidden', !!(photo && modalImg && failed !== photo));
    }
    if (modalImg) {
        const photo = signed ? (state.photoURL || '') : '';
        const failed = modalImg.dataset.ntPhotoFailed || '';
        if (photo && failed !== photo) {
            modalImg.referrerPolicy = 'no-referrer';
            if (modalImg.getAttribute('src') !== photo) modalImg.src = photo;
            modalImg.classList.remove('hidden');
        } else {
            modalImg.classList.add('hidden');
            if (!photo) modalImg.removeAttribute('src');
        }
    }
    const photoToggle = document.getElementById('account-photo-alerts');
    if (photoToggle && photoToggle.dataset.dirty !== '1') {
        import('./rider-marks.js').then((m) => {
            photoToggle.checked = !!m.showPhotoInAlerts();
        }).catch(() => {});
    }
    const marksToggle = document.getElementById('account-marks-community');
    if (marksToggle && marksToggle.dataset.dirty !== '1') {
        import('./rider-marks.js').then((m) => {
            marksToggle.checked = !!m.showMarksInCommunity();
        }).catch(() => {});
    }
    import('./rider-marks.js').then((m) => m.syncRiderMarksUi()).catch(() => {});
    const paxLabel = $userProfile.get() || document.getElementById('settings-profile-display')?.textContent || 'Adult';
    const accountPax = document.getElementById('account-passenger-type-display');
    if (accountPax) accountPax.textContent = paxLabel;
    if (typeof window.placeAccountSettings === 'function') {
        const accountOn = document.documentElement.getAttribute('data-account-settings') === '1'
            || !document.getElementById('settings-account-btn')?.classList.contains('hidden');
        window.placeAccountSettings(accountOn);
    }
    const cluster = document.getElementById('settings-profile-cluster');
    const hosted = !!cluster?.closest('#account-settings-host');
    if (cluster) cluster.classList.toggle('hidden', signed && hosted);
}

export function syncAuthProviderUi(providers = getAuthProviders(), busy = _accountUiBusy) {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-account-provider]').forEach((button) => {
        const provider = button.getAttribute('data-account-provider');
        const unavailable = isAuthProviderActionDisabled(provider, providers, false);
        button.disabled = isAuthProviderActionDisabled(provider, providers, busy);
        button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
        button.classList.toggle('nt-account-provider-disabled', unavailable);
        button.querySelector('[data-provider-unavailable]')?.classList.toggle('hidden', !unavailable);
    });
}

function escapeAccountHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function badgeGlyph(kind, filled) {
    const stroke = filled ? '#d97706' : '#9ca3af';
    const fill = filled ? '#fef3c7' : '#f3f4f6';
    const icons = {
        community: `<path d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l.8-3.2A7.5 7.5 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>`,
        map: `<path d="M12 21s7-4.5 7-11a7 7 0 10-14 0c0 6.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>`,
        delay: `<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>`,
        validate: `<path d="M20 6L9 17l-5-5"/>`,
        streak3: `<path d="M12 3l2.1 6.3H21l-5.4 3.9 2.1 6.3L12 15.6 6.3 19.5l2.1-6.3L3 9.3h6.9z"/>`,
        streak5: `<path d="M12 2l3 6 7 .9-5 4.9 1.2 7L12 17.8 5.8 20.8 7 13.8 2 8.9 9 8z"/>`,
    };
    const d = icons[kind] || icons.community;
    return `<svg class="w-7 h-7" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function badgeSvg(kind, ratio) {
    const pct = Math.max(0, Math.min(100, Math.round((Number(ratio) || 0) * 100)));
    const top = 100 - pct;
    return `<span class="relative inline-block w-7 h-7 mx-auto">
        <span class="block opacity-40">${badgeGlyph(kind, false)}</span>
        <span class="absolute inset-0 overflow-hidden" style="clip-path: inset(${top}% 0 0 0)">${badgeGlyph(kind, true)}</span>
    </span>`;
}

function closeBadgeHowSheet() {
    requestCloseAccountSheet('account-badge-how-sheet');
}

function closeContributionSheet() {
    requestCloseAccountSheet('account-contrib-sheet');
}

function contributionSheetLines(item, marks) {
    const lines = typeof marks.contributionDetailLines === 'function'
        ? marks.contributionDetailLines(item)
        : [];
    if (item?.action === 'first_share_day') {
        if (!lines.length) lines.push('Trip details were not saved for this share.');
        return lines;
    }
    if (!lines.length && item?.how) lines.push(item.how);
    return lines;
}

function shareTripBlocks(state, marks) {
    const days = typeof marks.listContributionDays === 'function'
        ? marks.listContributionDays(state, { limit: 30 })
        : [];
    const trips = [];
    for (const day of days) {
        for (const item of day.items || []) {
            if (item.action !== 'first_share_day') continue;
            const when = day.day && typeof marks.formatContributionDate === 'function'
                ? marks.formatContributionDate(day.day)
                : '';
            const lines = contributionSheetLines(item, marks);
            trips.push({ when, lines });
        }
    }
    return trips;
}

function openContributionSheet(item, marks) {
    const sheet = document.getElementById('account-contrib-sheet');
    if (!sheet || !item) return;
    const title = document.getElementById('account-contrib-title');
    const points = document.getElementById('account-contrib-points');
    const body = document.getElementById('account-contrib-body');
    if (title) title.textContent = item.title || 'Contribution';
    if (points) {
        const n = Number(item.points) || 0;
        points.textContent = `+${n} ${marks.pointsWord(n)}`;
    }
    if (body) {
        const lines = contributionSheetLines(item, marks);
        body.innerHTML = (lines.length ? lines : ['Points from this action.']).map((line) => (
            `<p>${escapeAccountHtml(line)}</p>`
        )).join('');
    }
    showAccountSheet('account-contrib-sheet');
}

function openBadgeHowSheet(badgeId, state, marks) {
    const sheet = document.getElementById('account-badge-how-sheet');
    const cat = marks.MARK_CATALOG.find((c) => c.id === badgeId);
    if (!sheet || !cat) return;
    const on = marks.badgeUnlocked(badgeId, state);
    const progress = typeof marks.badgeProgress === 'function' ? marks.badgeProgress(badgeId, state) : { current: on ? 1 : 0, total: 1, unlocked: on };
    const title = document.getElementById('account-badge-how-title');
    const status = document.getElementById('account-badge-how-status');
    const body = document.getElementById('account-badge-how-body');
    const prereq = document.getElementById('account-badge-how-prereq');
    if (title) title.textContent = cat.title;
    if (status) {
        if (on) status.textContent = 'Unlocked';
        else if (progress.total > 1 && progress.current > 0) status.textContent = `${progress.current} of ${progress.total} service days`;
        else status.textContent = 'Not unlocked yet';
    }
    if (body) {
        if (badgeId === 'first_share_day') {
            const trips = shareTripBlocks(state, marks);
            if (trips.length) {
                body.innerHTML = trips.map((trip) => {
                    const head = trip.when
                        ? `<p class="font-semibold text-gray-800 dark:text-gray-100">${escapeAccountHtml(trip.when)}</p>`
                        : '';
                    const rest = trip.lines.map((line) => `<p>${escapeAccountHtml(line)}</p>`).join('');
                    return `<div class="space-y-1">${head}${rest}</div>`;
                }).join('');
            } else if (on) {
                body.textContent = 'Trip details were not saved for this share.';
            } else {
                body.textContent = `${cat.how} ${cat.points} ${marks.pointsWord(cat.points)}.`;
            }
        } else {
            body.textContent = `${cat.how} ${cat.points} ${marks.pointsWord(cat.points)}.`;
        }
    }
    const needs = Array.isArray(cat.requires) ? cat.requires : [];
    const missing = needs.filter((id) => !marks.badgeUnlocked(id, state)).map((id) => {
        const row = marks.MARK_CATALOG.find((c) => c.id === id);
        return row?.title || id;
    });
    if (prereq) {
        if (missing.length) {
            prereq.textContent = `Need first: ${missing.join(', ')}.`;
            prereq.classList.remove('hidden');
        } else {
            prereq.textContent = '';
            prereq.classList.add('hidden');
        }
    }
    showAccountSheet('account-badge-how-sheet');
}

export function paintAccountPoints(state) {
    if (typeof document === 'undefined') return;
    import('./rider-marks.js').then((m) => {
        const st = state || m.readMarks();
        const tier = m.tierForPoints(st.points);
        const next = m.nextTierForPoints(st.points);
        const progressEl = document.getElementById('account-points-progress');
        const bar = document.getElementById('account-points-bar');
        if (progressEl) {
            if (next) {
                const need = next.min - st.points;
                progressEl.textContent = `${tier.label} · ${st.points} ${m.pointsWord(st.points)}. ${need} more to ${next.label} (${next.min}).`;
            } else {
                progressEl.textContent = `${tier.label} · ${st.points} ${m.pointsWord(st.points)}. Highest level.`;
            }
        }
        if (bar) {
            if (!next) bar.style.width = '100%';
            else {
                const prevMin = tier.min;
                const span = Math.max(1, next.min - prevMin);
                bar.style.width = `${Math.max(6, Math.min(100, ((st.points - prevMin) / span) * 100))}%`;
            }
        }
        const tiers = document.getElementById('account-tier-list');
        if (tiers) {
            tiers.innerHTML = m.MARK_TIERS.map((t) => {
                const here = t.id === tier.id;
                return `<li class="flex justify-between gap-2 ${here ? 'font-bold text-amber-800 dark:text-amber-200' : ''}"><span>${escapeAccountHtml(t.label)}</span><span>${t.min}+ points</span></li>`;
            }).join('');
        }
        const earn = document.getElementById('account-earn-list');
        if (earn) {
            earn.innerHTML = m.MARK_CATALOG.map((c) => (
                `<li><span class="font-semibold text-gray-800 dark:text-gray-200">${escapeAccountHtml(c.title)}</span> · ${c.points} ${m.pointsWord(c.points)}. ${escapeAccountHtml(c.how)}</li>`
            )).join('');
        }
        const contrib = document.getElementById('account-contrib-list');
        if (contrib) {
            const days = typeof m.listContributionDays === 'function'
                ? m.listContributionDays(st)
                : [];
            const painted = new Map();
            contrib.innerHTML = days.length
                ? days.map((day) => {
                    const when = day.day && typeof m.formatContributionDate === 'function'
                        ? m.formatContributionDate(day.day)
                        : (day.day ? day.day : 'Earlier');
                    const items = (day.items || []).map((item, index) => {
                        const id = `${day.day || 'earlier'}:${index}`;
                        painted.set(id, item);
                        const label = `${item.title} (+${item.points})`;
                        return `<button type="button" data-contrib-id="${escapeAccountHtml(id)}" class="account-contrib-event w-full text-left rounded-lg px-2.5 py-2 text-[13px] font-semibold text-gray-800 dark:text-gray-100 bg-[#f2f2f7] dark:bg-[#2c2c2e] border border-black/10 dark:border-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">${escapeAccountHtml(label)}</button>`;
                    }).join('');
                    return `<li class="space-y-1.5">
                        <div class="flex justify-between gap-3 px-0.5">
                            <span>${escapeAccountHtml(when)}</span>
                            <span class="shrink-0 font-semibold">+${day.total}</span>
                        </div>
                        <div class="flex flex-col gap-1.5">${items}</div>
                    </li>`;
                }).join('')
                : '<li>No contributions yet. Earn points from the actions above.</li>';
            contrib.onclick = (ev) => {
                const btn = ev.target?.closest?.('[data-contrib-id]');
                if (!btn) return;
                const item = painted.get(btn.getAttribute('data-contrib-id'));
                if (item) openContributionSheet(item, m);
            };
        }
        const grid = document.getElementById('account-badge-grid');
        if (grid) {
            const badges = [
                { id: 'first_community_post', kind: 'community', title: 'First post' },
                { id: 'first_share_day', kind: 'map', title: 'Trip share' },
                { id: 'delay_report', kind: 'delay', title: 'Delay report' },
                { id: 'delay_confirm', kind: 'validate', title: 'Validation' },
                { id: 'streak_3day', kind: 'streak3', title: '3-day streak' },
                { id: 'streak_5day', kind: 'streak5', title: '5-day streak' },
            ];
            grid.innerHTML = badges.map((b) => {
                const progress = m.badgeProgress(b.id, st);
                const on = progress.unlocked;
                const warm = progress.ratio > 0;
                return `<button type="button" data-badge-id="${escapeAccountHtml(b.id)}" class="rounded-xl border px-1.5 py-2 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${warm ? 'border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/20' : 'border-gray-100 dark:border-gray-800 opacity-55'}">${badgeSvg(b.kind, progress.ratio)}<p class="mt-1 text-[9px] font-bold leading-tight ${on ? 'text-amber-800 dark:text-amber-200' : 'text-gray-400'}">${escapeAccountHtml(b.title)}</p></button>`;
            }).join('');
            grid.onclick = (ev) => {
                const btn = ev.target?.closest?.('[data-badge-id]');
                if (!btn) return;
                openBadgeHowSheet(btn.getAttribute('data-badge-id'), st, m);
            };
        }
    }).catch(() => {});
}

export function bindAccountUi() {
    if (typeof document === 'undefined') return;
    if (window.__ntAccountUiBound) {
        syncAccountSettingsUi();
        syncAuthProviderUi();
        return;
    }
    window.__ntAccountUiBound = true;

    const watchPhoto = (imgId, letterId) => {
        const img = document.getElementById(imgId);
        if (!img || img.dataset.ntPhotoWatch === '1') return;
        img.dataset.ntPhotoWatch = '1';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => {
            const failed = img.currentSrc || img.src || '';
            if (failed) img.dataset.ntPhotoFailed = failed;
            img.classList.add('hidden');
            document.getElementById(letterId)?.classList.remove('hidden');
        });
    };
    watchPhoto('account-modal-avatar-img', 'account-modal-avatar-letter');
    watchPhoto('settings-account-avatar-img', 'settings-account-avatar-ph');

    $account.subscribe(syncAccountSettingsUi);
    syncAccountSettingsUi();
    syncAuthProviderUi();
    loadAuthProviders().then((providers) => syncAuthProviderUi(providers)).catch(() => {});
    import('./rider-marks.js').then((m) => m.hydrateRemoteMarks()).catch(() => {});

    const open = () => {
        if (typeof window.triggerHaptic === 'function') window.triggerHaptic();
        openAccountModal();
    };
    document.getElementById('settings-account-btn')?.addEventListener('click', open);

    document.getElementById('account-modal-close')?.addEventListener('click', closeAccountModal);

    const setBusy = (busy) => {
        _accountUiBusy = !!busy;
        document.querySelectorAll('[data-account-action]').forEach((el) => {
            if (!el.hasAttribute('data-account-provider')) el.disabled = _accountUiBusy;
            el.classList.toggle('opacity-60', !!busy);
        });
        syncAuthProviderUi(getAuthProviders(), _accountUiBusy);
        if (busy) {
            const err = document.getElementById('account-error');
            if (err) err.textContent = '';
        }
    };
    const showErr = (msg) => {
        const err = document.getElementById('account-error');
        if (err) {
            err.textContent = msg || 'Something went wrong.';
            try { err.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
        }
    };

    document.getElementById('account-google-btn')?.addEventListener('click', async () => {
        setBusy(true);
        try {
            await signInWithGoogle();
            if (typeof window.showToast === 'function') window.showToast('Signed in', 'success');
            paintAccountPoints();
        } catch (e) {
            showErr(e?.code === 'auth/popup-closed-by-user' ? 'Sign-in cancelled.' : friendlyAuthError(e) || 'Google sign-in failed.');
        } finally {
            setBusy(false);
        }
    });

    document.getElementById('account-facebook-btn')?.addEventListener('click', async () => {
        setBusy(true);
        try {
            await signInWithFacebook();
            if (typeof window.showToast === 'function') window.showToast('Signed in', 'success');
            paintAccountPoints();
        } catch (e) {
            showErr(e?.code === 'auth/popup-closed-by-user' ? 'Sign-in cancelled.' : friendlyAuthError(e));
        } finally {
            setBusy(false);
        }
    });

    document.getElementById('account-email-signin-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('account-email')?.value;
        const password = document.getElementById('account-password')?.value;
        if (!email || !password) {
            showErr('Enter email and password.');
            return;
        }
        setBusy(true);
        try {
            await signInWithEmail(email, password);
            if (typeof window.showToast === 'function') window.showToast('Signed in', 'success');
            paintAccountPoints();
        } catch (e) {
            showErr(friendlyAuthError(e));
            const hint = document.getElementById('account-signin-create-hint');
            if (hint && ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(e?.code || '')) {
                hint.classList.remove('hidden');
            }
        } finally {
            setBusy(false);
        }
    });

    document.getElementById('account-forgot-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('account-email')?.value;
        setBusy(true);
        try {
            await sendAccountPasswordReset(email);
            if (typeof window.showToast === 'function') window.showToast('Password reset email sent', 'success');
        } catch (e) {
            showErr(friendlyAuthError(e) || e?.message || 'Could not send reset email.');
        } finally {
            setBusy(false);
        }
    });

    document.getElementById('account-email-signup-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('account-email')?.value;
        const password = document.getElementById('account-password')?.value;
        const displayName = document.getElementById('account-display-name')?.value;
        if (!email || !password) {
            showErr('Enter email and password.');
            return;
        }
        if (password.length < 6) {
            showErr('Password must be at least 6 characters.');
            return;
        }
        setBusy(true);
        try {
            await signUpWithEmail(email, password, displayName);
            if (typeof window.showToast === 'function') window.showToast('Account created', 'success');
            paintAccountPoints();
        } catch (e) {
            if (e?.message === DISPLAY_NAME_REFUSE_MSG) {
                if (typeof window.showToast === 'function') window.showToast(DISPLAY_NAME_REFUSE_MSG);
                showErr(DISPLAY_NAME_REFUSE_MSG);
            } else {
                showErr(friendlyAuthError(e));
            }
        } finally {
            setBusy(false);
        }
    });

    document.getElementById('account-save-display-name')?.addEventListener('click', async () => {
        const input = document.getElementById('account-edit-display-name');
        const photo = document.getElementById('account-photo-alerts');
        const nameErr = document.getElementById('account-name-error');
        if (nameErr) nameErr.textContent = '';
        setBusy(true);
        try {
            const next = await updateAccountDisplayName(input?.value || '');
            if (input) input.value = next;
            const { setShowPhotoInAlerts } = await import('./rider-marks.js');
            await setShowPhotoInAlerts(!!photo?.checked);
            await pushSignedInPrefs({ showPhotoInAlerts: !!photo?.checked });
            if (photo) delete photo.dataset.dirty;
            if (typeof window.showToast === 'function') window.showToast('Saved', 'success');
            requestCloseAccountSheet('account-name-sheet');
        } catch (e) {
            const msg = e?.message || 'Could not save.';
            if (msg === DISPLAY_NAME_REFUSE_MSG && typeof window.showToast === 'function') {
                window.showToast(DISPLAY_NAME_REFUSE_MSG);
            }
            if (nameErr) nameErr.textContent = msg;
            showErr(msg);
        } finally {
            setBusy(false);
        }
    });

    const askSignOutConfirm = () => new Promise((resolve) => {
        const sheet = document.getElementById('account-signout-confirm');
        if (!sheet) {
            resolve(typeof window.confirm === 'function' ? window.confirm('Sign out?') : true);
            return;
        }
        sheet.classList.remove('hidden');
        const yes = document.getElementById('account-signout-confirm-btn');
        const no = document.getElementById('account-signout-cancel-btn');
        const finish = (ok) => {
            sheet.classList.add('hidden');
            yes?.removeEventListener('click', onYes);
            no?.removeEventListener('click', onNo);
            resolve(ok);
        };
        const onYes = () => finish(true);
        const onNo = () => finish(false);
        yes?.addEventListener('click', onYes);
        no?.addEventListener('click', onNo);
    });

    document.getElementById('account-signout-btn')?.addEventListener('click', async () => {
        const ok = await askSignOutConfirm();
        if (!ok) return;
        setBusy(true);
        try {
            await signOutAccount();
            if (typeof window.showToast === 'function') window.showToast('Signed out');
        } catch (e) {
            showErr(e?.message || 'Sign-out failed.');
        } finally {
            setBusy(false);
        }
    });

    document.getElementById('account-verify-resend-btn')?.addEventListener('click', async () => {
        setBusy(true);
        try {
            await resendAccountVerification();
            if (typeof window.showToast === 'function') window.showToast('Verification email sent', 'success');
        } catch (e) {
            showErr(e?.message || 'Could not send verification email.');
        } finally {
            setBusy(false);
        }
    });

    const deleteConfirm = document.getElementById('account-delete-confirm');
    const deleteType = document.getElementById('account-delete-type');
    const deleteConfirmBtn = document.getElementById('account-delete-confirm-btn');
    const syncDeleteType = () => {
        const ok = (deleteType?.value || '') === 'DELETE';
        if (deleteConfirmBtn) {
            deleteConfirmBtn.disabled = !ok;
            deleteConfirmBtn.classList.toggle('opacity-40', !ok);
        }
    };
    document.getElementById('account-delete-btn')?.addEventListener('click', () => {
        if (isAdminEmail($account.get().email)) {
            showErr('This account cannot be deleted in the app.');
            return;
        }
        if (deleteType) deleteType.value = '';
        syncDeleteType();
        deleteConfirm?.classList.remove('hidden');
        deleteType?.focus();
    });
    document.getElementById('account-delete-cancel-btn')?.addEventListener('click', () => {
        deleteConfirm?.classList.add('hidden');
        if (deleteType) deleteType.value = '';
        syncDeleteType();
    });
    deleteType?.addEventListener('input', syncDeleteType);
    document.getElementById('account-delete-confirm-btn')?.addEventListener('click', async () => {
        if ((deleteType?.value || '') !== 'DELETE') return;
        setBusy(true);
        try {
            await requestAccountDeletion();
            if (typeof window.showToast === 'function') window.showToast('Deletion request sent');
        } catch (e) {
            showErr(e?.message || 'Could not send the deletion request.');
        } finally {
            setBusy(false);
        }
    });

    const openPointsSheet = () => {
        if (!document.getElementById('account-points-sheet')) return;
        paintAccountPoints();
        showAccountSheet('account-points-sheet');
    };
    const closePointsSheet = () => requestCloseAccountSheet('account-points-sheet');
    document.getElementById('account-points-btn')?.addEventListener('click', openPointsSheet);
    document.getElementById('account-points-guest-btn')?.addEventListener('click', openPointsSheet);
    document.getElementById('account-points-close')?.addEventListener('click', closePointsSheet);
    document.getElementById('account-points-overlay')?.addEventListener('click', closePointsSheet);

    const openNameSheet = () => {
        const input = document.getElementById('account-edit-display-name');
        const nameErr = document.getElementById('account-name-error');
        if (nameErr) nameErr.textContent = '';
        if (input) input.value = $account.get().displayName || '';
        showAccountSheet('account-name-sheet');
        setTimeout(() => input?.focus(), 40);
    };
    const closeNameSheet = () => requestCloseAccountSheet('account-name-sheet');
    document.getElementById('account-name-edit-btn')?.addEventListener('click', openNameSheet);
    document.getElementById('account-name-close')?.addEventListener('click', closeNameSheet);
    document.getElementById('account-name-overlay')?.addEventListener('click', closeNameSheet);
    document.getElementById('account-passenger-type-btn')?.addEventListener('click', () => {
        if (typeof window.triggerHaptic === 'function') window.triggerHaptic();
        if (typeof window.openSmoothModal === 'function') window.openSmoothModal('profile-modal');
    });
    document.getElementById('account-photo-toggle')?.addEventListener('click', (e) => {
        const t = e.target;
        if (t.tagName === 'INPUT' || t.tagName === 'LABEL') return;
        const cb = document.getElementById('account-photo-alerts');
        if (!cb) return;
        cb.checked = !cb.checked;
        cb.dataset.dirty = '1';
    });
    document.getElementById('account-photo-alerts')?.addEventListener('change', (e) => {
        e.target.dataset.dirty = '1';
    });
    const persistMarksVisibility = async (on) => {
        try {
            const { setShowMarksInCommunity } = await import('./rider-marks.js');
            await setShowMarksInCommunity(!!on);
            await pushSignedInPrefs({ showMarksInCommunity: !!on });
        } catch { /* local switch still shows the choice */ }
    };
    document.getElementById('account-marks-toggle')?.addEventListener('click', (e) => {
        const t = e.target;
        if (t.tagName === 'INPUT' || t.tagName === 'LABEL') return;
        const cb = document.getElementById('account-marks-community');
        if (!cb) return;
        cb.checked = !cb.checked;
        delete cb.dataset.dirty;
        persistMarksVisibility(cb.checked);
    });
    document.getElementById('account-marks-community')?.addEventListener('change', (e) => {
        delete e.target.dataset.dirty;
        persistMarksVisibility(e.target.checked);
    });

    document.getElementById('account-badge-how-close')?.addEventListener('click', closeBadgeHowSheet);
    document.getElementById('account-badge-how-overlay')?.addEventListener('click', closeBadgeHowSheet);
    document.getElementById('account-contrib-close')?.addEventListener('click', closeContributionSheet);
    document.getElementById('account-contrib-overlay')?.addEventListener('click', closeContributionSheet);

    paintAccountPoints();
}

function friendlyAuthError(e) {
    const code = e?.code || '';
    if (code === 'auth/invalid-email') return 'Invalid email address.';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        return 'Wrong email or password.';
    }
    if (code === 'auth/email-already-in-use') return 'Email already registered - try Sign in.';
    if (code === 'auth/weak-password') return 'Password is too weak.';
    if (code === 'auth/network-request-failed') return 'Network error - try again.';
    if (code === 'auth/unauthorized-domain') return 'This site cannot sign in. Open nexttrain.co.za.';
    if (code === 'auth/popup-blocked') return 'Popup blocked. Allow popups and try again.';
    if (code === 'auth/operation-not-allowed') return 'Facebook sign-in is not enabled yet. Try Google or email.';
    if (code === 'auth/account-exists-with-different-credential') {
        return 'That email is already used with another sign-in method.';
    }
    return e?.message || 'Authentication failed.';
}

if (typeof window !== 'undefined') {
    window.__ntAccountSheetOnPop = accountSheetOnPop;
    window.openAccountModal = openAccountModal;
    window.waitForSignedIn = waitForSignedIn;
    window.signOutAccount = signOutAccount;
    window.paintAccountPoints = paintAccountPoints;
    window.updateAccountDisplayName = updateAccountDisplayName;
    window.formatAccountDisplayName = formatAccountDisplayName;
    window.pushSignedInPrefs = pushSignedInPrefs;
    window.pickCanonicalChatDeviceId = pickCanonicalChatDeviceId;
    window.$account = $account;
}
