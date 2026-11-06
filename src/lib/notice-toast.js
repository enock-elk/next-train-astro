/**
 * Commuter copy for a live official notice toast.
 * A bare URL is not the notice. The title is.
 */

function plain(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Words a person can read. Empty when the field was only a link. */
export function readableNoticeText(value) {
    return plain(value).slice(0, 140);
}

/**
 * One short line. Critical notices keep a Service alert lead.
 * Everything else uses the title, then the body, never "Corridor notice" plus a URL.
 */
export function noticeToastCopy(notice) {
    const title = readableNoticeText(notice?.title || notice?.buttonText || '');
    const body = readableNoticeText(notice?.message || notice?.text || '');
    const line = title || body || 'New notice on your line';
    if (notice?.severity === 'critical') return `Service alert. ${line}`;
    return line;
}
