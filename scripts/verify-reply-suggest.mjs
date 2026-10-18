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
    certainGreeting,
    composerHtmlFromResult,
    contactBlockForRegion,
    GAUTENG_OFFICES,
    haltPanelText,
    htmlAttrUrl,
    isThreadFileUrl,
    liaisonRules,
    knowledgeBase,
    noticeQuotePlain,
    withQuotedNoticeText,
    loadSuggestFile,
    unansweredCommuterMessages,
    suggestDraftMessageId,
    emailOutreachText,
    mailtoReplyUrl,
    outreachPlainText,
    parseSuggestResult,
    PRASA_SURVEY_URL,
    whatsappReplyUrl,
} from '../src/lib/reply-suggest.js';
import { describeRoute } from '../src/lib/reply-knowledge.js';
import { whatsappMarkupToHtml } from '../src/lib/rich-text.js';
import {
    buildTextAssistRequest,
    parseTextAssistResult,
    sanitizeTextAssist,
    textAssistRules,
    comfortAssistText,
    assistHtmlFromText,
} from '../src/lib/text-assist.js';
import { handleRequest } from '../workers/nexttrain-reply/worker.js';
import { fetchLinkPreview, isPublicPreviewUrl, parseLinkPreviewHtml, previewFromMicrolink } from '../src/lib/link-preview.js';

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
ok(liaisonRules('KZN').includes('Dear Enock'), 'a certain first name is Dear Firstname');
ok(liaisonRules('KZN').includes('Dear Mr Kazembe'), 'a certain surname is Dear Mr Surname');
ok(certainGreeting({ emails: ['enockelk@gmail.com'] }) === 'Dear Enock', 'enockelk is Dear Enock');
ok(certainGreeting({ emails: ['j.kazembe@gmail.com'] }) === 'Dear Mr Kazembe', 'an initial plus surname is Dear Mr Kazembe');
ok(certainGreeting({ texts: ['My name is Thabo Mokoena'] }) === 'Dear Thabo', 'a stated first name is used');
ok(certainGreeting({ texts: ['I am Mr Kazembe'] }) === 'Dear Mr Kazembe', 'a stated surname keeps the title');
ok(certainGreeting({ alias: 'Kudzi' }) === 'Dear Kudzi', 'a real alias is a certain first name');
ok(certainGreeting({ emails: ['info@nexttrain.co.za'] }) === '', 'a role inbox is not a name');
ok(certainGreeting({ emails: ['qwerty@gmail.com'] }) === '', 'a random inbox is not a name');
ok(certainGreeting({ emails: ['marketing.team@gmail.com'] }) === '', 'two ordinary words are not a name');
ok(certainGreeting({ emails: ['thandeka05nxumalo@gmail.com'] }) === 'Dear Thandeka', 'a first name glued to a surname is Dear Thandeka');
ok(certainGreeting({ emails: ['enock.kazembe@gmail.com'] }) === 'Dear Enock', 'firstname.surname is Dear Firstname');
ok(certainGreeting({ emails: ['kazembe.enock@gmail.com'] }) === 'Dear Enock', 'surname.firstname still finds the first name');
ok(certainGreeting({ texts: ['I am good thanks'] }) === '', 'I am good is not a name');
ok(certainGreeting({ texts: ['I am waiting for the Sunday train'] }) === '', 'I am waiting is not a name');
ok(certainGreeting({ texts: ['Please write to enockelk@gmail.com'] }) === 'Dear Enock', 'an email inside the message can name them');
ok(certainGreeting({ alias: 'Coolguy' }) === '', 'a made-up alias is not a certain name');
ok(certainGreeting({ alias: 'Mr Kazembe' }) === 'Dear Mr Kazembe', 'an alias with Mr uses the surname');
const named = buildSuggestPayload([
    { deviceId: 'usr_named', email: 'enockelk@gmail.com', text: 'The Sunday train please', timestamp: 10 },
], { deviceId: 'usr_named' });
ok(named.greeting === 'Dear Enock', 'the draft payload carries Dear Enock');
ok(!JSON.stringify(named).includes('enockelk@gmail.com'), 'the email address stays out of the draft payload');
ok(liaisonRules('KZN').includes('more than 7 days'), 'a week-old message gets a late-reply line');
ok(liaisonRules('GP').includes('unless they asked'), 'independence is only mentioned when they ask');
ok(liaisonRules('GP').includes('Do not write "I want to gently mention"'), 'the draft does not open with a disclaimer');
ok(liaisonRules('GP').includes('ADMIN ALERT'), 'a quoted notice is an admin alert');
ok(liaisonRules('GP').includes('Only Next Train can post an alert'), 'only admin posts alerts');
ok(liaisonRules('GP').includes('Do not thank them for sharing'), 'a reply is not treated as the commuter posting the alert');
ok(!liaisonRules('GP').includes('independent unofficial'), 'the system prompt does not hand the model the old disclaimer');
const quoted = buildSuggestPayload([
    {
        deviceId: 'usr_quote',
        text: '[ALERT:poll1|notice|What Commuters Said About the Proposed...]\nThey are right about the student prices.',
        timestamp: 20,
    },
], {
    deviceId: 'usr_quote',
    quotedNotices: {
        poll1: noticeQuotePlain({
            title: 'What Commuters Said About the Proposed PRASA Monthly Ticket Prices',
            message: '<p>Thank you to everyone who voted.</p><p>Student prices and the Sunday schedule were the main concerns.</p>',
            poll: {
                question: 'Are the new PRASA monthly ticket prices fair?',
                optionA: "Yes, it's still cheaper",
                optionB: 'No, service is poor',
                optionC: "I'm undecided",
            },
            pollResults: { A: 694, B: 310, C: 324, total: 1328 },
        }),
    },
});
const quotedAlert = quoted.thread.find((row) => row.role === 'alert');
const quotedReply = quoted.thread.find((row) => row.role === 'reply');
ok(quotedAlert && quotedAlert.from === 'admin' && quotedAlert.text.includes('Student prices and the Sunday schedule'), 'the alert is labeled as admin');
ok(quotedAlert.text.includes('694 votes'), 'the draft receives the poll counts');
ok(quotedReply && quotedReply.from === 'commuter' && quotedReply.text.includes('They are right about the student prices'), 'the commuter line is only their reply');
ok(!quotedReply.text.includes('Student prices and the Sunday schedule'), 'the alert text is not inside the commuter line');
const quotedPrompt = buildSuggestUserText(quoted, '');
ok(quotedPrompt.indexOf('ADMIN ALERT') >= 0 && quotedPrompt.indexOf('ADMIN ALERT') < quotedPrompt.indexOf('COMMUTER. This is their reply'), 'the prompt names the alert before the reply');
const storedQuote = withQuotedNoticeText([{ text: 'Hello', quotedText: 'Full stored advisory' }])[0];
ok(storedQuote.alertPlain.includes('Full stored advisory') && storedQuote.text === 'Hello', 'a stored quote stays separate from the commuter words');
const visit = buildSuggestPayload([{
    deviceId: 'usr_visit',
    text: '[ALERT:visit1|notice|Ministerial Oversight Visit and the new bus fleet]\nThe service is good.',
    timestamp: 50,
    quotedText: 'Ministerial Oversight Visit\nThe new bus fleet is in service.',
}], { deviceId: 'usr_visit' });
const visitAlert = visit.thread.find((row) => row.role === 'alert');
const visitReply = visit.thread.find((row) => row.role === 'reply');
ok(visitAlert && visitAlert.from === 'admin' && visitAlert.text.includes('new bus fleet'), 'the ministerial notice is an admin alert');
ok(visitReply && visitReply.text === 'The service is good.' && !visitReply.text.includes('Ministerial'), 'the service comment is only the commuter reply');
ok(knowledgeBase().includes('Centurion'), 'Centurion is in the knowledge base');
ok(knowledgeBase().includes('pta-pien'), 'route keys are in the knowledge base');
ok(describeRoute('pta-pien').includes('Pienaarspoort'), 'pta-pien is Pretoria to Pienaarspoort');
ok(describeRoute('herc-koed').includes('no Saturday'), 'Hercules to Koedoespoort has no Saturday trains');
ok(describeRoute('ec-berlin').includes('no Saturday'), 'East London to Berlin has no Saturday trains');
ok(knowledgeBase().includes('first Monday'), 'Cato Ridge maintenance day is in the knowledge base');
ok(knowledgeBase().includes('R180.00'), 'zone 1 monthly fare is in the knowledge base');
ok(knowledgeBase().includes('09:30'), 'off-peak window is in the knowledge base');
const photoUrl = 'https://firebasestorage.googleapis.com/v0/b/app/o/feedback_attachments%2Fa.jpg?alt=media&token=abc';
const pdfUrl = 'https://firebasestorage.googleapis.com/v0/b/app/o/feedback_attachments%2Fa.pdf?alt=media&token=abc';
ok(isThreadFileUrl(photoUrl), 'a chat photo URL is allowed');
ok(isThreadFileUrl(pdfUrl), 'a chat PDF URL is allowed');
ok(!isThreadFileUrl('https://evil.example/a.jpg'), 'a foreign file URL is dropped');
ok(whatsappMarkupToHtml('*Metrorail Update*') === '<b>Metrorail Update</b>', 'WhatsApp stars become bold');
ok(whatsappMarkupToHtml('hello') === '', 'plain alert paste stays plain text');
const gap = unansweredCommuterMessages([
    { from: 'commuter', text: 'The Sunday train' },
    { from: 'commuter', text: 'Also the monthly ticket' },
]);
ok(gap.length === 2, 'two messages with no admin reply both stay unanswered');
const answered = unansweredCommuterMessages([
    { from: 'commuter', text: 'First' },
    { from: 'admin', text: 'Replied' },
    { from: 'commuter', text: 'Latest' },
]);
ok(answered.length === 1 && answered[0].text === 'Latest', 'an earlier reply is not asked again');
const longThread = Array.from({ length: 45 }, (_, i) => ({
    deviceId: 'usr_long',
    text: `Message ${i}`,
    timestamp: i + 1,
    region: 'GP',
    routeId: 'pta-pien',
}));
const longPayload = buildSuggestPayload(longThread, { deviceId: 'usr_long' });
ok(longPayload.thread.length === 45, 'the whole thread is sent');
ok(longPayload.thread[0].text === 'Message 0', 'the earliest message is kept');
const withFile = buildSuggestPayload([
    { deviceId: 'usr_file', text: 'See this', attachmentUrl: photoUrl, timestamp: 1, region: 'GP', routeId: 'pta-pien' },
    { deviceId: 'usr_file', text: 'And this', attachmentUrls: [pdfUrl], timestamp: 2 },
], { deviceId: 'usr_file' });
ok(withFile.files.length === 2, 'chat photos and PDFs are attached to the draft');
ok(withFile.files.some((file) => file.kind === 'pdf'), 'a PDF is marked as a PDF');
const contextText = buildSuggestUserText({
    thread: [{ from: 'commuter', text: 'Why does it end on the 31st?', at: 1 }],
    draftContext: 'Monthly tickets end on the last day of the calendar month.',
    routeId: 'pta-pien',
}, '');
ok(contextText.includes('last day of the calendar month'), 'operator context is sent with the rerun');
ok(contextText.includes('Pienaarspoort'), 'the open route is named in the prompt');
ok(contextText.includes('Answer every one') || contextText.includes('One message still needs a reply'), 'unanswered messages are called out');
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
ok(!adminJs.includes('Sent while signed out'), 'the inbox does not label Sent while signed out');
ok(adminJs.includes('quotedNoticesForSuggest'), 'suggest reply loads the full quoted notice');
ok(adminJs.includes('id="reply-suggest"'), 'reply composer has Suggest reply');
ok(adminJs.includes('id="admin-reply-suggest-context"'), 'a halt can take the missing fact');
ok(adminJs.includes('id="admin-reply-suggest-status"'), 'suggest shows progress while it writes');
ok(adminJs.includes('id="admin-reply-suggest-done"'), 'a finished draft note sits inside the instructions accordion');
ok(adminJs.includes('Next Train Composer'), 'the write modal is Next Train Composer');
ok(adminJs.includes('Next Train Co-Pilot'), 'the reply modal is Next Train Co-Pilot');
ok(adminJs.includes('Using the whole field.'), 'Write uses the field without a selection');
ok(!adminJs.includes('Using the selected text.'), 'Write no longer requires a selection');
ok(adminJs.includes('A blank note is not saved.'), 'a blank shared note is refused');
ok(adminJs.includes('shrink-0 rounded-t-lg'), 'the reply formatting bar does not shrink away');
ok(adminJs.includes('whatsappMarkupToHtml'), 'service alerts convert WhatsApp paste marks');
ok(adminJs.includes('Admin.suggestReplyForThread'), 'thread options can suggest a reply');
const suggestStart = adminJs.indexOf('runSuggestReply: async () => {');
const suggestEnd = adminJs.indexOf('openReplyModal:', suggestStart);
const suggestBody = adminJs.slice(suggestStart, suggestEnd);
ok(suggestBody.includes('composerHtmlFromResult'), 'suggest fills the composer from the helper');
const sent = outreachPlainText('Hi there<br><br><span style="color: #9ca3af; font-style: italic;">- Enock</span>');
ok(sent === 'Hi there\n\n- Enock', 'outreach text keeps the same reply and sign-off');
const rich = '<div>Hi there,</div><div>Thanks for sharing your thoughts.</div><br><br><span style="color: #9ca3af; font-style: italic;">- Enock</span>';
ok(outreachPlainText(rich) === 'Hi there,\nThanks for sharing your thoughts.\n\n- Enock', 'outreach keeps paragraphs and the sign-off');
ok(emailOutreachText(rich) === 'Hi there,\nThanks for sharing your thoughts.', 'email text keeps paragraphs and drops the sign-off');
const wa = whatsappReplyUrl('27821234567', sent);
const waText = decodeURIComponent(wa.split('?text=')[1]);
ok(wa.startsWith('https://wa.me/27821234567?text='), 'WhatsApp opens on the number they gave');
ok(waText.startsWith('> Metrorail Next Train | Response\n\n'), 'WhatsApp quote title sits on the first line');
ok(waText.endsWith(sent), 'WhatsApp body is the same reply under the title');
const mail = mailtoReplyUrl('rider@example.com', rich);
ok(mail.startsWith('mailto:rider@example.com?'), 'email opens to their address');
ok(decodeURIComponent(mail.split('subject=')[1].split('&')[0]) === 'Metrorail Next Train | Feedback Response', 'email subject is the feedback response line');
ok(decodeURIComponent(mail.split('body=')[1]).replace(/\r\n/g, '\n') === 'Hi there,\nThanks for sharing your thoughts.', 'email body keeps paragraphs and drops the sign-off');
ok(!decodeURIComponent(mail.split('body=')[1]).includes('- Enock'), 'email body has no operator sign-off');
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
ok(adminJs.includes("Admin.outreachHref('whatsapp', ph, replyHtml)"), 'the thread WhatsApp chip uses the reply');
ok(adminJs.includes("Admin.outreachHref('email', em, replyHtml)"), 'the thread email chip uses the reply');

const bridge = readFileSync(join(ROOT, 'src/lib/admin-bridge.js'), 'utf8');
ok(bridge.includes('window.ntReplySuggest'), 'admin bridge exposes the suggest helper');

const worker = readFileSync(join(ROOT, 'workers/nexttrain-reply/worker.js'), 'utf8');
ok(!worker.includes('inbox.json'), 'reply worker does not read the inbox tree');
ok(!worker.includes('feedback.json'), 'reply worker does not read the feedback tree');
ok(worker.includes('gemini-3.5-flash-lite'), 'reply worker uses 3.5 Flash-Lite');
ok(!worker.includes('gemini-2.5-flash-lite'), 'reply worker no longer calls 2.5 Flash-Lite');
ok(worker.includes("pathname === '/edit'"), 'write assist has its own route');
const geminiConfig = buildGeminiRequest({
    payload: { thread: [{ from: 'commuter', text: 'Sunday train', at: 1 }], region: 'KZN' },
}).generationConfig;
ok(geminiConfig.thinkingConfig.thinkingLevel === 'MINIMAL', 'drafts ask for minimal thinking');
ok(!('temperature' in geminiConfig), '3.5 requests leave temperature at the model default');
const grammar = buildTextAssistRequest({ text: 'train is late today', action: 'grammar' });
ok(grammar.generationConfig.thinkingConfig.thinkingLevel === 'MINIMAL', 'grammar uses minimal thinking');
ok(textAssistRules('compose').includes('Do not invent'), 'compose cannot invent a fact');
ok(sanitizeTextAssist({ text: 'hi', action: 'nope' }).action === '', 'an unknown writing action is dropped');
let emptyAction = '';
try { buildTextAssistRequest({ text: '', action: 'grammar' }); } catch (err) { emptyAction = err.message; }
ok(emptyAction.includes('text'), 'empty text is refused before Gemini');
ok(parseTextAssistResult('{"text":"The train is late today."}') === 'The train is late today.', 'a writing result is plain text');
const wall = 'Service update: Delays of 40 to 50 minutes due to TFR planned maintenance at Muldersvlei affecting Wellington trains. Single line working is in place between Muldersvlei and Dal Josafat. Train T3503 at 05:20 from Cape Town to Wellington';
const comfort = comfortAssistText(wall);
ok(comfort.startsWith('Service update\n\n'), `a labelled wall gets a title: ${comfort}`);
ok(comfort.includes('\n\nDelays of 40 to 50 minutes'), 'the title is not stuck to the first paragraph');
ok((comfort.match(/\n\n/g) || []).length >= 2, 'the wall is split into paragraphs');
const assistHtml = assistHtmlFromText(comfort);
ok(assistHtml.startsWith('<p><strong>Service update</strong></p>'), 'the title is strong');
ok(assistHtml.includes('<p>Delays of 40 to 50 minutes'), 'the first paragraph stays a paragraph');
ok(!assistHtml.includes('<script'), 'assist html does not pass markup through');
ok(textAssistRules('compose').includes('blank line'), 'compose asks for paragraphs');
ok(adminJs.includes('composer-v3'), 'composer is the full-screen revision');
ok(adminJs.includes('gsmNoticeImageSrc'), 'state monitor resolves poster addresses');
ok(adminJs.includes('comfortAssistText'), 'the composer comforts a wall of text');
ok(adminJs.includes('assistHtmlFromText'), 'the composer paints a title and paragraphs');
ok(adminJs.includes('writeAssistShow'), 'the composer shows the formatted result');
ok(adminJs.includes('openWriteAssist'), 'admin opens the write modal');
ok(adminJs.includes("writeAssistButtonHtml('excl-grid-notice')"), 'exclusions have Write');
ok(adminJs.includes("writeAssistButtonHtml('push-notifications-message')"), 'notifications have Write');
ok(adminJs.includes('sched-override-msg-'), 'holiday popups have Write');
ok(adminJs.includes("fetch(`${Admin.replyWorkerUrl()}/edit`"), 'write calls the reply worker');
const ui = readFileSync(join(ROOT, 'src/lib/ui.js'), 'utf8');
ok(ui.includes("console.error('Toast:'"), 'error toasts are written to the console log');
ok(ui.includes('max-h-40 overflow-y-auto'), 'error toasts can show the whole message');
const layout = readFileSync(join(ROOT, 'src/layouts/Layout.astro'), 'utf8');
ok(layout.includes('MAX_ERROR_LINE = 800'), 'error log lines keep the full toast');

const denied = await handleRequest(new Request('https://reply.test/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
}), {});
ok(denied.status === 401, 'suggest without an operator token is rejected');
const editDenied = await handleRequest(new Request('https://reply.test/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Late', action: 'grammar' }),
}), {});
ok(editDenied.status === 401, 'write without an operator token is rejected');
const health = await handleRequest(new Request('https://reply.test/health'), {});
ok(health.status === 200, 'health check stays open');
ok(suggestDraftMessageId([
    { id: 'm1', text: 'first', timestamp: 1 },
    { id: 'm2', text: 'admin', timestamp: 2, isFromAdmin: true },
    { id: 'm3', text: 'latest', timestamp: 3 },
]) === 'm3', 'a draft belongs to the latest unanswered message');
ok(suggestDraftMessageId([
    { id: 'm1', text: 'first', timestamp: 1 },
    { id: 'm2', text: 'admin', timestamp: 2, isFromAdmin: true },
]) === 'm1', 'an answered thread keeps the draft on that commuter message');
const preview = parseLinkPreviewHtml('<html><head><meta property="og:title" content="UCV Survey"><meta property="og:description" content="One minute"><meta property="og:image" content="https://example.com/banner.jpg"></head></html>', 'https://docs.google.com/forms/d/e/abc/viewform');
ok(preview?.title === 'UCV Survey', 'a link preview reads the page title');
ok(preview?.description === 'One minute', 'a link preview reads the page description');
ok(preview?.image === 'https://example.com/banner.jpg', 'a link preview reads the page image');
ok(!isPublicPreviewUrl('http://example.com/a'), 'a preview refuses plain http');
ok(!isPublicPreviewUrl('https://127.0.0.1/secret'), 'a preview refuses a local address');
ok(isPublicPreviewUrl('https://forms.gle/abc'), 'a public https link can be previewed');
const microCard = previewFromMicrolink({
    status: 'success',
    data: {
        title: 'UCV Commuter Survey: PRASA Monthly Ticket Increase',
        description: 'One minute.',
        publisher: 'Google Docs',
        image: { url: 'https://lh4.googleusercontent.com/survey.png' },
        url: 'https://docs.google.com/forms/d/e/abc/viewform?usp=embed_facebook',
    },
}, 'https://forms.gle/8XeSgtyJZFr1tp9cA');
ok(microCard?.title.startsWith('UCV Commuter Survey'), 'a forms link keeps the page title');
ok(microCard?.description === 'One minute.', 'a forms link keeps the page description');
ok(microCard?.image === 'https://lh4.googleusercontent.com/survey.png', 'a forms link keeps the page image');
ok(microCard?.url === 'https://forms.gle/8XeSgtyJZFr1tp9cA', 'the card opens the pasted link');
ok(microCard?.site === 'Google Docs', 'the card names the page site');
const realFetch = globalThis.fetch;
const seen = [];
globalThis.fetch = async (input) => {
    const href = String(input);
    seen.push(href);
    if (href.includes('/unfurl')) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (href.includes('api.microlink.io')) {
        return new Response(JSON.stringify({
            status: 'success',
            data: {
                title: 'UCV Commuter Survey',
                description: 'Anonymous and one minute.',
                publisher: 'Google Docs',
                image: { url: 'https://lh4.googleusercontent.com/survey.png' },
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('no', { status: 500 });
};
const fallen = await fetchLinkPreview('https://forms.gle/8XeSgtyJZFr1tp9cA', 'https://reply.test');
ok(fallen?.title === 'UCV Commuter Survey' && fallen?.url === 'https://forms.gle/8XeSgtyJZFr1tp9cA', 'a missing unfurl route still builds the link card');
ok(seen.some((href) => href.includes('/unfurl')) && seen.some((href) => href.includes('api.microlink.io')), 'the reply worker is tried before the public page reader');
globalThis.fetch = async (input) => {
    const href = String(input);
    if (href.includes('/unfurl')) {
        return new Response(JSON.stringify({
            url: 'https://example.com/survey',
            title: 'From the worker',
            description: 'Ready',
            image: '',
            site: 'example.com',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('no', { status: 500 });
};
const workerCard = await fetchLinkPreview('https://example.com/other-survey', 'https://reply.test');
ok(workerCard?.title === 'From the worker', 'the reply worker card is stored when the route answers');
globalThis.fetch = realFetch;
const blockedPreview = await handleRequest(new Request('https://reply.test/unfurl?url=' + encodeURIComponent('https://127.0.0.1/x')), {});
ok(blockedPreview.status === 400, 'unfurl refuses a private host');
const draftDenied = await handleRequest(new Request('https://reply.test/draft?id=m1'), {});
ok(draftDenied.status === 401, 'a saved draft stays behind the operator token');
ok(adminJs.includes('persistReplyDraft'), 'closing Co-Pilot keeps the draft');
ok(adminJs.includes('restoreReplyDraft'), 'opening Co-Pilot loads the saved draft');
ok(adminJs.includes('card.style.height = `${height}px`'), 'Co-Pilot fills the screen');
ok(adminJs.includes("suggestBtn.classList.toggle('hidden', halted)"), 'Suggest reply hides while Co-Pilot is halted');
ok(adminJs.includes('id="outreach-later-backlog"') && adminJs.includes('id="outreach-later-progress"'), 'Later saves the reply under To do or In progress');
ok(adminJs.includes('outreachMessage'), 'a later ticket keeps the reply for WhatsApp and email');
ok(adminJs.includes('cm-bubble'), 'community monitor paints message bubbles');
ok(adminJs.includes('target.scrollTop = target.scrollHeight'), 'community monitor opens on the latest message');
ok(ui.includes('bindModalBackgroundGuard'), 'a short modal does not scroll the page behind it');

const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
const loadedPng = await loadSuggestFile({ url: photoUrl, from: 'commuter' }, async () => new Response(png, { status: 200 }));
ok(loadedPng?.mimeType === 'image/png' && loadedPng.data, 'a chat photo is read from its bytes');
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
const loadedPdf = await loadSuggestFile({ url: pdfUrl, from: 'commuter' }, async () => new Response(pdfBytes, { status: 200 }));
ok(loadedPdf?.mimeType === 'application/pdf', 'a chat PDF is read from its bytes');

if (failures.length) {
    console.error('verify-reply-suggest FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-reply-suggest: ok');
