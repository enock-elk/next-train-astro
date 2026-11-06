/**
 * Pull live regional timetable sheets before SEO SSG.
 * Prefer Cloudflare schedule cache, then Firebase RTDB.
 * Writes public/data/.seo-build-database.json (gitignored) for loadScheduleDump().
 *
 * Run: node scripts/fetch-live-schedules-for-seo.mjs
 * Env:
 *   SEO_REQUIRE_LIVE=1  — exit 1 if live fetch fails (CI / production builds)
 *   SEO_SKIP_LIVE=1     — skip fetch; keep using checked-in full-database.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', '.seo-build-database.json');

const REGION_FILES = {
  gauteng: 'schedules/gauteng.json',
  westerncape: 'schedules/westerncape.json',
  kzn: 'schedules/kzn.json',
  easterncape: 'schedules/easterncape.json',
};

const CF_BASE = 'https://nexttrain-cache.enock.workers.dev/';
const FB_BASE = 'https://metrorail-next-train-default-rtdb.firebaseio.com/';

const requireLive = process.env.SEO_REQUIRE_LIVE === '1'
  || process.env.CI === 'true'
  || process.env.GITHUB_ACTIONS === 'true';

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...headers,
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${url} ${body.slice(0, 120)}`);
  }
  return res.json();
}

async function fetchRegion(path) {
  const errors = [];
  try {
    return {
      source: 'cloudflare',
      data: await fetchJson(`${CF_BASE}${path}`, { Origin: 'https://nexttrain.co.za' }),
    };
  } catch (err) {
    errors.push(`CF: ${err.message}`);
  }
  try {
    return {
      source: 'firebase',
      data: await fetchJson(`${FB_BASE}${path}`),
    };
  } catch (err) {
    errors.push(`FB: ${err.message}`);
  }
  throw new Error(errors.join(' | '));
}

function sheetCount(node) {
  if (!node || typeof node !== 'object') return 0;
  return Object.keys(node).filter((k) => Array.isArray(node[k]) || Array.isArray(node[k]?.rows)).length;
}

async function main() {
  if (process.env.SEO_SKIP_LIVE === '1') {
    console.log('seo live schedules: skipped (SEO_SKIP_LIVE=1)');
    return;
  }

  const merged = {
    _seoLiveFetchedAt: new Date().toISOString(),
    _seoLiveSources: {},
  };

  try {
    for (const [nest, path] of Object.entries(REGION_FILES)) {
      const { source, data } = await fetchRegion(path);
      if (!data || typeof data !== 'object') {
        throw new Error(`${nest}: empty payload from ${source}`);
      }
      merged[nest] = data;
      merged._seoLiveSources[nest] = source;
      console.log(`seo live schedules: ${nest} from ${source} (${sheetCount(data)} sheet arrays)`);
    }
  } catch (err) {
    console.error(`seo live schedules: FAILED — ${err.message}`);
    if (requireLive) {
      process.exit(1);
    }
    console.warn('seo live schedules: continuing with checked-in public/data/full-database.json');
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(merged), 'utf8');
  console.log(`seo live schedules: wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
