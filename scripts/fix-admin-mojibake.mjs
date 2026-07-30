/**
 * Repair UTF-8-as-Latin1 mojibake in public/js/admin.js
 * Run: node scripts/fix-admin-mojibake.mjs
 */
import fs from 'fs';

const path = new URL('../public/js/admin.js', import.meta.url);
let s = fs.readFileSync(path, 'utf8');
const original = s;

function tryDecodeLatin1Utf8(match) {
  try {
    const bytes = Buffer.from([...match].map((c) => c.charCodeAt(0) & 0xff));
    const out = bytes.toString('utf8');
    if (out.includes('\uFFFD')) return match;
    return out;
  } catch {
    return match;
  }
}

// Pass 1: decode any run that starts with a UTF-8 lead byte encoded as Latin-1
s = s.replace(/[\u00C2-\u00F4][\u0080-\u00FF\u0100-\u017F]+/g, (match) => {
  // Map extended Latin chars that often appear in mojibake back toward bytes when possible
  const normalized = [...match].map((ch) => {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) return String.fromCharCode(cp);
    // Common Windows-1252 / mojibake stand-ins
    const map = {
      0x0178: 0x9f, // Ÿ
      0x0160: 0x8a, // Š
      0x0161: 0x9a,
      0x017d: 0x8e,
      0x017e: 0x9e,
      0x0152: 0x8c,
      0x0153: 0x9c,
      0x0192: 0x83,
      0x02c6: 0x88,
      0x201a: 0x82,
      0x2030: 0x89,
    };
    if (map[cp] != null) return String.fromCharCode(map[cp]);
    return ch;
  }).join('');
  const decoded = tryDecodeLatin1Utf8(normalized);
  if (decoded !== normalized && decoded !== match) return decoded;
  return tryDecodeLatin1Utf8(match);
});

// Pass 2: explicit known broken literals still in file
const exact = [
  ['âš\u00a0ï¸', '⚠️'],
  ['âš ï¸', '⚠️'],
  ['âš\u00a0️', '⚠️'],
  ['âš️', '⚠️'],
  ['âš\u00a0', '⚠'],
  ['â›”', '⛔'],
  ['â­', '⭐'],
  ['â—€', '◀'],
  ['â–¶', '▶'],
  ['ðŸ’¬', '💬'],
  ['ðŸ“¢', '📢'],
  ['ðŸš§', '🚧'],
  ['ðŸ›‘', '🚫'],
  ['ðŸ”¥', '🔥'],
  ['ðŸš€', '🚀'],
  ['ðŸ“¥', '📥'],
  ['ðŸ“Š', '📊'],
  ['ðŸŒ', '🌍'],
  ['ðŸŽ‰', '🎉'],
  ['ðŸ”', '🔍'],
  ['ðŸ”„', '🔄'],
  ['ðŸ“‹', '📋'],
  ['ðŸ“ž', '📞'],
  ['ðŸ“Ž', '📎'],
  ['ðŸ“„', '📄'],
  ['ðŸ›', '🐛'],
  ['ðŸ’¡', '💡'],
  ['ðŸ”—', '🔗'],
  ['ðŸ©º', '🩺'],
  ['ðŸ› ï¸', '🛠️'],
  ['ðŸ›\u00a0ï¸', '🛠️'],
  ['ðŸ—ºï¸', '🗺️'],
  ['ðŸ—º️', '🗺️'],
  ['ðŸ›¡ï¸', '🛡️'],
  ['ðŸ›¡️', '🛡️'],
  ['ðŸ“', '📝'],
  ['ðŸ“ˆ', '📈'],
  ['ðŸ“­', '📡'],
  ['ðŸ”µ', '🔵'],
  ['ðŸ”´', '🔴'],
  ['ðŸ“¸', '📷'],
  ['ðŸ“°', '📰'],
  ['ðŸ“', '📍'],
  ['ðŸš‚', '🚂'],
  ['ðŸ“Œ', '📌'],
  ['ðŸ›️', '🛠️'],
  ['ðŸ›\uFE0F', '🛠️'],
];
for (const [bad, good] of exact) {
  if (s.includes(bad)) s = s.split(bad).join(good);
}

// Pass 3: curly-quote mojibake (U+201C/U+201D used instead of byte 0x93/0x94)
s = s.replace(/ðŸ[\u201C\u201D\u2018\u2019\u2022\u2026\u02DC\u2122][^\s<"']{0,3}/g, (match) => {
  const map = {
    'ðŸ“ˆ': '📈', 'ðŸ“­': '📡', 'ðŸ”µ': '🔵', 'ðŸ”´': '🔴',
    'ðŸ“¸': '📷', 'ðŸ“°': '📰', 'ðŸ“': '📍', 'ðŸš‚': '🚂',
    'ðŸ“Œ': '📌', 'ðŸ›️': '🛠️',
  };
  for (const [bad, good] of Object.entries(map)) {
    if (match.startsWith(bad) || match === bad) return good + match.slice(bad.length);
  }
  // Generic: map curly quotes back toward CP1252 bytes then decode
  const remapped = [...match].map((ch) => {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) return String.fromCharCode(cp);
    const cp1252 = { 0x201c: 0x93, 0x201d: 0x94, 0x2018: 0x91, 0x2019: 0x92, 0x2022: 0x95, 0x2026: 0x85, 0x02dc: 0x98, 0x2122: 0x99 };
    if (cp1252[cp] != null) return String.fromCharCode(cp1252[cp]);
    return ch;
  }).join('');
  return tryDecodeLatin1Utf8(remapped);
});

fs.writeFileSync(path, s, 'utf8');
console.log(JSON.stringify({
  changed: s !== original,
  leftover_df: (s.match(/ðŸ/g) || []).length,
  leftover_a: (s.match(/âš|â›|â­|â—|â–/g) || []).length,
  has_speech: s.includes('💬'),
  has_warn: s.includes('⚠️'),
  diag: (() => {
    const i = s.indexOf('Diagnostic Errors');
    return i < 0 ? null : s.slice(i - 60, i + 30);
  })(),
}, null, 2));
