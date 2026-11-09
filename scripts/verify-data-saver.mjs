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
assert(!held.includes('<img'), 'tap markup has no image yet');

rememberPicture(seen);
assert(pictureWasShown(seen) === true, 'a shown picture is remembered');
assert(posterLoadPlan(seen) === 'show', 'a picture already shown is not held');
assert(pictureMarkup(seen).includes('<img'), 'a remembered picture paints immediately');

writeDataSaver({ pictures: 'auto', linkCards: false, push: false });
assert(picturesWaitForTap() === false, 'automatic pictures do not wait');
assert(dataSaverSummary() === 'Link cards off', 'link cards can be the only change');
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

const hub = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
assert(hub.includes('shouldHoldPicture(href)'), 'the notice keeps its picture when data saving is off');
assert(hub.includes('rememberPicture(href)'), 'a notice picture that loads is remembered');

const community = readFileSync(new URL('../src/lib/community.js', import.meta.url), 'utf8');
assert(community.includes('pictureMarkup(url, { link: true })'), 'community pictures use the same hold');
assert(community.includes('profilePhotosOn()'), 'profile photos can stay off');
assert(community.includes('settleDeferredPictures(listEl)'), 'community checks the cache before showing a download');

const cards = readFileSync(new URL('../src/lib/link-preview.js', import.meta.url), 'utf8');
assert(cards.includes('if (!linkCardsOn()) return'), 'link cards off skips the card');
assert(cards.includes('shouldHoldPicture(card.image)'), 'a link card picture waits only in tap mode');

const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert(ui.includes('#account-data'), 'back treats Data saving as its own page');

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
