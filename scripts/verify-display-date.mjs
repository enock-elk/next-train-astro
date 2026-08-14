/**
 * Display dates must be "13 Aug 2026", never locale numeric 8/13/2026.
 * Run: node scripts/verify-display-date.mjs
 */
import { formatDisplayDate, formatDisplayDateTime } from '../src/lib/utils.js';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

const d = new Date(2026, 7, 13, 15, 45, 0); // 13 Aug 2026 15:45
assert(formatDisplayDate(d) === '13 Aug 2026', `date got ${formatDisplayDate(d)}`);
assert(formatDisplayDateTime(d) === '13 Aug 2026, 3:45 PM', `datetime got ${formatDisplayDateTime(d)}`);
assert(!formatDisplayDate(d).includes('/'), 'no slashes in display date');
assert(formatDisplayDate(null) === '', 'null date empty');
assert(formatDisplayDate('not-a-date') === '', 'invalid date empty');

if (failures.length) {
    console.error('verify-display-date failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-display-date: ok');
