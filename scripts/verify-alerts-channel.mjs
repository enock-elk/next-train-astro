/**
 * Node checks for alerts-channel feed rules (union, expiry, posters, paging).
 * Run: node scripts/verify-alerts-channel.mjs
 */
import {
    parseNoticeBucket,
    mergeUnionNotices,
    noticeScopeKeys,
    isNoticeLive,
    highestSeverity,
    pageAlertsFeed,
    sanitizeAlertImageUrl,
    collectNoticeImageUrls,
    splitAlertTitleAndBody,
    hoistAlertImagesFromHtml,
    layoutAlertPost,
    sanitizeInlineAlertImageUrl,
    shouldIgnoreAlertLongPress,
    shouldForceOpen,
    pickAutoOpenNotice,
    seenStorageKey,
    buildNoticesMeta,
    summarizeAlertReactions,
    buildAlertReactionBreakdown,
    stripAlertSignoffHtml,
    noticeScopeLabel,
    ALERTS_PAGE_SIZE,
    ALERT_REACTION_KEYS,
} from '../src/lib/alerts-feed.js';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

const now = 1_700_000_000_000;

{
    const keys = noticeScopeKeys('GP', 'pta-mabopane');
    assert(keys.includes('all') && keys.includes('all_GP') && keys.includes('pta-mabopane'), `union keys ${keys}`);
    const wc = noticeScopeKeys('WC', 'pta-kempton');
    assert(wc.includes('all_WC') && !wc.includes('all_GP'), 'WC must not include GP region key');
}

{
    assert(isNoticeLive({ expiresAt: now + 1000 }, now), 'future expiry is live');
    assert(!isNoticeLive({ expiresAt: now - 1000 }, now), 'past expiry is not live');
    assert(isNoticeLive({ message: 'x' }, now), 'no expiry is live');
}

{
    const single = parseNoticeBucket({ id: '1', message: 'A', expiresAt: now + 1 }, 'all', now);
    assert(single.length === 1 && single[0].id === '1' && single[0]._sourceKey === 'all', 'legacy single notice');

    const map = parseNoticeBucket({
        a: { id: 'a', message: 'A', postedAt: 1, expiresAt: now + 1 },
        b: { id: 'b', message: 'B', postedAt: 2, expiresAt: now - 1 },
        c: { id: 'c', message: 'C', postedAt: 3, expiresAt: now + 1 },
    }, 'all_GP', now);
    assert(map.length === 2 && map.every((n) => n.id !== 'b'), `expired dropped: ${map.map((n) => n.id)}`);
    assert(map.every((n) => n._sourceKey === 'all_GP'), 'child notices keep source key');
}

{
    const route = [{ id: 'r1', message: 'route', severity: 'info', postedAt: 10, _sourceKey: 'pta-mabopane' }];
    const region = [{ id: 'g1', message: 'gp', severity: 'warning', postedAt: 20, _sourceKey: 'all_GP' }];
    const global = [{ id: 'n1', message: 'all', severity: 'critical', postedAt: 5, _sourceKey: 'all' }];
    const merged = mergeUnionNotices([global, region, route]);
    assert(merged.length === 3, `union keeps all scopes, got ${merged.length}`);
    assert(merged[0].id === 'n1' && merged[2].id === 'g1', 'chronological oldest-first');
    assert(highestSeverity(merged) === 'critical', 'highest severity is critical');
}

{
    const list = Array.from({ length: 14 }, (_, i) => ({ id: String(i), postedAt: i }));
    const page = pageAlertsFeed(list, ALERTS_PAGE_SIZE);
    assert(page.visible.length === 10 && page.hiddenCount === 4, `page ${page.visible.length}/${page.hiddenCount}`);
    assert(page.visible[0].id === '4' && page.visible[9].id === '13', 'initial page is the newest tail');
}

{
    assert(sanitizeAlertImageUrl('/images/alerts/fare.png') === '/images/alerts/fare.png', 'same-origin poster path');
    assert(sanitizeAlertImageUrl('/images/alerts/fare.png?x=1') === '/images/alerts/fare.png', 'query stripped');
    assert(sanitizeAlertImageUrl('/images/network-map.png') === null, 'non-alerts folder blocked');
    assert(sanitizeAlertImageUrl('/images/alerts/../icons/x.png') === null, 'traversal blocked');
    assert(sanitizeAlertImageUrl('https://evil.example/images/alerts/x.png') === '/images/alerts/x.png', 'host stripped, path kept if alerts');
    assert(sanitizeAlertImageUrl('https://evil.example/etc/passwd') === null, 'foreign path blocked');
    const urls = collectNoticeImageUrls({
        imageUrl: '/images/alerts/legacy.png',
        imageUrls: ['/images/alerts/a.png', '/images/alerts/b.png', '/images/alerts/c.png', '/tmp/x.png'],
    });
    assert(urls.length === 2 && urls[0] === '/images/alerts/a.png' && urls[1] === '/images/alerts/b.png', `max 2 posters ${urls}`);
    const legacy = collectNoticeImageUrls({ imageUrl: '/images/alerts/legacy.png' });
    assert(legacy.length === 1 && legacy[0] === '/images/alerts/legacy.png', 'legacy imageUrl fallback');
}

{
    assert(shouldForceOpen({ severity: 'critical' }), 'critical defaults to force open');
    assert(!shouldForceOpen({ severity: 'warning' }), 'warning does not auto-open');
    assert(shouldForceOpen({ severity: 'info', forcePopup: true }), 'forcePopup wins');
    assert(!shouldForceOpen({ severity: 'critical', forcePopup: false }), 'forcePopup false blocks critical');
    const pick = pickAutoOpenNotice([
        { id: 'old', severity: 'critical', postedAt: 1, _sourceKey: 'all' },
        { id: 'new', severity: 'critical', postedAt: 9, _sourceKey: 'all' },
        { id: 'warn', severity: 'warning', postedAt: 99, _sourceKey: 'all' },
    ]);
    assert(pick?.id === 'new', `auto-open newest critical, got ${pick?.id}`);
}

{
    const key = seenStorageKey({ id: '0619', _sourceKey: 'pta-kempton' });
    assert(key === 'seen_notice_pta-kempton_0619', `seen key ${key}`);
}

{
    const meta = buildNoticesMeta([
        { id: 'a', severity: 'info', postedAt: 1 },
        { id: 'b', severity: 'critical', postedAt: 3 },
        { id: 'c', severity: 'warning', postedAt: 2, expiresAt: 1 },
    ]);
    assert(meta.liveCount === 2, `meta liveCount ${meta.liveCount}`);
    assert(meta.latestId === 'b' && meta.latestSeverity === 'critical', 'meta latest is newest live');
    assert(meta.latestCriticalAt === 3, 'meta critical timestamp');
}

{
    assert(ALERT_REACTION_KEYS.includes('wow') && ALERT_REACTION_KEYS.includes('sad'), 'picker includes wow/sad');
    const empty = summarizeAlertReactions({ id: '1' });
    assert(empty.length === 0, 'no chips when nobody has reacted');
    const some = summarizeAlertReactions({ reactions: { like: 2, pray: 1 } }, 'like');
    assert(some.length === 2 && some[0].key === 'like' && some[0].mine && some[0].count === 2, `summary chips ${JSON.stringify(some)}`);
    const breakdown = buildAlertReactionBreakdown({ reactions: { like: 2, pray: 1, laugh: 5 } });
    assert(breakdown.total === 8, `breakdown total ${breakdown.total}`);
    assert(breakdown.rows[0].key === 'laugh' && breakdown.rows[0].count === 5, 'breakdown sorts by count');
}

{
    const fake = (hits) => ({
        closest: (sel) => sel.split(',').map((s) => s.trim()).some((p) => hits.includes(p)) ? {} : null,
    });
    assert(!shouldIgnoreAlertLongPress(fake(['[data-alert-lightbox]', 'button'])), 'catalog poster is hold-to-react');
    assert(!shouldIgnoreAlertLongPress(fake(['[data-alert-media]'])), 'poster grid is hold-to-react');
    assert(!shouldIgnoreAlertLongPress(fake(['button[onclick*="openLightbox"]', 'button'])), 'inline lightbox photo is hold-to-react');
    assert(!shouldIgnoreAlertLongPress(fake(['[data-alert-title]'])), 'title text is hold-to-react');
    assert(shouldIgnoreAlertLongPress(fake(['[data-alert-reply]', 'button'])), 'reply button is not hold-to-react');
    assert(shouldIgnoreAlertLongPress(fake(['[data-alert-summary]', 'button'])), 'count chip is not hold-to-react');
    assert(shouldIgnoreAlertLongPress(fake(['.nt-poll-vote', 'button'])), 'poll vote is not hold-to-react');
    assert(shouldIgnoreAlertLongPress(fake(['a'])), 'links are not hold-to-react');
    assert(shouldIgnoreAlertLongPress(null), 'missing target ignored');
}

{
    const splitField = splitAlertTitleAndBody('<p>Body only</p>', 'Sinkhole update');
    assert(splitField.title === 'Sinkhole update' && splitField.body === '<p>Body only</p>', 'explicit title wins');
    const splitH3 = splitAlertTitleAndBody('<h3>Weekend service</h3><p>Trains resume Monday.</p>');
    assert(splitH3.title === 'Weekend service' && splitH3.body.includes('Trains resume'), `heading title ${splitH3.title}`);
    const noTitle = splitAlertTitleAndBody('<p>Just a notice</p>');
    assert(!noTitle.title && noTitle.body.includes('Just a notice'), 'no title when none provided');

    const hoisted = hoistAlertImagesFromHtml('Hello<br><img src="/images/alerts/fare.png" alt="x"><p>After</p>');
    assert(hoisted.urls[0] === '/images/alerts/fare.png' && !hoisted.body.includes('<img'), `hoist imgs ${hoisted.body}`);

    assert(sanitizeInlineAlertImageUrl('https://evil.example/x.png') === null, 'foreign inline image blocked');
    assert(sanitizeInlineAlertImageUrl('https://firebasestorage.googleapis.com/v0/b/app/o/x.png') === 'https://firebasestorage.googleapis.com/v0/b/app/o/x.png', 'firebase storage allowed');

    const laid = layoutAlertPost({
        title: 'Service recovery',
        message: '<h3>Ignored heading</h3><p>Trains are back.</p>',
        imageUrls: ['/images/alerts/train.png'],
    });
    assert(laid.title === 'Service recovery', `layout title ${laid.title}`);
    assert(laid.imageUrls[0] === '/images/alerts/train.png', `layout image ${laid.imageUrls}`);
    assert(laid.body.includes('Trains are back') && !laid.body.includes('Ignored heading'), `layout body ${laid.body}`);

    const inlineLaid = layoutAlertPost({
        message: '<h3>Good news</h3><button type="button"><img src="https://firebasestorage.googleapis.com/v0/b/app/o/x.png"></button><p>Resume Monday.</p>',
    });
    assert(inlineLaid.title === 'Good news', 'inline heading becomes title');
    assert(inlineLaid.imageUrls[0].includes('firebasestorage.googleapis.com'), 'inline img hoisted');
    assert(inlineLaid.body.includes('Resume Monday') && !inlineLaid.body.includes('<img'), 'text stays below image');
}

{
    const kemptonKeys = noticeScopeKeys('GP', 'pta-kempton');
    assert(kemptonKeys.includes('pta-kempton') && kemptonKeys.includes('all_GP'), 'Kempton union is route ∪ region ∪ all');
    assert(!kemptonKeys.includes('pta-irene'), 'Kempton pin does not inherit Irene');
}

{
    const dup = mergeUnionNotices([
        [{ id: 'same', message: 'gp copy', postedAt: 1, _sourceKey: 'all_GP' }],
        [{ id: 'same', message: 'kempton copy', postedAt: 1, _sourceKey: 'pta-kempton' }],
        [{ id: 'other', message: 'network', postedAt: 2, _sourceKey: 'all' }],
    ]);
    assert(dup.length === 2, `same-id union collapses to one card, got ${dup.length}`);
    const kept = dup.find((n) => n.id === 'same');
    assert(kept && kept._sourceKey === 'pta-kempton', `same-id prefers route source, got ${kept?._sourceKey}`);
}

{
    const stripped = stripAlertSignoffHtml('<p>Please take note of this</p><br><span class="opacity-75">- Next Train Ops</span>');
    assert(stripped.includes('Please take note') && !stripped.includes('Next Train Ops'), `signoff stripped from html ${stripped}`);
    assert(noticeScopeLabel('all_GP') === 'Gauteng', `scope all_GP ${noticeScopeLabel('all_GP')}`);
    assert(noticeScopeLabel('all') === 'Network', 'scope all is Network');
    const signed = layoutAlertPost({
        title: 'Advisory',
        message: '<p>Trains resume Monday.</p><br><span>- Next Train Ops</span>',
    });
    assert(signed.body.includes('Trains resume') && !signed.body.includes('Next Train Ops'), `layout body drops signoff ${signed.body}`);
}

{
    const { readFileSync } = await import('node:fs');
    const channel = readFileSync(new URL('../src/components/AlertsChannel.astro', import.meta.url), 'utf8');
    assert(channel.includes('>Close</button>'), 'header has a labeled Close button');
    assert(channel.includes('When Next Train posts a notice for your region or route, it will show up here.'), 'empty-state copy');
    assert(!channel.includes('When PRASA or Next Train'), 'empty-state no longer mentions PRASA');
    assert(channel.includes('bg-slate-200 dark:bg-gray-950'), 'channel background contrasts with white cards');

    const js = readFileSync(new URL('../src/lib/alerts-channel.js', import.meta.url), 'utf8');
    assert(js.includes('nt-alert-signoff'), 'card has signature class');
    assert(js.includes('nt-alert-chip'), 'card has severity chip class');
    assert(js.includes('nt-alert-time'), 'card has posted timestamp class');
    assert(js.indexOf('nt-alert-signoff') < js.indexOf('nt-alert-chip'), 'signature precedes chip in template');
    assert(js.indexOf('nt-alert-time') < js.indexOf('nt-alert-reply'), 'timestamp precedes Reply');

    const shareApp = readFileSync(new URL('../src/lib/live-board-ui.js', import.meta.url), 'utf8');
    assert(shareApp.includes('Say Goodbye to Waiting'), 'Share App still has marketing sentence');

    const gridShare = readFileSync(new URL('../src/lib/timetable-grid.js', import.meta.url), 'utf8');
    assert(!gridShare.includes('Check out the weekday'), 'grid share has no caption');
    assert(gridShare.includes('{ url: shareUrl }'), 'grid share is URL-only');

    const plannerShare = readFileSync(new URL('../src/lib/planner-ui.js', import.meta.url), 'utf8');
    assert(!plannerShare.includes('Trip Plan:'), 'planner header share has no Trip Plan caption');
    assert(!plannerShare.includes('Check details here:'), 'planner header share has no extra text');
    assert(plannerShare.includes('{ url: shareUrl }') || plannerShare.includes('{ url: shareLink }'), 'planner share payloads are URL-only');
}

{
    const { readFileSync } = await import('node:fs');
    const rules = JSON.parse(readFileSync(new URL('../firebase-database.rules.json', import.meta.url), 'utf8')).rules;
    assert(rules.config?.features?.['.read'] === true, 'live config/features kept');
    assert(!!rules.push_subscriptions, 'live push_subscriptions kept');
    assert(!!rules.ride_pings, 'live ride_pings kept');
    assert(rules.notices_meta?.['.read'] === true, 'notices_meta public read');
    const emojiWrite = rules.notices?.$target?.$noticeId?.reactions?.$emoji?.['.write'] || '';
    assert(emojiWrite.includes('wow') && emojiWrite.includes('sad') && emojiWrite.includes('like'), `notice reaction write ${emojiWrite}`);
}

if (failures.length) {
    console.error('verify-alerts-channel failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-alerts-channel: ok');
