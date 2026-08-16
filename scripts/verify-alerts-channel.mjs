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
    shouldForceOpen,
    pickAutoOpenNotice,
    seenStorageKey,
    buildNoticesMeta,
    ALERTS_PAGE_SIZE,
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

if (failures.length) {
    console.error('verify-alerts-channel failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-alerts-channel: ok');
