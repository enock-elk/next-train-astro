/**
 * Repair UTF-8-as-Latin1 mojibake across src/ and public/js/
 * Run: node scripts/fix-mojibake-src.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const roots = [path.join(root, 'src'), path.join(root, 'public', 'js')];

const exact = [
  ['â€”', '—'],
  ['â€"', '—'],
  ['â€“', '–'],
  ['â€¢', '•'],
  ['â€¦', '…'],
  ['â€™', '\u2019'],
  ['â€˜', '\u2018'],
  ['â€œ', '\u201C'],
  ['â˜¢️', '☢️'],
  ['â˜¢\uFE0F', '☢️'],
  ['â˜¢', '☢'],
  ['âš\u00a0ï¸', '⚠️'],
  ['âš ï¸', '⚠️'],
  ['âš\u00a0️', '⚠️'],
  ['âš\u00a0', '⚠'],
  ['â†”', '↔'],
  ['ðŸ“…', '📅'],
  ['ðŸ›¡ï¸', '🛡️'],
  ['ðŸ›\uFE0F', '🛡️'],
  ['ðŸ’¬', '💬'],
  ['ðŸš€', '🚀'],
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      walk(p, out);
    } else if (/\.(js|mjs|astro|css|html|md)$/i.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = roots.flatMap((r) => walk(r));
const report = [];

for (const file of files) {
  // Never rewrite utils.js — it holds escaped mojibake lookup keys for runtime repair
  if (file.endsWith(`${path.sep}utils.js`)) continue;
  let s = fs.readFileSync(file, 'utf8');
  const original = s;
  for (const [bad, good] of exact) {
    if (s.includes(bad)) s = s.split(bad).join(good);
  }
  if (s !== original) {
    fs.writeFileSync(file, s, 'utf8');
    report.push(path.relative(root, file));
  }
}

console.log(JSON.stringify({ changed: report.length, files: report }, null, 2));
