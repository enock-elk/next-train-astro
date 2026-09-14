/**
 * Last successful GPS ping clock + age. Age always includes seconds.
 */

/** Epoch ms of the last GPS sample this share accepted. */
export function gpsPingSuccessAt(ping) {
    return Number(ping?.fixAt || ping?.acceptedAt || ping?.lastPingAt || ping?.at || 0) || 0;
}

/** 24h clock with seconds, e.g. 15:20:23. */
export function formatGpsPingClock(at) {
    const ms = Number(at);
    if (!ms) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

/** Always includes seconds: `5 sec`, `1m 5 sec`. */
export function formatGpsPingAge(at, now = Date.now()) {
    const ms = Number(at);
    if (!ms) return 'Unknown';
    const sec = Math.max(0, Math.floor((now - ms) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m <= 0) return `${s} sec`;
    return `${m}m ${s} sec`;
}

export function formatLastSeenWithPingClock(place, at) {
    const station = String(place || 'on the route').trim() || 'on the route';
    const clock = formatGpsPingClock(at);
    return clock ? `Last seen ${station} - ${clock}` : `Last seen ${station}`;
}
