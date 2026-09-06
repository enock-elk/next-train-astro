/**
 * Optional WhatsApp / email field on Send Feedback and Feedback Hub.
 * Empty is fine. Only block obvious bad input.
 */

export const FEEDBACK_CONTACT_MAX = 64;

const CONTACT_HINTS = {
    spaces: 'Remove spaces from your email or number.',
    long: 'Keep contact details under 64 characters.',
    both: 'Share one contact here. Put the other in the message.',
    email: 'Use a full email like name@example.com.',
    phone: 'Use a phone number with 9 to 15 digits, or leave this blank.',
    invalid: 'Use an email or a phone number, or leave this blank.',
};

const CONTACT_ONLY_LABEL = /\b(whatsapp|whats\s*app|e-?mail|number|num|cell|phone|mobile|contact|my)\b/gi;
const EMAIL_IN_TEXT = /[^\s@,/;]+@[^\s@,/;]+\.[A-Za-z]{2,}/;
const EMAIL_ONLY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_ONLY = /^\+?\d{9,15}$/;

export function contactHintMessage(reason) {
    return CONTACT_HINTS[reason] || CONTACT_HINTS.invalid;
}

function extractEmail(value) {
    const m = String(value || '').match(EMAIL_IN_TEXT);
    return m ? m[0] : '';
}

function hasEmailAndPhone(value) {
    const email = extractEmail(value);
    if (!email) return false;
    const restDigits = value.replace(email, '').replace(/\D/g, '');
    if (restDigits.length >= 9) return true;
    const local = email.slice(0, Math.max(0, email.indexOf('@')));
    return /^(?:\+?\d{9,15})/.test(local) && /[A-Za-z]/.test(local);
}

export function validateFeedbackContact(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return { ok: true, value: '', reason: null };
    if (/\s/.test(value)) return { ok: false, value, reason: 'spaces' };
    if (value.length > FEEDBACK_CONTACT_MAX) return { ok: false, value, reason: 'long' };
    if (hasEmailAndPhone(value)) return { ok: false, value, reason: 'both' };
    if (value.includes('@')) {
        if (EMAIL_ONLY.test(value)) return { ok: true, value, reason: null };
        return { ok: false, value, reason: 'email' };
    }
    if (PHONE_ONLY.test(value)) return { ok: true, value, reason: null };
    return { ok: false, value, reason: 'phone' };
}

/** True when the message is only a number/email (plus labels like WhatsApp). */
export function looksLikeContactOnlyMessage(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return false;
    const stripped = raw.replace(CONTACT_ONLY_LABEL, ' ').replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
    if (!stripped) return false;
    const compact = stripped.replace(/\s+/g, '');
    const result = validateFeedbackContact(compact);
    return !!(result.ok && result.value);
}
