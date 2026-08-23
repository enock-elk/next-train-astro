/**
 * Phase 4 — Passenger account foundation (Firebase Auth).
 * Guest mode remains fully usable; sign-in is optional.
 *
 * RTDB shape (design):
 *   users/{uid}: {
 *     displayName, photoURL, email?, createdAt,
 *     deviceIds: { [deviceId]: true },
 *     flags: { shadowBanned: false, shadowBannedUntil: 0, role: 'user' },
 *     trustScore: 0
 *   }
 *   devices/{deviceId}: { uid, linkedAt }  — reverse link (migration, not a wipe)
 */
import { atom } from 'nanostores';
import { bootFirebase } from './firebase-boot.js';
import { safeStorage } from './utils.js';
import { $deviceId } from '../store.js';
import { bindPasswordReveal } from './ui.js';

/** @typedef {'guest' | 'loading' | 'signed-in'} AccountStatus */

export const $account = atom({
    status: /** @type {AccountStatus} */ ('guest'),
    uid: null,
    displayName: null,
    photoURL: null,
    email: null,
});

let _inited = false;
let _unsubAuth = null;

function getDeviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || null;
}

function publishUser(user) {
    if (!user || user.isAnonymous) {
        $account.set({
            status: 'guest',
            uid: null,
            displayName: null,
            photoURL: null,
            email: null,
        });
        safeStorage.removeItem('authUid');
        return;
    }
    $account.set({
        status: 'signed-in',
        uid: user.uid,
        displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Passenger'),
        photoURL: user.photoURL || null,
        email: user.email || null,
    });
    safeStorage.setItem('authUid', user.uid);
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
 */
export async function ensureUserProfile(user) {
    if (!user || user.isAnonymous || !window.firebaseDb) return;
    const deviceId = getDeviceId();
    const userPath = `users/${user.uid}`;
    const now = Date.now();

    try {
        const snap = await window.firebaseDbGet(window.firebaseDbRef(window.firebaseDb, userPath));
        if (!snap.exists()) {
            await window.firebaseDbSet(window.firebaseDbRef(window.firebaseDb, userPath), {
                displayName: user.displayName || null,
                photoURL: user.photoURL || null,
                email: user.email || null,
                createdAt: now,
                deviceIds: deviceId ? { [deviceId]: true } : {},
                flags: {
                    shadowBanned: false,
                    shadowBannedUntil: 0,
                    role: 'user',
                },
                trustScore: 0,
            });
        } else {
            const patch = {
                displayName: user.displayName || snap.val()?.displayName || null,
                photoURL: user.photoURL || snap.val()?.photoURL || null,
                email: user.email || snap.val()?.email || null,
                updatedAt: now,
            };
            if (deviceId) patch[`deviceIds/${deviceId}`] = true;
            // Preserve existing flags; only set defaults if missing
            const flags = snap.val()?.flags;
            if (!flags) {
                patch.flags = { shadowBanned: false, shadowBannedUntil: 0, role: 'user' };
            } else if (flags.shadowBannedUntil === undefined) {
                patch['flags/shadowBannedUntil'] = 0;
            }
            if (snap.val()?.trustScore === undefined) {
                patch.trustScore = 0;
            }
            await window.firebaseDbUpdate(window.firebaseDbRef(window.firebaseDb, userPath), patch);
        }

        if (deviceId) {
            await window.firebaseDbUpdate(
                window.firebaseDbRef(window.firebaseDb, `devices/${deviceId}`),
                { uid: user.uid, linkedAt: now }
            );
        }
    } catch (e) {
        // RTDB rules may block until deployed — Auth session still valid locally
        console.warn('Account profile sync deferred', e?.message || e);
    }
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
            return;
        }
        publishUser(user);
        if (user && !user.isAnonymous) {
            await ensureUserProfile(user);
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
    const cred = await window.firebaseCreateUser(window.firebaseAuth, email.trim(), password);
    if (displayName?.trim()) {
        try {
            await window.firebaseUpdateProfile(cred.user, { displayName: displayName.trim() });
        } catch (e) { /* non-fatal */ }
    }
    await ensureUserProfile(cred.user);
    return cred.user;
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
}

export function openAccountModal() {
    if (typeof window.openSmoothModal === 'function') {
        window.openSmoothModal('account-modal');
    }
}

export function closeAccountModal() {
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
        if (signed && state.photoURL) {
            avatarImg.src = state.photoURL;
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
    if (modalName) modalName.textContent = state.displayName || 'Passenger';
    if (modalEmail) modalEmail.textContent = state.email || '';
    const letterEl = document.getElementById('account-modal-avatar-letter');
    if (letterEl) {
        letterEl.textContent = signed
            ? (state.displayName || state.email || 'P').charAt(0).toUpperCase()
            : '?';
    }
}

export function bindAccountUi() {
    if (typeof document === 'undefined') return;
    if (window.__ntAccountUiBound) {
        syncAccountSettingsUi();
        return;
    }
    window.__ntAccountUiBound = true;

    $account.subscribe(syncAccountSettingsUi);
    syncAccountSettingsUi();

    const open = () => {
        if (typeof window.triggerHaptic === 'function') window.triggerHaptic();
        openAccountModal();
    };
    bindPasswordReveal({
        inputId: 'account-password',
        buttonId: 'account-toggle-password-btn',
        openIconId: 'account-eye-open-icon',
        closedIconId: 'account-eye-closed-icon',
    });

    document.getElementById('settings-account-btn')?.addEventListener('click', open);

    document.getElementById('account-modal-close')?.addEventListener('click', closeAccountModal);
    document.getElementById('account-modal-done')?.addEventListener('click', closeAccountModal);

    const setBusy = (busy) => {
        document.querySelectorAll('[data-account-action]').forEach((el) => {
            el.disabled = !!busy;
            el.classList.toggle('opacity-60', !!busy);
        });
        const err = document.getElementById('account-error');
        if (!busy && err) err.textContent = '';
    };
    const showErr = (msg) => {
        const err = document.getElementById('account-error');
        if (err) err.textContent = msg || 'Something went wrong.';
    };

    document.getElementById('account-google-btn')?.addEventListener('click', async () => {
        setBusy(true);
        try {
            await signInWithGoogle();
            if (typeof window.showToast === 'function') window.showToast('Signed in', 'success');
            closeAccountModal();
        } catch (e) {
            showErr(e?.code === 'auth/popup-closed-by-user' ? 'Sign-in cancelled.' : (e?.message || 'Google sign-in failed.'));
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
            closeAccountModal();
        } catch (e) {
            showErr(friendlyAuthError(e));
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
            closeAccountModal();
        } catch (e) {
            showErr(friendlyAuthError(e));
        } finally {
            setBusy(false);
        }
    });

    document.getElementById('account-signout-btn')?.addEventListener('click', async () => {
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
}

function friendlyAuthError(e) {
    const code = e?.code || '';
    if (code === 'auth/invalid-email') return 'Invalid email address.';
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        return 'Wrong email or password.';
    }
    if (code === 'auth/email-already-in-use') return 'Email already registered — try Sign in.';
    if (code === 'auth/weak-password') return 'Password is too weak.';
    if (code === 'auth/network-request-failed') return 'Network error — try again.';
    if (code === 'auth/popup-blocked') return 'Popup blocked — allow popups for Google sign-in.';
    return e?.message || 'Authentication failed.';
}

if (typeof window !== 'undefined') {
    window.openAccountModal = openAccountModal;
    window.signOutAccount = signOutAccount;
    window.$account = $account;
}
