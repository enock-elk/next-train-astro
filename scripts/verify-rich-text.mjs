/**
 * Node checks for alert rich-text: contact autolink tokens and style/href guards.
 * Run: node scripts/verify-rich-text.mjs
 */
import { splitContactTokens, isSafeHref, sanitizeStyleAttr } from '../src/lib/rich-text.js';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

{
    const parts = splitContactTokens('Email admin@nexttrain.co.za or call 082 123 4567 thanks');
    const email = parts.find((p) => p.type === 'email');
    const phone = parts.find((p) => p.type === 'phone');
    assert(email?.href === 'mailto:admin@nexttrain.co.za', 'email token href');
    assert(phone?.href === 'tel:+27821234567', `phone token href got ${phone?.href}`);
}

{
    const parts = splitContactTokens('See https://nexttrain.co.za/status, then done.');
    const url = parts.find((p) => p.type === 'url');
    assert(url?.href === 'https://nexttrain.co.za/status', `url peel punctuation got ${url?.href}`);
    const after = parts.find((p) => p.type === 'text' && p.value.startsWith(','));
    assert(!!after, 'trailing comma stays as text');
}

{
    const parts = splitContactTokens('Ring +27 21 123 4567 for ops');
    const phone = parts.find((p) => p.type === 'phone');
    assert(phone?.href === 'tel:+27211234567', `landline tel got ${phone?.href}`);
}

{
    const parts = splitContactTokens('Already a sentence with no contacts.');
    assert(parts.length === 1 && parts[0].type === 'text', 'plain text stays one token');
}

assert(isSafeHref('mailto:ops@nexttrain.co.za'), 'mailto allowed');
assert(isSafeHref('tel:+27821234567'), 'tel allowed');
assert(isSafeHref('https://nexttrain.co.za'), 'https allowed');
assert(!isSafeHref('javascript:alert(1)'), 'javascript href blocked');
assert(!isSafeHref('data:text/html,x'), 'data href blocked');

{
    const ok = sanitizeStyleAttr('text-align: center; font-family: Verdana, Geneva, sans-serif');
    assert(/text-align:\s*center/i.test(ok) && /font-family/i.test(ok), `allowed styles kept: ${ok}`);
    const bad = sanitizeStyleAttr('background: url(https://evil); color: red');
    assert(!bad.includes('url('), 'url() stripped from style');
    const js = sanitizeStyleAttr('font-size: expression(alert(1))');
    assert(js === '', 'expression() style blocked');
}

if (failures.length) {
    console.error('verify-rich-text failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-rich-text: ok');
