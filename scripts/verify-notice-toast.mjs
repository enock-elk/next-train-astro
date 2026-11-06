/**
 * Official-notice toasts use the notice title and open that alert.
 * A raw channel URL is not the toast.
 */
import { readFileSync } from 'node:fs';
import { noticeToastCopy } from '../src/lib/notice-toast.js';

function fail(message) {
  console.error(`verify-notice-toast: ${message}`);
  process.exit(1);
}

const channel = 'https://whatsapp.com/channel/0029Vb5ueHpCsU9YpEsHJd0K';
const urlOnly = noticeToastCopy({ title: '', message: channel });
if (urlOnly !== 'New notice on your line') fail(`url-only notice became: ${urlOnly}`);
if (urlOnly.toLowerCase().includes('corridor')) fail('url-only notice still says corridor');

const titled = noticeToastCopy({
  title: 'Germiston connection',
  message: `Join the channel ${channel}`,
});
if (titled !== 'Germiston connection') fail(`title was not kept: ${titled}`);
if (/https?:/i.test(titled)) fail('toast still contains a url');

const bodyOnly = noticeToastCopy({
  message: `The Naledi departure has moved. Details: ${channel}`,
});
if (!bodyOnly.startsWith('The Naledi departure has moved.')) fail(`body was dropped: ${bodyOnly}`);
if (/https?:/i.test(bodyOnly)) fail('body toast still contains a url');

const critical = noticeToastCopy({ severity: 'critical', title: 'Park Station delay' });
if (critical !== 'Service alert. Park Station delay') fail(`critical copy: ${critical}`);

const notify = readFileSync(new URL('../src/lib/push-notify.js', import.meta.url), 'utf8');
if (notify.includes('Corridor notice')) fail('push-notify still titles toasts Corridor notice');
if (!notify.includes('noticeToastCopy')) fail('push-notify does not use noticeToastCopy');
if (!notify.includes('aboveModals: true')) fail('toast does not open the alert above the current sheet');
if (!notify.includes("actionLabel: typeof onClick === 'function' ? 'View' : ''")) {
  fail('tappable notice toast has no View action');
}

const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
if (!ui.includes('options.onClick')) fail('showToast has no onClick');
if (!ui.includes('nt-toast-action')) fail('showToast has no View button');

const alerts = readFileSync(new URL('../src/lib/alerts-channel.js', import.meta.url), 'utf8');
if (!alerts.includes('opts.aboveModals')) fail('alerts channel ignores aboveModals');
if (!alerts.includes("channelEl.style.zIndex = '260'")) fail('alerts opened from a toast stay under the sheet');

console.log('verify-notice-toast: ok');
