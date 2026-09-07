/**
 * Live-board transfer (shuttle) card helpers.
 * Hub names come from the journey / route transfer station, never a hardcoded stop.
 * Dual onward options (short-turn + terminus) are Pienaarspoort only.
 */

/** Routes that may list a short-turn and a terminus train at the same hub. */
export const DUAL_HUB_OPTION_ROUTE_IDS = Object.freeze(['pta-pien']);

export function routeAllowsDualHubOptions(routeId) {
    return DUAL_HUB_OPTION_ROUTE_IDS.includes(String(routeId || ''));
}

/** Change station: configured hub on the journey, not a painted place name. */
export function resolveTransferHubName(journey) {
    const t1 = journey?.train1 || {};
    const conn = journey?.connection || {};
    return String(
        t1.terminationStation
        || conn.connectionStation
        || t1.headboardDestination
        || ''
    ).trim();
}

/**
 * Onward trains leaving the hub. Dual list only when the route is allow-listed
 * and a later train actually reaches the card destination.
 */
export function collectHubOnwardOptions(journey, routeId) {
    const conn = journey?.connection;
    if (!conn) return [];
    const options = [conn];
    const nextFull = journey?.nextFullJourney;
    if (
        routeAllowsDualHubOptions(routeId)
        && nextFull
        && String(nextFull.train || '') !== String(conn.train || '')
    ) {
        options.push(nextFull);
    }
    return options;
}

/**
 * First shortening step when a full name will not fit one row.
 * Multi-word: keep the first words, clip the last to 4 letters (Gardens → Gard).
 * One long word: drop the last four letters (Pienaarspoort → Pienaarsp).
 */
export function shortenStationLabel(name) {
    const s = String(name || '').replace(/\s+/g, ' ').trim();
    if (!s) return s;
    const parts = s.split(' ');
    if (parts.length > 1) {
        const last = parts[parts.length - 1];
        const head = parts.slice(0, -1).join(' ');
        if (last.length > 4) return `${head} ${last.slice(0, 4)}`;
    }
    if (s.length > 8) return s.slice(0, Math.max(8, s.length - 4));
    return s;
}

/**
 * Keep the full name unless `overflows(label)` is true.
 * Then try the short form, then clip one character at a time.
 */
export function fitStationLabel(name, overflows) {
    const full = String(name || '').replace(/\s+/g, ' ').trim();
    if (!full) return '';
    if (typeof overflows !== 'function' || !overflows(full)) return full;
    let label = shortenStationLabel(full);
    if (label !== full && !overflows(label)) return label;
    while (label.length > 4 && overflows(label)) {
        label = label.slice(0, -1).replace(/\s+$/g, '');
    }
    return label || full.slice(0, 4);
}

/** After the card is in the DOM, shorten dest names that still wrap. */
export function fitOnwardRowLabels(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('[data-nt-onward-row]').forEach((row) => {
        const destEl = row.querySelector('[data-nt-onward-dest]');
        if (!destEl) return;
        const full = destEl.getAttribute('data-full-name') || destEl.textContent || '';
        destEl.textContent = fitStationLabel(full, (trial) => {
            destEl.textContent = trial;
            return row.scrollWidth > row.clientWidth + 0.5;
        });
        destEl.setAttribute('title', full);
    });
}
