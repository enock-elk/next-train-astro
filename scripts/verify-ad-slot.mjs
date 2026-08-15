/**
 * Guards the bottom ad slot: empty hosts must not count as filled
 * (that reserved 100px and stole footer taps).
 */
import assert from 'node:assert/strict';
import { AD_LOADER_ID, isAdSlotFilled } from '../src/lib/ad-slot.js';

function el(tag, extras = {}) {
    const children = extras.children || [];
    const node = {
        tagName: tag.toUpperCase(),
        id: extras.id || '',
        offsetHeight: extras.offsetHeight ?? 0,
        children,
        getBoundingClientRect: () => ({ height: extras.height ?? extras.offsetHeight ?? 0 }),
        querySelector(sel) {
            if (sel === 'iframe') {
                if (tag.toUpperCase() === 'IFRAME') return node;
                return children.find((c) => c.tagName === 'IFRAME') || null;
            }
            return null;
        },
    };
    return node;
}

assert.equal(isAdSlotFilled(null), false, 'null is empty');
assert.equal(isAdSlotFilled(el('div')), false, 'no children is empty');

const scriptOnly = el('div', {
    offsetHeight: 100,
    children: [el('script', { id: AD_LOADER_ID, offsetHeight: 0 })],
});
assert.equal(isAdSlotFilled(scriptOnly), false, 'loader script + reserved height is not filled');

const tallEmpty = el('div', { offsetHeight: 100, children: [] });
assert.equal(isAdSlotFilled(tallEmpty), false, 'min-height host with no kids is not filled');

const iframe = el('iframe', { height: 90, offsetHeight: 90 });
const filled = el('div', { offsetHeight: 100, children: [iframe] });
assert.equal(isAdSlotFilled(filled), true, 'iframe > 20px is filled');

const tinyIframe = el('iframe', { height: 10, offsetHeight: 10 });
const tiny = el('div', { offsetHeight: 100, children: [tinyIframe] });
assert.equal(isAdSlotFilled(tiny), false, 'tiny iframe is not filled');

const creative = el('div', { height: 50, offsetHeight: 50 });
const wrap = el('div', { offsetHeight: 100, children: [creative] });
assert.equal(isAdSlotFilled(wrap), true, 'non-script child with height is filled');

console.log('verify-ad-slot: ok');
