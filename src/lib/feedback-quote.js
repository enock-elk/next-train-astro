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

function stripQuoteHtml(value) {
    return String(value || '')
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/\s*(p|div|li|h[1-6]|tr|section|article)\s*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Full plain text of a quoted notice or incident, including a poll and its tally. */
export function noticeQuotePlain(notice) {
    if (!notice || typeof notice !== 'object') return '';
    const title = stripQuoteHtml(notice.title || notice.buttonText || '');
    const body = stripQuoteHtml(notice.message || notice.text || notice.longExplanation || '');
    const lines = [];
    if (title) lines.push(title);
    if (body && body !== title) lines.push(body);
    const poll = notice.poll;
    if (poll && typeof poll === 'object' && (poll.question || poll.optionA || poll.optionB)) {
        if (poll.question) lines.push(`Poll: ${stripQuoteHtml(poll.question)}`);
        const results = notice.pollResults;
        const total = Number(results?.total || 0);
        const row = (key, field) => {
            const name = stripQuoteHtml(poll[field] || '');
            if (!name) return;
            if (results && total > 0) {
                const count = Number(results[key] || 0);
                const pct = Math.round((count / total) * 100);
                lines.push(`- ${name}: ${pct}% (${count} votes)`);
            } else {
                lines.push(`- ${name}`);
            }
        };
        row('A', 'optionA');
        row('B', 'optionB');
        row('C', 'optionC');
        if (total > 0) lines.push(`Total: ${total} votes`);
    }
    return lines.join('\n').trim().slice(0, 8000);
}

/** Commuter Feedback Hub: drop the [ALERT:…] prefix. Admin still parses the raw text. */
export function commuterFeedbackText(text) {
    const raw = String(text || '');
    const parsed = parseFeedbackAlertQuote(raw);
    if (parsed) return String(parsed.body || '').trim();
    return raw.replace(/^\[ALERT:[^\]]*\]\s*/i, '').trim();
}
