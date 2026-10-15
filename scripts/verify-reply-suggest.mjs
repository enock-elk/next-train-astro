/**
 * Suggest-a-reply: no commuter emails in the model payload, halt never
 * becomes composer HTML, and Gauteng phones stay off other regions.
 * Run: node scripts/verify-reply-suggest.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyDraftGuard,
    buildGeminiRequest,
    buildSuggestPayload,
    buildSuggestUserText,
    composerHtmlFromResult,
    contactBlockForRegion,
    GAUTENG_OFFICES,
    haltPanelText,
    htmlAttrUrl,
    liaisonRules,
    knowledgeBase,
    mailtoReplyUrl,
    outreachPlainText,
    parseSuggestResult,
    PRASA_SURVEY_URL,
    whatsappReplyUrl,
} from '../src/lib/reply-suggest.js';
import { handleRequest } from '../workers/nexttrain-reply/worker.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

const guide = readFileSync(join(ROOT, 'src/pages/guide.astro'), 'utf8');
for (const office of GAUTENG_OFFICES) {
    for (const phone of office.phones) {
        ok(guide.includes(phone), `guide lists ${office.office} ${phone}`);
        ok(contactBlockForRegion('GP').includes(phone), `Gauteng contact block lists ${phone}`);
    }
}
ok(guide.includes(PRASA_SURVEY_URL), 'guide lists the PRASA survey');
ok(contactBlockForRegion('KZN').includes(PRASA_SURVEY_URL), 'KZN contact block uses the survey');
ok(!contactBlockForRegion('KZN').includes('011 013 0306'), 'KZN contact block has no Pretoria number');
ok(liaisonRules('KZN').includes('halt'), 'liaison rules tell the model to halt');
ok(liaisonRules('KZN').includes('Thank you for using Next Train'), 'drafts close with the standard line');
ok(liaisonRules('KZN').includes('two blank lines'), 'greeting leaves two blank lines');
ok(liaisonRules('KZN').includes('more than 7 days'), 'a week-old message gets a late-reply line');
ok(knowledgeBase().includes('Centurion'), 'sinkhole note is in the knowledge base');
ok(knowledgeBase().includes('Midway'), 'Vereeniging operating stations are in the knowledge base');
ok(!liaisonRules('KZN').includes('011 013 0306'), 'KZN rules do not hand the model a Gauteng number');

const thread = [
    {
        deviceId: 'usr_current',
        text: 'Please email rider@example.com about the Sunday train to kwaNdengezi',
        email: 'rider@example.com',
        region: 'KZN',
        routeId: 'kzn-pinetown',
        timestamp: 100,
        status: 'unread',
    },
    {
        deviceId: 'usr_current',
        isFromAdmin: true,
        text: 'Hey there',
        timestamp: 200,
    },
];
const others = [
    {
        deviceId: 'usr_other',
        text: 'We need a Sunday train for church at kwaNdengezi',
        email: 'other@example.com',
        region: 'KZN',
        routeId: 'kzn-pinetown',
        timestamp: 50,
    },
    {
        deviceId: 'usr_other',
        isFromAdmin: true,
        text: 'I cannot add Sunday trains. Ask PRASA.',
        timestamp: 80,
    },
    {
        deviceId: 'usr_far',
        text: 'Ticket price is too high',
        region: 'GP',
        routeId: 'pta-pien',
        timestamp: 40,
    },
    {
        deviceId: 'usr_far',
        isFromAdmin: true,
        text: 'Fares belong to PRASA.',
        timestamp: 70,
    },
];
const payload = buildSuggestPayload([...thread, ...others], {
    deviceId: 'usr_current',
    alias: 'rider@example.com',
    allItems: [...thread, ...others],
});
const packed = JSON.stringify(payload);
ok(!packed.includes('rider@example.com'), 'payload omits the commuter email');
ok(!packed.includes('other@example.com'), 'similar replies omit the other email');
ok(packed.includes('[email]'), 'email text is redacted');
ok(payload.region === 'KZN', 'thread region is KZN');
ok(payload.similar.length === 1, 'only the similar KZN reply is included');
ok(payload.similar[0].deviceId === 'usr_other', 'similar reply is the other thread');
ok(!packed.includes('usr_far') , 'unrelated Gauteng thread is left out');

const halted = applyDraftGuard({
    action: 'draft',
    reply: 'Please call Pretoria on 011 013 0306.',
}, 'KZN');
ok(halted.action === 'halt', 'a Gauteng number on a KZN draft becomes a halt');
ok(composerHtmlFromResult(halted) === null, 'halt JSON never becomes composer HTML');
ok(haltPanelText(halted).includes('Gauteng'), 'halt text explains the blocked number');

const scriptDraft = parseSuggestResult({ action: 'draft', reply: '<script>alert(1)</script>' });
const html = composerHtmlFromResult(scriptDraft);
ok(html && !html.includes('<script>'), 'composer HTML escapes a draft');
ok(html.includes('&lt;script&gt;'), 'composer keeps the draft as text');
ok(composerHtmlFromResult(parseSuggestResult('{"action":"halt","reply":"<b>no</b>","questions":["Which route?"]}')) === null, 'a halt string is not composer HTML');

const allowed = applyDraftGuard({ action: 'draft', reply: 'Johannesburg is 011 013 0191.' }, 'GP');
ok(allowed.action === 'draft', 'Gauteng may use a Gauteng office number');
ok(composerHtmlFromResult(allowed)?.includes('011 013 0191'), 'a real draft can fill the composer');

const gemini = buildGeminiRequest({
    payload,
    sharedNote: 'Be warm.',
    images: [{ mimeType: 'image/png', data: 'aaaa' }],
});
ok(gemini.systemInstruction.parts[0].text.includes(PRASA_SURVEY_URL), 'Gemini request carries the survey');
ok(!JSON.stringify(gemini).includes('rider@example.com'), 'Gemini request has no commuter email');
ok(gemini.contents[0].parts.some((part) => part.inlineData?.mimeType === 'image/png'), 'images ride along as inline data');

const adminJs = readFileSync(join(ROOT, 'public/js/admin.js'), 'utf8');
ok(adminJs.includes('id="reply-suggest"'), 'reply composer has Suggest reply');
ok(adminJs.includes('Admin.suggestReplyForThread'), 'thread options can suggest a reply');
const suggestStart = adminJs.indexOf('runSuggestReply: async () => {');
const suggestEnd = adminJs.indexOf('openReplyModal:', suggestStart);
const suggestBody = adminJs.slice(suggestStart, suggestEnd);
ok(suggestBody.includes('composerHtmlFromResult'), 'suggest fills the composer from the helper');
const sent = outreachPlainText('Hi there<br><br><span style="color: #9ca3af; font-style: italic;">- Enock</span>');
ok(sent === 'Hi there\n\n- Enock', 'outreach text keeps the same reply and sign-off');
const wa = whatsappReplyUrl('27821234567', sent);
const waText = decodeURIComponent(wa.split('?text=')[1]);
ok(wa.startsWith('https://wa.me/27821234567?text='), 'WhatsApp opens on the number they gave');
ok(waText.startsWith('> Metrorail Next Train | Response\n\n'), 'WhatsApp quote title sits on the first line');
ok(waText.endsWith(sent), 'WhatsApp body is the same reply under the title');
const mail = mailtoReplyUrl('rider@example.com', sent);
ok(mail.startsWith('mailto:rider@example.com?'), 'email opens to their address');
ok(decodeURIComponent(mail.split('subject=')[1].split('&')[0]) === 'Metrorail Next Train | Feedback Response', 'email subject is the feedback response line');
ok(decodeURIComponent(mail.split('body=')[1]) === sent, 'email body is the same reply');
const weekAgo = Date.parse('2026-10-01T00:00:00Z');
const today = Date.parse('2026-10-15T00:00:00Z');
const staleText = buildSuggestUserText({
    thread: [{ from: 'commuter', text: 'Is the sinkhole open yet?', at: weekAgo }],
}, '', today);
ok(staleText.includes('Apologize calmly'), 'a message older than a week asks for a late reply');
const freshText = buildSuggestUserText({
    thread: [{ from: 'commuter', text: 'Is the sinkhole open yet?', at: Date.parse('2026-10-14T00:00:00Z') }],
}, '', today);
ok(freshText.includes('Do not apologize'), 'a recent message does not get a delay apology');
const stripped = parseSuggestResult({
    action: 'draft',
    reply: '[Device: usr_x]\nHi there,\n\n\nThanks for writing.\n\nThank you for using Next Train.',
});
ok(!stripped.reply.includes('[Device:'), 'device id stays out of the reply the operator edits');
ok(stripped.reply.startsWith('Hi there,'), 'the greeting stays in the draft');
ok(!composerHtmlFromResult(stripped).includes('Metrorail Next Train | Response'), 'the in-app draft has no WhatsApp quote title');
ok(htmlAttrUrl(wa).includes('&amp;') === false || wa.includes('&') === false, 'a single-field WhatsApp link needs no extra escape');
ok(htmlAttrUrl(mail).includes('&amp;body='), 'email link escapes the body join for HTML');
ok(whatsappReplyUrl('0821234567', '') === 'https://wa.me/0821234567', 'a number with no reply yet still opens WhatsApp');

ok(suggestBody.includes('/suggest'), 'suggest calls the reply worker');
ok(!suggestBody.includes('inbox/'), 'suggest does not post to inbox');
ok(!suggestBody.includes('resolveFeedback'), 'suggest does not archive the thread');
ok(suggestBody.includes('Draft ready. Edit it, then send.'), 'suggest leaves the draft for editing');
ok(adminJs.includes('message: text'), 'the sent reply is handed to WhatsApp and email');
ok(adminJs.includes("Admin.outreachHref('whatsapp', ph, replyPlain)"), 'the thread WhatsApp chip uses the reply');
ok(adminJs.includes("Admin.outreachHref('email', em, replyPlain)"), 'the thread email chip uses the reply');

const bridge = readFileSync(join(ROOT, 'src/lib/admin-bridge.js'), 'utf8');
ok(bridge.includes('window.ntReplySuggest'), 'admin bridge exposes the suggest helper');

const worker = readFileSync(join(ROOT, 'workers/nexttrain-reply/worker.js'), 'utf8');
ok(!worker.includes('inbox.json'), 'reply worker does not read the inbox tree');
ok(!worker.includes('feedback.json'), 'reply worker does not read the feedback tree');
ok(worker.includes('gemini-2.5-flash-lite'), 'reply worker uses Flash-Lite');

const denied = await handleRequest(new Request('https://reply.test/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
}), {});
ok(denied.status === 401, 'suggest without an operator token is rejected');
const health = await handleRequest(new Request('https://reply.test/health'), {});
ok(health.status === 200, 'health check stays open');

if (failures.length) {
    console.error('verify-reply-suggest FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-reply-suggest: ok');
