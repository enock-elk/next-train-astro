/**
 * Regenerate src/catalog.json from the app ROUTES table.
 * Run from repo root: node workers/nexttrain-og/scripts/gen-catalog.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const configPath = path.join(root, 'src/lib/config.js');
// Windows needs file:// URLs for dynamic import (bare C:\… is not a valid ESM scheme).
const mod = await import(pathToFileURL(configPath).href);
const catalog = {};
for (const [id, r] of Object.entries(mod.ROUTES || {})) {
  if (!r || !r.isActive || id === 'special_event') continue;
  catalog[id] = {
    id,
    region: r.region || 'GP',
    destA: String(r.destA || '').replace(/\s+STATION$/i, '').trim(),
    destB: String(r.destB || '').replace(/\s+STATION$/i, '').trim(),
    sheetKeys: r.sheetKeys || null,
  };
}
const out = path.join(__dirname, '../src/catalog.json');
fs.writeFileSync(out, JSON.stringify(catalog));
console.log(`Wrote ${Object.keys(catalog).length} routes → ${out}`);
