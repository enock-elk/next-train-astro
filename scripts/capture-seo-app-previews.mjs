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
import {
    getSeoPlannerPreview,
    listSeoAppPreviews,
    SEO_PREVIEW_IMAGE_HEIGHT,
    SEO_PREVIEW_IMAGE_WIDTH,
    SEO_PREVIEW_SIM_DAY_INDEX,
    SEO_PREVIEW_SIM_TIME,
    seoPreviewImageAbsPath,
    seoPlannerPreviewImageAbsPath,
} from '../src/lib/seo-app-previews.js';

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

async function prepPlannerChrome(page) {
    await page.evaluate(() => {
        const hide = (sel) => {
            document.querySelectorAll(sel).forEach((el) => {
                el.style.setProperty('display', 'none', 'important');
                el.setAttribute('aria-hidden', 'true');
            });
        };
        hide('#welcome-modal, #toast, #offline-toast, #offline-wrapper, #nt-recovery-lifeline, #clever-core, #nt-ad-scroll-host, #developer-reply-banner, #delay-report-banner, iframe, #app-header');
        document.getElementById('welcome-modal')?.classList.add('hidden');
        document.getElementById('toast')?.classList.remove('show');
        const install = document.getElementById('install-app-btn-planner') || document.getElementById('install-app-btn');
        if (install) {
            install.classList.remove('hidden');
            install.style.display = 'flex';
        }
        const main = document.getElementById('main-content');
        if (main) main.style.visibility = 'visible';
        document.getElementById('bottom-nav')?.classList.remove('hidden');
        document.documentElement.classList.add('nt-in-app');
        document.documentElement.classList.remove('nt-onboarding');
        document.body?.classList.add('nav-bottom');
    });
}

async function capturePlanner(page, origin, preview) {
    const url = `${origin}/?plan=${encodeURIComponent(`${preview.from}~${preview.to}`)}&r=${encodeURIComponent(preview.region)}&t=${encodeURIComponent(preview.time)}&d=wd`;
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(({ simTime, simDay }) => {
        window.__ntSimUseSpecificDate = false;
        window.__ntLastSimKey = null;
        window.__ntSimDayIndex = simDay;
        window.simDayIndex = simDay;
        window.simTimeStr = simTime;
        window.isSimMode = true;
        const dateInput = document.getElementById('sim-date');
        if (dateInput) dateInput.value = '';
        try { window.updateTime?.(); } catch { /* ignore */ }
    }, { simTime: SEO_PREVIEW_SIM_TIME, simDay: SEO_PREVIEW_SIM_DAY_INDEX });
    await page.waitForFunction(() => Array.isArray(window.MASTER_STATION_LIST) && window.MASTER_STATION_LIST.length > 10, { timeout: 90000 });
    await new Promise((r) => setTimeout(r, 16000));
    await page.evaluate(({ fromName, toName }) => {
        const section = document.getElementById('planner-results-section');
        const already = section && !section.classList.contains('hidden')
            && /Journey Timeline|View Trip Plan on Map/.test(document.getElementById('planner-results-list')?.innerText || '');
        if (already) return;
        const norm = (s) => String(s || '').replace(/\s+STATION$/i, '').replace(/\s+/g, ' ').trim().toUpperCase();
        const list = window.MASTER_STATION_LIST || [];
        const pick = (want) => list.find((value) => norm(value) === want)
            || list.find((value) => norm(value).includes(want) || want.includes(norm(value)));
        const fromHit = pick(norm(fromName));
        const toHit = pick(norm(toName));
        if (!fromHit || !toHit) throw new Error(`planner stations missing (${fromName} / ${toName})`);
        const fromSelect = document.getElementById('planner-from');
        const toSelect = document.getElementById('planner-to');
        if (fromSelect) {
            if (![...fromSelect.options].some((opt) => opt.value === fromHit)) {
                fromSelect.appendChild(new Option(fromHit, fromHit));
            }
            fromSelect.value = fromHit;
        }
        if (toSelect) {
            if (![...toSelect.options].some((opt) => opt.value === toHit)) {
                toSelect.appendChild(new Option(toHit, toHit));
            }
            toSelect.value = toHit;
        }
        const fromInput = document.getElementById('planner-from-search');
        const toInput = document.getElementById('planner-to-search');
        if (fromInput) {
            fromInput.value = fromHit.replace(/ STATION/g, '');
            fromInput.dataset.resolvedValue = fromHit;
        }
        if (toInput) {
            toInput.value = toHit.replace(/ STATION/g, '');
            toInput.dataset.resolvedValue = toHit;
        }
        document.getElementById('planner-search-btn')?.click();
        try { history.replaceState({ view: 'planner-results' }, '', '#planner-results'); } catch { /* ignore */ }
    }, { fromName: preview.from, toName: preview.to });
    await page.waitForFunction(() => {
        const section = document.getElementById('planner-results-section');
        const list = document.getElementById('planner-results-list');
        if (!section || !list || section.classList.contains('hidden')) return false;
        const text = list.innerText || '';
        if (/Searching all possible|Evaluating alternative|Schedules still loading|Checking live line/i.test(text)) return false;
        if (list.querySelector('#planner-spinner-text')) return false;
        return /Journey Timeline|View Trip Plan on Map|All Trains Departed|See Next Available Day/i.test(text);
    }, { timeout: 90000 });
    await page.evaluate(({ simTime, simDay }) => {
        window.__ntSimUseSpecificDate = false;
        window.__ntLastSimKey = null;
        window.__ntSimDayIndex = simDay;
        window.simDayIndex = simDay;
        window.simTimeStr = simTime;
        window.isSimMode = true;
        const dateInput = document.getElementById('sim-date');
        if (dateInput) dateInput.value = '';
        try { window.updateTime?.(); } catch { /* ignore */ }
        const items = [...document.querySelectorAll('#custom-time-list li')];
        const target = 10 * 3600;
        let best = 0;
        let bestDist = Infinity;
        items.forEach((li, idx) => {
            const m = String(li.textContent || '').match(/(\d{1,2}):(\d{2})/);
            if (!m) return;
            const sec = (Number(m[1]) * 3600) + (Number(m[2]) * 60);
            const dist = Math.abs(sec - target);
            if (dist < bestDist) {
                bestDist = dist;
                best = idx;
            }
        });
        const nextDay = document.querySelector('.planner-next-day-cta');
        if (nextDay) nextDay.click();
        else try { window._selectCustomTrip?.(best); } catch { /* ignore */ }
    }, { simTime: SEO_PREVIEW_SIM_TIME, simDay: SEO_PREVIEW_SIM_DAY_INDEX });
    await page.waitForFunction(() => /Journey Timeline|View Trip Plan on Map/i.test(document.getElementById('planner-results-list')?.innerText || ''), { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => [...document.querySelectorAll('#custom-time-list li')].some((li) => /^\s*10:\d{2}/.test(li.textContent || '')), { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => {
        const items = [...document.querySelectorAll('#custom-time-list li')];
        const midday = items.findIndex((li) => /^\s*10:\d{2}/.test(li.textContent || ''));
        const target = 10 * 3600;
        let best = midday >= 0 ? midday : 0;
        let bestDist = Infinity;
        if (midday < 0) {
            items.forEach((li, idx) => {
                const m = String(li.textContent || '').match(/(\d{1,2}):(\d{2})/);
                if (!m) return;
                const sec = (Number(m[1]) * 3600) + (Number(m[2]) * 60);
                const dist = Math.abs(sec - target);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = idx;
                }
            });
        }
        try { window._selectCustomTrip?.(best); } catch { /* ignore */ }
    });
    await new Promise((r) => setTimeout(r, 400));
    await prepPlannerChrome(page);
    await new Promise((r) => setTimeout(r, 400));
    await prepPlannerChrome(page);

    const clip = await page.evaluate(() => {
        const main = document.getElementById('main-content') || document.getElementById('planner-results-section');
        const nav = document.getElementById('bottom-nav');
        if (!main) throw new Error('planner clip target missing');
        const m = main.getBoundingClientRect();
        const n = nav ? nav.getBoundingClientRect() : { bottom: window.innerHeight };
        const top = Math.max(0, m.top);
        const bottom = Math.min(window.innerHeight, n.bottom + 6);
        return {
            x: Math.max(0, m.left),
            y: top,
            width: m.width || window.innerWidth,
            height: Math.max(200, bottom - top),
        };
    });
    const png = await page.screenshot({ type: 'png', clip, captureBeyondViewport: true });
    const out = seoPlannerPreviewImageAbsPath(ROOT);
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
    const plannerPreview = getSeoPlannerPreview();
    let capturePlannerShot = !args.only || args.only === plannerPreview.id || args.only === 'planner';
    if (args.only) {
        previews = previews.filter((item) => item.routeId === args.only || item.slug === args.only);
        if (!previews.length && !capturePlannerShot) throw new Error(`no preview for ${args.only}`);
        if (args.only !== plannerPreview.id && args.only !== 'planner') capturePlannerShot = false;
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
            `--user-data-dir=/tmp/seo-preview-chrome-${Date.now()}`,
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
        if (capturePlannerShot) {
            process.stdout.write(`${plannerPreview.id} (trip plan) … `);
            const page = await browser.newPage();
            try {
                await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
                page.setDefaultTimeout(90000);
                await page.evaluateOnNewDocument((region, simTime, simDay) => {
                    try {
                        localStorage.setItem('welcomeSeen', 'true');
                        localStorage.setItem('theme', 'light');
                        localStorage.setItem('colourPack', 'classic');
                        localStorage.setItem('userRegion', region);
                        localStorage.setItem(`defaultRoute_${region}`, 'pta-pien');
                        localStorage.setItem('ntClassicDefaultV1', '1');
                        localStorage.setItem('ntProdClassicPackV1', '1');
                        localStorage.setItem('activeTab', 'trip-planner');
                    } catch { /* ignore */ }
                    window.simTimeStr = simTime;
                    window.isSimMode = true;
                    window.simDayIndex = simDay;
                    window.__ntSimDayIndex = simDay;
                    window.__ntSimUseSpecificDate = false;
                }, plannerPreview.region, SEO_PREVIEW_SIM_TIME, SEO_PREVIEW_SIM_DAY_INDEX);
                const out = await capturePlanner(page, origin, plannerPreview);
                const kb = Math.round(statSync(out).size / 1024);
                console.log(`${kb} KB`);
            } catch (err) {
                console.log('FAIL');
                console.error(`  ${err?.message || err}`);
                failures.push(`${plannerPreview.id}: ${err?.message || err}`);
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
