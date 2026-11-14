/**
 * Data saving starts off, and a cached or already shown picture is not held.
 */
import { readFileSync } from 'node:fs';
import {
    dataSaverSummary,
    linkCardsOn,
    normalizeDataSaver,
    pictureMarkup,
    pictureWasShown,
    picturesWaitForTap,
    posterLoadPlan,
    profilePhotosOn,
    readDataSaver,
    rememberPicture,
    shouldHoldPicture,
    writeDataSaver,
} from '../src/lib/data-saver.js';
import { formatDownloadSize, imageMetaForUrl, imageMetaKey, imageMetaRow } from '../src/lib/picture-preview.js';
import jpeg from 'jpeg-js';
import { jpegThumbnail } from '../workers/nexttrain-community/jpeg-thumb.js';

let failed = 0;
function assert(cond, msg) {
    if (cond) return;
    failed += 1;
    console.error('FAIL', msg);
}

const fresh = 'https://nexttrain-community.enock.workers.dev/alerts/img_fresh.jpg';
const auto = 'https://nexttrain-community.enock.workers.dev/alerts/img_auto.jpg';
const seen = 'https://nexttrain-community.enock.workers.dev/alerts/img_seen.jpg';
const cached = 'https://nexttrain-community.enock.workers.dev/alerts/img_cached.jpg';

const defaults = readDataSaver();
assert(defaults.pictures === 'auto', 'pictures default to automatic');
assert(defaults.linkCards === true, 'link cards default on');
assert(defaults.profilePhotos === true, 'profile photos default on');
assert(dataSaverSummary(defaults) === 'Off', 'summary is Off');
assert(picturesWaitForTap() === false, 'tap mode is off');
assert(linkCardsOn() === true && profilePhotosOn() === true, 'the other switches start on');
assert(shouldHoldPicture(fresh) === false, 'a new picture is not held while data saving is off');
assert(posterLoadPlan(fresh) === 'show', 'default plan shows the picture');
assert(posterLoadPlan(cached, { cached: true }) === 'show', 'a cache hit shows the picture');
assert(!pictureMarkup(auto).includes('data-nt-defer-src'), 'automatic markup downloads the picture');
assert(pictureMarkup(auto).includes('<img'), 'automatic markup keeps the picture');

writeDataSaver({ pictures: 'tap', push: false });
assert(picturesWaitForTap() === true, 'Only when I tap waits');
assert(dataSaverSummary() === 'Pictures wait for a tap', 'summary names the picture choice');
assert(posterLoadPlan(fresh) === 'hold', 'an unseen picture waits for a tap');
assert(shouldHoldPicture(fresh) === true, 'shouldHoldPicture matches the plan');
assert(posterLoadPlan(cached, { cached: true }) === 'show', 'a cached picture is not held');
const held = pictureMarkup(fresh);
assert(held.includes('data-nt-defer-src'), 'tap markup does not download yet');
assert(held.includes('nt-picture-hold-ask hidden'), 'the download chip stays hidden until the cache check misses');
assert(!held.includes(`<img src="${fresh}"`), 'tap markup does not point an image at the full photo');
assert(held.includes(`data-nt-defer-src="${fresh}"`), 'the full address stays on the hold until a tap');
assert(held.includes('data-nt-preview-img'), 'tap markup can show a blurred preview');
assert(held.includes('data-nt-download-label'), 'tap markup has a place for the file size');
assert(formatDownloadSize(474112) === '463 kB', 'a byte count becomes kB');
assert(formatDownloadSize(2 * 1024 * 1024) === '2,0 MB', 'megabytes use a comma');
assert(formatDownloadSize(0) === '', 'a missing size stays blank');
const packed = imageMetaRow(fresh, { bytes: 474112, preview: 'data:image/jpeg;base64,aaaa' });
assert(packed && packed.key === imageMetaKey(fresh) && !packed.key.includes('.'), 'preview keys are safe for Firebase');
assert(imageMetaForUrl({ [packed.key]: packed.row }, fresh).bytes === 474112, 'a notice can look up its preview');
const pixels = new Uint8Array(16 * 16 * 4);
for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 180;
    pixels[i + 1] = 40;
    pixels[i + 2] = 40;
    pixels[i + 3] = 255;
}
const encoded = jpeg.encode({ data: pixels, width: 16, height: 16 }, 60);
const thumb = jpegThumbnail(encoded.data, 8, 40);
assert(thumb && thumb[0] === 0xff && thumb[1] === 0xd8 && thumb.length < encoded.data.length, 'a jpeg shrinks to a tiny preview');

rememberPicture(seen);
assert(pictureWasShown(seen) === true, 'a shown picture is remembered');
assert(posterLoadPlan(seen) === 'show', 'a picture already shown is not held');
assert(pictureMarkup(seen).includes('<img'), 'a remembered picture paints immediately');

writeDataSaver({ pictures: 'auto', linkCards: false, push: false });
assert(picturesWaitForTap() === false, 'automatic pictures do not wait');
assert(dataSaverSummary() === 'Link previews off', 'link previews can be the only change');
assert(posterLoadPlan(fresh) === 'show', 'turning pictures back to automatic shows them');

writeDataSaver({ linkCards: true, profilePhotos: false, push: false });
assert(dataSaverSummary() === 'Profile photos off', 'profile photos can be the only change');
assert(profilePhotosOn() === false, 'profile photos obey the switch');

writeDataSaver({ pictures: 'tap', linkCards: false, profilePhotos: false, push: false });
assert(dataSaverSummary() === 'Pictures wait for a tap', 'picture choice leads the summary');
assert(normalizeDataSaver(null).pictures === 'auto', 'a missing pref normalizes to off');
assert(normalizeDataSaver({ pictures: 'nope', linkCards: false }).pictures === 'auto', 'unknown picture mode stays automatic');
assert(normalizeDataSaver({ pictures: 'nope', linkCards: false }).linkCards === false, 'an explicit link card off is kept');

const channel = readFileSync(new URL('../src/lib/alerts-channel.js', import.meta.url), 'utf8');
const cacheCheck = channel.indexOf('resolveCachedAlertImage(originalSrc)');
const hold = channel.indexOf('else holdPosterForTap(host, startLoad)');
assert(cacheCheck > 0 && hold > cacheCheck, 'a poster checks the phone cache before the download chip');
assert(channel.includes("posterLoadPlan(originalSrc, { cached: !!cached }) === 'show'"), 'a cache hit loads the poster');
assert(channel.includes('ntPosterChecking'), 'a tap during the cache check does not open the full picture');
assert(channel.includes('settleHeldPicture'), 'a held poster asks for the blurred preview');
const worker = readFileSync(new URL('../workers/nexttrain-community/worker.js', import.meta.url), 'utf8');
assert(worker.includes("url.pathname === '/media/preview'"), 'the community worker serves a small preview');
assert(worker.includes("url.pathname === '/media/file'"), 'the community worker can hand a picture to the save button');
const admin = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
assert(admin.includes("tabBtn('timetables', 'Timetables')"), 'alert posters include a Timetables tab');
assert(admin.includes('openScheduleSheet'), 'a timetable row opens the image');
assert(!admin.includes('phelophepa_health_train'), 'the health poster is gone from the picker');
assert(!admin.includes('ger_leralla_ballast'), 'the ballast poster is gone from the picker');
assert(!admin.includes('2025-fare-adjustment'), 'the fare poster is gone from the picker');
const alertManifest = JSON.parse(readFileSync(new URL('../public/images/alerts/manifest.json', import.meta.url), 'utf8'));
assert(!alertManifest.posters.some((p) => /fare-adjustment|mass-meeting|leralla-ballast|phelophepa/.test(p.id)), 'retired posters left the catalogue');

const hub = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
assert(hub.includes('shouldHoldPicture(href)'), 'the notice keeps its picture when data saving is off');
assert(hub.includes('rememberPicture(href)'), 'a notice picture that loads is remembered');

const community = readFileSync(new URL('../src/lib/community.js', import.meta.url), 'utf8');
assert(community.includes('renderSharedMediaHtml'), 'community pictures use the alert poster, including the data-saver hold');
assert(!community.includes('pictureMarkup(url, { link: true })'), 'a community picture does not open the image host');
assert(community.includes('openLightbox(src, host)'), 'a community picture opens in the alert viewer');
assert(community.includes("host.setAttribute('data-alert-ready', '1')"), 'a shown community picture is allowed into full view');
assert(community.includes("imageUrls.length === 1 ? ' is-single'"), 'one picture fills the bubble');
assert(community.includes('profilePhotosOn()'), 'profile photos can stay off');
assert(community.includes('settleDeferredPictures(listEl)'), 'community checks the cache before showing a download');

const cards = readFileSync(new URL('../src/lib/link-preview.js', import.meta.url), 'utf8');
assert(cards.includes('if (!linkCardsOn()) return'), 'link cards off skips the card');
assert(cards.includes('shouldHoldPicture(card.image)'), 'a link card picture waits only in tap mode');

const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert(ui.includes('#account-data'), 'back treats Data saving as its own page');
assert(ui.includes('/media/file?u='), 'saving a cross-origin picture goes through the community worker');

const utils = readFileSync(new URL('../src/lib/utils.js', import.meta.url), 'utf8');
assert(utils.includes("'ntDataSaver'") && utils.includes("'ntDataSaverSeen'"), 'a volatile flush keeps the choice and the pictures already shown');

const page = readFileSync(new URL('../src/components/HubModals.astro', import.meta.url), 'utf8');
assert(page.includes('id="account-data-summary"') && page.includes('>Off<'), 'the row starts by saying Off');
assert(page.includes('The timetable always loads'), 'the page says the timetable still loads');

if (failed) {
    console.error(`${failed} data-saving check(s) failed`);
    process.exit(1);
}
console.log('data saving defaults off, and cached pictures stay visible');
