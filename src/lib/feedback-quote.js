/**
 * Stable prefix so admin can preview the quoted service alert / incident
 * even when the original is expired, archived, or missing from the thread.
 *
 * Format: [ALERT:{id}|{notice|disruption}|{snippet}]
 */
export function encodeFeedbackAlertQuote({ alertId = '', kind = 'notice', snippet = '' } = {}) {
    const id = String(alertId || '').replace(/[|[\]]/g, '').trim();
    const k = String(kind || 'notice').toLowerCase() === 'disruption' ? 'disruption' : 'notice';
    const snip = String(snippet || '')
        .replace(/[\r\n[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
    return `[ALERT:${id}|${k}|${snip}]`;
}

export function parseFeedbackAlertQuote(text) {
    const raw = String(text || '');
    const m = raw.match(/^\[ALERT:([^|\]]*)\|([^|\]]*)\|([^\]]*)\]\s*([\s\S]*)$/i);
    if (!m) return null;
    const kind = String(m[2] || 'notice').trim().toLowerCase();
    return {
        alertId: String(m[1] || '').trim(),
        kind: kind === 'disruption' ? 'disruption' : 'notice',
        snippet: String(m[3] || '').trim(),
        body: String(m[4] || ''),
    };
}
