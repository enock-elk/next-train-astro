/**
 * Operator line for a feedback report: handset, network, signal, screen.
 * A one-letter Android user-agent token such as "K" is a privacy placeholder,
 * not a phone model, so it is left off.
 */

const NETWORK_LABELS = {
    mobile: 'Mobile network',
    wifi: 'Wi-Fi',
    ethernet: 'Ethernet',
    offline: 'Offline',
};

const SIGNAL_LABELS = {
    weak: 'Weak signal',
    good: 'Good signal',
    excellent: 'Excellent signal',
};

export function feedbackPhoneBit(phone) {
    const value = String(phone || '').trim();
    if (!value || /^unknown phone$/i.test(value)) return '';
    if (/^[A-Za-z]$/.test(value)) return '';
    return value;
}

export function formatFeedbackDiagLine(diag) {
    if (!diag || typeof diag !== 'object') return '';
    const bits = [];
    const phone = feedbackPhoneBit(diag.phone);
    if (phone) bits.push(phone);
    const netKey = String(diag.network || '').trim().toLowerCase();
    let network = NETWORK_LABELS[netKey] || (netKey && netKey !== 'unknown' ? netKey : '');
    if (diag.captive) network = network ? `${network}, captive` : 'Captive';
    if (network) bits.push(network);
    const signal = SIGNAL_LABELS[String(diag.signal || '').trim().toLowerCase()] || '';
    if (signal) bits.push(signal);
    const view = String(diag.viewport || '').trim().match(/^(\d{2,5})x(\d{2,5})$/i);
    if (view) bits.push(`${view[1]} × ${view[2]}`);
    return bits.join(' · ');
}
