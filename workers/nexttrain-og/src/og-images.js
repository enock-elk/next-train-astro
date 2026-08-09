/**
 * Stylized timetable / planner OG cards (SVG → PNG via resvg-wasm).
 * Fonts are embedded — Workers have no system fonts, so text is blank without them.
 *
 * Composition is title-first and center-weighted: WhatsApp often shows a small
 * left thumbnail (center-crop), so route names must stay readable there — not
 * only in Facebook's large top preview.
 */
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import fontRegular from '../assets/Inter-Regular.ttf';
import fontSemiBold from '../assets/Inter-SemiBold.ttf';
import fontBold from '../assets/Inter-Bold.ttf';
import { dayLabel, stationLabel } from './parse.js';
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from './og-size.js';

const FONT = 'Inter';
export { OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT };

let wasmReady = null;
let fontBuffers = null;

async function toUint8(mod) {
  if (mod instanceof ArrayBuffer) return new Uint8Array(mod);
  if (ArrayBuffer.isView(mod)) return new Uint8Array(mod.buffer, mod.byteOffset, mod.byteLength);
  if (typeof mod === 'string') {
    const res = await fetch(mod);
    if (!res.ok) throw new Error(`font fetch ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error('Unsupported font module type');
}

async function ensureWasm() {
  if (!wasmReady) {
    wasmReady = initWasm(resvgWasm);
  }
  await wasmReady;
  if (!fontBuffers) {
    fontBuffers = await Promise.all([fontRegular, fontSemiBold, fontBold].map(toUint8));
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s, n) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Brand-blue timetable card — tight padding, large grid, readable title. */
export function buildTimetableSvg({ origin, dest, day, grid }) {
  const W = OG_IMAGE_WIDTH;
  const H = OG_IMAGE_HEIGHT;
  const originT = truncate(origin, 20);
  const destT = truncate(dest, 20);
  // Single-line title saves vertical blue padding vs stacked names.
  const title = `${originT} to ${destT}`;
  const subtitle = `${day} timetable`;

  let gridBody = '';
  if (grid && grid.stations?.length) {
    const padX = 18;
    const trains = (grid.trainIds || []).slice(0, 8);
    const stations = (grid.stations || []).slice(0, 9);
    const stationW = 236;
    const tableInnerW = W - padX * 2;
    const colW = trains.length
      ? Math.floor((tableInnerW - stationW) / trains.length)
      : 96;
    const tableW = stationW + trains.length * colW;
    const left = Math.round((W - tableW) / 2);
    const top = 128;
    // Stretch rows so the grid eats the blue gap above the footer.
    const footerTop = 596;
    const availH = footerTop - top;
    const rowH = Math.max(32, Math.floor(availH / (1 + stations.length)));
    const tableH = rowH * (1 + stations.length);
    const textY = Math.round(rowH * 0.68);
    const fontSize = rowH >= 42 ? 20 : rowH >= 36 ? 17 : 15;

    let headerCells = `<rect x="${left}" y="${top}" width="${stationW}" height="${rowH}" fill="#1e3a8a"/>
      <text x="${left + 12}" y="${top + textY}" fill="#93c5fd" font-size="${fontSize}" font-family="${FONT}" font-weight="700">STATION</text>`;
    trains.forEach((id, i) => {
      const x = left + stationW + i * colW;
      headerCells += `<rect x="${x}" y="${top}" width="${colW}" height="${rowH}" fill="#1e40af" stroke="#1e3a8a"/>
        <text x="${x + colW / 2}" y="${top + textY}" fill="#dbeafe" font-size="${fontSize - 1}" font-family="${FONT}" font-weight="700" text-anchor="middle">${esc(String(id).slice(-4))}</text>`;
    });

    let rows = '';
    stations.forEach((st, ri) => {
      const y = top + rowH + ri * rowH;
      const bg = ri % 2 === 0 ? '#f8fafc' : '#e2e8f0';
      rows += `<rect x="${left}" y="${y}" width="${stationW}" height="${rowH}" fill="${bg}" stroke="#cbd5e1"/>
        <text x="${left + 12}" y="${y + textY}" fill="#0f172a" font-size="${fontSize}" font-family="${FONT}" font-weight="700">${esc(truncate(st, 18))}</text>`;
      (grid.cells[ri] || []).slice(0, trains.length).forEach((t, ci) => {
        const x = left + stationW + ci * colW;
        rows += `<rect x="${x}" y="${y}" width="${colW}" height="${rowH}" fill="${bg}" stroke="#cbd5e1"/>
          <text x="${x + colW / 2}" y="${y + textY}" fill="#1e293b" font-size="${fontSize}" font-family="${FONT}" font-weight="700" text-anchor="middle">${esc(t || '—')}</text>`;
      });
    });

    gridBody = `<rect x="${left - 4}" y="${top - 4}" width="${tableW + 8}" height="${tableH + 8}" rx="10" fill="#0f172a" opacity="0.16"/>
      ${headerCells}${rows}`;
  } else {
    gridBody = `<text x="600" y="340" fill="#e2e8f0" font-size="28" font-family="${FONT}" font-weight="600" text-anchor="middle">Open in Next Train for the full grid</text>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1d4ed8"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="600" y="28" fill="#93c5fd" font-size="16" font-family="${FONT}" font-weight="800" letter-spacing="2" text-anchor="middle">METRORAIL NEXT TRAIN</text>
  <text x="600" y="74" fill="#ffffff" font-size="44" font-family="${FONT}" font-weight="800" text-anchor="middle">${esc(title)}</text>
  <text x="600" y="108" fill="#bfdbfe" font-size="20" font-family="${FONT}" font-weight="700" text-anchor="middle">${esc(subtitle)}</text>
  ${gridBody}
  <text x="600" y="618" fill="#93c5fd" font-size="16" font-family="${FONT}" font-weight="700" text-anchor="middle">Tap to open live boards · free · works offline</text>
</svg>`;
}

export function buildPlannerSvg({ from, to, time, day }) {
  const W = OG_IMAGE_WIDTH;
  const H = OG_IMAGE_HEIGHT;
  const timeLine = time ? `Depart ${time}` : 'Open your trip plan';
  const dayLine = day ? dayLabel(day) : 'Today';
  const fromT = truncate(stationLabel(from), 22);
  const toT = truncate(stationLabel(to), 22);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f766e"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="20" fill="#042f2e" opacity="0.35"/>
  <text x="600" y="88" fill="#99f6e4" font-size="18" font-family="${FONT}" font-weight="800" letter-spacing="2" text-anchor="middle">METRORAIL NEXT TRAIN</text>
  <text x="600" y="136" fill="#ccfbf1" font-size="22" font-family="${FONT}" font-weight="700" text-anchor="middle">TRIP PLAN</text>
  <text x="600" y="250" fill="#ffffff" font-size="68" font-family="${FONT}" font-weight="800" text-anchor="middle">${esc(fromT)}</text>
  <text x="600" y="320" fill="#5eead4" font-size="36" font-family="${FONT}" font-weight="800" text-anchor="middle">to</text>
  <text x="600" y="400" fill="#ffffff" font-size="68" font-family="${FONT}" font-weight="800" text-anchor="middle">${esc(toT)}</text>
  <text x="600" y="490" fill="#99f6e4" font-size="28" font-family="${FONT}" font-weight="700" text-anchor="middle">${esc(timeLine)} · ${esc(dayLine)}</text>
  <text x="600" y="560" fill="#5eead4" font-size="18" font-family="${FONT}" font-weight="700" text-anchor="middle">Tap to open connections, times &amp; fares</text>
</svg>`;
}

export async function svgToPng(svg) {
  await ensureWasm();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: OG_IMAGE_WIDTH },
    font: {
      fontBuffers,
      defaultFontFamily: FONT,
      loadSystemFonts: false,
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

export async function timetablePng(opts) {
  return svgToPng(buildTimetableSvg(opts));
}

export async function plannerPng(opts) {
  return svgToPng(buildPlannerSvg(opts));
}
