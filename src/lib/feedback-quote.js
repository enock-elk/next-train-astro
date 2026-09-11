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

/** `[REPLY TO ADMIN: key | snippet]` or legacy `[REPLY TO ADMIN: key]`. */
export function parseReplyToAdminQuote(text) {
    const raw = String(text || '');
    const withPipe = raw.match(/^\[REPLY TO ADMIN:\s*([^|\]]+?)\s*\|\s*([^\]]*)\]\s*([\s\S]*)$/i);
    if (withPipe) {
        return {
            replyKey: String(withPipe[1] || '').trim(),
            snippet: String(withPipe[2] || '').trim(),
            body: String(withPipe[3] || ''),
        };
    }
    const headerOnly = raw.match(/^\[REPLY TO ADMIN:\s*([^\]]+)\]\s*([\s\S]*)$/i);
    if (!headerOnly) return null;
    return {
        replyKey: String(headerOnly[1] || '').trim(),
        snippet: '',
        body: String(headerOnly[2] || ''),
    };
}

/** Commuter Feedback Hub: drop the [ALERT:…] / reply prefix. Admin still parses the raw text. */
export function commuterFeedbackText(text) {
    const raw = String(text || '');
    const parsed = parseFeedbackAlertQuote(raw);
    if (parsed) return String(parsed.body || '').trim();
    const reply = parseReplyToAdminQuote(raw);
    if (reply) return String(reply.body || '').trim();
    return raw.replace(/^\[ALERT:[^\]]*\]\s*/i, '').trim();
}
