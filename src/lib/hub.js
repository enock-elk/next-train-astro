/**
 * App Hub (sidenav) + feedback + notices + cache sync + changelog badge
 */
import {
    APP_VERSION,
    CHANGELOG_DATA,
    DYNAMIC_BASE_URL,
    withBase,
    getLatestChangelog,
    getChangelogVersionId,
    normalizeChangelogId,
} from './config.js';
import { safeStorage, escapeHTML, repairMojibake, restoreDeviceIdentity, formatAppDate } from './utils.js';
import { encodeFeedbackAlertQuote } from './feedback-quote.js';
import { inboxReplyStillVisible } from './inbox-replies.js';
import { trackAnalyticsEvent } from './analytics.js';
import { prepareRichHtml, injectRichTextStyles } from './rich-text.js';
import {
    showToast, triggerHaptic, openSmoothModal, closeSmoothModal, canAutoOpenHomeNotices,
    hapticsAreEnabled, bindPasswordReveal
} from './ui.js';
import {
    fetchUnionNotices,
    setCachedLiveNotices,
    applyBellFromNotices,
    openAlertsChannel,
    initAlertsChannel,
    pickAutoOpenNotice,
    resolveAlertImageSrc,
} from './alerts-channel.js';
import { layoutAlertPost } from './alerts-feed.js';
import { $userProfile, $currentRouteId, $userRegion, $deviceId } from '../store.js';
import { isLieFi } from './logic.js';
import { bindColourPackControls, setColourPack, getColourPack } from './prefs.js';
import { markPendingReload } from './session-stability.js';
import { setupMapLogic } from './map-viewer.js';
import { applyShadowBanCloak, checkContentSafety, queueAutoModeration, checkRateLimit, recordRateHit, startRateLimitCountdown } from './trust.js';

const FEEDBACK_RATE_KEY = 'feedbackSendRateV1';
const FEEDBACK_WINDOW_MS = 30 * 60 * 1000;
const FEEDBACK_MAX = 6;
const FEEDBACK_COOLDOWN_MS = 20 * 1000;
const THREAD_CONTACT_KEY = 'nt_feedback_contact';
const FEEDBACK_FILE_MAX_BYTES = 5 * 1024 * 1024;
let feedbackWaitCancel = null;

async function uploadFeedbackAttachments(fileList) {
    if (!fileList?.length || !window.firebaseStorage || !window.firebaseStorageRef) return [];
    const files = Array.from(fileList).slice(0, 4);
    const uploads = files.map(async (file) => {
        try {
            if (file.size > FEEDBACK_FILE_MAX_BYTES) return null;
            const ext = file.name.split('.').pop();
            const fileName = `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
            const storageReference = window.firebaseStorageRef(window.firebaseStorage, `feedback_attachments/${fileName}`);
            const task = window.firebaseUploadBytesResumable(storageReference, file);
            await new Promise((resolve, reject) => {
                task.on('state_changed', null, reject, resolve);
            });
            return await window.firebaseGetDownloadURL(task.snapshot.ref);
        } catch (e) {
            console.warn('Attachment upload failed', e);
            return null;
        }
    });
    return (await Promise.all(uploads)).filter(Boolean);
}

function signedInContactEmail() {
    const email = window.firebaseAuth?.currentUser?.email;
    return (email && !window.firebaseAuth.currentUser.isAnonymous) ? String(email).trim() : '';
}

function resolveThreadContact() {
    const signedIn = signedInContactEmail();
    if (signedIn) return signedIn;
    const field = document.getElementById('messages-thread-contact')?.value?.trim() || '';
    if (field) return field;
    try { return safeStorage.getItem(THREAD_CONTACT_KEY) || ''; } catch { return ''; }
}

function paintThreadContactRow() {
    const row = document.getElementById('messages-thread-contact-row');
    const input = document.getElementById('messages-thread-contact');
    if (!row || !input) return;
    const signedIn = signedInContactEmail();
    if (signedIn) {
        input.value = signedIn;
        row.classList.add('hidden');
        return;
    }
    row.classList.remove('hidden');
    if (!input.value) {
        try { input.value = safeStorage.getItem(THREAD_CONTACT_KEY) || ''; } catch { /* ignore */ }
    }
}

function paintThreadFileChip(fileInput) {
    const preview = document.getElementById('messages-thread-file-chip');
    const nameEl = document.getElementById('messages-thread-file-name');
    if (fileInput?.files?.length) {
        if (nameEl) {
            nameEl.textContent = fileInput.files.length === 1
                ? fileInput.files[0].name
                : `${fileInput.files.length} files selected`;
        }
        preview?.classList.remove('hidden');
    } else {
        preview?.classList.add('hidden');
    }
}

function checkFeedbackRate() {
    return checkRateLimit(FEEDBACK_RATE_KEY, {
        windowMs: FEEDBACK_WINDOW_MS,
        max: FEEDBACK_MAX,
        cooldownMs: FEEDBACK_COOLDOWN_MS,
    });
}

function paintFeedbackWait(limit, hintId = 'feedback-mod-hint') {
    const el = document.getElementById(hintId);
    const submitBtn = document.getElementById('feedback-submit-btn');
    const sendBtn = document.getElementById('messages-thread-send');
    if (feedbackWaitCancel) feedbackWaitCancel();
    feedbackWaitCancel = startRateLimitCountdown(el, limit.retryAfterMs || FEEDBACK_COOLDOWN_MS, {
        reason: limit.reason || 'cooldown',
        onDone: () => {
            feedbackWaitCancel = null;
            if (submitBtn) submitBtn.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
        },
    });
    if (submitBtn) submitBtn.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
}

/** Plain text from HTML notices — insert spaces between block tags so title+body don't glue. */
function htmlToPlainSnippet(html, maxWords = 8) {
    if (!html) return '';
    const spaced = String(html)
        .replace(/<\s*br\s*\/?>/gi, ' ')
        .replace(/<\/\s*(h[1-6]|p|div|li|tr|section|article)\s*>/gi, ' ')
        .replace(/<\s*(h[1-6]|p|div|li|tr|section|article)(\s[^>]*)?>/gi, ' ');
    let text = '';
    try {
        const doc = new DOMParser().parseFromString(spaced, 'text/html');
        text = doc.body?.textContent || doc.body?.innerText || '';
    } catch {
        text = spaced.replace(/<[^>]+>/g, ' ');
    }
    text = text.replace(/\s+/g, ' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    return words.slice(0, maxWords).join(' ') + (words.length > maxWords ? '...' : '');
}

function feedbackReplySvg() {
    return '<svg class="w-4 h-4 mr-2 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
}

/** Overlay parked under feedback (e.g. developer-reply) so cancel/send restores it. */
let feedbackReturnModalId = null;

/** Unhide a higher-z overlay that was parked while feedback reply was open. */
export function restoreFeedbackReturnOverlay() {
    const id = feedbackReturnModalId;
    feedbackReturnModalId = null;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el || el.getAttribute('data-feedback-parked') !== '1') return;
    el.removeAttribute('data-feedback-parked');
    el.classList.remove('hidden', 'opacity-0');
    const inner = el.firstElementChild;
    if (inner) {
        inner.classList.remove('scale-95');
        inner.classList.add('scale-100');
    }
}

/**
 * Open feedback in reply mode without flashing home.
 * notice-modal (lower z) stays open underneath; higher-z overlays are parked then restored.
 */
export function openFeedbackReplyFromOverlay(returnModalId, replyOpts = {}) {
    enterFeedbackReplyMode(replyOpts);
    feedbackReturnModalId = returnModalId || null;
    if (returnModalId && returnModalId !== 'notice-modal') {
        const parked = document.getElementById(returnModalId);
        if (parked) {
            parked.setAttribute('data-feedback-parked', '1');
            parked.classList.add('hidden');
        }
    }
    trackAlertEvent('open_feedback_modal', {
        location: returnModalId === 'developer-reply-modal' ? 'admin_inbox_reply' : 'alert_reply',
    });
    openSmoothModal('feedback-modal');
}

/** Open the feedback modal and always ping `open_feedback_modal` with a location. */
export function openFeedbackModal({ location = 'unknown', skipClear = false } = {}) {
    if (!skipClear) {
        clearFeedbackReplyMode();
        restoreFeedbackReturnOverlay();
    }
    trackAlertEvent('open_feedback_modal', { location });
    openSmoothModal('feedback-modal');
}

/** Reset reply chrome so a fresh Feedback open is a normal form. */
export function clearFeedbackReplyMode() {
    const contextBox = document.getElementById('feedback-reply-context');
    if (contextBox) {
        contextBox.classList.add('hidden');
        contextBox.innerHTML = '';
        delete contextBox.dataset.rawMsg;
        delete contextBox.dataset.alertId;
        delete contextBox.dataset.alertKind;
    }
    const typeWrap = document.getElementById('feedback-type-wrap');
    if (typeWrap) typeWrap.classList.remove('hidden');
    const fType = document.getElementById('feedback-type');
    if (fType) {
        fType.querySelector('option[value="thread_reply"]')?.remove();
        if (fType.value === 'thread_reply') fType.value = 'general';
    }
}

/** Show reply context chip and lock type to Thread Reply. */
export function enterFeedbackReplyMode({ label = 'Replying to Advisory:', snippet = '', rawMsg = '', alertId = '', alertKind = 'notice' } = {}) {
    const fText = document.getElementById('feedback-text');
    const fType = document.getElementById('feedback-type');
    const typeWrap = document.getElementById('feedback-type-wrap');
    if (typeWrap) typeWrap.classList.add('hidden');

    let contextBox = document.getElementById('feedback-reply-context');
    if (!contextBox && fText?.parentNode) {
        contextBox = document.createElement('div');
        contextBox.id = 'feedback-reply-context';
        fText.parentNode.insertBefore(contextBox, fText);
    }
    if (contextBox) {
        contextBox.className = 'mb-1 p-3 bg-gray-100 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 italic flex items-start shadow-inner';
        contextBox.innerHTML = `${feedbackReplySvg()}<div><span class="block font-bold text-[10px] uppercase tracking-wider mb-0.5 text-gray-400">${escapeHTML(label)}</span><span class="line-clamp-2">"${escapeHTML(snippet)}"</span></div>`;
        contextBox.dataset.rawMsg = rawMsg || snippet;
        if (alertId) contextBox.dataset.alertId = alertId;
        else delete contextBox.dataset.alertId;
        contextBox.dataset.alertKind = alertKind === 'disruption' ? 'disruption' : 'notice';
        contextBox.classList.remove('hidden');
    }
    if (fText) fText.value = '';
    if (fType) {
        if (!fType.querySelector('option[value="thread_reply"]')) {
            const replyOpt = document.createElement('option');
            replyOpt.value = 'thread_reply';
            replyOpt.textContent = 'Thread Reply';
            fType.appendChild(replyOpt);
        }
        fType.value = 'thread_reply';
    }
}

export function closeAppHub(skipHistory = false) {
    const sidenav = document.getElementById('sidenav');
    const overlay = document.getElementById('sidenav-overlay');
    if (!skipHistory && location.hash === '#sidenav') {
        window._isSidenavClosing = true;
        try { history.back(); } catch { /* ignore */ }
        setTimeout(() => { window._isSidenavClosing = false; }, 150);
    }
    if (sidenav) {
        // Right drawer: closed = translate-x-full / no .open
        sidenav.classList.remove('translate-x-0', 'open', '-translate-x-full');
        sidenav.classList.add('translate-x-full');
    }
    if (overlay) {
        overlay.classList.add('opacity-0');
        overlay.classList.remove('open');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
    document.body.classList.remove('sidenav-open', 'modal-active');
    import('./ui.js').then((m) => m.syncBottomNavActive?.()).catch(() => {});
}

export function openAppHub() {
    triggerHaptic();
    // Sign-in / account chrome lives in a deferred chunk — kick it as soon as
    // the hub is actually opened so first tap is not a no-op.
    import('./account.js')
        .then(({ bindAccountUi, initAccount }) => {
            bindAccountUi();
            initAccount();
        })
        .catch(() => {});
    const sidenav = document.getElementById('sidenav');
    const overlay = document.getElementById('sidenav-overlay');
    sidenav?.classList.remove('-translate-x-full', 'translate-x-full');
    sidenav?.classList.add('translate-x-0', 'open');
    import('./ui.js').then((m) => m.syncBottomNavActive?.()).catch(() => {});
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.classList.add('open');
        setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    }
    document.body.classList.add('sidenav-open', 'modal-active');
    if (location.hash !== '#sidenav') {
        try { history.pushState({ view: 'sidenav' }, '', '#sidenav'); } catch { /* ignore */ }
    }
}

export function resetProfile() {
    triggerHaptic();
    closeAppHub(true);
    setTimeout(() => openSmoothModal('profile-modal'), 50);
}

export async function performHardCacheClear(source = 'modal_confirm') {
    triggerHaptic();
    trackAnalyticsEvent('execute_hard_cache_clear', { source });
    if (source === 'modal_confirm') {
        showToast('Clearing offline data and syncing...', 'info', 5000);
        await new Promise((r) => setTimeout(r, 600));
    }
    closeAppHub(true);
    const modal = document.getElementById('cache-clear-modal');
    if (modal) closeSmoothModal('cache-clear-modal');

    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) await reg.unregister();
        }
        if ('caches' in window) {
            const names = await caches.keys();
            for (const name of names) await caches.delete(name);
        }
        if (typeof safeStorage.flushVolatile === 'function') {
            safeStorage.flushVolatile();
        } else {
            safeStorage.removeItem(`full_db_${$userRegion.get() || 'GP'}`);
            safeStorage.removeItem('app_installed_version');
        }
        if (window.indexedDB) {
            await new Promise((resolve) => {
                try {
                    const req = indexedDB.deleteDatabase('NextTrainDB');
                    req.onsuccess = resolve;
                    req.onerror = resolve;
                    req.onblocked = resolve;
                } catch (e) { resolve(); }
            });
        }
    } catch (e) {
        console.warn('🛡️ Guardian: Failed to fully clear caches', e);
    }
    markPendingReload('cache_sync', 500);
    setTimeout(() => {
        window.location.href = window.location.pathname + '?v=' + Date.now();
    }, 500);
}

export function showCacheClearWarning() {
    if (!navigator.onLine) {
        showToast('You must be online to check for updates.', 'warning');
        return;
    }
    triggerHaptic();
    closeAppHub(true);
    let modal = document.getElementById('cache-clear-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cache-clear-modal';
        modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-md z-[140] hidden flex items-center justify-center p-4 transition-opacity duration-300';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 transform transition-all scale-95 border border-gray-200 dark:border-gray-700">
                <div class="text-center">
                    <div class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-orange-100 dark:bg-orange-900 mb-4 shadow-inner">
                        <svg class="h-6 w-6 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2m0 0H15"></path></svg>
                    </div>
                    <h3 class="text-xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">Check for App Updates?</h3>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">This clears your offline cache and reloads the latest <span class="font-bold">app version</span> from the server. Schedules refresh as part of that reload.</p>
                    <div class="flex space-x-3">
                        <button type="button" id="cache-clear-cancel" class="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold py-3 px-4 rounded-xl transition-colors focus:outline-none">Cancel</button>
                        <button type="button" id="cache-clear-confirm" class="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-colors focus:outline-none">Update App</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('#cache-clear-cancel')?.addEventListener('click', () => closeSmoothModal('cache-clear-modal'));
        modal.querySelector('#cache-clear-confirm')?.addEventListener('click', () => performHardCacheClear('modal_confirm'));
    }
    openSmoothModal('cache-clear-modal');
}

function syncProfileDisplay() {
    const el = document.getElementById('settings-profile-display');
    if (el) el.textContent = $userProfile.get() || 'Adult';
}

function syncHapticsToggle() {
    const cb = document.getElementById('settings-haptics-checkbox');
    if (cb) cb.checked = hapticsAreEnabled();
}

// What's New is a commuter surface. CHANGELOG_DATA copy must stay commuter-visible
// only — no admin mode, no internal / IP work. See the CHANGELOG_DATA comment in config.js.
function syncChangelogBadge() {
    const badge = document.getElementById('whats-new-badge');
    const verLabel = document.querySelector('#settings-app-version .font-mono');
    const latest = getLatestChangelog();
    const ver = getChangelogVersionId(latest) || APP_VERSION;
    if (verLabel) verLabel.textContent = ver;
    const seenNorm = normalizeChangelogId(safeStorage.getItem('seen_changelog_version'));
    if (badge) badge.classList.toggle('hidden', seenNorm === normalizeChangelogId(ver));
}

/** Opens the public What's New modal. Copy comes from CHANGELOG_DATA (commuter-only). */
function openChangelog() {
    triggerHaptic();
    closeAppHub(true);
    const latest = getLatestChangelog();
    const ver = getChangelogVersionId(latest) || APP_VERSION;
    safeStorage.setItem('seen_changelog_version', ver);
    syncChangelogBadge();
    if (window.Renderer?.renderChangelogModal) {
        window.Renderer.renderChangelogModal(CHANGELOG_DATA);
    }
}

/** Auto-open What's New only when the latest entry opts in via forceShow. */
function maybeForceShowChangelog() {
    const latest = getLatestChangelog();
    if (!latest?.forceShow) return;
    const ver = getChangelogVersionId(latest) || APP_VERSION;
    const seenNorm = normalizeChangelogId(safeStorage.getItem('seen_changelog_version'));
    if (seenNorm === normalizeChangelogId(ver)) return;
    openChangelog();
}

async function submitFeedback() {
    const type = document.getElementById('feedback-type')?.value;
    let text = document.getElementById('feedback-text')?.value.trim() || '';
    const email = document.getElementById('feedback-email')?.value.trim() || '';
    const fileInput = document.getElementById('feedback-file');
    const submitBtn = document.getElementById('feedback-submit-btn');
    const submitText = document.getElementById('feedback-submit-text');
    const spinner = document.getElementById('feedback-spinner');

    if (!text || text.length < 5) {
        showToast('Please provide more details (at least 5 characters).', 'error');
        return;
    }

    const limit = checkFeedbackRate();
    if (!limit.ok) {
        showToast(limit.message, 'error');
        paintFeedbackWait(limit);
        return;
    }

    const safety = checkContentSafety(text);
    if (safety.verdict === 'block') {
        showToast(safety.message, 'error');
        const hint = document.getElementById('feedback-mod-hint');
        if (hint) hint.textContent = safety.message;
        return;
    }
    if (safety.verdict === 'review') {
        await queueAutoModeration({
            source: 'feedback',
            reason: safety.reason,
            body: text,
            routeId: $currentRouteId.get() || null,
            publish: {
                kind: 'feedback',
                payload: {
                    type,
                    text,
                    email,
                    status: 'unread',
                    appVersion: APP_VERSION,
                    routeId: $currentRouteId.get() || 'none',
                    region: $userRegion.get() || 'GP',
                    timestamp: Date.now(),
                    deviceId: $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown',
                },
            },
        });
        recordRateHit(FEEDBACK_RATE_KEY, { windowMs: FEEDBACK_WINDOW_MS });
        showToast(safety.message, 'info');
        const hint = document.getElementById('feedback-mod-hint');
        if (hint) hint.textContent = safety.message;
        return;
    }

    // Prefix thread-reply context so admin can render a single quote chip
    try {
        const contextBox = document.getElementById('feedback-reply-context');
        const prefix = contextBox && !contextBox.classList.contains('hidden')
            ? String(contextBox.dataset.rawMsg || '').trim()
            : '';
        if (prefix) {
            const alertId = String(contextBox.dataset.alertId || '').trim();
            const alertKind = String(contextBox.dataset.alertKind || 'notice');
            const header = encodeFeedbackAlertQuote({
                alertId,
                kind: alertKind,
                snippet: prefix,
            });
            text = prefix.startsWith('[ALERT:') ? `${prefix}\n${text}` : `${header}\n${text}`;
        }
    } catch { /* ignore */ }

    const hasFile = !!(fileInput?.files?.length);
    triggerHaptic();
    trackAnalyticsEvent('click_submit_feedback_btn', {
        type: type || 'general',
        has_file: hasFile,
    });
    if (submitBtn) submitBtn.disabled = true;
    if (submitText) submitText.textContent = 'Sending...';
    spinner?.classList.remove('hidden');

    try {
        if (!navigator.onLine || isLieFi) {
            throw new Error('Network disconnected. Cannot submit feedback while offline.');
        }

        if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
            await window.firebaseSignInAnonymously(window.firebaseAuth);
        }
        let authToken = '';
        if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
            authToken = await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true);
        }

        let attachmentUrls = [];
        if (hasFile && window.firebaseStorage && window.firebaseStorageRef) {
            if (submitText) submitText.textContent = 'Uploading Files...';
            attachmentUrls = await uploadFeedbackAttachments(fileInput.files);
        }

        if (submitText) submitText.textContent = 'Saving...';
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;
        const payload = {
            type,
            text,
            email,
            attachmentUrl: attachmentUrls[0] || null,
            attachmentUrls: attachmentUrls.length ? attachmentUrls : null,
            status: 'unread',
            appVersion: APP_VERSION,
            routeId: $currentRouteId.get() || 'none',
            region: $userRegion.get() || 'GP',
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            deviceId: $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown',
            isPWA: isStandalone
        };

        const authParam = authToken ? `?auth=${authToken}` : '';
        const res = await fetch(`${DYNAMIC_BASE_URL}feedback.json${authParam}`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`Failed to post feedback: ${res.status}`);
        recordRateHit(FEEDBACK_RATE_KEY, { windowMs: FEEDBACK_WINDOW_MS });
        trackAnalyticsEvent('submit_feedback_success', { type: type || 'general' });

        try { await postCommuterInboxCopy({ text, feedbackType: type }); } catch { /* thread copy is best-effort */ }

        showToast('Feedback sent! Thank you.', 'success');
        closeSmoothModal('feedback-modal');
        clearFeedbackReplyMode();
        feedbackReturnModalId = null;
        setTimeout(() => openMessagesThread(), 420);
        const ta = document.getElementById('feedback-text');
        const em = document.getElementById('feedback-email');
        if (ta) ta.value = '';
        if (em) em.value = '';
        if (fileInput) fileInput.value = '';
        document.getElementById('feedback-file-preview')?.classList.add('hidden');
    } catch (e) {
        console.error(e);
        trackAnalyticsEvent('submit_feedback_error', { message: String(e?.message || e || 'error').slice(0, 80) });
        showToast(e.message || 'Could not send feedback.', 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (submitText) submitText.textContent = 'Submit';
        spinner?.classList.add('hidden');
    }
}

/** Survives sanitizeHTML (no SVG) — clear circular “+” expand affordance on alert images. */
const LIGHTBOX_PLUS_BADGE_HTML =
    '<span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span>';

function ensureLightboxPlusBadges(root) {
    if (!root) return;
    root.querySelectorAll('button[onclick*="openLightbox"]').forEach((btn) => {
        // Drop empty husks left after SVG strip (and any prior + chip we will replace)
        btn.querySelectorAll('.absolute.bottom-2.right-2').forEach((el) => {
            if (el.classList.contains('nt-zoom-plus') || !(el.textContent || '').trim()) el.remove();
        });
        if (!/\brelative\b/.test(btn.className)) btn.className = `${btn.className} relative`.trim();
        btn.insertAdjacentHTML('beforeend', LIGHTBOX_PLUS_BADGE_HTML);
    });
}

function sanitizeHTML(dirtyHtml) {
    const doc = new DOMParser().parseFromString(prepareRichHtml(dirtyHtml || ''), 'text/html');
    // SVG badges are stripped above — restore a text “+” chip on lightbox buttons
    ensureLightboxPlusBadges(doc.body);
    return doc.body.innerHTML;
}

function trackAlertEvent(name, params) {
    trackAnalyticsEvent(name, params);
}

/** Alert-severity palette for poll chrome (info=blue, warning=amber, critical=red). */
function pollTone(severity) {
    if (severity === 'critical') {
        return {
            wrap: 'mt-4 bg-red-50 dark:bg-red-900/20 p-4 rounded-xl border border-red-200 dark:border-red-800 shadow-sm',
            title: 'text-red-900 dark:text-red-100',
            label: 'text-red-800 dark:text-red-200',
            muted: 'text-red-500 dark:text-red-400',
            track: 'bg-red-100 dark:bg-red-950',
            bar: 'bg-red-500',
            ring: 'ring-red-400',
            btn: 'border-red-300 dark:border-red-700 hover:border-red-500 text-red-700 dark:text-red-300',
        };
    }
    if (severity === 'warning') {
        return {
            wrap: 'mt-4 bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800 shadow-sm',
            title: 'text-amber-900 dark:text-amber-100',
            label: 'text-amber-800 dark:text-amber-200',
            muted: 'text-amber-600 dark:text-amber-400',
            track: 'bg-amber-100 dark:bg-amber-950',
            bar: 'bg-amber-500',
            ring: 'ring-amber-400',
            btn: 'border-amber-300 dark:border-amber-700 hover:border-amber-500 text-amber-800 dark:text-amber-300',
        };
    }
    return {
        wrap: 'mt-4 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800 shadow-sm',
        title: 'text-blue-900 dark:text-blue-100',
        label: 'text-blue-800 dark:text-blue-200',
        muted: 'text-blue-500 dark:text-blue-400',
        track: 'bg-blue-100 dark:bg-blue-950',
        bar: 'bg-blue-500',
        ring: 'ring-blue-400',
        btn: 'border-blue-300 dark:border-blue-700 hover:border-blue-500 text-blue-700 dark:text-blue-300',
    };
}

async function ensurePollAuthToken() {
    try {
        if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
            await window.firebaseSignInAnonymously(window.firebaseAuth);
        }
        if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
            return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true) || '';
        }
    } catch { /* ignore */ }
    return '';
}

/** Fetch poll tallies and render percentages (no raw vote lists). */
async function renderPollResultsInto(container, pollId, poll, votedOption, severity = 'info', seedVote = null) {
    if (!container || !pollId || !poll) return;
    const tone = pollTone(severity || poll.severity || 'info');
    try {
        const res = await fetch(`${DYNAMIC_BASE_URL}polls/${encodeURIComponent(pollId)}.json?t=${Date.now()}`);
        const data = res.ok ? await res.json() : null;
        let countA = 0, countB = 0, countC = 0;
        if (data && typeof data === 'object') {
            Object.values(data).forEach((vote) => {
                if (!vote || typeof vote !== 'object') return;
                if (vote.optionKey === 'A') countA++;
                else if (vote.optionKey === 'B') countB++;
                else if (vote.optionKey === 'C') countC++;
            });
        }
        // Seed the just-cast vote if the write hasn't appeared in the GET yet
        if (seedVote === 'A' && countA === 0) countA = 1;
        else if (seedVote === 'B' && countB === 0) countB = 1;
        else if (seedVote === 'C' && countC === 0) countC = 1;

        const total = countA + countB + countC;
        const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
        const row = (key, label, n) => {
            if (!label) return '';
            const p = pct(n);
            const mine = votedOption === key ? ` ring-1 ${tone.ring}` : '';
            return `
                <div class="mb-2${mine}">
                    <div class="flex justify-between text-[10px] font-bold ${tone.label} mb-1">
                        <span>${escapeHTML(label)}${votedOption === key ? ' · your vote' : ''}</span>
                        <span>${p}%</span>
                    </div>
                    <div class="w-full ${tone.track} rounded-full h-2">
                        <div class="${tone.bar} h-2 rounded-full transition-all duration-500" style="width:${p}%"></div>
                    </div>
                </div>`;
        };
        const nested = String(container.id || '').startsWith('poll-live-results');
        container.innerHTML = `
            ${nested ? '' : `<p class="text-xs font-black ${tone.title} mb-3 text-center leading-tight">${escapeHTML(poll.question || 'Poll results')}</p>`}
            ${row('A', poll.optionA, countA)}
            ${row('B', poll.optionB, countB)}
            ${poll.optionC ? row('C', poll.optionC, countC) : ''}
            <p class="text-[9px] text-center ${tone.muted} font-bold uppercase tracking-wider mt-1">Live percentages</p>`;
        container.className = nested ? 'mt-1' : `${tone.wrap} shadow-inner`;
    } catch {
        container.innerHTML = `
            <div class="text-center">
                <p class="text-xs font-bold ${tone.title}">Thanks for voting!</p>
                <p class="text-[10px] ${tone.muted} mt-0.5">Your response has been recorded.</p>
            </div>`;
        container.className = tone.wrap;
    }
}

/** SPA parity — notice modal poll votes (one vote per device via localStorage). */
export async function submitPollVote(pollId, optionKey, optionText, pollMeta = null) {
    triggerHaptic();
    if (!pollId || !optionKey) return;
    if (safeStorage.getItem('poll_voted_' + pollId)) {
        showToast('You have already voted on this poll.', 'warning');
        return;
    }

    const severity = pollMeta?.severity || 'info';
    const tone = pollTone(severity);
    const container = document.getElementById(`poll-container-${pollId}`);

    try {
        const token = await ensurePollAuthToken();
        if (!token) throw new Error('Auth required to vote');

        const payload = {
            optionKey,
            optionText: optionText || optionKey,
            timestamp: Date.now(),
            deviceId: $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown',
        };
        const res = await fetch(
            `${DYNAMIC_BASE_URL}polls/${encodeURIComponent(pollId)}.json?auth=${encodeURIComponent(token)}`,
            { method: 'POST', body: JSON.stringify(payload) }
        );
        if (!res.ok) throw new Error(`Vote write failed (${res.status})`);

        try { safeStorage.setItem('poll_voted_' + pollId, optionKey); } catch { /* ignore */ }
        trackAlertEvent('alert_poll_vote', {
            poll_id: pollId,
            vote_option: optionKey,
            vote_text: optionText,
            route_id: $currentRouteId.get() || 'global',
        });

        if (container) {
            if (pollMeta?.showResults) {
                await renderPollResultsInto(container, pollId, pollMeta, optionKey, severity, optionKey);
            } else {
                container.innerHTML = `
                    <div class="text-center animate-fade-in-up">
                        <p class="text-xs font-bold ${tone.title}">Thanks for voting!</p>
                        <p class="text-[10px] ${tone.muted} mt-0.5">Your response has been recorded.</p>
                    </div>`;
                container.className = tone.wrap;
            }
        }
        showToast('Vote recorded successfully!', 'success');
    } catch (e) {
        console.warn('Poll vote failed', e);
        showToast('Could not record your vote. Please try again.', 'error');
    }
}

/**
 * Red badges for unread admin replies: on the bottom-nav Options button
 * (visible with the drawer closed) and on the sidenav Messages row.
 */
export function syncInboxBadges(count = 0) {
    if (typeof document === 'undefined') return;
    const n = Math.max(0, Number(count) || 0);
    const label = n > 9 ? '9+' : String(n);

    const rowBadge = document.getElementById('sidenav-inbox-badge');
    if (rowBadge) {
        rowBadge.textContent = label;
        rowBadge.classList.toggle('hidden', n === 0);
    }
    const sub = document.getElementById('sidenav-inbox-sub');
    if (sub) {
        sub.textContent = n > 0
            ? `${n} new ${n === 1 ? 'reply' : 'replies'} from the team`
            : 'Contact the team';
    }
    const navDot = document.getElementById('open-nav-badge');
    if (navDot) navDot.classList.toggle('hidden', n === 0);
}

function getThreadDeviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || '';
}

const LOCAL_INBOX_KEY = 'ntInboxLocalV1';

function readLocalInbox() {
    try {
        const raw = JSON.parse(safeStorage.getItem(LOCAL_INBOX_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter((m) => m && (m.message || m.text)) : [];
    } catch {
        return [];
    }
}

function rememberLocalInbox(msg) {
    if (!msg || !(msg.message || msg.text)) return;
    const list = readLocalInbox();
    const key = msg.id || `${msg.timestamp}|${String(msg.message || msg.text).slice(0, 48)}`;
    if (list.some((m) => (m.id && m.id === msg.id) || (`${m.timestamp}|${String(m.message || m.text).slice(0, 48)}` === key))) {
        return;
    }
    list.push(msg);
    const packed = JSON.stringify(list.slice(-80));
    safeStorage.setItem(LOCAL_INBOX_KEY, packed);
    safeStorage.setResilientItem?.(LOCAL_INBOX_KEY, packed)?.catch?.(() => {});
}

function mergeInboxThread(remote, local) {
    const byKey = new Map();
    const add = (m) => {
        if (!m || !(m.message || m.text)) return;
        const text = String(m.message || m.text);
        const key = m.id || `${m.timestamp || 0}|${text.slice(0, 48)}`;
        if ([...byKey.values()].some((x) => x.timestamp === m.timestamp && String(x.message || x.text) === text)) return;
        byKey.set(key, m);
    };
    (remote || []).forEach(add);
    (local || []).forEach(add);
    return [...byKey.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function isCommuterInboxMsg(m) {
    return m?.from === 'commuter' || String(m?.id || '').startsWith('cm_');
}

function stripAdminSignoff(html) {
    return String(html || '')
        .replace(/(?:<br\s*\/?>|\n)*\s*<span[^>]*>\s*[-–—]\s*[^<]*<\/span>\s*$/i, '')
        .replace(/(?:<br\s*\/?>|\n)*\s*[-–—]\s*[A-Za-z]{2,20}\s*$/i, '')
        .trim();
}

function adminBubbleName(m, rawHtml) {
    const named = String(m?.fromName || '').trim();
    if (named) return named;
    const text = String(rawHtml || m?.message || m?.text || '');
    const match = text.match(/[-–—]\s*([A-Za-z]{2,20})\s*(?:<\/span>)?\s*$/i);
    if (match) return match[1].trim();
    return 'Admin';
}

function inboxClock(ts) {
    const d = new Date(ts || Date.now());
    if (Number.isNaN(d.getTime())) return '--:--';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function fetchRemoteInbox() {
    const deviceId = getThreadDeviceId();
    if (!deviceId) return [];
    const res = await fetch(`${DYNAMIC_BASE_URL}inbox/${encodeURIComponent(deviceId)}.json?t=${Date.now()}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data)
        .map(([id, m]) => ({ id, ...(m || {}) }))
        .filter((m) => m && (m.message || m.text));
}

async function fetchInboxThread() {
    try {
        const recovered = await restoreDeviceIdentity();
        if (recovered && recovered !== $deviceId.get()) $deviceId.set(recovered);
    } catch { /* keep current id */ }
    let remote = [];
    try { remote = await fetchRemoteInbox(); } catch { remote = []; }
    return mergeInboxThread(remote, readLocalInbox());
}

function renderMessagesThread(list) {
    const host = document.getElementById('messages-thread-list');
    if (!host) return;
    if (!list.length) {
        host.innerHTML = '<p class="text-xs text-gray-500 dark:text-gray-400 text-center py-8 px-4">No messages yet. Send one below — you and the team will see the full chat here.</p>';
        return;
    }
    host.innerHTML = list.map((m) => {
        const mine = isCommuterInboxMsg(m);
        const raw = m.message || m.text || '';
        const body = mine ? escapeHTML(raw) : sanitizeHTML(stripAdminSignoff(raw));
        const clock = inboxClock(m.timestamp);
        const who = mine ? 'You' : escapeHTML(adminBubbleName(m, raw));
        const avatar = mine
            ? ''
            : `<div class="inbox-avatar"><img src="${withBase('icons/icon-192.png')}" alt="" width="32" height="32" class="w-full h-full object-cover"></div>`;
        return `<div class="inbox-row ${mine ? 'justify-end' : 'justify-start gap-2'}">
      ${avatar}
      <div class="inbox-bubble-wrap">
        <div class="inbox-bubble ${mine ? 'inbox-bubble-own' : 'inbox-bubble-other'}">
          <div class="inbox-bubble-name-row">${who}</div>
          <div class="inbox-bubble-body">
            <div class="inbox-msg-text">${body}<span class="inbox-msg-time">${clock}</span></div>
          </div>
        </div>
      </div>
    </div>`;
    }).join('');
    host.scrollTop = host.scrollHeight;
}

async function postCommuterInboxCopy({ text, feedbackType }) {
    const deviceId = getThreadDeviceId();
    if (!deviceId || !text) return false;
    if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
        try { await window.firebaseSignInAnonymously(window.firebaseAuth); } catch { /* optional */ }
    }
    let authToken = '';
    if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
        try { authToken = await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true); } catch { /* ignore */ }
    }
    const msgId = `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
        from: 'commuter',
        deviceId,
        message: String(text).slice(0, 2000),
        timestamp: Date.now(),
        type: feedbackType || 'general',
        read: true,
    };
    rememberLocalInbox({ id: msgId, ...payload });
    const authParam = authToken ? `?auth=${encodeURIComponent(authToken)}` : '';
    const res = await fetch(
        `${DYNAMIC_BASE_URL}inbox/${encodeURIComponent(deviceId)}/${msgId}.json${authParam}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }
    );
    return res.ok;
}

export async function openMessagesThread() {
    triggerHaptic();
    closeAppHub(true);
    document.getElementById('developer-reply-banner')?.classList.add('hidden');
    const host = document.getElementById('messages-thread-list');
    if (host) host.innerHTML = '<p class="text-xs text-gray-400 text-center py-8">Loading…</p>';
    paintThreadContactRow();
    setTimeout(() => openSmoothModal('messages-thread-modal'), 50);
    try {
        const list = await fetchInboxThread();
        renderMessagesThread(list);
        const deviceId = getThreadDeviceId();
        const unread = list.filter((m) => !isCommuterInboxMsg(m) && !m.read && m.id);
        if (unread.length && deviceId) {
            const updates = {};
            unread.forEach((m) => {
                updates[`${m.id}/read`] = true;
                updates[`${m.id}/readAt`] = Date.now();
                updates[`${m.id}/viewedAt`] = Date.now();
                updates[`${m.id}/acknowledged`] = true;
            });
            fetch(`${DYNAMIC_BASE_URL}inbox/${encodeURIComponent(deviceId)}.json`, {
                method: 'PATCH',
                body: JSON.stringify(updates),
            }).catch(() => {});
            syncInboxBadges(0);
        }
    } catch {
        renderMessagesThread(readLocalInbox());
    }
}

/**
 * Fill #notice-modal with a notice using the same sanitize/CSS/poll path users see.
 * mode: 'live' | 'preview' | 'archive'
 */
export function renderServiceAlertModal(notice, options = {}) {
    injectRichTextStyles();
    const modal = document.getElementById('notice-modal');
    const content = document.getElementById('notice-content');
    const timestamp = document.getElementById('notice-timestamp');
    if (!modal || !content || !notice) return false;

    const mode = options.mode || 'live';
    const severity = notice.severity || 'info';
    if (mode === 'live') delete modal.dataset.alertPreview;
    else modal.dataset.alertPreview = '1';

    const modalCard = document.getElementById('notice-modal-card') || modal.firstElementChild;
    if (modalCard) {
        modalCard.classList.remove('border-red-500', 'border-yellow-500', 'border-blue-500', 'border-red-200', 'dark:border-red-900/50');
        if (severity === 'critical') modalCard.classList.add('border-red-500');
        else if (severity === 'warning') modalCard.classList.add('border-yellow-500');
        else modalCard.classList.add('border-blue-500');
    }

    const modalHeader = document.getElementById('notice-modal-title') || modal.querySelector('h3');
    if (modalHeader) {
        const headerContainer = modalHeader.parentElement;
        if (headerContainer) {
            const existingIcon = headerContainer.querySelector('svg');
            if (existingIcon) existingIcon.remove();
            headerContainer.className = `flex items-center shrink-0 ${
                severity === 'critical'
                    ? 'text-red-600 dark:text-red-400'
                    : severity === 'warning'
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-blue-600 dark:text-blue-400'
            }`;
        }
        modalHeader.textContent = severity === 'critical'
            ? '🔴 CRITICAL ADVISORY'
            : severity === 'warning'
              ? '🟡 SERVICE WARNING'
              : '🔵 SERVICE INFO';
    }

    const layout = layoutAlertPost(notice);
    const titleHtml = layout.title
        ? `<h3 class="text-base font-black text-gray-900 dark:text-white leading-snug mb-2">${escapeHTML(layout.title)}</h3>`
        : '';
    let formattedMsg = sanitizeHTML(layout.body);
    if (options.prefixHtml) formattedMsg = `${options.prefixHtml}${formattedMsg}`;

    if (notice.sourceName) {
        const sName = escapeHTML(notice.sourceName);
        const sUrl = notice.sourceUrl ? escapeHTML(notice.sourceUrl) : null;
        const innerCitation = sUrl
            ? `<a href="${sUrl}" target="_blank" rel="noopener" class="hover:underline text-blue-600 dark:text-blue-400 font-medium flex items-center">${sName} <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg></a>`
            : `<span class="font-medium text-gray-700 dark:text-gray-300">${sName}</span>`;
        formattedMsg += `<div class="mt-3 p-2.5 bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-lg text-[10px] text-gray-500 dark:text-gray-400 italic flex items-center shadow-sm w-fit max-w-full"><span class="mr-1.5 not-italic text-sm">📰</span><span class="flex items-center space-x-1"><span>Source:</span> ${innerCitation}</span></div>`;
    }

    const posterUrls = layout.imageUrls;
    let mediaHtml = '';
    if (posterUrls.length) {
        const cells = posterUrls.map((path) => {
            const src = escapeHTML(resolveAlertImageSrc(path));
            if (!src) return '';
            const safeJs = src.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `<button type="button" onclick="event.stopPropagation(); window.openLightbox('${safeJs}')" class="relative block w-full focus:outline-none cursor-zoom-in rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm"><img src="${src}" alt="Service poster" class="w-full h-auto max-h-56 object-cover"></button>`;
        }).join('');
        const grid = posterUrls.length > 1 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1';
        mediaHtml = `<div class="${grid} mt-2 mb-1">${cells}</div>`;
    }
    content.innerHTML = `${titleHtml}${mediaHtml}${formattedMsg}`;
    ensureLightboxPlusBadges(content);

    if (notice.ctaUrl && notice.ctaText) {
        content.innerHTML += `
            <a href="${escapeHTML(notice.ctaUrl)}" target="_blank" rel="noopener" class="mt-4 flex items-center justify-center w-full bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 font-bold py-2.5 px-4 rounded-lg transition-colors text-xs uppercase tracking-wide border border-blue-200 dark:border-blue-800 shadow-sm focus:outline-none">
                ${escapeHTML(notice.ctaText)}
                <svg class="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
            </a>`;
    }

    if (notice.poll && notice.poll.active) {
        const pollId = notice.id || 'preview';
        const votedOption = mode === 'live' ? safeStorage.getItem('poll_voted_' + pollId) : null;
        const pollSeverity = severity || 'info';
        const tone = pollTone(pollSeverity);
        const pollMeta = {
            question: notice.poll.question || '',
            optionA: notice.poll.optionA || '',
            optionB: notice.poll.optionB || '',
            optionC: notice.poll.optionC || '',
            showResults: !!notice.poll.showResults,
            severity: pollSeverity,
        };
        content.innerHTML += `<div id="poll-container-${escapeHTML(String(pollId))}" class="${tone.wrap}"></div>`;
        const pollEl = document.getElementById(`poll-container-${pollId}`);
        if (pollEl) {
            try { pollEl.dataset.pollMeta = JSON.stringify(pollMeta); } catch { /* ignore */ }
            if (votedOption && notice.poll.showResults) {
                renderPollResultsInto(pollEl, pollId, { ...notice.poll, ...pollMeta }, votedOption, pollSeverity);
            } else if (votedOption) {
                pollEl.innerHTML = `
                    <div class="text-center">
                        <p class="text-xs font-bold ${tone.title}">Thanks for voting!</p>
                        <p class="text-[10px] ${tone.muted} mt-0.5">Your response has been recorded.</p>
                    </div>`;
            } else {
                const voteBtn = (key, text) =>
                    `<button type="button" data-poll-id="${escapeHTML(String(pollId))}" data-poll-opt="${key}" data-poll-text="${escapeHTML(text)}" class="nt-poll-vote flex-1 min-w-[30%] bg-white dark:bg-gray-800 border-2 ${tone.btn} font-bold py-2.5 rounded-lg transition-all text-xs focus:outline-none shadow-sm">${escapeHTML(text)}</button>`;
                const optC = notice.poll.optionC
                    ? voteBtn('C', notice.poll.optionC)
                    : '';
                pollEl.innerHTML = `
                    <p class="text-sm font-black ${tone.title} mb-3 leading-tight text-center">${escapeHTML(notice.poll.question || '')}</p>
                    <div class="flex flex-wrap gap-2 mb-3">
                        ${voteBtn('A', notice.poll.optionA || 'A')}
                        ${voteBtn('B', notice.poll.optionB || 'B')}
                        ${optC}
                    </div>
                    <div id="poll-live-results-${escapeHTML(String(pollId))}" class="${notice.poll.showResults ? '' : 'hidden'}"></div>`;
                if (notice.poll.showResults && mode === 'live') {
                    const liveBox = document.getElementById(`poll-live-results-${pollId}`);
                    if (liveBox) {
                        renderPollResultsInto(liveBox, pollId, { ...notice.poll, ...pollMeta }, null, pollSeverity);
                    }
                }
            }
        }
    }

    if (timestamp) {
        if (options.timestampHtml) {
            timestamp.innerHTML = options.timestampHtml;
        } else {
            const posted = notice.repostedAt || notice.postedAt || notice.timestamp;
            if (posted) {
                const label = (notice.isRepost || notice.repostedAt) ? 'Reposted' : 'Posted';
                timestamp.textContent = `${label}: ${formatAppDate(posted, { withTime: true })}`;
            } else if (mode === 'preview') {
                timestamp.textContent = 'Preview — not posted yet';
            } else {
                timestamp.textContent = '';
            }
        }
    }

    const skipHashClose = () => {
        if (typeof closeSmoothModal === 'function') closeSmoothModal('notice-modal', true);
        else modal.classList.add('hidden');
        delete modal.dataset.alertPreview;
    };

    const closeNotice = () => {
        if (mode !== 'live') {
            skipHashClose();
            return;
        }
        if (location.hash === '#notice') history.back();
        else closeSmoothModal('notice-modal');
    };

    const oldCloseBtn = document.getElementById('notice-modal-close-btn')
        || modal.querySelector('button.bg-red-600, button.bg-blue-600, button.bg-yellow-600');
    modal.querySelectorAll('.nt-notice-actions').forEach((el) => el.remove());

    let baseColorClass = 'bg-blue-600 hover:bg-blue-700';
    if (severity === 'critical') baseColorClass = 'bg-red-600 hover:bg-red-700';
    else if (severity === 'warning') baseColorClass = 'bg-yellow-600 hover:bg-yellow-700';

    const btnContainer = document.createElement('div');
    btnContainer.className = 'nt-notice-actions flex space-x-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 w-full';

    const leftBtn = document.createElement('button');
    leftBtn.type = 'button';
    leftBtn.id = 'notice-close-btn';
    leftBtn.className = 'flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-bold py-2.5 px-4 rounded-lg shadow-sm transition-colors focus:outline-none';
    if (mode === 'preview') {
        leftBtn.textContent = 'Edit';
        leftBtn.onclick = () => {
            triggerHaptic();
            skipHashClose();
            if (typeof options.onEdit === 'function') options.onEdit();
        };
    } else {
        leftBtn.textContent = 'Close';
        leftBtn.onclick = () => {
            closeNotice();
            if (typeof options.onClose === 'function') options.onClose();
        };
    }
    btnContainer.appendChild(leftBtn);

    const rightBtn = document.createElement('button');
    rightBtn.type = 'button';
    if (mode === 'preview') {
        rightBtn.className = `flex-1 ${baseColorClass} text-white font-bold py-2.5 px-4 rounded-lg shadow-sm transition-colors focus:outline-none`;
        rightBtn.textContent = 'Post';
        rightBtn.onclick = () => {
            triggerHaptic();
            skipHashClose();
            if (typeof options.onPost === 'function') options.onPost();
        };
        btnContainer.appendChild(rightBtn);
    } else if (mode === 'archive') {
        if (typeof options.onRevive === 'function') {
            rightBtn.className = 'flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-lg shadow-sm transition-colors focus:outline-none';
            rightBtn.textContent = 'Revive / Repost';
            rightBtn.onclick = () => {
                triggerHaptic();
                skipHashClose();
                options.onRevive();
            };
            btnContainer.appendChild(rightBtn);
        }
    } else {
        rightBtn.className = `flex-1 ${baseColorClass} text-white font-bold py-2.5 px-4 rounded-lg shadow-sm transition-colors focus:outline-none flex items-center justify-center`;
        const replySvg = '<svg class="w-4 h-4 mr-1.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
        rightBtn.innerHTML = `${replySvg} Reply`;
        rightBtn.onclick = () => {
            triggerHaptic();
            const rawHtml = repairMojibake(notice?.message || notice?.text || '');
            let truncatedMsg = htmlToPlainSnippet(rawHtml, 6);
            truncatedMsg = truncatedMsg.replace(/[—–].*/, '').trim();
            openFeedbackReplyFromOverlay('notice-modal', {
                label: 'Replying to Advisory:',
                snippet: truncatedMsg,
                rawMsg: truncatedMsg,
                alertId: notice?.id || '',
                alertKind: 'notice',
            });
        };
        btnContainer.appendChild(rightBtn);
    }

    if (oldCloseBtn) {
        oldCloseBtn.style.display = 'none';
        oldCloseBtn.parentNode?.appendChild(btnContainer);
    } else {
        content.parentNode?.appendChild(btnContainer);
    }

    const topCloseBtn = modal.querySelector('button.text-gray-400');
    if (topCloseBtn) {
        topCloseBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (mode === 'preview') {
                skipHashClose();
                if (typeof options.onEdit === 'function') options.onEdit();
            } else if (mode === 'archive') {
                skipHashClose();
                if (typeof options.onClose === 'function') options.onClose();
            } else if (location.hash === '#notice') {
                history.back();
            } else {
                closeSmoothModal('notice-modal');
            }
        };
    }

    return true;
}

if (typeof window !== 'undefined') {
    window.renderServiceAlertModal = renderServiceAlertModal;
    window.prepareRichHtml = prepareRichHtml;
    window.injectRichTextStyles = injectRichTextStyles;
}

export async function checkServiceAlerts() {
    const bellBtn = document.getElementById('notice-bell');
    const dot = document.getElementById('notice-dot');
    const modal = document.getElementById('notice-modal');
    if (!bellBtn) return;

    const deviceId = $deviceId.get() || safeStorage.getItem('next_train_device_id');
    const routeId = $currentRouteId.get();

    try {
        // 1. Commuter inbox (admin replies)
        let adminReply = null;
        if (deviceId) {
            try {
                const inboxRes = await fetch(`${DYNAMIC_BASE_URL}inbox/${deviceId}.json?t=${Date.now()}`);
                if (inboxRes.ok) {
                    const ct = inboxRes.headers.get('content-type') || '';
                    if (ct.includes('text/html')) throw new Error('Captive Portal Detected');
                    const inboxData = await inboxRes.json();
                    if (inboxData) {
                        const unreadKeys = Object.keys(inboxData).filter((k) => inboxReplyStillVisible(inboxData[k]));
                        syncInboxBadges(unreadKeys.length);
                        if (unreadKeys.length > 0) {
                            const latestKey = unreadKeys.sort((a, b) => (inboxData[b].timestamp || 0) - (inboxData[a].timestamp || 0))[0];
                            adminReply = { ...inboxData[latestKey], _key: latestKey };

                            const undeliveredKeys = unreadKeys.filter((k) => !inboxData[k].delivered);
                            if (undeliveredKeys.length > 0) {
                                const updates = {};
                                undeliveredKeys.forEach((k) => {
                                    updates[`${k}/delivered`] = true;
                                    updates[`${k}/deliveredAt`] = Date.now();
                                });
                                fetch(`${DYNAMIC_BASE_URL}inbox/${deviceId}.json`, {
                                    method: 'PATCH',
                                    body: JSON.stringify(updates)
                                }).catch(() => {});
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('Inbox fetch failed', e);
            }
        }

        const replyBanner = document.getElementById('developer-reply-banner');
        const viewReplyBtn = document.getElementById('view-reply-btn');

        if (adminReply && replyBanner) {
            replyBanner.classList.remove('hidden');

            if (viewReplyBtn) {
                window.__ntOpenAdminReply = () => openMessagesThread();
                viewReplyBtn.onclick = () => openMessagesThread();
            }

            const devReplyCloseTop = document.querySelector('#developer-reply-modal button.text-gray-400');
            if (devReplyCloseTop) {
                devReplyCloseTop.onclick = (e) => {
                    e.preventDefault();
                    if (location.hash === '#devreply') history.back();
                    else closeSmoothModal('developer-reply-modal');
                };
            }
        } else if (replyBanner) {
            replyBanner.classList.add('hidden');
        }

        // 2. Notices: union of global + region + current route (not exclusive winner)
        const region = $userRegion.get() || 'GP';
        const validNotices = await fetchUnionNotices(region, routeId);
        setCachedLiveNotices(validNotices);

        if (validNotices.length === 0) {
            bellBtn.classList.add('hidden');
            return;
        }

        applyBellFromNotices(validNotices);

        const autoNotice = pickAutoOpenNotice(validNotices);
        if (autoNotice && !window._alertsChannelOpening && canAutoOpenHomeNotices()) {
            window._alertsChannelOpening = true;
            setTimeout(() => {
                if (!canAutoOpenHomeNotices()) {
                    window._alertsChannelOpening = false;
                    return;
                }
                triggerHaptic();
                trackAlertEvent('auto_open_alert', {
                    severity: autoNotice.severity || 'critical',
                    route_id: routeId || 'all',
                    notice_id: autoNotice.id || '',
                });
                openAlertsChannel({
                    notices: validNotices,
                    highlightId: autoNotice.id || null,
                    resetVisible: true,
                });
                window._alertsChannelOpening = false;
            }, 400);
        }
        const pushNotice = autoNotice || validNotices[0];
        if (pushNotice) {
            import('./push-notify.js').then((m) => {
                m.maybeNotifyOfficialNotice?.(pushNotice, { toast: !autoNotice });
            }).catch(() => {});
        }

        const topCloseBtn = modal?.querySelector('button.text-gray-400');
        if (topCloseBtn && modal?.dataset?.alertPreview !== '1') {
            topCloseBtn.onclick = (e) => {
                e.preventDefault();
                if (location.hash === '#notice') history.back();
                else closeSmoothModal('notice-modal');
            };
        }
    } catch (e) {
        console.warn('Service alerts check failed', e);
    }
}

export function initHub() {
    if (typeof window === 'undefined') return;

    window.repairMojibake = repairMojibake;
    window.closeAppHub = closeAppHub;
    window.restoreFeedbackReturnOverlay = restoreFeedbackReturnOverlay;
    window.openAppHub = openAppHub;
    window.resetProfile = resetProfile;
    window.performHardCacheClear = performHardCacheClear;
    window.showCacheClearWarning = showCacheClearWarning;
    window.checkServiceAlerts = checkServiceAlerts;
    window.submitPollVote = submitPollVote;
    window.openMessagesThread = openMessagesThread;
    window.renderServiceAlertModal = renderServiceAlertModal;
    window.prepareRichHtml = prepareRichHtml;
    window.injectRichTextStyles = injectRichTextStyles;
    window.openFeedbackReplyFromOverlay = openFeedbackReplyFromOverlay;
    window.openFeedbackModal = openFeedbackModal;
    injectRichTextStyles();
    initAlertsChannel();
    bindPasswordReveal({
        inputId: 'account-password',
        buttonId: 'account-toggle-password-btn',
        openIconId: 'account-eye-open-icon',
        closedIconId: 'account-eye-closed-icon',
    });

    if (!window.__ntPollVoteBound) {
        window.__ntPollVoteBound = true;
        document.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.nt-poll-vote');
            if (!btn) return;
            e.preventDefault();
            if (document.getElementById('notice-modal')?.dataset?.alertPreview === '1') {
                showToast('Preview only — votes are not recorded.', 'info');
                return;
            }
            const wrap = btn.closest('[id^="poll-container-"]');
            let pollMeta = null;
            try { pollMeta = JSON.parse(wrap?.dataset?.pollMeta || 'null'); } catch { pollMeta = null; }
            submitPollVote(
                btn.getAttribute('data-poll-id'),
                btn.getAttribute('data-poll-opt'),
                btn.getAttribute('data-poll-text'),
                pollMeta
            );
        });
    }

    // Close inbox / notice modals when browser back clears their hash
    if (!window._hubAlertPopstateBound) {
        window._hubAlertPopstateBound = true;
        window.addEventListener('popstate', () => {
            const hash = location.hash;
            const replyModal = document.getElementById('developer-reply-modal');
            const noticeModal = document.getElementById('notice-modal');
            if (replyModal && !replyModal.classList.contains('hidden') && hash !== '#devreply') {
                closeSmoothModal('developer-reply-modal');
            }
            // Keep notice open while lightbox (#lightbox) or static map preview is on top
            if (noticeModal && !noticeModal.classList.contains('hidden')
                && hash !== '#notice' && hash !== '#lightbox' && hash !== '#prasa-map') {
                closeSmoothModal('notice-modal');
            }
            const alertsEl = document.getElementById('alerts-channel');
            if (alertsEl && !alertsEl.classList.contains('hidden')
                && hash !== '#alerts' && hash !== '#lightbox' && hash !== '#map' && hash !== '#feedback') {
                closeSmoothModal('alerts-channel');
            }
        });
    }

    syncProfileDisplay();
    syncHapticsToggle();
    syncChangelogBadge();
    maybeForceShowChangelog();
    $userProfile.subscribe(syncProfileDisplay);

    // Colour packs (delegated; also bound via hydratePrefs)
    setColourPack(getColourPack());
    bindColourPackControls();

    // Account / community / delay-reports pull firebase-vendor. Idle-defer so
    // home LCP is not competing with Auth+RTDB. First user intent still boots
    // them immediately (openAppHub, Community tab, live-board hydrate).
    const idleImport = (loader) => {
        const run = () => { try { loader(); } catch { /* ignore */ } };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4500 });
        else setTimeout(run, 2500);
    };

    idleImport(() => {
        import('./account.js')
            .then(({ bindAccountUi, initAccount }) => {
                bindAccountUi();
                initAccount();
            })
            .catch(() => {});
    });

    // Cloaked shadow-ban UX (looks like bad connectivity — never disclose ban)
    const runShadowBanCloak = () =>
        import('./trust.js').then((m) => m.applyShadowBanCloak()).catch(() => {});
    idleImport(runShadowBanCloak);
    // Re-check periodically so bans applied mid-session still take effect
    setInterval(runShadowBanCloak, 90_000);

    // Delay reports (Phase 5)
    idleImport(() => {
        import('./delay-reports.js').then((m) => m.bindDelayReportUi()).catch(() => {});
    });

    // Route community (Phase 6)
    idleImport(() => {
        import('./community.js').then((m) => m.bindCommunityUi()).catch(() => {});
    });

    // Live ride sharing / last-seen (Wave 3)
    import('./ride-pings.js').then((m) => m.bindRideCheckInUi()).catch(() => {});

    // Notifications pref (Phase 8 stub)
    import('./prefs.js').then(({ getNotifyPref, setNotifyPref, syncNotifyUi }) => {
        syncNotifyUi(getNotifyPref());
        const toggle = document.getElementById('settings-notify-toggle');
        const cb = document.getElementById('settings-notify-checkbox');
        const apply = (on) => { setNotifyPref(on); triggerHaptic(); };
        toggle?.addEventListener('click', (e) => {
            const t = e.target;
            if (t.tagName !== 'INPUT' && t.tagName !== 'LABEL') {
                apply(!(cb?.checked));
            }
        });
        cb?.addEventListener('change', (e) => apply(e.target.checked));
    }).catch(() => {});

    // Profile
    document.getElementById('settings-profile-btn')?.addEventListener('click', resetProfile);

    // Haptics
    const hapticsToggle = document.getElementById('settings-haptics-toggle');
    const hapticsCb = document.getElementById('settings-haptics-checkbox');
    const applyHaptics = (on) => {
        safeStorage.setItem('hapticsEnabled', on ? 'true' : 'false');
        if (hapticsCb) hapticsCb.checked = on;
        if (on) triggerHaptic();
    };
    hapticsToggle?.addEventListener('click', (e) => {
        const t = e.target;
        if (t.tagName !== 'INPUT' && t.tagName !== 'LABEL') {
            applyHaptics(!hapticsAreEnabled());
        }
    });
    hapticsCb?.addEventListener('change', (e) => applyHaptics(e.target.checked));

    // Network map pinch/pan/zoom (SPA map-viewer parity)
    setupMapLogic();

    /** In-app sheet for guide / interactive map — keeps planner state (no full remount). */
    const isMapSheetUrl = (url) => /\/map(?:\.html)?(?:\?|#|$)/i.test(String(url || ''));

    const applySheetChrome = (overlay, mode, title) => {
        const chrome = document.getElementById('nt-inapp-sheet-chrome');
        const titleEl = document.getElementById('nt-inapp-sheet-title');
        const frame = document.getElementById('nt-inapp-sheet-frame');
        const isMap = mode === 'map';
        overlay.dataset.sheetMode = isMap ? 'map' : 'guide';
        if (chrome) {
            chrome.className = isMap
                ? 'absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 pointer-events-none'
                : 'relative shrink-0 z-10 flex items-center justify-between gap-3 px-3 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm';
        }
        const closeBtn = document.getElementById('nt-inapp-sheet-close');
        if (closeBtn) {
            closeBtn.className = isMap
                ? 'pointer-events-auto inline-flex items-center text-sm font-bold text-gray-800 dark:text-white bg-white/95 dark:bg-gray-800/95 border border-gray-300 dark:border-gray-600 rounded-xl shadow-lg py-2.5 px-4 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none'
                : 'inline-flex items-center text-sm font-bold text-blue-600 dark:text-blue-400 px-2 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 focus:outline-none';
        }
        if (titleEl) {
            if (isMap) {
                titleEl.textContent = '';
                titleEl.classList.add('hidden');
            } else {
                titleEl.textContent = title || '';
                titleEl.classList.remove('hidden');
            }
        }
        // Guide keeps a right spacer for title centering; map leaves the row open for Network Lines.
        const spacer = chrome?.querySelector('[data-nt-sheet-spacer]');
        if (spacer) spacer.classList.toggle('hidden', isMap);
        if (frame) {
            frame.className = isMap
                ? 'absolute inset-0 w-full h-full border-0 bg-gray-100 dark:bg-gray-900'
                : 'relative flex-1 w-full border-0 bg-white dark:bg-gray-900 min-h-0';
            // Paint iframe chrome before navigation — blank iframe defaults to white.
            const isDark = document.documentElement.classList.contains('dark');
            frame.style.backgroundColor = isMap
                ? (isDark ? '#111827' : '#f3f4f6')
                : (isDark ? '#111827' : '#ffffff');
        }
    };

    const showSheetOverlay = (overlay) => {
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
        document.body.classList.add('overflow-hidden');
        if (overlay.dataset.sheetMode === 'map') {
            import('./ui.js').then((m) => m.setImmersiveChrome?.(true)).catch(() => {});
        }
    };

    const hideSheetOverlay = (overlay) => {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        document.body.classList.remove('overflow-hidden');
        import('./ui.js').then((m) => m.setImmersiveChrome?.(false)).catch(() => {});
        const frame = document.getElementById('nt-inapp-sheet-frame');
        // Delay blanking so users never see an empty white iframe flash.
        setTimeout(() => {
            if (overlay.classList.contains('hidden') && frame && !overlay.classList.contains('flex')) {
                frame.src = 'about:blank';
            }
        }, 320);
    };

    const openInAppSheet = (url, title) => {
        let overlay = document.getElementById('nt-inapp-sheet');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'nt-inapp-sheet';
            overlay.className = 'fixed inset-0 z-[220] hidden flex-col bg-gray-50 dark:bg-gray-900';
            overlay.innerHTML = `
                <div id="nt-inapp-sheet-chrome" class="relative shrink-0 z-10 flex items-center justify-between gap-3 px-3 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
                    <button type="button" id="nt-inapp-sheet-close" class="inline-flex items-center text-sm font-bold text-blue-600 dark:text-blue-400 px-2 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 focus:outline-none">
                        <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                        Back
                    </button>
                    <span id="nt-inapp-sheet-title" class="text-sm font-black text-gray-900 dark:text-white truncate"></span>
                    <span data-nt-sheet-spacer class="w-16" aria-hidden="true"></span>
                </div>
                <iframe id="nt-inapp-sheet-frame" title="In-app page" class="relative flex-1 w-full border-0 bg-white dark:bg-gray-900 min-h-0"></iframe>`;
            document.body.appendChild(overlay);
            const closeSheet = () => {
                if (overlay.classList.contains('hidden')) return;
                hideSheetOverlay(overlay);
                if (location.hash === '#sheet') {
                    try { history.back(); } catch { /* ignore */ }
                }
            };
            const navigateSheet = (nextUrl, nextTitle) => {
                const frame = document.getElementById('nt-inapp-sheet-frame');
                const mode = isMapSheetUrl(nextUrl) || (!nextUrl && /network map/i.test(String(nextTitle || '')))
                    ? 'map'
                    : 'guide';
                // Title-only updates (map embed handshake) keep current URL/mode.
                if (!nextUrl && nextTitle) {
                    if (mode === 'guide' || overlay.dataset.sheetMode === 'guide') {
                        const titleEl = document.getElementById('nt-inapp-sheet-title');
                        if (titleEl) titleEl.textContent = nextTitle;
                    }
                    showSheetOverlay(overlay);
                    return;
                }
                applySheetChrome(overlay, mode, nextTitle || title);
                showSheetOverlay(overlay);
                if (frame && nextUrl) {
                    const isDark = document.documentElement.classList.contains('dark');
                    frame.style.backgroundColor = mode === 'map'
                        ? (isDark ? '#111827' : '#f3f4f6')
                        : (isDark ? '#111827' : '#ffffff');
                    requestAnimationFrame(() => {
                        if (document.getElementById('nt-inapp-sheet') === overlay && !overlay.classList.contains('hidden')) {
                            frame.src = nextUrl;
                        }
                    });
                }
            };
            document.getElementById('nt-inapp-sheet-close')?.addEventListener('click', closeSheet);
            window.addEventListener('popstate', () => {
                if (location.hash !== '#sheet' && !overlay.classList.contains('hidden')) {
                    hideSheetOverlay(overlay);
                }
            });
            window.__ntCloseInAppSheet = closeSheet;
            window.__ntNavigateInAppSheet = navigateSheet;
        }
        const mode = isMapSheetUrl(url) ? 'map' : 'guide';
        applySheetChrome(overlay, mode, title);
        const frame = document.getElementById('nt-inapp-sheet-frame');
        // Show themed chrome first, then navigate — avoids a white flash before map.html paints.
        showSheetOverlay(overlay);
        if (frame) {
            const isDark = document.documentElement.classList.contains('dark');
            frame.style.backgroundColor = mode === 'map'
                ? (isDark ? '#111827' : '#f3f4f6')
                : (isDark ? '#111827' : '#ffffff');
            // Defer src one frame so the overlay/iframe background is composited first.
            requestAnimationFrame(() => {
                if (document.getElementById('nt-inapp-sheet') === overlay && !overlay.classList.contains('hidden')) {
                    frame.src = url;
                }
            });
        }
        // Opening from sidenav uses closeAppHub(true), which leaves #sidenav on the stack.
        // Replace that entry so one Back returns to the real previous screen (not a blank stop).
        try {
            if (location.hash === '#sheet' || location.hash === '#sidenav') {
                history.replaceState({ ntSheet: true }, '', '#sheet');
            } else {
                history.pushState({ ntSheet: true }, '', '#sheet');
            }
        } catch { /* ignore */ }
    };

    // Full map (regions + Network Lines). The home Map tab is the stripped
    // "where is my train" view, so this deliberately does NOT switch tabs.
    document.getElementById('sidenav-interactive-map-btn')?.addEventListener('click', () => {
        triggerHaptic();
        trackAnalyticsEvent('click_interactive_map', { location: 'sidenav' });
        trackAnalyticsEvent('click_network_map', { location: 'sidenav' });
        closeAppHub(true);
        setTimeout(() => {
            trackAnalyticsEvent('open_interactive_map', { location: 'sidenav' });
            openInAppSheet(withBase('/map'), 'Network Map');
        }, 120);
    });

    // Updates
    document.getElementById('check-updates-btn')?.addEventListener('click', () => {
        trackAnalyticsEvent('check_updates_click', { location: 'sidenav' });
        showCacheClearWarning();
    });

    // About / Help / Changelog
    document.getElementById('settings-about-btn')?.addEventListener('click', () => {
        triggerHaptic();
        closeAppHub(true);
        const ver = document.getElementById('about-version-label');
        if (ver) {
            const edition = (getLatestChangelog()?.title) || 'Next Train';
            ver.textContent = `Version ${APP_VERSION} (${edition})`;
        }
        setTimeout(() => {
            trackAnalyticsEvent('view_about_page', { location: 'sidenav' });
            openSmoothModal('about-modal');
        }, 50);
    });
    document.getElementById('close-about-btn')?.addEventListener('click', () => closeSmoothModal('about-modal'));
    document.getElementById('settings-help-btn')?.addEventListener('click', () => {
        triggerHaptic();
        closeAppHub(true);
        setTimeout(() => {
            trackAnalyticsEvent('view_user_guide', { location: 'sidenav' });
            openInAppSheet(withBase('/guide.html'), 'Commuter Guide');
        }, 120);
    });
    document.getElementById('settings-app-version')?.addEventListener('click', openChangelog);

    // Feedback (live board CTA + Settings Support row)
    const openFeedback = async (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        triggerHaptic();
        const location = e?.currentTarget?.id === 'feedback-btn-planner'
            ? 'planner'
            : e?.currentTarget?.id === 'settings-feedback-btn'
                ? 'settings'
                : 'board';
        clearFeedbackReplyMode();
        restoreFeedbackReturnOverlay(); // drop any parked alert/inbox overlay from a prior reply
        closeAppHub(true);
        try {
            const thread = await fetchInboxThread();
            if (thread.length) {
                openMessagesThread();
                return;
            }
        } catch { /* fall through to the form */ }
        setTimeout(() => openFeedbackModal({ location, skipClear: true }), 50);
    };
    document.getElementById('feedback-btn')?.addEventListener('click', openFeedback);
    document.getElementById('feedback-btn-planner')?.addEventListener('click', openFeedback);
    // Messages row: always the commuter thread (compose lives inside it).
    document.getElementById('settings-feedback-btn')?.addEventListener('click', () => {
        trackAnalyticsEvent('open_feedback_modal', { location: 'settings' });
        openMessagesThread();
    });
    document.getElementById('messages-thread-close')?.addEventListener('click', () => closeSmoothModal('messages-thread-modal'));
    document.getElementById('messages-thread-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('messages-thread-input');
        const sendBtn = document.getElementById('messages-thread-send');
        const threadFile = document.getElementById('messages-thread-file');
        const hasFile = !!(threadFile?.files?.length);
        let text = input?.value?.trim() || '';
        if (!text && hasFile) text = '(attachment)';
        if (text.length < 5 && !hasFile) {
            showToast('Please write a bit more (at least 5 characters).', 'error');
            return;
        }
        const email = resolveThreadContact();
        const limit = checkFeedbackRate();
        if (!limit.ok) {
            showToast(limit.message, 'error');
            paintFeedbackWait(limit, 'messages-thread-hint');
            return;
        }
        const safety = checkContentSafety(text);
        if (safety.verdict === 'block') {
            showToast(safety.message, 'error');
            const hint = document.getElementById('messages-thread-hint');
            if (hint) hint.textContent = safety.message;
            return;
        }
        if (safety.verdict === 'review') {
            await queueAutoModeration({
                source: 'feedback_thread',
                reason: safety.reason,
                body: text,
                routeId: $currentRouteId.get() || null,
                publish: {
                    kind: 'feedback',
                    payload: {
                        type: 'thread_reply',
                        text,
                        email,
                        status: 'unread',
                        appVersion: APP_VERSION,
                        routeId: $currentRouteId.get() || 'none',
                        region: $userRegion.get() || 'GP',
                        timestamp: Date.now(),
                        deviceId: getThreadDeviceId() || 'unknown',
                    },
                },
            });
            recordRateHit(FEEDBACK_RATE_KEY, { windowMs: FEEDBACK_WINDOW_MS });
            if (input) input.value = '';
            showToast(safety.message, 'info');
            const hint = document.getElementById('messages-thread-hint');
            if (hint) hint.textContent = safety.message;
            return;
        }
        if (sendBtn) sendBtn.disabled = true;
        try {
            if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
                await window.firebaseSignInAnonymously(window.firebaseAuth);
            }
            let authToken = '';
            if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
                authToken = await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true);
            }
            let attachmentUrls = [];
            if (hasFile) {
                attachmentUrls = await uploadFeedbackAttachments(threadFile.files);
            }
            const payload = {
                type: 'thread_reply',
                text,
                email,
                attachmentUrl: attachmentUrls[0] || null,
                attachmentUrls: attachmentUrls.length ? attachmentUrls : null,
                status: 'unread',
                appVersion: APP_VERSION,
                routeId: $currentRouteId.get() || 'none',
                region: $userRegion.get() || 'GP',
                timestamp: Date.now(),
                userAgent: navigator.userAgent,
                deviceId: getThreadDeviceId() || 'unknown',
                isPWA: window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone,
            };
            const authParam = authToken ? `?auth=${authToken}` : '';
            const res = await fetch(`${DYNAMIC_BASE_URL}feedback.json${authParam}`, {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(`Failed (${res.status})`);
            recordRateHit(FEEDBACK_RATE_KEY, { windowMs: FEEDBACK_WINDOW_MS });
            if (email && !signedInContactEmail()) {
                try { safeStorage.setItem(THREAD_CONTACT_KEY, email); } catch { /* ignore */ }
            }
            await postCommuterInboxCopy({ text, feedbackType: 'thread_reply' });
            if (input) input.value = '';
            if (threadFile) threadFile.value = '';
            paintThreadFileChip(threadFile);
            renderMessagesThread(await fetchInboxThread());
            showToast('Message sent.', 'success');
        } catch (err) {
            showToast(err?.message || 'Could not send message.', 'error');
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    });
    document.getElementById('feedback-text')?.addEventListener('input', () => {
        const hint = document.getElementById('feedback-mod-hint');
        const safety = checkContentSafety(document.getElementById('feedback-text')?.value || '', { live: true });
        if (hint && !feedbackWaitCancel) {
            hint.textContent = safety.verdict === 'block' ? safety.message : '';
        }
    });
    document.getElementById('messages-thread-input')?.addEventListener('input', () => {
        const hint = document.getElementById('messages-thread-hint');
        const safety = checkContentSafety(document.getElementById('messages-thread-input')?.value || '', { live: true });
        if (hint && !feedbackWaitCancel) {
            hint.textContent = safety.verdict === 'block' ? safety.message : '';
        }
    });
    document.getElementById('feedback-submit-btn')?.addEventListener('click', submitFeedback);
    // Clear reply mode when modal is cancelled/closed via footer/X
    document.querySelectorAll('#feedback-modal [onclick*="feedback-modal"]').forEach((btn) => {
        btn.addEventListener('click', () => setTimeout(clearFeedbackReplyMode, 0));
    });
    document.getElementById('feedback-privacy-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerHaptic();
        window.openLegal?.('privacy');
    });
    document.getElementById('messages-thread-privacy')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerHaptic();
        window.openLegal?.('privacy');
    });
    document.getElementById('about-contact-btn')?.addEventListener('click', () => {
        trackAlertEvent('click_about_inapp_message', { location: 'about_modal' });
        openFeedbackModal({ location: 'about', skipClear: true });
    });
    document.getElementById('about-email-btn')?.addEventListener('click', () => {
        trackAlertEvent('click_about_email', { location: 'about_modal' });
    });

    const fileInput = document.getElementById('feedback-file');
    fileInput?.addEventListener('change', () => {
        const preview = document.getElementById('feedback-file-preview');
        const nameEl = document.getElementById('feedback-file-name');
        if (fileInput.files?.length) {
            if (nameEl) nameEl.textContent = fileInput.files.length === 1
                ? fileInput.files[0].name
                : `${fileInput.files.length} files selected`;
            preview?.classList.remove('hidden');
        } else {
            preview?.classList.add('hidden');
        }
    });
    document.getElementById('feedback-file-remove')?.addEventListener('click', () => {
        if (fileInput) fileInput.value = '';
        document.getElementById('feedback-file-preview')?.classList.add('hidden');
    });

    const threadFileInput = document.getElementById('messages-thread-file');
    threadFileInput?.addEventListener('change', () => paintThreadFileChip(threadFileInput));
    document.getElementById('messages-thread-file-remove')?.addEventListener('click', () => {
        if (threadFileInput) threadFileInput.value = '';
        paintThreadFileChip(threadFileInput);
    });
    document.getElementById('messages-thread-contact')?.addEventListener('change', () => {
        const val = document.getElementById('messages-thread-contact')?.value?.trim() || '';
        if (val) {
            try { safeStorage.setItem(THREAD_CONTACT_KEY, val); } catch { /* ignore */ }
        }
    });

    // Legal in sidenav
    document.querySelectorAll('.hub-legal-link').forEach((btn) => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-legal') || 'terms';
            closeAppHub(true);
            setTimeout(() => window.openLegal?.(type), 50);
        });
    });

    // Admin password eye is bound after stampAdminChrome (login lives in a <template>).

    // Poll notices soon after boot, then often while the app is open (refresh was
    // previously the only reliable way to see a just-published alert).
    setTimeout(() => checkServiceAlerts(), 600);
    setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        checkServiceAlerts();
    }, 45 * 1000);
    if (!window.__ntAlertVisibilityBound) {
        window.__ntAlertVisibilityBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') checkServiceAlerts();
        });
    }

    // Prefetch holiday approvals, then show notice only on the home board
    // (stabilized + route selected + Next Train / Trip Planner).
    import('./holiday-approvals.js').then((m) => m.loadHolidayApprovals?.()).catch(() => {});
    setTimeout(() => {
        import('./holiday-notice.js')
            .then((m) => m.maybeShowHolidayNotice?.())
            .catch(() => {});
    }, 3500);
}
