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
import { isAdminEmail, SUPPORT_EMAIL } from './config.js';
import { trackAnalyticsEvent } from './analytics.js';
import { safeStorage } from './utils.js';
import { $deviceId } from '../store.js';

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
                prefs: { showPhotoInAlerts: false },
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
            if (snap.val()?.prefs?.showPhotoInAlerts === undefined) {
                patch['prefs/showPhotoInAlerts'] = false;
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
    const uid = user?.uid || '';
    const email = user?.email || '';
    return `Please delete my Next Train account.\n\nuid: ${uid}\nemail: ${email}`;
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
        throw new Error('Operator accounts cannot use this control.');
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
    if (typeof window.syncFeedbackModalViewport === 'function') {
        window.syncFeedbackModalViewport();
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
    const deleteWrap = document.getElementById('account-delete-wrap');
    if (deleteWrap) {
        deleteWrap.classList.toggle('hidden', !signed || isAdminEmail(state.email));
    }
    if (!signed) {
        document.getElementById('account-delete-confirm')?.classList.add('hidden');
        const pointsPanel = document.getElementById('account-points-panel');
        pointsPanel?.classList.add('hidden');
        document.querySelectorAll('#account-points-btn, #account-points-guest-btn').forEach((btn) => {
            btn.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('#account-points-chevron, .account-points-chevron').forEach((el) => {
            el.classList.remove('rotate-180');
        });
        if (modalName) modalName.textContent = 'Passenger';
        if (modalEmail) modalEmail.textContent = '';
    } else {
        if (modalName) modalName.textContent = state.displayName || 'Passenger';
        if (modalEmail) modalEmail.textContent = state.email || '';
    }
    const contribWrap = document.getElementById('account-contrib-wrap');
    if (contribWrap) contribWrap.classList.toggle('hidden', !signed);
    const letterEl = document.getElementById('account-modal-avatar-letter');
    const modalImg = document.getElementById('account-modal-avatar-img');
    if (letterEl) {
        letterEl.textContent = signed
            ? (state.displayName || state.email || 'P').charAt(0).toUpperCase()
            : '?';
        letterEl.classList.toggle('hidden', !!(signed && state.photoURL && modalImg));
    }
    if (modalImg) {
        if (signed && state.photoURL) {
            modalImg.src = state.photoURL;
            modalImg.classList.remove('hidden');
        } else {
            modalImg.classList.add('hidden');
            modalImg.removeAttribute('src');
        }
    }
    const photoToggle = document.getElementById('account-photo-alerts');
    if (photoToggle && !photoToggle.dataset.userToggled) {
        import('./rider-marks.js').then((m) => {
            photoToggle.checked = !!m.showPhotoInAlerts();
        }).catch(() => {});
    }
    import('./rider-marks.js').then((m) => m.syncRiderMarksUi()).catch(() => {});
}

function escapeAccountHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function badgeSvg(kind, on) {
    const stroke = on ? '#d97706' : '#9ca3af';
    const fill = on ? '#fef3c7' : '#f3f4f6';
    const icons = {
        community: `<path d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l.8-3.2A7.5 7.5 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>`,
        map: `<path d="M12 21s7-4.5 7-11a7 7 0 10-14 0c0 6.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/>`,
        delay: `<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>`,
        validate: `<path d="M20 6L9 17l-5-5"/>`,
        streak3: `<path d="M12 3l2.1 6.3H21l-5.4 3.9 2.1 6.3L12 15.6 6.3 19.5l2.1-6.3L3 9.3h6.9z"/>`,
        streak5: `<path d="M12 2l3 6 7 .9-5 4.9 1.2 7L12 17.8 5.8 20.8 7 13.8 2 8.9 9 8z"/>`,
    };
    const d = icons[kind] || icons.community;
    return `<svg class="w-7 h-7 mx-auto" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
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
            const rows = m.listContributions(st);
            contrib.innerHTML = rows.length
                ? rows.slice(0, 12).map((row) => {
                    const when = row.at ? new Date(row.at).toLocaleDateString() : '';
                    return `<li class="flex justify-between gap-2"><span>${escapeAccountHtml(row.title)}${when ? ` · ${escapeAccountHtml(when)}` : ''}</span><span class="shrink-0 font-semibold">+${row.points}</span></li>`;
                }).join('')
                : '<li>No contributions yet. Earn points from the actions above.</li>';
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
                const on = m.badgeUnlocked(b.id, st);
                return `<div class="rounded-xl border px-1.5 py-2 text-center ${on ? 'border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/20' : 'border-gray-100 dark:border-gray-800 opacity-55'}">${badgeSvg(b.kind, on)}<p class="mt-1 text-[9px] font-bold leading-tight ${on ? 'text-amber-800 dark:text-amber-200' : 'text-gray-400'}">${escapeAccountHtml(b.title)}</p></div>`;
            }).join('');
        }
    }).catch(() => {});
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
    import('./rider-marks.js').then((m) => m.hydrateRemoteMarks()).catch(() => {});

    const open = () => {
        if (typeof window.triggerHaptic === 'function') window.triggerHaptic();
        openAccountModal();
    };
    document.getElementById('settings-account-btn')?.addEventListener('click', open);

    document.getElementById('account-modal-close')?.addEventListener('click', closeAccountModal);

    const setBusy = (busy) => {
        document.querySelectorAll('[data-account-action]').forEach((el) => {
            el.disabled = !!busy;
            el.classList.toggle('opacity-60', !!busy);
        });
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

    const deleteConfirm = document.getElementById('account-delete-confirm');
    document.getElementById('account-delete-btn')?.addEventListener('click', () => {
        if (isAdminEmail($account.get().email)) {
            showErr('Operator accounts cannot use this control.');
            return;
        }
        deleteConfirm?.classList.remove('hidden');
    });
    document.getElementById('account-delete-cancel-btn')?.addEventListener('click', () => {
        deleteConfirm?.classList.add('hidden');
    });
    document.getElementById('account-delete-confirm-btn')?.addEventListener('click', async () => {
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

    const togglePoints = () => {
        const panel = document.getElementById('account-points-panel');
        if (!panel) return;
        const open = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        document.querySelectorAll('#account-points-btn, #account-points-guest-btn').forEach((btn) => {
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        document.querySelectorAll('#account-points-chevron, .account-points-chevron').forEach((el) => {
            el.classList.toggle('rotate-180', open);
        });
        if (open) paintAccountPoints();
    };
    document.getElementById('account-points-btn')?.addEventListener('click', togglePoints);
    document.getElementById('account-points-guest-btn')?.addEventListener('click', togglePoints);

    document.getElementById('account-photo-alerts')?.addEventListener('change', async (e) => {
        const box = e.target;
        box.dataset.userToggled = '1';
        const { setShowPhotoInAlerts } = await import('./rider-marks.js');
        await setShowPhotoInAlerts(!!box.checked);
    });

    document.querySelectorAll('.account-legal-link').forEach((btn) => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-legal') || 'privacy';
            window.openLegal?.(type);
        });
    });

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
    if (code === 'auth/unauthorized-domain') return 'This host cannot sign in. Open nexttrain.co.za or ask an operator to allow this domain.';
    if (code === 'auth/popup-blocked') return 'Popup blocked. Allow popups and try again.';
    if (code === 'auth/operation-not-allowed') return 'Facebook sign-in is not enabled yet. Try Google or email.';
    if (code === 'auth/account-exists-with-different-credential') {
        return 'That email is already used with another sign-in method.';
    }
    return e?.message || 'Authentication failed.';
}

if (typeof window !== 'undefined') {
    window.openAccountModal = openAccountModal;
    window.waitForSignedIn = waitForSignedIn;
    window.signOutAccount = signOutAccount;
    window.paintAccountPoints = paintAccountPoints;
    window.$account = $account;
}
