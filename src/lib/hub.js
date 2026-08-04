/**
 * App Hub (sidenav) + feedback + notices + cache sync + changelog badge
 */
import {
    APP_VERSION,
    CHANGELOG_DATA,
    DYNAMIC_BASE_URL,
    ROUTES,
    withBase,
    getLatestChangelog,
    getChangelogVersionId,
    normalizeChangelogId,
} from './config.js';
import { safeStorage, escapeHTML, repairMojibake } from './utils.js';
import {
    showToast, triggerHaptic, openSmoothModal, closeSmoothModal
} from './ui.js';
import { $userProfile, $currentRouteId, $userRegion, $deviceId } from '../store.js';
import { isLieFi } from './logic.js';
import { bindColourPackControls, setColourPack, getColourPack } from './prefs.js';
import { bindAccountUi, initAccount } from './account.js';
import { markPendingReload } from './session-stability.js';
import { setupMapLogic } from './map-viewer.js';
import { applyShadowBanCloak } from './trust.js';

export function closeAppHub(skipHistory = false) {
    const sidenav = document.getElementById('sidenav');
    const overlay = document.getElementById('sidenav-overlay');
    if (!skipHistory && location.hash === '#sidenav') {
        window._isSidenavClosing = true;
        try { history.back(); } catch { /* ignore */ }
        setTimeout(() => { window._isSidenavClosing = false; }, 150);
    }
    if (sidenav) {
        // Left drawer (SPA): closed = -translate-x-full / no .open
        sidenav.classList.remove('translate-x-0', 'open');
        sidenav.classList.add('-translate-x-full');
    }
    if (overlay) {
        overlay.classList.add('opacity-0');
        overlay.classList.remove('open');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
    document.body.classList.remove('sidenav-open', 'modal-active');
}

export function openAppHub() {
    triggerHaptic();
    const sidenav = document.getElementById('sidenav');
    const overlay = document.getElementById('sidenav-overlay');
    sidenav?.classList.remove('-translate-x-full', 'translate-x-full');
    sidenav?.classList.add('translate-x-0', 'open');
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
                    <h3 class="text-xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">Sync Latest Schedule?</h3>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">This will clear your offline cache and download the absolute latest App version from the server.</p>
                    <div class="flex space-x-3">
                        <button type="button" id="cache-clear-cancel" class="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold py-3 px-4 rounded-xl transition-colors focus:outline-none">Cancel</button>
                        <button type="button" id="cache-clear-confirm" class="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-colors focus:outline-none">Sync Now</button>
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
    if (cb) cb.checked = safeStorage.getItem('hapticsEnabled') !== 'false';
}

function syncChangelogBadge() {
    const badge = document.getElementById('whats-new-badge');
    const verLabel = document.querySelector('#settings-app-version .font-mono');
    const latest = getLatestChangelog();
    const ver = getChangelogVersionId(latest) || APP_VERSION;
    if (verLabel) verLabel.textContent = ver;
    const seenNorm = normalizeChangelogId(safeStorage.getItem('seen_changelog_version'));
    if (badge) badge.classList.toggle('hidden', seenNorm === normalizeChangelogId(ver));
}

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

    const hasFile = !!(fileInput?.files?.length);
    triggerHaptic();
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
            const uploads = Array.from(fileInput.files).map(async (file) => {
                try {
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
            attachmentUrls = (await Promise.all(uploads)).filter(Boolean);
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

        showToast('Feedback sent! Thank you.', 'success');
        closeSmoothModal('feedback-modal');
        const ta = document.getElementById('feedback-text');
        const em = document.getElementById('feedback-email');
        if (ta) ta.value = '';
        if (em) em.value = '';
        if (fileInput) fileInput.value = '';
        document.getElementById('feedback-file-preview')?.classList.add('hidden');
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Could not send feedback.', 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (submitText) submitText.textContent = 'Submit';
        spinner?.classList.add('hidden');
    }
}

function sanitizeHTML(dirtyHtml) {
    const doc = new DOMParser().parseFromString(repairMojibake(dirtyHtml || ''), 'text/html');
    const allowedTags = ['B', 'I', 'STRONG', 'EM', 'A', 'BR', 'P', 'SPAN', 'DIV', 'UL', 'OL', 'LI', 'IMG', 'BUTTON'];
    const cleanNode = (node) => {
        Array.from(node.childNodes).forEach((child) => {
            if (child.nodeType === 1) {
                if (!allowedTags.includes(child.tagName)) {
                    child.replaceWith(...Array.from(child.childNodes));
                    cleanNode(node);
                } else {
                    Array.from(child.attributes).forEach((attr) => {
                        const attrName = attr.name.toLowerCase();
                        if (attrName === 'href' || attrName === 'src') {
                            if (!/^(https?|mailto):/i.test(attr.value)) child.removeAttribute(attr.name);
                        } else if (attrName === 'onclick') {
                            if (!/^window\.openLightbox\(.*\)$/.test(attr.value)) child.removeAttribute(attr.name);
                        } else if (attrName === 'target' && child.tagName === 'A') {
                            // Same-origin links must stay in the PWA (no browser handoff)
                            try {
                                const href = child.getAttribute('href');
                                if (href) {
                                    const u = new URL(href, location.href);
                                    if (u.origin === location.origin) child.removeAttribute('target');
                                }
                            } catch { /* keep target */ }
                        } else if (!['target', 'class', 'rel', 'alt', 'type'].includes(attrName)) {
                            child.removeAttribute(attr.name);
                        }
                    });
                    cleanNode(child);
                }
            }
        });
    };
    cleanNode(doc.body);
    return doc.body.innerHTML;
}

function trackAlertEvent(name, params) {
    if (typeof window.trackAnalyticsEvent === 'function') {
        window.trackAnalyticsEvent(name, params);
    }
}

/** Fetch poll tallies and render percentages (no raw vote lists). */
async function renderPollResultsInto(container, pollId, poll, votedOption) {
    if (!container || !pollId || !poll) return;
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
        const total = countA + countB + countC;
        const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
        const row = (key, label, n) => {
            if (!label) return '';
            const p = pct(n);
            const mine = votedOption === key ? ' ring-1 ring-purple-400' : '';
            return `
                <div class="mb-2${mine}">
                    <div class="flex justify-between text-[10px] font-bold text-purple-800 dark:text-purple-200 mb-1">
                        <span>${escapeHTML(label)}${votedOption === key ? ' · your vote' : ''}</span>
                        <span>${p}%</span>
                    </div>
                    <div class="w-full bg-purple-100 dark:bg-purple-950 rounded-full h-2">
                        <div class="bg-purple-500 h-2 rounded-full transition-all duration-500" style="width:${p}%"></div>
                    </div>
                </div>`;
        };
        container.innerHTML = `
            <p class="text-xs font-black text-purple-900 dark:text-purple-100 mb-3 text-center leading-tight">${escapeHTML(poll.question || 'Poll results')}</p>
            ${row('A', poll.optionA, countA)}
            ${row('B', poll.optionB, countB)}
            ${poll.optionC ? row('C', poll.optionC, countC) : ''}
            <p class="text-[9px] text-center text-purple-500 dark:text-purple-400 font-bold uppercase tracking-wider mt-1">Live percentages</p>`;
        container.className = 'mt-4 bg-purple-50 dark:bg-purple-900/20 p-4 rounded-xl border border-purple-200 dark:border-purple-800 shadow-inner';
    } catch {
        container.innerHTML = `
            <div class="text-center">
                <p class="text-xs font-bold text-green-800 dark:text-green-300">Thanks for voting!</p>
                <p class="text-[10px] text-green-600 dark:text-green-500 mt-0.5">Your response has been recorded.</p>
            </div>`;
        container.className = 'mt-4 bg-green-50 dark:bg-green-900/20 p-3 rounded-xl border border-green-200 dark:border-green-800 shadow-inner';
    }
}

/** SPA parity — notice modal poll votes (one vote per device via localStorage). */
export function submitPollVote(pollId, optionKey, optionText, pollMeta = null) {
    triggerHaptic();
    if (!pollId) return;
    if (safeStorage.getItem('poll_voted_' + pollId)) {
        showToast('You have already voted on this poll.', 'warning');
        return;
    }
    trackAlertEvent('alert_poll_vote', {
        poll_id: pollId,
        vote_option: optionKey,
        vote_text: optionText,
        route_id: $currentRouteId.get() || 'global',
    });
    try { safeStorage.setItem('poll_voted_' + pollId, optionKey); } catch { /* ignore */ }
    try {
        const payload = {
            optionKey,
            optionText,
            timestamp: Date.now(),
            deviceId: $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown',
        };
        fetch(`${DYNAMIC_BASE_URL}polls/${encodeURIComponent(pollId)}.json`, {
            method: 'POST',
            body: JSON.stringify(payload),
        }).catch(() => {});
    } catch { /* ignore */ }

    const container = document.getElementById(`poll-container-${pollId}`);
    if (container) {
        if (pollMeta?.showResults) {
            renderPollResultsInto(container, pollId, pollMeta, optionKey);
        } else {
            container.innerHTML = `
                <div class="text-center animate-fade-in-up">
                    <p class="text-xs font-bold text-green-800 dark:text-green-300">Thanks for voting!</p>
                    <p class="text-[10px] text-green-600 dark:text-green-500 mt-0.5">Your response has been recorded.</p>
                </div>`;
            container.className = 'mt-4 bg-green-50 dark:bg-green-900/20 p-3 rounded-xl border border-green-200 dark:border-green-800 shadow-inner transition-all';
        }
    }
    showToast('Vote recorded successfully!', 'success');
}

export async function checkServiceAlerts() {
    const bellBtn = document.getElementById('notice-bell');
    const dot = document.getElementById('notice-dot');
    const modal = document.getElementById('notice-modal');
    const content = document.getElementById('notice-content');
    const timestamp = document.getElementById('notice-timestamp');
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
                        const unreadKeys = Object.keys(inboxData).filter((k) => inboxData[k] && !inboxData[k].read);
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
                viewReplyBtn.onclick = () => {
                    triggerHaptic();

                    const replyContent = document.getElementById('developer-reply-content');
                    const markReadBtn = document.getElementById('mark-reply-read-btn');

                    if (replyContent) {
                        const replyModalCard = document.querySelector('#developer-reply-modal > div');
                        if (replyModalCard && !replyModalCard.dataset.styled) {
                            replyModalCard.dataset.styled = 'true';
                            replyModalCard.classList.add('max-h-[85vh]', 'flex', 'flex-col', 'p-0', 'overflow-hidden');
                            replyModalCard.classList.remove('p-6');

                            const headerDiv = replyModalCard.querySelector('.flex.items-center.justify-between');
                            if (headerDiv) {
                                headerDiv.classList.add('p-5', 'bg-white', 'dark:bg-gray-800', 'border-b', 'border-gray-200', 'dark:border-gray-700', 'shrink-0');
                                headerDiv.classList.remove('mb-4');
                            }

                            replyContent.classList.add('overflow-y-auto', 'custom-scrollbar', 'flex-grow', 'p-5', 'rounded-none', 'border-0', 'mb-0');
                            replyContent.classList.remove('mb-6', 'rounded-xl', 'border', 'border-gray-200', 'dark:border-gray-700');
                        }

                        replyContent.innerHTML = sanitizeHTML(adminReply.message || '');
                    }

                    if (markReadBtn) {
                        markReadBtn.textContent = 'Got it, Thanks!';
                        markReadBtn.disabled = false;

                        const actionsContainer = document.getElementById('admin-message-actions') || markReadBtn.parentNode;
                        actionsContainer.className = 'flex space-x-3 w-full shrink-0 p-5 pt-0';
                        markReadBtn.className = 'flex-1 bg-gray-900 hover:bg-black dark:bg-gray-700 dark:hover:bg-gray-600 text-white font-bold py-3 rounded-xl shadow-md transition-colors focus:outline-none text-sm';

                        markReadBtn.onclick = async () => {
                            triggerHaptic();
                            markReadBtn.disabled = true;
                            markReadBtn.textContent = 'Marking...';
                            try {
                                await fetch(`${DYNAMIC_BASE_URL}inbox/${deviceId}/${adminReply._key}.json`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ read: true, readAt: Date.now(), acknowledged: true })
                                });
                            } catch (e) {}

                            if (location.hash === '#devreply') history.back();
                            else closeSmoothModal('developer-reply-modal');
                            replyBanner.classList.add('hidden');
                        };

                        let replyToAdminBtn = document.getElementById('reply-to-admin-btn');
                        if (!replyToAdminBtn) {
                            replyToAdminBtn = document.createElement('button');
                            replyToAdminBtn.id = 'reply-to-admin-btn';
                            replyToAdminBtn.type = 'button';
                            replyToAdminBtn.className = 'flex-1 bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 border-2 border-blue-600 dark:border-blue-500 hover:bg-blue-50 dark:hover:bg-gray-700 font-bold py-3 rounded-xl shadow-sm transition-colors focus:outline-none flex items-center justify-center text-sm';
                            replyToAdminBtn.innerHTML = '<svg class="w-4 h-4 mr-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Reply to Admin';
                            actionsContainer.appendChild(replyToAdminBtn);
                        }

                        replyToAdminBtn.onclick = () => {
                            triggerHaptic();

                            const fText = document.getElementById('feedback-text');
                            const fType = document.getElementById('feedback-type');

                            if (fText) {
                                let contextBox = document.getElementById('feedback-reply-context');
                                if (!contextBox) {
                                    contextBox = document.createElement('div');
                                    contextBox.id = 'feedback-reply-context';
                                    fText.parentNode?.insertBefore(contextBox, fText);
                                }
                                contextBox.className = 'mb-0 mx-5 mt-4 p-3 bg-gray-100 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 italic flex items-start shadow-inner';

                                let cleanAdminMsg = '';
                                if (adminReply.message) {
                                    const tempDoc = new DOMParser().parseFromString(adminReply.message, 'text/html');
                                    cleanAdminMsg = tempDoc.body.textContent || tempDoc.body.innerText || '';
                                }
                                cleanAdminMsg = cleanAdminMsg.replace(/—.*/, '').trim();
                                const words = cleanAdminMsg.split(/\s+/).filter((w) => w.length > 0);
                                const truncatedAdminMsg = words.slice(0, 8).join(' ') + (words.length > 8 ? '...' : '');

                                contextBox.innerHTML = `<svg class="w-4 h-4 mr-2 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><div><span class="block font-bold text-[10px] uppercase tracking-wider mb-0.5 text-gray-400">Replying to Admin:</span><span class="line-clamp-2">"${escapeHTML(truncatedAdminMsg)}"</span></div>`;
                                contextBox.dataset.rawMsg = `[REPLY TO ADMIN: ${adminReply._key}] ${truncatedAdminMsg}`;
                                contextBox.classList.remove('hidden');
                                fText.value = '';
                            }

                            if (fType) {
                                if (!fType.querySelector('option[value="thread_reply"]')) {
                                    const replyOpt = document.createElement('option');
                                    replyOpt.value = 'thread_reply';
                                    replyOpt.textContent = 'Thread Reply';
                                    fType.appendChild(replyOpt);
                                }
                                fType.value = 'thread_reply';
                            }

                            if (location.hash === '#devreply') history.back();
                            else closeSmoothModal('developer-reply-modal');
                            setTimeout(() => {
                                trackAlertEvent('open_feedback_modal', { location: 'admin_inbox_reply' });
                                history.pushState({ modal: 'feedback' }, '', '#feedback');
                                openSmoothModal('feedback-modal');
                            }, 350);
                        };
                    }

                    history.pushState({ modal: 'devreply' }, '', '#devreply');
                    openSmoothModal('developer-reply-modal', 'dev-banner');
                };
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

        // 2. Notices: global + region-wide + current route (admin targets: all, all_GP, …, routeId)
        const now = Date.now();
        const severityScore = { critical: 3, warning: 2, info: 1 };
        const region = $userRegion.get() || 'GP';
        const noticeKeys = ['all', `all_${region}`];
        if (routeId && ROUTES[routeId]) noticeKeys.push(routeId);

        const parseNoticeBucket = (raw, sourceKey) => {
            if (!raw) return [];
            const stamp = (n) => (n && typeof n === 'object' ? { ...n, _sourceKey: sourceKey } : null);
            if (Array.isArray(raw)) {
                return raw.map((n) => stamp(n)).filter((n) => n && (!n.expiresAt || n.expiresAt > now));
            }
            if (typeof raw === 'object') {
                if (raw.message || raw.text || raw.id || raw.severity) {
                    return (!raw.expiresAt || raw.expiresAt > now) ? [stamp(raw)] : [];
                }
                return Object.values(raw)
                    .map((n) => stamp(n))
                    .filter((n) => n && (!n.expiresAt || n.expiresAt > now));
            }
            return [];
        };

        const fetchBucket = async (key) => {
            try {
                const res = await fetch(`${DYNAMIC_BASE_URL}notices/${key}.json?t=${Date.now()}`);
                if (!res.ok) return [];
                const ct = res.headers.get('content-type') || '';
                if (ct.includes('text/html')) throw new Error('Captive Portal Detected');
                return parseNoticeBucket(await res.json(), key);
            } catch (e) {
                if (e?.message === 'Captive Portal Detected') throw e;
                return [];
            }
        };

        const buckets = await Promise.all(noticeKeys.map(fetchBucket));
        const validNotices = buckets.flat();

        if (validNotices.length === 0) {
            bellBtn.classList.add('hidden');
            return;
        }

        validNotices.sort((a, b) => (severityScore[b.severity] || 1) - (severityScore[a.severity] || 1));
        const activeNotice = validNotices[0];
        const severity = activeNotice.severity || 'info';
        const seenKey = `seen_notice_${activeNotice._sourceKey || 'x'}_${activeNotice.id || activeNotice.timestamp || 'x'}`;
        const hasSeen = safeStorage.getItem(seenKey) === 'true';
        const forcePopup = activeNotice.forcePopup === true
            || (activeNotice.forcePopup == null && severity === 'critical');

        const bindModalContent = () => {
            if (!content || !modal) return;

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

            let formattedMsg = sanitizeHTML(activeNotice.message || activeNotice.text || '');

            if (activeNotice.sourceName) {
                const sName = escapeHTML(activeNotice.sourceName);
                const sUrl = activeNotice.sourceUrl ? escapeHTML(activeNotice.sourceUrl) : null;
                const innerCitation = sUrl
                    ? `<a href="${sUrl}" target="_blank" rel="noopener" class="hover:underline text-blue-600 dark:text-blue-400 font-medium flex items-center">${sName} <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg></a>`
                    : `<span class="font-medium text-gray-700 dark:text-gray-300">${sName}</span>`;
                formattedMsg += `<div class="mt-3 p-2.5 bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-lg text-[10px] text-gray-500 dark:text-gray-400 italic flex items-center shadow-sm w-fit max-w-full"><span class="mr-1.5 not-italic text-sm">📰</span><span class="flex items-center space-x-1"><span>Source:</span> ${innerCitation}</span></div>`;
            }

            content.innerHTML = formattedMsg;

            if (activeNotice.ctaUrl && activeNotice.ctaText) {
                content.innerHTML += `
                    <a href="${escapeHTML(activeNotice.ctaUrl)}" target="_blank" rel="noopener" class="mt-4 flex items-center justify-center w-full bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 font-bold py-2.5 px-4 rounded-lg transition-colors text-xs uppercase tracking-wide border border-blue-200 dark:border-blue-800 shadow-sm focus:outline-none">
                        ${escapeHTML(activeNotice.ctaText)}
                        <svg class="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    </a>`;
            }

            // Interactive poll (SPA parity) — one local vote; optional live % results
            if (activeNotice.poll && activeNotice.poll.active) {
                const pollId = activeNotice.id;
                const votedOption = safeStorage.getItem('poll_voted_' + pollId);
                const pollMeta = {
                    question: activeNotice.poll.question || '',
                    optionA: activeNotice.poll.optionA || '',
                    optionB: activeNotice.poll.optionB || '',
                    optionC: activeNotice.poll.optionC || '',
                    showResults: !!activeNotice.poll.showResults,
                };
                content.innerHTML += `<div id="poll-container-${escapeHTML(String(pollId))}" class="mt-4 bg-purple-50 dark:bg-purple-900/20 p-4 rounded-xl border border-purple-200 dark:border-purple-800 shadow-sm"></div>`;
                const pollEl = document.getElementById(`poll-container-${pollId}`);
                if (pollEl) {
                    try { pollEl.dataset.pollMeta = JSON.stringify(pollMeta); } catch { /* ignore */ }
                    if (votedOption && activeNotice.poll.showResults) {
                        renderPollResultsInto(pollEl, pollId, activeNotice.poll, votedOption);
                    } else if (votedOption) {
                        pollEl.innerHTML = `
                            <div class="text-center">
                                <p class="text-xs font-bold text-green-800 dark:text-green-300">Thanks for voting!</p>
                                <p class="text-[10px] text-green-600 dark:text-green-500 mt-0.5">Your response has been recorded.</p>
                            </div>`;
                        pollEl.className = 'mt-4 bg-green-50 dark:bg-green-900/20 p-3 rounded-xl border border-green-200 dark:border-green-800 shadow-inner';
                    } else {
                        const optC = activeNotice.poll.optionC
                            ? `<button type="button" data-poll-id="${escapeHTML(String(pollId))}" data-poll-opt="C" data-poll-text="${escapeHTML(activeNotice.poll.optionC)}" class="nt-poll-vote flex-1 min-w-[30%] bg-white dark:bg-gray-800 border-2 border-purple-300 dark:border-purple-700 hover:border-purple-500 text-purple-700 dark:text-purple-300 font-bold py-2.5 rounded-lg transition-all text-xs focus:outline-none shadow-sm">${escapeHTML(activeNotice.poll.optionC)}</button>`
                            : '';
                        pollEl.innerHTML = `
                            <p class="text-sm font-black text-purple-900 dark:text-purple-100 mb-3 leading-tight text-center">${escapeHTML(activeNotice.poll.question || '')}</p>
                            <div class="flex flex-wrap gap-2 mb-3">
                                <button type="button" data-poll-id="${escapeHTML(String(pollId))}" data-poll-opt="A" data-poll-text="${escapeHTML(activeNotice.poll.optionA || 'A')}" class="nt-poll-vote flex-1 min-w-[30%] bg-white dark:bg-gray-800 border-2 border-purple-300 dark:border-purple-700 hover:border-purple-500 text-purple-700 dark:text-purple-300 font-bold py-2.5 rounded-lg transition-all text-xs focus:outline-none shadow-sm">${escapeHTML(activeNotice.poll.optionA || 'A')}</button>
                                <button type="button" data-poll-id="${escapeHTML(String(pollId))}" data-poll-opt="B" data-poll-text="${escapeHTML(activeNotice.poll.optionB || 'B')}" class="nt-poll-vote flex-1 min-w-[30%] bg-white dark:bg-gray-800 border-2 border-purple-300 dark:border-purple-700 hover:border-purple-500 text-purple-700 dark:text-purple-300 font-bold py-2.5 rounded-lg transition-all text-xs focus:outline-none shadow-sm">${escapeHTML(activeNotice.poll.optionB || 'B')}</button>
                                ${optC}
                            </div>
                            <div id="poll-live-results-${escapeHTML(String(pollId))}" class="${activeNotice.poll.showResults ? '' : 'hidden'}"></div>`;
                        if (activeNotice.poll.showResults) {
                            const liveBox = document.getElementById(`poll-live-results-${pollId}`);
                            if (liveBox) renderPollResultsInto(liveBox, pollId, activeNotice.poll, null);
                        }
                    }
                }
            }

            if (timestamp) {
                const posted = activeNotice.postedAt || activeNotice.timestamp;
                if (posted) {
                    const date = new Date(posted);
                    timestamp.textContent = `Posted: ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${date.toLocaleDateString()}`;
                } else {
                    timestamp.textContent = '';
                }
            }

            // SPA design: Close + Reply footer (severity-coloured Reply)
            const closeNotice = () => {
                if (location.hash === '#notice') history.back();
                else closeSmoothModal('notice-modal');
            };
            const oldCloseBtn = document.getElementById('notice-modal-close-btn')
                || modal.querySelector('button.bg-red-600, button.bg-blue-600, button.bg-yellow-600');
            const oldContainer = modal.querySelector('.nt-notice-actions');
            if (oldContainer) oldContainer.remove();

            let baseColorClass = 'bg-blue-600 hover:bg-blue-700';
            if (severity === 'critical') baseColorClass = 'bg-red-600 hover:bg-red-700';
            else if (severity === 'warning') baseColorClass = 'bg-yellow-600 hover:bg-yellow-700';

            const btnContainer = document.createElement('div');
            btnContainer.className = 'nt-notice-actions flex space-x-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 w-full';

            const newCloseBtn = document.createElement('button');
            newCloseBtn.type = 'button';
            newCloseBtn.id = 'notice-close-btn';
            newCloseBtn.className = 'flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white font-bold py-2.5 px-4 rounded-lg shadow-sm transition-colors focus:outline-none';
            newCloseBtn.textContent = 'Close';
            newCloseBtn.onclick = closeNotice;
            btnContainer.appendChild(newCloseBtn);

            const newReplyBtn = document.createElement('button');
            newReplyBtn.type = 'button';
            newReplyBtn.className = `flex-1 ${baseColorClass} text-white font-bold py-2.5 px-4 rounded-lg shadow-sm transition-colors focus:outline-none flex items-center justify-center`;
            const replySvg = '<svg class="w-4 h-4 mr-1.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
            newReplyBtn.innerHTML = `${replySvg} Reply`;
            newReplyBtn.onclick = () => {
                triggerHaptic();
                let cleanMsgText = '';
                if (activeNotice?.message || activeNotice?.text) {
                    const tempDoc = new DOMParser().parseFromString(
                        repairMojibake(activeNotice.message || activeNotice.text || ''),
                        'text/html'
                    );
                    cleanMsgText = tempDoc.body.textContent || tempDoc.body.innerText || '';
                    cleanMsgText = cleanMsgText.replace(/[—–].*/, '').trim();
                }
                const words = cleanMsgText.split(/\s+/).filter((w) => w.length > 0);
                let truncatedMsg = words.slice(0, 6).join(' ');
                if (words.length > 6) truncatedMsg += '...';

                const fText = document.getElementById('feedback-text');
                const fType = document.getElementById('feedback-type');
                if (fText) {
                    let contextBox = document.getElementById('feedback-reply-context');
                    if (!contextBox) {
                        contextBox = document.createElement('div');
                        contextBox.id = 'feedback-reply-context';
                        contextBox.className = 'mb-3 p-3 bg-gray-100 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 italic flex items-start hidden shadow-inner';
                        fText.parentNode.insertBefore(contextBox, fText);
                    }
                    contextBox.innerHTML = `<svg class="w-4 h-4 mr-2 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><div><span class="block font-bold text-[10px] uppercase tracking-wider mb-0.5 text-gray-400">Replying to Advisory:</span><span class="line-clamp-2">"${escapeHTML(truncatedMsg)}"</span></div>`;
                    contextBox.dataset.rawMsg = truncatedMsg;
                    contextBox.dataset.alertId = activeNotice.id || '';
                    contextBox.classList.remove('hidden');
                    fText.value = '';
                }
                if (fType) {
                    if (!fType.querySelector('option[value="thread_reply"]')) {
                        const replyOpt = document.createElement('option');
                        replyOpt.value = 'thread_reply';
                        replyOpt.textContent = 'Thread Reply';
                        fType.appendChild(replyOpt);
                    }
                    fType.value = 'thread_reply';
                }
                closeNotice();
                setTimeout(() => {
                    trackAlertEvent('open_feedback_modal', { location: 'alert_reply' });
                    history.pushState({ modal: 'feedback' }, '', '#feedback');
                    openSmoothModal('feedback-modal');
                }, 350);
            };
            btnContainer.appendChild(newReplyBtn);

            if (oldCloseBtn) {
                oldCloseBtn.style.display = 'none';
                oldCloseBtn.parentNode?.appendChild(btnContainer);
            } else {
                content.parentNode?.appendChild(btnContainer);
            }
        };

        bellBtn.classList.remove('hidden');

        // SPA design: full className reset so severity bg + text always apply
        let bellClass = 'absolute top-4 right-4 z-[70] p-1.5 rounded-full shadow-md focus:outline-none hover:scale-105 transition-transform ';
        let dotClass = 'absolute top-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-gray-800 transform translate-x-1/4 -translate-y-1/4 ';
        if (severity === 'critical') {
            bellClass += 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300';
            dotClass += 'bg-red-600';
        } else if (severity === 'warning') {
            bellClass += 'bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-300';
            dotClass += 'bg-yellow-500';
        } else {
            bellClass += 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300';
            dotClass += 'bg-blue-600';
        }
        bellBtn.className = bellClass;
        if (dot) dot.className = dotClass;

        if (!hasSeen) {
            if (dot) dot.classList.remove('hidden');
            if (severity === 'critical') bellBtn.classList.add('animate-shake');
            else bellBtn.classList.remove('animate-shake');

            const welcomeModal = document.getElementById('welcome-modal');
            const isWelcomeScreenActive = !routeId || (welcomeModal && !welcomeModal.classList.contains('hidden'));

            if (forcePopup && !window._criticalModalShown && !isWelcomeScreenActive) {
                window._criticalModalShown = true;
                setTimeout(() => {
                    triggerHaptic();
                    trackAlertEvent('auto_open_alert', { severity, route_id: routeId || 'all' });
                    safeStorage.setItem(seenKey, 'true');
                    bellBtn.classList.remove('animate-shake');
                    if (dot) dot.classList.add('hidden');
                    bindModalContent();
                    // openSmoothModal pushes #notice once — don't double-push over #planner-results
                    openSmoothModal('notice-modal');
                }, 1200);
            }
        } else {
            bellBtn.classList.remove('animate-shake');
            if (dot) dot.classList.add('hidden');
        }

        bellBtn.onclick = () => {
            triggerHaptic();
            trackAlertEvent('view_service_alert', { severity, route_id: routeId || 'all' });
            safeStorage.setItem(seenKey, 'true');
            bellBtn.classList.remove('animate-shake');
            if (dot) dot.classList.add('hidden');
            bindModalContent();
            // openSmoothModal owns the #notice history entry
            openSmoothModal('notice-modal');
        };

        const topCloseBtn = modal?.querySelector('button.text-gray-400');
        if (topCloseBtn) {
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
    window.openAppHub = openAppHub;
    window.resetProfile = resetProfile;
    window.performHardCacheClear = performHardCacheClear;
    window.showCacheClearWarning = showCacheClearWarning;
    window.checkServiceAlerts = checkServiceAlerts;
    window.submitPollVote = submitPollVote;

    if (!window.__ntPollVoteBound) {
        window.__ntPollVoteBound = true;
        document.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.nt-poll-vote');
            if (!btn) return;
            e.preventDefault();
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
            // Keep notice open while lightbox (#lightbox) or legacy #map preview is on top
            if (noticeModal && !noticeModal.classList.contains('hidden')
                && hash !== '#notice' && hash !== '#lightbox' && hash !== '#map') {
                closeSmoothModal('notice-modal');
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

    // Account (Phase 4)
    bindAccountUi();
    initAccount();

    // Cloaked shadow-ban UX (looks like bad connectivity — never disclose ban)
    applyShadowBanCloak().catch(() => {});

    // Delay reports (Phase 5)
    import('./delay-reports.js').then((m) => m.bindDelayReportUi()).catch(() => {});

    // Route community (Phase 6)
    import('./community.js').then((m) => m.bindCommunityUi()).catch(() => {});

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
            applyHaptics(!(safeStorage.getItem('hapticsEnabled') !== 'false'));
        }
    });
    hapticsCb?.addEventListener('change', (e) => applyHaptics(e.target.checked));

    // Network map pinch/pan/zoom (SPA map-viewer parity)
    setupMapLogic();
    document.getElementById('sidenav-interactive-map-btn')?.addEventListener('click', () => {
        triggerHaptic();
        window.location.href = withBase('/map.html');
    });

    // Updates
    document.getElementById('check-updates-btn')?.addEventListener('click', showCacheClearWarning);

    // About / Help / Changelog
    document.getElementById('settings-about-btn')?.addEventListener('click', () => {
        triggerHaptic();
        closeAppHub(true);
        const ver = document.getElementById('about-version-label');
        if (ver) {
            const edition = (getLatestChangelog()?.title) || 'Next Train';
            ver.textContent = `Version ${APP_VERSION} (${edition})`;
        }
        setTimeout(() => openSmoothModal('about-modal'), 50);
    });
    document.getElementById('close-about-btn')?.addEventListener('click', () => closeSmoothModal('about-modal'));
    document.getElementById('settings-help-btn')?.addEventListener('click', () => {
        triggerHaptic();
        closeAppHub(true);
        setTimeout(() => { window.location.href = withBase('/guide.html'); }, 150);
    });
    document.getElementById('settings-app-version')?.addEventListener('click', openChangelog);

    // Feedback (live board CTA + Settings Support row)
    const openFeedback = (e) => {
        e?.preventDefault?.();
        triggerHaptic();
        closeAppHub(true);
        setTimeout(() => openSmoothModal('feedback-modal'), 50);
    };
    document.getElementById('feedback-btn')?.addEventListener('click', openFeedback);
    document.getElementById('feedback-btn-planner')?.addEventListener('click', openFeedback);
    document.getElementById('settings-feedback-btn')?.addEventListener('click', openFeedback);
    document.getElementById('feedback-submit-btn')?.addEventListener('click', submitFeedback);
    document.getElementById('feedback-privacy-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerHaptic();
        window.openLegal?.('privacy');
    });
    document.getElementById('about-contact-btn')?.addEventListener('click', () => {
        trackAlertEvent('click_about_inapp_message', { location: 'about_modal' });
        // Stack feedback on top of About so Cancel / Back returns to About
        openSmoothModal('feedback-modal');
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

    // Legal in sidenav
    document.querySelectorAll('.hub-legal-link').forEach((btn) => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-legal') || 'terms';
            closeAppHub(true);
            setTimeout(() => window.openLegal?.(type), 50);
        });
    });

    // Password eye toggle (login modal)
    const togglePassBtn = document.getElementById('toggle-password-btn');
    const passInput = document.getElementById('admin-password');
    const eyeOpen = document.getElementById('eye-open-icon');
    const eyeClosed = document.getElementById('eye-closed-icon');
    togglePassBtn?.addEventListener('click', () => {
        if (!passInput) return;
        const show = passInput.type === 'password';
        passInput.type = show ? 'text' : 'password';
        eyeOpen?.classList.toggle('hidden', show);
        eyeClosed?.classList.toggle('hidden', !show);
    });
    // Admin cancel/login history is owned by public/js/admin.js only.
    // A second listener here called history.back() twice and skipped the home page.

    // Poll notices after boot (and periodically)
    setTimeout(() => checkServiceAlerts(), 1500);
    setInterval(() => checkServiceAlerts(), 5 * 60 * 1000);
}
