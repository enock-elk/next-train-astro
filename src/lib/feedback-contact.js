/**
 * Optional WhatsApp / email field on Send Feedback and Feedback Hub.
 * Empty is fine. Only block obvious bad input.
 *
 * RSA numbers: 10 digits starting with 0, or +27 plus the same 9 digits.
 * Spaces in a number are fine (+27 76 110 2832 / 076 110 2832).
 */

export const FEEDBACK_CONTACT_MAX = 64;

const CONTACT_HINTS = {
    long: 'Keep contact details under 64 characters.',
    both: 'Share one contact here. Put the other in the message.',
    email: 'Use a full email like name@example.com.',
    phone: 'Check the phone number, or leave this blank.',
    invalid: 'Use an email or a phone number, or leave this blank.',
};

const CONTACT_ONLY_LABEL = /\b(whatsapp|whats\s*app|e-?mail|number|num|cell|phone|mobile|contact|my)\b/gi;
const EMAIL_IN_TEXT = /[^\s@,/;]+@[^\s@,/;]+\.[A-Za-z]{2,}/;
const EMAIL_ONLY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_DOMAIN_HINT = /[a-z][a-z0-9._%+-]*[a-z0-9]\.(com|co\.za|net|org|edu|io|me|za)\b/i;

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

function looksLikeEmailAttempt(value) {
    if (value.includes('@')) return true;
    return EMAIL_DOMAIN_HINT.test(value);
}

function compactPhone(value) {
    return String(value || '').replace(/[\s().-]/g, '');
}

function isPhoneShaped(value) {
    return /^\+?\d+$/.test(compactPhone(value));
}

/** Local 0XXXXXXXXX or international +27XXXXXXXXX / 27XXXXXXXXX. */
export function isValidRsaPhone(value) {
    const compact = compactPhone(value);
    if (/^0\d{9}$/.test(compact)) return true;
    if (/^\+27\d{9}$/.test(compact)) return true;
    if (/^27\d{9}$/.test(compact)) return true;
    return false;
}

export function validateFeedbackContact(raw) {
    const value = String(raw ?? '').trim();
    if (!value) return { ok: true, value: '', reason: null };
    if (value.length > FEEDBACK_CONTACT_MAX) return { ok: false, value, reason: 'long' };
    if (hasEmailAndPhone(value)) return { ok: false, value, reason: 'both' };
    if (looksLikeEmailAttempt(value)) {
        if (EMAIL_ONLY.test(value)) return { ok: true, value, reason: null };
        return { ok: false, value, reason: 'email' };
    }
    if (isPhoneShaped(value)) {
        if (isValidRsaPhone(value)) return { ok: true, value, reason: null };
        return { ok: false, value, reason: 'phone' };
    }
    return { ok: false, value, reason: 'invalid' };
}

/** True when the message is only a number/email (plus labels like WhatsApp). */
export function looksLikeContactOnlyMessage(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return false;
    const stripped = raw.replace(CONTACT_ONLY_LABEL, ' ').replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
    if (!stripped) return false;
    const result = validateFeedbackContact(stripped);
    if (result.ok && result.value) return true;
    const compact = stripped.replace(/\s+/g, '');
    const compacted = validateFeedbackContact(compact);
    return !!(compacted.ok && compacted.value);
}
