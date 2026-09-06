/**
 * Optional contact field: empty is fine; only obvious bad input is blocked.
 * Run: node scripts/verify-feedback-contact.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    validateFeedbackContact,
    looksLikeContactOnlyMessage,
    contactHintMessage,
    FEEDBACK_CONTACT_MAX,
} from '../src/lib/feedback-contact.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

function expect(raw, ok, reason = null) {
    const result = validateFeedbackContact(raw);
    assert(result.ok === ok, `"${raw}" ok=${result.ok} expected ${ok}`);
    if (reason) assert(result.reason === reason, `"${raw}" reason=${result.reason} expected ${reason}`);
    if (ok) assert(result.value === String(raw ?? '').trim(), `"${raw}" should keep trimmed value`);
}

expect('', true);
expect('   ', true);
expect('name@example.com', true);
expect('user.name+tag@example.co.za', true);
expect('+27821234567', true);
expect('0821234567', true);
expect('123456789012345', true);

expect('082 123 4567', false, 'spaces');
expect('name@ example.com', false, 'spaces');
expect('a@b', false, 'email');
expect('user@localhost', false, 'email');
expect('not-an-email-or-phone', false, 'phone');
expect('12345678', false, 'phone');
expect('1234567890123456', false, 'phone');
expect('name@example.com0821234567', false, 'both');
expect('0821234567name@example.com', false, 'both');
expect('name@example.com,+27821234567', false, 'both');
expect('123456789@example.com', true);
expect('x'.repeat(FEEDBACK_CONTACT_MAX + 1), false, 'long');

assert(looksLikeContactOnlyMessage('0736166688'), 'bare phone is contact-only');
assert(looksLikeContactOnlyMessage('0736166688 WhatsApp number'), 'WhatsApp label still contact-only');
assert(looksLikeContactOnlyMessage('Funkyngwenya@gmail.com'), 'bare email is contact-only');
assert(looksLikeContactOnlyMessage('WhatsApp: +27821234567'), 'labelled plus-phone is contact-only');
assert(!looksLikeContactOnlyMessage(''), 'empty message is not contact-only');
assert(!looksLikeContactOnlyMessage('Please help the 06:18 is late'), 'real message is not contact-only');
assert(!looksLikeContactOnlyMessage('call me on 0821234567 tonight'), 'mixed sentence is not contact-only');
assert(!looksLikeContactOnlyMessage('(attachment)'), 'attachment placeholder is not contact-only');

assert(contactHintMessage('spaces').includes('spaces'), 'spaces hint mentions spaces');
assert(contactHintMessage('both').includes('one contact'), 'both hint asks for one contact');
assert(contactHintMessage('email').includes('name@example.com'), 'email hint shows an example');

const hub = readFileSync(join(ROOT, 'src/lib/hub.js'), 'utf8');
assert(hub.includes("from './feedback-contact.js'"), 'hub imports contact validation');
assert(hub.includes('paintContactField'), 'hub paints contact validity');
assert(hub.includes('nt-contact-invalid'), 'hub toggles the invalid class');
assert(hub.includes("safeStorage.setItem(THREAD_CONTACT_KEY"), 'valid contact can still be stored');
assert(!/messages-thread-contact[\s\S]{0,180}safeStorage\.setItem\(THREAD_CONTACT_KEY, val\)/.test(hub), 'raw contact change no longer stores unvalidated text');
assert(hub.includes('looksLikeContactOnlyMessage'), 'hub can hint when the message is only a number or email');
assert(hub.includes('put it in the contact field'), 'contact-only hint does not rewrite the message');

const modals = readFileSync(join(ROOT, 'src/components/HubModals.astro'), 'utf8');
assert(modals.includes('id="messages-thread-contact-hint"'), 'Hub has a contact hint');
assert(modals.includes('id="feedback-email-hint"'), 'Send Feedback has a contact hint');
assert(modals.includes('maxlength="64"'), 'contact fields cap length');
assert(modals.includes('#messages-thread-contact.nt-contact-invalid'), 'invalid contact gets a red border');
assert(/#messages-thread-modal \{\s*align-items: flex-end;\s*justify-content: center;/.test(modals), 'Feedback Hub is centered horizontally');
assert(!/#messages-thread-modal \{\s*align-items: flex-end;\s*justify-content: flex-end;/.test(modals), 'Feedback Hub no longer docks to the far right');

if (failures.length) {
    console.error('verify-feedback-contact failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-feedback-contact: ok');
