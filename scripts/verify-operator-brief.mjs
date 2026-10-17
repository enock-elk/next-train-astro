/**
 * Operator brief facts and the Check for Updates toast hold.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from '../workers/nexttrain-reply/worker.js';
import {
    BRIEF_DISMISS_KEY,
    alertDraftFromBriefCard,
    briefDismissed,
    briefLauncherHtml,
    briefReportHtml,
    buildBriefRequest,
    buildCrashExplainRequest,
    buildOperatorBrief,
    dismissBrief,
    greetingForHour,
    johannesburgClock,
    parseBriefText,
    scrubOperatorText,
    upcomingOpsNotes,
} from '../src/lib/operator-brief.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function ok(cond, message) {
    if (!cond) failures.push(message);
}

const thursdayEvening = Date.parse('2026-10-15T17:30:00+02:00');
const clock = johannesburgClock(thursdayEvening);
ok(clock.key === '2026-10-15', '15 Oct 2026 evening is that Johannesburg day');
ok(clock.weekday === 'Thu', '15 Oct 2026 is a Thursday');
ok(greetingForHour(clock.hour) === 'Evening brief', '17:30 is an evening brief');

const notes = upcomingOpsNotes(thursdayEvening);
const joined = notes.map((note) => `${note.title} ${note.body}`).join('\n');
ok(joined.includes('0618 and 0619'), 'Friday ahead names trains 0618 and 0619');
ok(!joined.includes('Hercules to Koedoespoort'), 'Thursday does not repeat Saturday Hercules');
ok(notes.some((note) => note.id === 'country'), 'the country scan is on the brief');
const country = notes.find((note) => note.id === 'country');
const countryText = (country?.details || []).join('\n');
ok(countryText.includes('Gauteng') && countryText.includes('KwaZulu-Natal'), 'the country scan names the regions');
ok(countryText.includes('0618 and 0619'), 'the Gauteng scan uses the Kempton Park route-page note');
ok(countryText.includes('first Monday'), 'the KwaZulu-Natal scan uses the Cato Ridge route-page note');
ok(countryText.includes('Western Cape'), 'a region with no route-page note is still listed');
ok(!joined.includes('Cato Ridge'), '15 Oct is not near the next first Monday');

const friday = Date.parse('2026-10-16T09:00:00+02:00');
const fridayJoined = upcomingOpsNotes(friday).map((note) => `${note.title} ${note.body}`).join('\n');
ok(fridayJoined.includes('Hercules to Koedoespoort'), 'Friday names Saturday Hercules');
ok(fridayJoined.includes('other routes'), 'Friday keeps the other-routes line with Hercules');

const beforeNovemberMonday = Date.parse('2026-11-01T12:00:00+02:00');
const cato = upcomingOpsNotes(beforeNovemberMonday).map((note) => note.body).join(' ');
ok(cato.includes('first Monday'), 'the day before the first Monday names Cato Ridge maintenance');
ok(cato.includes('unless PRASA says otherwise'), 'Cato Ridge does not invent a service');

const wednesday = Date.parse('2026-10-20T18:00:00+02:00');
const wed = upcomingOpsNotes(wednesday).map((note) => note.body).join(' ');
ok(wed.includes('do not name which day'), 'a nearby Wednesday stays a selected-day reminder');

const brief = buildOperatorBrief({
    now: thursdayEvening,
    appVersion: 'V9_10.15.7',
    usersEver: 12,
    trips: [
        { origin: 'PRETORIA', destination: 'JOHANNESBURG', region: 'GP', dayType: 'saturday', transfers: 1, routeIds: ['pta-kempton'] },
        { origin: 'HERCULES', destination: 'KOEDOESPOORT', region: 'GP', dayType: 'saturday', routeIds: ['herc-koed'] },
        { origin: 'CATO RIDGE', destination: 'DURBAN', region: 'KZN', dayType: 'weekday', routeIds: ['kzn-catoridge'] },
    ],
    pairs: { 'PRETORIA~JOHANNESBURG': { origin: 'PRETORIA', destination: 'JOHANNESBURG', lastSeen: 1 } },
    fails: [{ reason: 'NO_SERVICE', origin: 'HERCULES', destination: 'GEZINA' }],
    fares: [{ agree: false, origin: 'CAPE TOWN', destination: 'BELLVILLE', quotedPrice: 14, reportedPrice: 18, ticketType: 'single' }],
    crashes: [{ id: 'bb_1', error: 'TypeError at board', appVersion: 'V9_10.15.7', timestamp: thursdayEvening }],
    features: { mapTab: { enabled: true, regionIds: ['KZN'] }, communityTab: { enabled: false } },
    scheduleOverride: { regions: { GP: { active: false }, KZN: { active: true, dayType: 'saturday', title: 'Holiday sheet' } } },
    expiring: [{ type: 'Alert', label: 'Late notice', expiresAt: thursdayEvening + 3 * 3600000, routeId: 'pta-pien' }],
});
ok(brief.greeting === 'Evening brief', 'the report greets by the time of day');
ok(brief.cards.some((card) => card.id === 'trips' && card.body.includes('no trains that day')), 'a Saturday plan on herc-koed is called out');
ok(brief.cards.some((card) => card.body.includes('Cato Ridge')), 'a Cato Ridge plan is counted');
ok(brief.cards.some((card) => card.body.includes('R4')), 'a fare gap is stated in rand');
ok(brief.cards.some((card) => card.title.includes('48 hours')), 'an alert due inside two days is listed');
ok(brief.cards.some((card) => card.body.includes('Map') && card.body.includes('KZN')), 'a feature switch names its region');
ok(!JSON.stringify(brief.digest).includes('@'), 'the digest has no email from this sample');

const dirty = scrubOperatorText('Write to enockelk@gmail.com or 0788227993. Bearer abc.def');
ok(dirty.includes('[email]') && dirty.includes('[phone]') && dirty.includes('[token]'), 'emails, phones, and tokens are removed');
ok(!dirty.includes('0788227993'), 'the phone number itself is gone');

const memory = { value: '', getItem: () => memory.value, setItem: (_k, v) => { memory.value = v; }, removeItem: () => { memory.value = ''; } };
ok(!briefDismissed(memory, thursdayEvening), 'the brief starts visible');
dismissBrief(memory, thursdayEvening);
ok(memory.value === johannesburgClock(thursdayEvening).key, 'dismiss stores the Johannesburg day');
ok(briefDismissed(memory, thursdayEvening), 'the same day stays dismissed');
ok(memory.value === BRIEF_DISMISS_KEY || memory.value.length === 10, 'dismiss is a day key');

const launcher = briefLauncherHtml({ hidden: false, clock });
ok(launcher.includes('id="operator-brief-open"'), 'the launcher is a button');
ok(launcher.includes('id="operator-brief-dismiss"'), 'the launcher can be dismissed');
ok(launcher.includes('w-full'), 'the launcher is full width');
ok(briefLauncherHtml({ hidden: true, clock }).includes('id="operator-brief-restore"'), 'a dismissed brief can be opened again');
ok(!brief.cards.some((card) => card.id === 'rail'), 'an empty disruption list does not add a rail card');
const withRail = buildOperatorBrief({
    now: thursdayEvening,
    disruptions: [{ region: 'GP', route: 'Pretoria to Kempton Park', stretch: 'Centurion - Irene', tier: 'CRITICAL' }],
});
ok(withRail.cards.some((card) => card.id === 'rail' && card.body.includes('Centurion')), 'a live disruption names the region stretch');
const oldFail = Date.parse('2026-10-01T12:00:00+02:00');
const week = buildOperatorBrief({
    now: thursdayEvening,
    fails: [
        { reason: 'OLD', origin: 'A', destination: 'B', timestamp: oldFail },
        { reason: 'NEW', origin: 'C', destination: 'D', timestamp: thursdayEvening },
    ],
    crashes: [
        { id: 'old', error: 'old boom', timestamp: oldFail },
        { id: 'new', error: 'new boom', timestamp: thursdayEvening },
    ],
});
ok(week.cards.find((card) => card.id === 'fails')?.title.startsWith('1 '), 'routing rows older than a week stay out');
ok(!week.digest.crashes.recent.some((row) => /old boom/.test(row.error)), 'crash rows older than a week stay out');

const report = briefReportHtml(brief);
ok(report.includes('What this means'), 'the report has a written note');
ok(report.includes('Explain this crash'), 'a crash card can be sent for a reading');
ok(report.includes('Crashes this week'), 'crash rows start collapsed');
ok(report.includes('data-brief-card'), 'a brief card can expand');
ok(report.includes('Add to alerts'), 'a brief card can become an alert');
ok(report.includes('Google Analytics is not'), 'analytics that we cannot read are named as absent');
const draft = alertDraftFromBriefCard(country);
ok(draft.target === 'all', 'the country card posts to the whole network');
ok(draft.message.startsWith('<h3>'), 'the alert keeps a title');
ok(draft.message.includes('<p>'), 'the alert body is paragraphs');
ok(!draft.message.includes('Add to alerts'), 'the alert is the card, not the button');

const gemini = buildBriefRequest(brief.digest);
ok(gemini.generationConfig.thinkingConfig.thinkingLevel === 'MINIMAL', 'the brief asks for minimal thinking');
ok(!('temperature' in gemini.generationConfig), 'the brief leaves temperature at the model default');
ok(parseBriefText('{"text":"People are planning Saturday trips."}') === 'People are planning Saturday trips.', 'a brief note is plain text');
let emptyCrash = '';
try { buildCrashExplainRequest({}); } catch (err) { emptyCrash = err.message; }
ok(emptyCrash.includes('empty'), 'an empty crash is refused');

const hub = readFileSync(join(ROOT, 'src/lib/hub.js'), 'utf8');
ok(hub.includes('UPDATE_TOAST_MAX_MS = 6000'), 'Check for Updates caps the toast hold at 6 seconds');
ok(hub.includes("showUpdateToast('Checking for updates…')"), 'the check shows a toast before the probe returns');
ok(hub.includes('await waitOutUpdateToast(updateToastStarted)'), 'a quick download keeps the toast up to 6 seconds');
ok(hub.includes("persist: true"), 'the update toast stays until the download concludes');
const admin = readFileSync(join(ROOT, 'public/js/admin.js'), 'utf8');
ok(admin.includes('ensureOperatorBriefSlot'), 'Dev Hub paints the brief button');
ok(admin.includes('Admin.placeBelowBrief(telPanel)'), 'Live Telemetry sits under the brief');
ok(!admin.includes('insertBefore(telPanel, container.firstElementChild)'), 'the grid does not pin telemetry above the brief');
ok(admin.includes("Admin.replyWorkerUrl()}/brief`"), 'Explain and the note call the reply worker');
ok(!admin.includes('operator-brief-open') || admin.includes('openOperatorBrief'), 'the report opens from the button');
const worker = readFileSync(join(ROOT, 'workers/nexttrain-reply/worker.js'), 'utf8');
ok(worker.includes("pathname === '/brief'"), 'the reply worker has a brief route');
ok(!worker.includes('feedback.json'), 'the brief route does not read the feedback tree');
ok(!worker.includes('inbox.json'), 'the brief route does not read the inbox');

const denied = await handleRequest(new Request('https://reply.test/brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'report', digest: brief.digest }),
}), {});
ok(denied.status === 401, 'the brief without an operator token is rejected');

if (failures.length) {
    console.error('verify-operator-brief FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-operator-brief: ok');
