/**
 * Inbound live-share follow (`/og/l/{train}/…` or `?live=`).
 * Lets a recipient open the Map tab view-only without making Map a public tab.
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
