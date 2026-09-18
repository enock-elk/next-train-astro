/**
 * Capture weekday 10:00 Next Train tab screenshots for every SEO route landing.
 *
 *   node scripts/capture-seo-app-previews.mjs
 *   node scripts/capture-seo-app-previews.mjs --origin http://127.0.0.1:4321 --only pta-pien
 *
 * Serves dist/ unless --origin is set. Writes public/images/seo/{routeId}-live-board.webp
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { listSeoAppPreviews, SEO_PREVIEW_IMAGE_HEIGHT, SEO_PREVIEW_IMAGE_WIDTH, SEO_PREVIEW_SIM_DAY_INDEX, SEO_PREVIEW_SIM_TIME, seoPreviewImageAbsPath } from '../src/lib/seo-app-previews.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const CHROME = process.env.CHROME_PATH
    || ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome']
        .find((path) => existsSync(path));

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
};

function parseArgs(argv) {
    const out = { origin: '', only: '', port: 4179 };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--origin') out.origin = argv[++i] || '';
        else if (arg === '--only') out.only = argv[++i] || '';
        else if (arg === '--port') out.port = Number(argv[++i]) || out.port;
    }
    return out;
}

function startStaticServer(dir, port) {
    const server = createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        let filePath = join(dir, decodeURIComponent(url.pathname));
        if (url.pathname === '/' || url.pathname.endsWith('/')) filePath = join(dir, 'index.html');
        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
            const html = join(dir, 'index.html');
            if (existsSync(html) && !url.pathname.includes('.')) filePath = html;
        }
        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
            res.writeHead(404);
            res.end('not found');
            return;
        }
        const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(readFileSync(filePath));
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

async function ensureDist() {
    if (existsSync(join(DIST, 'index.html'))) return;
    console.log('Building dist/ …');
    await new Promise((resolve, reject) => {
        const child = spawn('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', env: process.env });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
    });
}

async function prepBoard(page, stationRaw) {
    await page.evaluate(async ({ stationRaw, simTime, simDay }) => {
        const hide = (sel) => {
            document.querySelectorAll(sel).forEach((el) => {
                el.style.setProperty('display', 'none', 'important');
                el.setAttribute('aria-hidden', 'true');
            });
        };
        hide('#welcome-modal, #toast, #offline-toast, #offline-wrapper, #nt-recovery-lifeline, #clever-core, #nt-ad-scroll-host, #developer-reply-banner, #delay-report-banner, iframe, #app-header');
        document.getElementById('welcome-modal')?.classList.add('hidden');
        document.getElementById('toast')?.classList.remove('show');

        try { window.applyAdminAuthedChrome?.(true); } catch { /* ignore */ }
        document.documentElement.setAttribute('data-admin-authed', '1');
        document.querySelectorAll('[data-admin-authed-only]').forEach((el) => {
            el.hidden = false;
            el.removeAttribute('inert');
            el.classList.remove('hidden');
            el.setAttribute('aria-hidden', 'false');
        });

        const install = document.getElementById('install-app-btn');
        if (install) {
            install.classList.remove('hidden');
            install.style.display = 'flex';
        }

        window.__ntSimUseSpecificDate = false;
        window.__ntLastSimKey = null;
        window.__ntSimDayIndex = simDay;
        window.simDayIndex = simDay;
        window.simTimeStr = simTime;
        window.isSimMode = true;
        const dateInput = document.getElementById('sim-date');
        if (dateInput) dateInput.value = '';
        try { window.updateTime?.(); } catch { /* ignore */ }

        const select = document.getElementById('station-select');
        const input = document.getElementById('station-search-input');
        if (!select) {
            throw new Error(`station-select missing (${location.pathname} ids=${[...document.querySelectorAll('[id]')].slice(0, 12).map((el) => el.id).join(',')})`);
        }
        const norm = (s) => String(s || '').replace(/\s+STATION$/i, '').replace(/\s+/g, ' ').trim().toUpperCase();
        const want = norm(stationRaw);
        const options = [...select.options].map((opt) => opt.value).filter(Boolean);
        const hit = options.find((value) => norm(value) === want)
            || options.find((value) => norm(value).includes(want) || want.includes(norm(value)));
        if (!hit) throw new Error(`station ${stationRaw} not in ${options.join(' | ')}`);
        select.value = hit;
        if (input) {
            input.value = hit.replace(/ STATION/g, '');
            input.dataset.resolvedValue = hit;
        }
        select.dispatchEvent(new Event('change', { bubbles: true }));
        try { window.updateTime?.(); } catch { /* ignore */ }
        try { window.findNextTrains?.(); } catch { /* ignore */ }
        try { window.updateNextTrainView?.(); } catch { /* ignore */ }

        const main = document.getElementById('main-content');
        if (main) main.style.visibility = 'visible';
        document.getElementById('bottom-nav')?.classList.remove('hidden');
        document.documentElement.classList.add('nt-in-app');
        document.documentElement.classList.remove('nt-onboarding');
        document.body?.classList.add('nav-bottom');
    }, { stationRaw, simTime: SEO_PREVIEW_SIM_TIME, simDay: SEO_PREVIEW_SIM_DAY_INDEX });
}

async function waitForBoard(page) {
    await page.waitForFunction(() => {
        const select = document.getElementById('station-select');
        const a = document.getElementById('pretoria-time');
        const b = document.getElementById('pienaarspoort-time');
        if (!select || select.options.length < 2) return false;
        const text = `${a?.innerText || ''} ${b?.innerText || ''}`;
        if (!text.trim()) return false;
        if (/Select station/i.test(text) && !/\d{1,2}:\d{2}/.test(text)) return false;
        return true;
    }, { timeout: 45000 });
}

async function captureOne(page, origin, preview) {
    const url = `${origin}/?rt=${encodeURIComponent(preview.routeId)}&r=${encodeURIComponent(preview.region || '')}`;
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#station-select', { timeout: 45000 });
    await page.waitForFunction(() => typeof window.findNextTrains === 'function', { timeout: 45000 });
    await page.waitForFunction(() => {
        const select = document.getElementById('station-select');
        return !!(select && select.options.length > 2);
    }, { timeout: 45000 });

    await prepBoard(page, preview.stationRaw);
    await waitForBoard(page);
    await new Promise((r) => setTimeout(r, 400));
    await prepBoard(page, preview.stationRaw);
    await new Promise((r) => setTimeout(r, 250));

    const clip = await page.evaluate(() => {
        const main = document.getElementById('main-content');
        const pill = document.getElementById('route-selector-pill');
        const nav = document.getElementById('bottom-nav');
        if (!main || !pill || !nav) throw new Error('clip targets missing');
        const m = main.getBoundingClientRect();
        const p = pill.getBoundingClientRect();
        const n = nav.getBoundingClientRect();
        const top = Math.max(0, p.top - 10);
        const bottom = Math.min(window.innerHeight, n.bottom + 6);
        return {
            x: Math.max(0, m.left),
            y: top,
            width: m.width,
            height: Math.max(200, bottom - top),
        };
    });
    const png = await page.screenshot({ type: 'png', clip, captureBeyondViewport: true });
    const out = seoPreviewImageAbsPath(preview.routeId, ROOT);
    mkdirSync(dirname(out), { recursive: true });
    await sharp(png)
        .resize(SEO_PREVIEW_IMAGE_WIDTH, SEO_PREVIEW_IMAGE_HEIGHT, {
            fit: 'contain',
            background: { r: 243, g: 244, b: 246, alpha: 1 },
        })
        .webp({ quality: 82 })
        .toFile(out);
    return out;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!CHROME) throw new Error('Chrome not found');
    let previews = listSeoAppPreviews();
    if (args.only) {
        previews = previews.filter((item) => item.routeId === args.only || item.slug === args.only);
        if (!previews.length) throw new Error(`no preview for ${args.only}`);
    }

    let server = null;
    let origin = args.origin.replace(/\/$/, '');
    if (!origin) {
        await ensureDist();
        server = await startStaticServer(DIST, args.port);
        origin = `http://127.0.0.1:${args.port}`;
    }

    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--hide-scrollbars',
            '--window-size=390,844',
            '--user-data-dir=/tmp/seo-preview-chrome',
        ],
        defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
    });

    const failures = [];
    try {
        for (const preview of previews) {
            process.stdout.write(`${preview.routeId} (${preview.station}) … `);
            const page = await browser.newPage();
            try {
                await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
                page.setDefaultTimeout(45000);
                await page.evaluateOnNewDocument((region, routeId) => {
                    try {
                        localStorage.setItem('welcomeSeen', 'true');
                        localStorage.setItem('theme', 'light');
                        localStorage.setItem('colourPack', 'classic');
                        localStorage.setItem('userRegion', region);
                        localStorage.setItem(`defaultRoute_${region}`, routeId);
                        localStorage.setItem('ntClassicDefaultV1', '1');
                        localStorage.setItem('ntProdClassicPackV1', '1');
                        localStorage.setItem('activeTab', 'next-train');
                        sessionStorage.setItem('dev_force_source', 'GITHUB');
                    } catch { /* ignore */ }
                }, preview.region, preview.routeId);
                const out = await captureOne(page, origin, preview);
                const kb = Math.round(statSync(out).size / 1024);
                console.log(`${kb} KB`);
            } catch (err) {
                console.log('FAIL');
                console.error(`  ${err?.message || err}`);
                failures.push(`${preview.routeId}: ${err?.message || err}`);
            } finally {
                await page.close().catch(() => {});
            }
        }
    } finally {
        await browser.close();
        if (server) await new Promise((resolve) => server.close(resolve));
    }

    if (failures.length) {
        console.error(`\n${failures.length} capture(s) failed:\n${failures.join('\n')}`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
