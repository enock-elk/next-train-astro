/**
 * Node checks for alerts-channel feed rules (union, expiry, posters, paging).
 * Run: node scripts/verify-alerts-channel.mjs
 */
import {
    parseNoticeBucket,
    isNoticeRecord,
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
    isNoticePinned,
    sortAlertsFeed,
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

    const imageOnly = parseNoticeBucket({
        poster: { id: 'p1', imageUrls: ['/images/alerts/a.png'], postedAt: 1, expiresAt: now + 1 },
        empty: { id: 'skip' },
    }, 'all', now);
    assert(imageOnly.length === 1 && imageOnly[0].id === 'p1', `image-only child is kept: ${imageOnly.map((n) => n.id)}`);
    assert(isNoticeRecord({ imageUrls: ['/images/alerts/a.png'] }), 'imageUrls counts as a notice');

    const pollOnly = parseNoticeBucket({
        poster: { id: 'poll-only', poll: { active: true, question: 'Keep Saturday trains?' }, postedAt: 1, expiresAt: now + 1 },
        empty: { id: 'skip' },
    }, 'all', now);
    assert(pollOnly.length === 1 && pollOnly[0].id === 'poll-only', `poll-only child is kept: ${pollOnly.map((n) => n.id)}`);
    assert(isNoticeRecord({ poll: { active: true, question: 'Q' } }), 'poll counts as a notice');
}

{
    const route = [{ id: 'r1', message: 'route', severity: 'info', postedAt: 10, _sourceKey: 'pta-mabopane' }];
    const region = [{ id: 'g1', message: 'gp', severity: 'warning', postedAt: 20, _sourceKey: 'all_GP' }];
    const global = [{ id: 'n1', message: 'all', severity: 'critical', postedAt: 5, _sourceKey: 'all' }];
    const merged = mergeUnionNotices([global, region, route]);
    assert(merged.length === 3, `union keeps all scopes, got ${merged.length}`);
    assert(merged[0].id === 'n1' && merged[2].id === 'g1', 'chronological oldest-first');
    assert(highestSeverity(merged) === 'critical', 'highest severity is critical');
    const pinnedFeed = sortAlertsFeed([
        { id: 'old', postedAt: 1 },
        { id: 'pin', postedAt: 2, pinned: true, pinnedAt: 9 },
        { id: 'new', postedAt: 8 },
    ]);
    assert(pinnedFeed[2].id === 'pin' && pinnedFeed[0].id === 'old' && pinnedFeed[1].id === 'new', `pinned sits at the bottom ${pinnedFeed.map((n) => n.id)}`);
    assert(isNoticePinned({ pinned: true }) && !isNoticePinned({}), 'pinned flag helper');
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
    const afterEdit = seenStorageKey({ id: '0619', _sourceKey: 'pta-kempton', postedAt: 99, message: 'edited' });
    assert(afterEdit === key, 'edit keeps the same unseen key');
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
    assert(shouldIgnoreAlertLongPress(fake(['.nt-poll'])), 'poll results panel is not hold-to-react');
    assert(shouldIgnoreAlertLongPress(fake(['[data-poll-shell]'])), 'poll shell is not hold-to-react');
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
    assert(sanitizeInlineAlertImageUrl('https://user:pass@firebasestorage.googleapis.com/v0/b/app/o/x.png') === null, 'storage URL with credentials blocked');

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
    assert(channel.includes('id="alerts-channel-wallpaper"'), 'alerts wallpaper sits behind the feed');
    assert(channel.includes('id="alerts-channel-footer-close"'), 'alerts has a bottom Close');
    assert(channel.includes('When Next Train posts a notice for your region or route, it will show up here.'), 'empty-state copy');
    assert(!channel.includes('When PRASA or Next Train'), 'empty-state no longer mentions PRASA');
    assert(channel.includes('bg-slate-200 dark:bg-gray-950'), 'channel background contrasts with white cards');

    const js = readFileSync(new URL('../src/lib/alerts-channel.js', import.meta.url), 'utf8');
    assert(js.includes('scopedLiveNotices'), 'feed filters to the current route union');
    assert(js.includes('noticeScopeKeys(region, routeId'), 'scoped notices use union keys');
    assert(js.includes('alerts-channel-footer-close'), 'footer Close is bound');
    assert(js.includes('nt-alert-signoff'), 'card has signature class');
    assert(js.includes('nt-alert-poster-loading'), 'poster box has a loading overlay');
    assert(js.includes('hydrateAlertPosterImages'), 'posters hydrate after feed paint');
    assert(js.includes('img.decode'), 'poster reveal waits on decode when available');
    assert(js.includes("data-alert-ready"), 'poster click waits until the image is ready');
    assert(js.includes('data-alert-object-url'), 'decoded poster keeps an object URL for full view');
    assert(js.includes('window.openLightbox(src, lightbox)'), 'feed tap passes the loaded poster into full view');
    assert(!js.includes('setTimeout(resolve, 2500)'), 'poster decode is not raced against a timeout');
    assert(js.includes('fetchpriority="high"'), 'poster img asks for high fetch priority');
    assert(js.includes('watchAlertPosterHydration'), 'poster hydrate survives innerHTML rewrites');
    assert(js.includes('pointer-events-none'), 'loading overlay does not steal hold-to-react');
    assert(!js.includes('onclick='), 'alert posters must not use inline onclick');
    assert(js.includes('nt-alert-chip'), 'card has severity chip class');
    assert(js.includes('nt-alert-strip flex items-center justify-between gap-2 px-3 py-1'), 'Ops/INFO strip is a single compact row');
    assert(js.includes('nt-alert-strip-info'), 'info strip uses the blue severity class');
    assert(js.includes('🔵'), 'info chip keeps the blue emoji');
    assert(!js.includes('nt-alert-strip flex items-start justify-between gap-2 px-4 py-2.5'), 'Ops/INFO strip dropped the taller py-2.5 padding');
    assert(js.includes('nt-alert-time'), 'card has posted timestamp class');
    assert(js.indexOf('nt-alert-signoff') < js.indexOf('nt-alert-chip'), 'signature precedes chip in template');
    assert(js.indexOf('nt-alert-time') < js.indexOf('nt-alert-reply'), 'timestamp precedes Reply');
    assert(js.includes('nt-alert-card-footer'), 'alert card has a dedicated footer');
    assert(js.includes('nt-alert-meta-row'), 'source and time share a meta row');
    assert(js.includes('nt-alert-action-row'), 'reactions and Reply share an action row');
    assert(js.indexOf('nt-alert-meta-row') < js.indexOf('nt-alert-action-row'), 'source/time sit above reactions/Reply');
    assert(js.includes("renderReactionsHtml(notice, { compact: true })"), 'footer reactions omit the leftover mt-2 gap');
    assert(js.includes('📰</span>Source:'), 'source label includes the requested newspaper prefix');
    assert(js.includes('nt-alert-action-meta'), 'admin route/views share the roomier Reply row');
    const hub = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
    assert(js.includes('hydratePollResults(feed)'), 'poll results hydrate after feed paint');
    assert(js.includes('buildPollShellHtml'), 'feed uses the shared poll shell');
    assert(js.includes('feed.dataset.ntAlertsSig'), 'alerts skip innerHTML rewrite when the feed is unchanged');
    assert(hub.includes('paintPollShellsAfterVote'), 'a vote paints every poll shell for that notice');
    assert(hub.includes('toggleAlertPinned'), 'notice modal can pin any live alert');
    assert(hub.includes('nt-notice-admin'), 'signed-in admin gets pin and poll-count on the notice modal');
    assert(js.includes('ntPosterRevealed'), 'decoded posters skip the blob URL swap');
    assert(hub.includes('inboxMediaFromHtml'), 'commuter inbox reuses alerts image hoist');
    assert(hub.includes('hydrateAlertPosterImages(host)'), 'commuter inbox hydrates posters');
    assert(hub.includes("returnModalId !== 'alerts-channel'"), 'Reply does not park the alerts channel');
    assert(hub.includes('$currentRouteId.subscribe'), 'route swaps refetch notices');
    assert(hub.includes('paintAlertsForCurrentRoute'), 'open alerts drop the previous route immediately');
    assert(hub.includes('noticesPromise'), 'notice fetch does not wait on inbox');
    const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
    assert(hub.includes('whenSettledForAutoNotices'), 'force-open Alerts waits until the phone has settled');
    assert(ui.includes('isSettledForAutoNotices'), 'auto-open home notices require settled updates and ads');
    const stability = readFileSync(new URL('../src/lib/session-stability.js', import.meta.url), 'utf8');
    assert(stability.includes('isAdInjectionPending'), 'auto-open reads in-flight ad inject without changing ads');
    assert(stability.includes('isForcedUpdatePending'), 'auto-open waits for a pending force-update');
    assert(stability.includes('nt-ads-entering'), 'ad-inject wait uses the existing entering class');
    assert(!stability.includes('clever-ads.js'), 'session-stability does not import ad injection code');
    assert(ui.includes("modalId === 'alerts-channel'"), 'alerts Close fades before popping history');
    assert(ui.includes('cancelPendingGridOpenFromUi'), 'leaving the board cancels a pending timetable open');
    assert(ui.includes('resolveLightboxDisplaySrc'), 'alert full view reuses the feed poster bitmap');
    assert(ui.includes('poster.currentSrc'), 'full view prefers the already-decoded feed currentSrc');
    assert(!ui.includes('toDataURL'), 'full view does not re-encode the poster on the main thread');
    assert(!ui.includes('snapshotDecodedImage'), 'full view does not snapshot via canvas');
    assert(ui.includes('alert-image-lightbox-stage'), 'alert full view pinch is isolated to the image stage');
    assert(!/class="[^"]*nt-alert-reply[^"]*\bw-full\b/.test(js), 'Reply is not a full-width button');
    assert(!/class="[^"]*\bw-full\b[^"]*nt-alert-reply/.test(js), 'Reply does not pick up w-full from a twin CTA');

    const appearance = readFileSync(new URL('../src/styles/appearance.css', import.meta.url), 'utf8');
    assert(/\.nt-poll\s*\{[\s\S]*?background:\s*color-mix/.test(appearance), 'poll well uses pack tokens');
    assert(appearance.includes('.nt-poll-row.is-mine'), 'your-vote row is a padded highlight, not a ring');
    assert(/#alerts-channel-footer-close\s*\{[\s\S]*?background-color:\s*var\(--nt-primary\)/.test(appearance), 'footer Close stays the filled --nt-primary CTA');
    assert(/#close-timetable-footer-btn,[\s\S]*?#fare-modal-close-btn\s*\{[\s\S]*?color:\s*var\(--nt-primary-fg\)/.test(appearance), 'timetable, tips, and fare Close match Alerts CTA ink');
    assert(/#planner-train-sheet-fare\s*\{[\s\S]*?background-color:\s*#ffffff/.test(appearance), 'train-sheet fare chip stays white on the blue header');
    assert(/\.nt-planner-map-btn\s*\{[\s\S]*?color:\s*var\(--nt-text\)/.test(appearance), 'View trip plan on map uses body ink');
    assert(/\.nt-alert-reply\s*\{[\s\S]*?background-color:\s*var\(--nt-primary\)/.test(appearance), 'Reply uses the filled --nt-primary CTA');
    assert(/\.nt-alert-reply\s*\{[\s\S]*?color:\s*var\(--nt-primary-fg\)/.test(appearance), 'Reply uses white primary text');
    assert(js.includes('nt-alert-source'), 'source citation uses the quiet source class');
    assert(!js.includes('nt-alert-source mt-3 text-[11px] font-semibold'), 'source dropped the chip-sized type');
    assert(!js.includes('0 views'), 'alert cards do not show a views counter');
    assert(!js.includes('/alerts/impression'), 'Alerts overlay does not POST impressions to the worker');
    assert(js.includes('formatAppTime'), 'alert stamps are time-only');
    assert(js.includes('data-alert-date-chip'), 'alerts feed inserts date chips');
    assert(js.includes('data-alert-delete'), 'admin long-press can delete for everyone');
    assert(js.includes('data-alert-pin-toggle'), 'admin long-press can pin any alert');
    assert(js.includes('Pin to bottom of feed'), 'pin control is labeled for any posted alert');
    assert(js.includes('Show raw counts'), 'admin can switch poll rows to raw counts');
    assert(!/admin && notice\?\.poll\?\.active[\s\S]{0,80}data-alert-pin-toggle/.test(js), 'pin is not limited to poll posts');
    assert(js.includes('isAdminAuthed() ? noticeScopeLabel'), 'region/scope is admin-only');
    assert(!js.includes('Posted ${'), 'Posted prefix removed from alert stamps');

    const shareApp = readFileSync(new URL('../src/lib/live-board-ui.js', import.meta.url), 'utf8');
    assert(shareApp.includes('Say Goodbye to Waiting'), 'Share App still has marketing sentence');

    const gridShare = readFileSync(new URL('../src/lib/timetable-grid.js', import.meta.url), 'utf8');
    assert(!gridShare.includes('Check out the weekday'), 'grid share has no caption');
    assert(gridShare.includes('{ url: shareUrl }'), 'grid share is URL-only');
    assert(gridShare.includes('cancelPendingGridOpen'), 'stale timetable opens cancel when the commuter leaves the board');
    assert(gridShare.includes('shouldHonorGridOpenIntent'), 'pending timetable open checks the live board context');
    assert(gridShare.includes('gridViewEventOpen') && gridShare.includes('markFullGridClosed'), 'view_full_grid is once per open');
    assert(gridShare.includes('isSeoAppHandoff'), 'SEO Open links skip deep_link_open');

    const plannerShare = readFileSync(new URL('../src/lib/planner-ui.js', import.meta.url), 'utf8');
    assert(!plannerShare.includes('Trip Plan:'), 'planner header share has no Trip Plan caption');
    assert(!plannerShare.includes('Check details here:'), 'planner header share has no extra text');
    assert(plannerShare.includes('{ url: shareUrl }') || plannerShare.includes('{ url: shareLink }'), 'planner share payloads are URL-only');
}

{
    const { readFileSync } = await import('node:fs');
    const rules = JSON.parse(readFileSync(new URL('../firebase-database.rules.json', import.meta.url), 'utf8')).rules;
    assert(rules.config?.features?.['.read'] === true, 'live config/features kept');
    assert(rules.config?.feature_grants?.['.read'] === true, 'live config/feature_grants kept');
    assert(!!rules.push_subscriptions, 'live push_subscriptions kept');
    assert(rules.ride_pings, 'live ride_pings kept');
    const pingWrite = String(rules.ride_pings?.$routeId?.$deviceId?.['.write'] || '');
    assert(pingWrite.includes("data.child('uid').val() === auth.uid"), 'account owner can stop the other device share');
    const pingValidate = String(rules.ride_pings?.$routeId?.$deviceId?.['.validate'] || '');
    assert(pingValidate.includes('1800000'), 'ride_pings safety TTL is 30 minutes');
    assert(!pingValidate.includes('28800000'), 'ride_pings no longer allows an 8 hour write');
    assert(!pingValidate.includes('1200000'), 'ride_pings no longer caps at 20 minutes');
    assert(rules.ride_share_log, 'ride_share_log history node exists');
    assert(!rules.trains, 'no trains/ RTDB tree');
    assert(rules.notices_meta?.['.read'] === true, 'notices_meta public read');
    const emojiWrite = rules.notices?.$target?.$noticeId?.reactions?.$emoji?.['.write'] || '';
    assert(emojiWrite.includes('wow') && emojiWrite.includes('sad') && emojiWrite.includes('like'), `notice reaction write ${emojiWrite}`);
    const pollVoteWrite = String(rules.polls?.$pollId?.$voteId?.['.write'] || '');
    assert(pollVoteWrite.includes('$voteId === auth.uid'), `poll votes are keyed to uid ${pollVoteWrite}`);
    assert(pollVoteWrite.includes("child('_meta')") && pollVoteWrite.includes('closesAt'), 'closed polls reject new votes');
    assert(rules.polls?.$pollId?._meta, 'polls/{id}/_meta is a dedicated admin node');
}

{
    const {
        buildPollShellHtml,
        buildPollResultsHtml,
        tallyPollVotes,
        isPollOpen,
        withPollTiming,
        pollChoicesNeedStack,
    } = await import('../src/lib/alert-poll.js');
    const tallies = tallyPollVotes({
        a: { optionKey: 'A' },
        b: { optionKey: 'B' },
        c: { optionKey: 'A' },
        multi: { optionKey: 'A', optionKeys: 'A,C' },
        skip: 'nope',
        _meta: { closesAt: 9 },
    });
    assert(tallies.A === 3 && tallies.B === 1 && tallies.C === 1 && tallies.total === 5, `tally ${JSON.stringify(tallies)}`);

    const bars = buildPollResultsHtml({
        poll: { question: 'Keep Saturday trains?', optionA: 'Yes', optionB: 'No', optionC: 'Not sure' },
        counts: { A: 2, B: 1, C: 1, total: 4 },
        votedOption: 'A',
        includeQuestion: true,
    });
    assert(bars.includes('Keep Saturday trains?') && bars.includes('Your vote') && bars.includes('50%'), `results html ${bars}`);
    assert(bars.includes('is-mine') && bars.includes('ACTIVE POLL') && bars.includes('NEXT TRAIN'), 'voted row is marked with live poll label');
    assert(bars.indexOf('nt-poll-foot') < bars.indexOf('nt-poll-q'), 'live label sits above the results question');
    assert(!bars.includes('Live percentages'), 'old Live percentages footer is gone');
    assert(!bars.includes('(2)') && !bars.includes('(1)'), 'default results omit raw counts');

    const rawBars = buildPollResultsHtml({
        poll: { question: 'Keep Saturday trains?', optionA: 'Yes', optionB: 'No', showRawCounts: true },
        counts: { A: 2, B: 1, total: 3 },
        votedOption: 'A',
        includeQuestion: false,
    });
    assert(rawBars.includes('67% (2)') && rawBars.includes('33% (1)') && rawBars.includes('67%'), `raw counts sit in brackets next to percentages ${rawBars}`);

    const closedLabel = buildPollResultsHtml({
        poll: { question: 'Q', optionA: 'Yes', optionB: 'No', closesAt: 1 },
        counts: { A: 1, B: 0, total: 1 },
        votedOption: 'A',
        includeQuestion: false,
    });
    assert(closedLabel.includes('INACTIVE POLL') && closedLabel.includes('is-off'), `closed results use inactive label ${closedLabel}`);

    const notice = {
        id: 'poll-1',
        severity: 'info',
        poll: {
            active: true,
            showResults: true,
            question: 'Keep Saturday trains?',
            optionA: 'Yes',
            optionB: 'No',
        },
    };
    const unvoted = buildPollShellHtml(notice, { mode: 'preview' });
    assert(unvoted.includes('nt-poll-vote') && !unvoted.includes('data-poll-hydrate="1"'), 'results stay hidden until a vote');
    assert(unvoted.includes('Keep Saturday trains?') && unvoted.includes('Yes'), 'unvoted poll keeps the question and options');
    assert(unvoted.includes('ACTIVE POLL') && unvoted.includes('NEXT TRAIN'), 'unvoted poll still shows the live label');
    assert(unvoted.indexOf('nt-poll-foot') < unvoted.indexOf('nt-poll-q'), 'live label sits above the poll question');
    assert(unvoted.includes('View Poll Results') && unvoted.includes('data-poll-view-results'), 'unvoted poll tempts with View Poll Results');
    assert(!unvoted.includes('Thanks for voting'), 'showResults does not thank before a vote');
    assert(!unvoted.includes('data-poll-submit'), 'single-answer polls do not show Submit vote');

    const multiShell = buildPollShellHtml({
        ...notice,
        poll: { ...notice.poll, allowMultiple: true, optionC: 'Maybe' },
    }, { mode: 'preview' });
    assert(multiShell.includes('data-poll-multi="1"') && multiShell.includes('data-poll-submit'), 'multi-answer polls show Submit vote');

    const longOpt = {
        active: true,
        showResults: true,
        question: 'Q',
        optionA: 'Raise monthly fares only on Zone 4 corridors',
        optionB: 'No',
    };
    assert(pollChoicesNeedStack(longOpt) === true, 'long option text opts into stacked choices');
    const longShell = buildPollShellHtml({ id: 'poll-long', poll: longOpt }, { mode: 'preview' });
    assert(longShell.includes('nt-poll-choices--stack'), 'long answers render in a stacked column');

    const hidden = buildPollShellHtml({
        ...notice,
        poll: { ...notice.poll, showResults: false },
    }, { mode: 'preview' });
    assert(hidden.includes('nt-poll-vote') && !hidden.includes('data-poll-hydrate'), 'hidden results keep vote buttons only');

    const closedShell = buildPollShellHtml({
        ...notice,
        poll: { ...notice.poll, closesAt: 1 },
    }, { mode: 'preview' });
    assert(closedShell.includes('data-poll-open="0"') && closedShell.includes('INACTIVE POLL'), 'closed poll is inactive without flipping poll.active');
    assert(closedShell.includes('View Poll Results') && closedShell.includes('nt-poll-vote'), 'closed poll still shows answers and View Poll Results');

    assert(isPollOpen(withPollTiming({ active: true }, { expiresAt: now - 1 }), now) === false, 'missing closesAt inherits alert expiry');
    assert(isPollOpen(withPollTiming({ active: true }, {}), now) === true, 'no close and no alert expiry stays open');
    assert(isPollOpen(withPollTiming({ active: true, closesAt: now + 1 }, { expiresAt: now - 1 }), now) === true, 'dedicated poll close can outlive nothing once set');

    const { safeStorage } = await import('../src/lib/utils.js');
    safeStorage.setItem('poll_voted_poll-1', 'A');
    const votedShow = buildPollShellHtml(notice, { mode: 'live' });
    assert(votedShow.includes('data-poll-hydrate="1"') && votedShow.includes('Your vote'), 'after voting with showResults, the shell keeps a results well');
    assert(!votedShow.includes('nt-poll-vote'), 'after voting with showResults, vote buttons are gone');
    const votedHide = buildPollShellHtml({
        ...notice,
        poll: { ...notice.poll, showResults: false },
    }, { mode: 'live' });
    assert(votedHide.includes('Thanks for voting') && !votedHide.includes('data-poll-hydrate'), 'hidden results still thank the voter');

    const { readFileSync } = await import('node:fs');
    const hubJs = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
    assert(hubJs.includes("method: 'PUT'"), 'votes PUT to polls/{id}/{uid}');
    assert(hubJs.includes('Vote first to see the results.'), 'View Poll Results asks for a vote first');
    assert(hubJs.includes('shakePollVoteButtons'), 'View Poll Results shakes the answer buttons');
    assert(hubJs.includes('This poll is closed.'), 'closed polls tell the commuter votes are off');
}

if (failures.length) {
    console.error('verify-alerts-channel failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-alerts-channel: ok');
