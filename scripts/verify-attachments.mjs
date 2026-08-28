/**
 * Magic-byte sniffing, display-URL allowlist, lightbox onclick sanitizer,
 * and wiring for fare-sheet / planner zoom / uploads.
 * Run: node scripts/verify-attachments.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    sniffAttachmentBytes,
    sniffAttachmentFile,
    sanitizeAttachmentDisplayUrl,
    classifyAttachmentUrl,
    isSafeLightboxOnclick,
    lightboxOnclickJs,
    attachmentPreviewHtml,
    ATTACHMENT_MAX_BYTES,
} from '../src/lib/attachments.js';
import { sanitizeInlineAlertImageUrl } from '../src/lib/alerts-feed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

function bytes(...vals) {
    return new Uint8Array(vals);
}

{
    assert(sniffAttachmentBytes(bytes(0xFF, 0xD8, 0xFF, 0xE0))?.ext === 'jpg', 'jpeg magic');
    assert(sniffAttachmentBytes(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))?.ext === 'png', 'png magic');
    const gif = new TextEncoder().encode('GIF89a');
    assert(sniffAttachmentBytes(gif)?.ext === 'gif', 'gif magic');
    const webp = new Uint8Array(12);
    webp.set(new TextEncoder().encode('RIFF'), 0);
    webp.set(new TextEncoder().encode('WEBP'), 8);
    assert(sniffAttachmentBytes(webp)?.ext === 'webp', 'webp magic');
    assert(sniffAttachmentBytes(new TextEncoder().encode('%PDF-1.4'))?.ext === 'pdf', 'pdf magic');
}

{
    const htmlJpg = new TextEncoder().encode('<!DOCTYPE html><html><script>alert(1)</script>');
    assert(sniffAttachmentBytes(htmlJpg) === null, 'HTML pretending to be a file is rejected');
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    assert(sniffAttachmentBytes(svg) === null, 'SVG is rejected');
    const exe = bytes(0x4D, 0x5A, 0x90, 0x00);
    assert(sniffAttachmentBytes(exe) === null, 'EXE MZ header is rejected');
    assert(sniffAttachmentBytes(bytes(1, 2, 3)) === null, 'tiny buffer rejected');
}

{
    class FakeFile {
        constructor(u8, name, type) {
            this.size = u8.length;
            this.name = name;
            this.type = type;
            this._bytes = u8;
        }
        slice(start, end) {
            const part = this._bytes.slice(start, end);
            return {
                arrayBuffer: async () => {
                    const copy = new Uint8Array(part);
                    return copy.buffer;
                },
            };
        }
    }
    const jpegNamedHtml = new FakeFile(bytes(0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10), 'photo.html', 'text/html');
    const htmlNamedJpeg = new FakeFile(new TextEncoder().encode('<!DOCTYPE html>aaaa'), 'photo.jpg', 'image/jpeg');
    const tooBig = new FakeFile(bytes(0xFF, 0xD8, 0xFF), 'x.jpg', 'image/jpeg');
    tooBig.size = ATTACHMENT_MAX_BYTES + 1;
    globalThis.__ntAttachPending = [
        sniffAttachmentFile(jpegNamedHtml).then((r) => {
            assert(r?.ext === 'jpg' && r?.mime === 'image/jpeg', 'name/type ignored; jpeg bytes win');
        }),
        sniffAttachmentFile(htmlNamedJpeg).then((r) => {
            assert(r === null, 'HTML bytes with .jpg name rejected');
        }),
        sniffAttachmentFile(tooBig).then((r) => {
            assert(r === null, 'oversize file rejected');
        }),
    ];
}

{
    const firebase = 'https://firebasestorage.googleapis.com/v0/b/app/o/feedback_attachments%2Fx.jpg?alt=media&token=abc';
    assert(sanitizeAttachmentDisplayUrl(firebase) === firebase, 'firebase download URL allowed');
    assert(classifyAttachmentUrl(firebase) === 'image', 'firebase jpg classified as image');
    assert(sanitizeAttachmentDisplayUrl('https://evil.example/x.jpg') === null, 'foreign https blocked');
    assert(sanitizeAttachmentDisplayUrl('javascript:alert(1)') === null, 'javascript: blocked');
    assert(sanitizeAttachmentDisplayUrl('data:text/html;base64,PHNjcmlwdD4=') === null, 'data: blocked');
    assert(sanitizeAttachmentDisplayUrl('http://firebasestorage.googleapis.com/v0/b/app/o/x.jpg') === null, 'http storage blocked');
    assert(sanitizeAttachmentDisplayUrl('/images/alerts/fare.png')?.endsWith('/images/alerts/fare.png'), 'catalog poster allowed');
    assert(sanitizeAttachmentDisplayUrl('/images/network-map.png') === null, 'non-alerts image blocked');
    assert(sanitizeAttachmentDisplayUrl('https://user:pass@firebasestorage.googleapis.com/v0/b/app/o/x.jpg') === null, 'userinfo blocked');
    assert(sanitizeInlineAlertImageUrl(firebase) === firebase, 'inline sanitizer still allows firebase');
}

{
    const firebase = 'https://firebasestorage.googleapis.com/v0/b/app/o/x.jpg';
    const js = lightboxOnclickJs(firebase);
    assert(js === `window.openLightbox(${JSON.stringify(firebase)})`, `onclick js ${js}`);
    assert(isSafeLightboxOnclick(js), 'generated onclick is safe');
    assert(isSafeLightboxOnclick(`event.stopPropagation(); ${js}`), 'stopPropagation prefix is safe');
    assert(isSafeLightboxOnclick(`Admin.openLightbox(${JSON.stringify(firebase)})`), 'Admin.openLightbox is safe');
    assert(!isSafeLightboxOnclick(`window.openLightbox(${JSON.stringify('https://evil.example/x.jpg')})`), 'foreign onclick rejected');
    assert(!isSafeLightboxOnclick("window.openLightbox('javascript:alert(1)')"), 'javascript onclick rejected');
    assert(!isSafeLightboxOnclick('window.openLightbox(alert(1))'), 'bare-call onclick rejected');
    assert(!isSafeLightboxOnclick(`window.openLightbox(${JSON.stringify(firebase)}); alert(1)`), 'trailing statements rejected');
    const html = attachmentPreviewHtml(firebase, { admin: true });
    assert(html.includes('Admin.openLightbox') && html.includes('firebasestorage.googleapis.com'), 'admin preview uses Admin lightbox');
    assert(!attachmentPreviewHtml('https://evil.example/x.jpg'), 'evil preview is empty');
}

{
    const planner = readFileSync(join(ROOT, 'src/lib/planner-ui.js'), 'utf8');
    assert(planner.includes('openPlannerFareModal'), 'train sheet fare has a dedicated opener');
    assert(planner.includes('openFareModalForRoute'), 'train sheet fare calls openFareModalForRoute');
    assert(planner.includes('lockPlannerInputZoom'), 'planner zoom lock exists');
    assert(planner.includes('bindPlannerInputZoomGuard'), 'planner inputs bind zoom guard');
    assert(planner.includes("window.matchMedia('(pointer: coarse)')"), 'coarse pointer skips select()');
    const liveUi = readFileSync(join(ROOT, 'src/lib/live-board-ui.js'), 'utf8');
    assert(liveUi.includes('export function openFareModalForRoute'), 'openFareModalForRoute is exported');
    assert(liveUi.includes('window.openFareModalForRoute = openFareModalForRoute'), 'openFareModalForRoute is on window');
    const hub = readFileSync(join(ROOT, 'src/lib/hub.js'), 'utf8');
    assert(hub.includes('sniffAttachmentFile'), 'commuter upload sniffs bytes');
    assert(hub.includes('contentType: kind.mime'), 'commuter upload stores sniffed content-type');
    const admin = readFileSync(join(ROOT, 'public/js/admin.js'), 'utf8');
    assert(admin.includes('prepareSafeUpload'), 'admin upload sniffs via prepareSafeUpload');
    assert(!admin.includes("file.name.split('.').pop()"), 'admin no longer trusts file extension');
    assert(admin.includes('sanitizeAttachmentDisplayUrl'), 'admin lightbox allowlists URLs');
    const rich = readFileSync(join(ROOT, 'src/lib/rich-text.js'), 'utf8');
    assert(rich.includes('isSafeLightboxOnclick'), 'rich-text onclick uses allowlist');
    assert(rich.includes('sanitizeAttachmentDisplayUrl'), 'rich-text img src uses allowlist');
    const ui = readFileSync(join(ROOT, 'src/lib/ui.js'), 'utf8');
    assert(ui.includes('sanitizeAttachmentDisplayUrl(url)'), 'commuter lightbox allowlists URLs');
}

await Promise.all(globalThis.__ntAttachPending || []);

if (failures.length) {
    console.error('verify-attachments failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-attachments: ok');
