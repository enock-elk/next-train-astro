/**
 * App Hub (sidenav) + feedback + notices + cache sync + changelog badge
 */
import { APP_VERSION, CHANGELOG_DATA, DYNAMIC_BASE_URL, ROUTES } from './config.js';
import { safeStorage } from './utils.js';
import {
    showToast, triggerHaptic, openSmoothModal, closeSmoothModal
} from './ui.js';
import { $userProfile, $currentRouteId, $userRegion, $deviceId } from '../store.js';
import { isLieFi } from './logic.js';

export function closeAppHub(skipHistory = false) {
    const sidenav = document.getElementById('sidenav');
    const overlay = document.getElementById('sidenav-overlay');
    if (sidenav) {
        sidenav.classList.remove('translate-x-0', 'open');
        sidenav.classList.add('-translate-x-full');
    }
    if (overlay) {
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
    document.body.classList.remove('sidenav-open', 'modal-active');
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
    const latest = CHANGELOG_DATA?.[0];
    if (!latest) return;
    const ver = String(latest.version).split('<')[0].trim();
    if (verLabel) verLabel.textContent = ver.replace(/^V/i, 'v');
    const seen = safeStorage.getItem('seen_changelog_version');
    if (badge) badge.classList.toggle('hidden', seen === ver);
}

function openChangelog() {
    triggerHaptic();
    closeAppHub(true);
    const latest = CHANGELOG_DATA?.[0];
    if (latest) {
        const ver = String(latest.version).split('<')[0].trim();
        safeStorage.setItem('seen_changelog_version', ver);
    }
    syncChangelogBadge();
    if (window.Renderer?.renderChangelogModal) {
        window.Renderer.renderChangelogModal(CHANGELOG_DATA);
    }
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
    const doc = new DOMParser().parseFromString(dirtyHtml, 'text/html');
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

export async function checkServiceAlerts() {
    const bellBtn = document.getElementById('notice-bell');
    const dot = document.getElementById('notice-dot');
    if (!bellBtn) return;

    const deviceId = $deviceId.get() || safeStorage.getItem('next_train_device_id');
    const routeId = $currentRouteId.get();

    try {
        // Inbox
        let adminReply = null;
        if (deviceId) {
            const inboxRes = await fetch(`${DYNAMIC_BASE_URL}inbox/${deviceId}.json?t=${Date.now()}`);
            if (inboxRes.ok) {
                const ct = inboxRes.headers.get('content-type') || '';
                if (!ct.includes('text/html')) {
                    const inboxData = await inboxRes.json();
                    if (inboxData) {
                        const unreadKeys = Object.keys(inboxData).filter((k) => inboxData[k] && !inboxData[k].read);
                        if (unreadKeys.length > 0) {
                            const latestKey = unreadKeys.sort((a, b) => (inboxData[b].timestamp || 0) - (inboxData[a].timestamp || 0))[0];
                            adminReply = { ...inboxData[latestKey], _key: latestKey };
                        }
                    }
                }
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
                    if (replyContent) replyContent.innerHTML = sanitizeHTML(adminReply.message || '');
                    const markReadBtn = document.getElementById('mark-reply-read-btn');
                    if (markReadBtn) {
                        markReadBtn.onclick = async () => {
                            try {
                                await fetch(`${DYNAMIC_BASE_URL}inbox/${deviceId}/${adminReply._key}.json`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ read: true, readAt: Date.now() })
                                });
                            } catch (e) {}
                            replyBanner.classList.add('hidden');
                            closeSmoothModal('developer-reply-modal');
                        };
                    }
                    openSmoothModal('developer-reply-modal');
                };
            }
        } else if (replyBanner) {
            replyBanner.classList.add('hidden');
        }

        // Route notices
        if (!routeId || !ROUTES[routeId]) {
            bellBtn.classList.add('hidden');
            return;
        }
        const noticeRes = await fetch(`${DYNAMIC_BASE_URL}notices/${routeId}.json?t=${Date.now()}`);
        if (!noticeRes.ok) {
            bellBtn.classList.add('hidden');
            return;
        }
        const notice = await noticeRes.json();
        if (!notice || (notice.expiresAt && notice.expiresAt < Date.now())) {
            bellBtn.classList.add('hidden');
            return;
        }
        const seenKey = `seen_notice_${routeId}_${notice.id || notice.timestamp || 'x'}`;
        const unseen = safeStorage.getItem(seenKey) !== 'true';
        bellBtn.classList.remove('hidden');
        if (dot) dot.classList.toggle('hidden', !unseen);

        bellBtn.onclick = () => {
            triggerHaptic();
            const content = document.getElementById('notice-content');
            const timestamp = document.getElementById('notice-timestamp');
            if (content) content.innerHTML = sanitizeHTML(notice.message || notice.text || '');
            if (timestamp) {
                const ts = notice.timestamp ? new Date(notice.timestamp).toLocaleString() : '';
                timestamp.textContent = ts;
            }
            safeStorage.setItem(seenKey, 'true');
            if (dot) dot.classList.add('hidden');
            openSmoothModal('notice-modal');
        };
    } catch (e) {
        console.warn('Service alerts check failed', e);
    }
}

export function initHub() {
    if (typeof window === 'undefined') return;

    window.closeAppHub = closeAppHub;
    window.resetProfile = resetProfile;
    window.performHardCacheClear = performHardCacheClear;
    window.showCacheClearWarning = showCacheClearWarning;
    window.checkServiceAlerts = checkServiceAlerts;

    syncProfileDisplay();
    syncHapticsToggle();
    syncChangelogBadge();
    $userProfile.subscribe(syncProfileDisplay);

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

    // Maps
    document.getElementById('view-map-btn')?.addEventListener('click', () => {
        triggerHaptic();
        closeAppHub(true);
        setTimeout(() => openSmoothModal('map-modal'), 50);
    });
    document.getElementById('sidenav-interactive-map-btn')?.addEventListener('click', () => {
        triggerHaptic();
        window.location.href = '/map';
    });

    // Updates
    document.getElementById('check-updates-btn')?.addEventListener('click', showCacheClearWarning);

    // About / Help / Changelog
    document.getElementById('settings-about-btn')?.addEventListener('click', () => {
        triggerHaptic();
        closeAppHub(true);
        const ver = document.getElementById('about-version-label');
        if (ver) ver.textContent = `Version ${APP_VERSION} (Guardian Edition)`;
        setTimeout(() => openSmoothModal('about-modal'), 50);
    });
    document.getElementById('close-about-btn')?.addEventListener('click', () => closeSmoothModal('about-modal'));
    document.getElementById('settings-help-btn')?.addEventListener('click', () => {
        triggerHaptic();
        closeAppHub(true);
        setTimeout(() => { window.location.href = '/guide'; }, 150);
    });
    document.getElementById('settings-app-version')?.addEventListener('click', openChangelog);

    // Feedback
    document.getElementById('feedback-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        triggerHaptic();
        closeAppHub(true);
        setTimeout(() => openSmoothModal('feedback-modal'), 50);
    });
    document.getElementById('feedback-submit-btn')?.addEventListener('click', submitFeedback);
    document.getElementById('about-contact-btn')?.addEventListener('click', () => {
        closeSmoothModal('about-modal');
        setTimeout(() => openSmoothModal('feedback-modal'), 50);
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
    document.getElementById('admin-cancel-btn')?.addEventListener('click', () => closeSmoothModal('login-modal'));

    // Poll notices after boot (and periodically)
    setTimeout(() => checkServiceAlerts(), 1500);
    setInterval(() => checkServiceAlerts(), 5 * 60 * 1000);
}
