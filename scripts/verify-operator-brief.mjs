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
    briefSky,
    buildBriefRequest,
    buildCrashExplainRequest,
    buildOperatorBrief,
    dismissBrief,
    greetingForHour,
    johannesburgClock,
    localBriefNote,
    localCrashReading,
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
ok(notes.some((note) => note.id === 'region-GP' && note.region === 'GP'), 'Gauteng has its own rules card');
ok(notes.some((note) => note.id === 'region-WC' && note.region === 'WC'), 'Western Cape has its own card');
ok(notes.some((note) => note.id === 'region-KZN' && note.region === 'KZN'), 'KwaZulu-Natal has its own rules card');
ok(notes.some((note) => note.id === 'region-EC' && note.region === 'EC'), 'Eastern Cape has its own card');
const gpRules = notes.find((note) => note.id === 'region-GP');
const kznRules = notes.find((note) => note.id === 'region-KZN');
const wcRules = notes.find((note) => note.id === 'region-WC');
ok((gpRules?.body || '').includes('0618 and 0619'), 'the Gauteng card uses the Kempton Park day rule');
ok((kznRules?.body || '').includes('selected Wednesdays'), 'the KwaZulu-Natal card names the Wednesday hold');
ok((kznRules?.body || '').includes('Umlazi'), 'the KwaZulu-Natal card names the Umlazi hold');
ok((kznRules?.body || '').includes('first Monday'), 'the KwaZulu-Natal card uses the Cato Ridge rule');
ok((wcRules?.body || '').includes('No recurring') || (wcRules?.title || '').includes('No recurring'), 'a region with no day rule says so');
ok(!(gpRules?.body || '').includes('2020 lockdown'), 'the Gauteng rules card leaves the standing essay out');
const others = notes.find((note) => note.id === 'country-other');
ok((others?.details || []).join(' ').includes('shuttle'), 'standing notes sit in Others');
ok(!notes.some((note) => String(note.id).startsWith('cato-')), '15 Oct is not near the next first Monday');

const friday = Date.parse('2026-10-16T09:00:00+02:00');
const fridayJoined = upcomingOpsNotes(friday).map((note) => `${note.title} ${note.body}`).join('\n');
ok(fridayJoined.includes('Hercules to Koedoespoort'), 'Friday names Saturday Hercules');
ok(fridayJoined.includes('other routes'), 'Friday keeps the other-routes line with Hercules');
const saturday = upcomingOpsNotes(friday).find((note) => String(note.id).startsWith('sat-'));
ok(saturday?.body.includes('\n\n'), 'the Saturday note is two paragraphs');
ok(saturday.body.split('\n\n')[1].startsWith('Hercules and Koedoespoort'), 'the other-routes line is its own paragraph');
ok(briefSky(8).name === 'morning' && briefSky(14).name === 'afternoon', 'morning and afternoon have their own sky');
ok(briefSky(18).name === 'evening' && briefSky(1).name === 'night', 'evening and night have their own sky');

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
        { origin: 'PRETORIA', destination: 'JOHANNESBURG', region: 'GP', dayType: 'saturday', transfers: 1, routeIds: ['pta-kempton'], timestamp: thursdayEvening, userId: 'a' },
        { origin: 'HERCULES', destination: 'KOEDOESPOORT', region: 'GP', dayType: 'saturday', routeIds: ['herc-koed'], timestamp: thursdayEvening, userId: 'b' },
        { origin: 'CATO RIDGE', destination: 'DURBAN', region: 'KZN', dayType: 'weekday', routeIds: ['kzn-catoridge'], timestamp: thursdayEvening, userId: 'c' },
        { origin: 'OLD', destination: 'PLACE', region: 'GP', dayType: 'weekday', timestamp: thursdayEvening - 20 * 24 * 3600000, userId: 'z' },
        { origin: 'PRETORIA', destination: 'JOHANNESBURG', region: 'GP', dayType: 'weekday', timestamp: thursdayEvening - 8 * 24 * 3600000, userId: 'd' },
        { origin: 'PRETORIA', destination: 'JOHANNESBURG', region: 'GP', dayType: 'weekday', timestamp: thursdayEvening - 9 * 24 * 3600000, userId: 'e' },
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
const tripCard = brief.cards.find((card) => card.id === 'trips');
ok((tripCard?.body || '').includes('last 48 hours'), 'trip plans are counted inside 48 hours');
ok(!(tripCard?.body || '').includes('OLD'), 'a plan older than 48 hours stays out of the recent card');
ok((tripCard?.body || '').includes('week before'), 'trip plans compare this week with the week before');
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
ok(launcher.includes('data-brief-sky="evening"'), 'the launcher uses the evening sky');
ok(!launcher.includes('#4c1d95'), 'the launcher is not one purple gradient');
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
ok(report.includes('aria-label="Add to alerts"'), 'a brief card can become an alert');
ok(report.includes('absolute bottom-3 right-3'), 'add to alerts sits at the bottom right');
ok(!report.includes('>Add to alerts<'), 'add to alerts has no visible label');
ok(report.includes('data-brief-sky="evening"'), 'the report sky follows the hour');
ok(!/wrangler/i.test(report), 'the report does not ask for a deploy');
const localNote = localBriefNote(brief);
ok(localNote.includes('\n\n') && !/wrangler/i.test(localNote), 'a missing writer still leaves a two-paragraph note');
ok(report.includes('Google Analytics is not'), 'analytics that we cannot read are named as absent');
const draft = alertDraftFromBriefCard(gpRules);
ok(draft.target === 'all_GP', 'a region card posts to that region');
const otherDraft = alertDraftFromBriefCard(others);
ok(otherDraft.target === 'all', 'standing notes stay a network draft');
const crashRead = localCrashReading({
    error: "Uncaught SyntaxError: The requested module 'src/lib/alerts-feed.js' does not provide an export named 'sanitizeAlertVideoUrl'",
    appVersion: 'V10_10.18.2',
});
ok(crashRead.includes('sanitizeAlertVideoUrl') && crashRead.includes('V10_10.18.2'), 'a missing export is read from the log');
const undefRead = localCrashReading({ error: 'Uncaught ReferenceError: bindBlurBackdropDismiss is not defined', appVersion: 'V9_10.18.10' });
ok(undefRead.includes('bindBlurBackdropDismiss') && undefRead.includes('does not define'), 'a missing name is read from the log');
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
ok(hub.includes('UPDATE_TOAST_MAX_MS = 4000'), 'Check for Updates keeps its status toast a little past the Found toast');
ok(hub.includes("showUpdateToast('Checking for updates…')"), 'the check shows a toast before the probe returns');
ok(hub.includes('await waitOutUpdateToast(updateToastStarted)'), 'a quick download keeps the update toast up a little longer');
ok(hub.includes("persist: true"), 'the update toast stays until the download concludes');
const admin = readFileSync(join(ROOT, 'public/js/admin.js'), 'utf8');
ok(admin.includes('ensureOperatorBriefSlot'), 'Dev Hub paints the brief button');
ok(admin.includes('Admin.placeBelowBrief(telPanel)'), 'Live Telemetry sits under the brief');
ok(!admin.includes('insertBefore(telPanel, container.firstElementChild)'), 'the grid does not pin telemetry above the brief');
ok(admin.includes("Admin.replyWorkerUrl()}/brief`"), 'Explain and the note call the reply worker');
ok(!admin.includes('npx wrangler deploy'), 'the brief does not tell the operator to deploy');
ok(admin.includes('localBriefNote'), 'a missing writer falls back to the cards');
ok(admin.includes('localCrashReading'), 'a missing writer still reads the crash line');
ok(admin.includes('onBriefPopState'), 'back closes the brief before Dev Mode');
ok(admin.includes('messageUnread'), 'the home-screen badge counts messages');
ok(!admin.includes('setAppBadge(totalUnread)'), 'crashes and fails do not set the home-screen badge');
ok(!admin.includes('Could not read this crash.'), 'a crash reading stays on the card');
ok(!admin.includes('operator-brief-open') || admin.includes('openOperatorBrief'), 'the report opens from the button');
const ui = readFileSync(join(ROOT, 'src/lib/ui.js'), 'utf8');
ok(ui.includes('Admin.onBriefPopState'), 'back reaches the brief before Dev Mode');
const badge = readFileSync(join(ROOT, 'src/lib/operator-badge.js'), 'utf8');
ok(badge.includes('isAdminEmail') && badge.includes('clearAppBadge'), 'only an operator email can badge the icon');
ok(badge.includes('feedback.json'), 'the icon reads commuter messages');
const account = readFileSync(join(ROOT, 'src/lib/account.js'), 'utf8');
ok(account.includes('operator-badge.js'), 'the icon updates without opening Dev Mode');
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
