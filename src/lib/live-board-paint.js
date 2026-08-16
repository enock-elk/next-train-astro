/**
 * Quiet live-board paints: update countdown text without remounting cards.
 */
export function liveBoardJourneyKey(journey, destination = '') {
    if (!journey || typeof journey !== 'object') return '';
    const train = journey.train || journey.train1?.train || '';
    const dep = journey.departureTime || journey.train1?.departureTime || '';
    const type = journey.type || 'direct';
    const first = journey.isFirstTrain ? '1' : '0';
    const last = journey.isLastTrain ? '1' : '0';
    return `${type}|${train}|${dep}|${destination || ''}|${first}|${last}`;
}

export function liveBoardNextAvailKey(destination, rawTime, dayOffset = 0) {
    return `nextavail|${destination || ''}|${rawTime || ''}|${dayOffset || 0}`;
}

export function normalizeCountdownLabel(raw) {
    if (!raw) return '';
    return String(raw).replace(/(\d+)h\s(\d+)m/, '$1 hr $2 min').replace(/(\d+)m\)/, '$1 min)');
}

export function isQuietBoardPaint() {
    const w = typeof globalThis !== 'undefined' ? globalThis.window : undefined;
    return !!(w && w.__ntQuietBoardPaint);
}

export function tryPatchLiveBoardCountdown(element, key, countdownText) {
    if (!element || !isQuietBoardPaint() || !key) return false;
    if (element.getAttribute('data-nt-board-key') !== key) return false;
    const node = element.querySelector('[data-nt-countdown]');
    if (!node) return false;
    if (node.textContent !== countdownText) node.textContent = countdownText;
    return true;
}

export function stampLiveBoardCard(element, key) {
    if (element && key) element.setAttribute('data-nt-board-key', key);
}
