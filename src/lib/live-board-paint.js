/**
 * Quiet live-board paints: update countdown text without remounting cards.
 */
export function liveBoardJourneyIdentity(journey, destination = '') {
    if (!journey || typeof journey !== 'object') return '';
    const train = journey.train || journey.train1?.train || '';
    const dep = journey.departureTime || journey.train1?.departureTime || '';
    const type = journey.type || 'direct';
    return `${type}|${train}|${dep}|${destination || ''}`;
}

export function liveBoardJourneyKey(journey, destination = '') {
    const identity = liveBoardJourneyIdentity(journey, destination);
    if (!identity) return '';
    const first = journey.isFirstTrain ? '1' : '0';
    const last = journey.isLastTrain ? '1' : '0';
    return `${identity}|${first}|${last}`;
}

export function liveBoardNextAvailKey(destination, rawTime, dayOffset = 0) {
    return `nextavail|${destination || ''}|${rawTime || ''}|${dayOffset || 0}`;
}

export function liveBoardStaticKey(kind, destination = '', extra = '') {
    return `${kind || 'static'}|${destination || ''}|${extra || ''}`;
}

/** Train identity for quiet-patch: ignore first/last flags that flip styling only. */
export function boardPaintIdentity(key) {
    const raw = String(key || '');
    const parts = raw.split('|');
    if (!parts[0]) return raw;
    if (parts[0] === 'direct' || parts[0] === 'transfer') {
        return parts.length >= 4 ? parts.slice(0, 4).join('|') : raw;
    }
    return raw;
}

export function normalizeCountdownLabel(raw) {
    if (!raw) return '';
    return String(raw).replace(/(\d+)h\s(\d+)m/, '$1 hr $2 min').replace(/(\d+)m\)/, '$1 min)');
}

export function isQuietBoardPaint() {
    const w = typeof globalThis !== 'undefined' ? globalThis.window : undefined;
    return !!(w && w.__ntQuietBoardPaint);
}

export function tryPatchLiveBoardCountdown(element, key, countdownText, extras = {}) {
    if (!element || !isQuietBoardPaint() || !key) return false;
    const stamped = element.getAttribute('data-nt-board-key') || '';
    if (!stamped) return false;
    if (stamped !== key && boardPaintIdentity(stamped) !== boardPaintIdentity(key)) return false;
    const node = element.querySelector('[data-nt-countdown]');
    if (!node) return false;
    if (countdownText != null && node.textContent !== countdownText) node.textContent = countdownText;
    const clockText = extras.clockTime;
    if (clockText != null) {
        const clock = element.querySelector('[data-nt-deptime]');
        if (clock && clock.textContent !== clockText) clock.textContent = clockText;
    }
    return true;
}

export function stampLiveBoardCard(element, key) {
    if (element && key) element.setAttribute('data-nt-board-key', key);
}
