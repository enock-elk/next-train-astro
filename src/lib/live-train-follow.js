/**
 * Inbound live-share follow (`/og/l/{train}/…` or `?live=`).
 * Session-only permit to open the tracking Map view-only. Not a public tab.
 * Stored in sessionStorage so a later visit cannot reopen Map without the link,
 * an authenticated admin session, or an experimental Map pin/grant.
 */
const FOLLOW_KEY = 'nt_live_train_follow';

function readStored() {
    try {
        const raw = sessionStorage.getItem(FOLLOW_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed?.trainId ? parsed : null;
    } catch {
        return null;
    }
}

export function setLiveTrainFollow(info) {
    const next = info?.trainId
        ? {
            trainId: String(info.trainId),
            routeId: String(info.routeId || ''),
            dest: String(info.dest || ''),
        }
        : null;
    if (typeof window !== 'undefined') window.__ntLiveTrainFollow = next;
    try {
        if (next) sessionStorage.setItem(FOLLOW_KEY, JSON.stringify(next));
        else sessionStorage.removeItem(FOLLOW_KEY);
    } catch { /* ignore */ }
    return next;
}

export function getLiveTrainFollow() {
    if (typeof window !== 'undefined' && window.__ntLiveTrainFollow?.trainId) {
        return window.__ntLiveTrainFollow;
    }
    return readStored();
}

export function clearLiveTrainFollow() {
    setLiveTrainFollow(null);
}

export function isLiveTrainFollowActive() {
    return !!getLiveTrainFollow()?.trainId;
}
