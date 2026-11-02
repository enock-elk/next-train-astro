/**
 * Home-screen badge for a signed-in operator's new commuter messages.
 * Commuters never set it. Opening Dev Mode is not required.
 * The count matches the feedback tile: rows newer than the last time
 * that operator opened messages, on this phone or another.
 *
 * Cost: never download the full feedback tree. Query by timestamp from
 * lastChecked with a small limitToLast cap.
 */
import { DYNAMIC_BASE_URL, isAdminEmail } from './config.js';
import { safeStorage } from './utils.js';

const POLL_MS = 60 * 1000;
/** Cap unread download so a large inbox cannot blow the badge poll. */
const UNREAD_QUERY_LIMIT = 40;
let inFlight = false;

function currentOperator() {
    const user = typeof window !== 'undefined' ? window.firebaseAuth?.currentUser : null;
    if (!user || user.isAnonymous) return null;
    const email = String(user.email || '').trim();
    if (!email || !isAdminEmail(email)) return null;
    return user;
}

async function clearAppBadge() {
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.clearAppBadge === 'function') {
            await navigator.clearAppBadge();
        }
    } catch { /* the icon can keep its last count */ }
}

async function operatorToken(user) {
    if (typeof window.firebaseGetIdToken !== 'function') return '';
    try {
        return await window.firebaseGetIdToken(user, false) || '';
    } catch {
        try {
            return await window.firebaseGetIdToken(user, true) || '';
        } catch {
            return '';
        }
    }
}

/** REST query for feedback rows newer than lastChecked (requires .indexOn timestamp). */
function feedbackUnreadUrl(auth, lastChecked) {
    const params = new URLSearchParams();
    params.set('auth', auth);
    params.set('orderBy', '"timestamp"');
    params.set('startAt', String(Math.max(0, lastChecked + 1)));
    params.set('limitToLast', String(UNREAD_QUERY_LIMIT));
    return `${DYNAMIC_BASE_URL}feedback.json?${params.toString()}`;
}

export async function syncOperatorMessageBadge() {
    if (typeof window === 'undefined' || inFlight) return;
    const user = currentOperator();
    if (!user) {
        await clearAppBadge();
        return;
    }
    if (typeof navigator === 'undefined' || typeof navigator.setAppBadge !== 'function') return;
    inFlight = true;
    try {
        const token = await operatorToken(user);
        if (!token) return;
        const auth = encodeURIComponent(token);
        const seenRes = await fetch(
            `${DYNAMIC_BASE_URL}admin_state/${user.uid}/fb_last_checked.json?auth=${auth}`,
            { cache: 'no-store' }
        ).catch(() => null);
        const remoteSeen = seenRes && seenRes.ok ? Number(await seenRes.json().catch(() => 0)) || 0 : 0;
        const localSeen = parseInt(safeStorage.getItem('fb_last_checked') || '0', 10) || 0;
        const lastChecked = Math.max(localSeen, remoteSeen);
        const fbRes = await fetch(feedbackUnreadUrl(token, lastChecked), { cache: 'no-store' }).catch(() => null);
        if (!fbRes || !fbRes.ok) return;
        const data = await fbRes.json().catch(() => null);
        let unread = 0;
        if (data && typeof data === 'object') {
            Object.values(data).forEach((item) => {
                if (Number(item?.timestamp) > lastChecked) unread += 1;
            });
        }
        if (unread > 0) await navigator.setAppBadge(unread);
        else await clearAppBadge();
    } catch {
        /* leave the last badge if the read fails */
    } finally {
        inFlight = false;
    }
}

export function watchOperatorMessageBadge() {
    if (typeof window === 'undefined' || window.__ntOperatorBadgeWatch) return;
    window.__ntOperatorBadgeWatch = true;
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) syncOperatorMessageBadge();
    });
    window.setInterval(() => {
        if (!document.hidden) syncOperatorMessageBadge();
    }, POLL_MS);
    syncOperatorMessageBadge();
}
