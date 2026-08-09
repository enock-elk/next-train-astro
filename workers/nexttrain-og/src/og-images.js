/**
 * Stylized timetable / planner OG cards (SVG → PNG via resvg-wasm).
 * Fonts are embedded — Workers have no system fonts, so text is blank without them.
 *
 * Timetable art shows the FULL sheet (all trains × stations) as a dense grid so
 * WhatsApp's large preview communicates "there's a real schedule here".
 */
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import fontRegular from '../assets/Inter-Regular.ttf';
import fontSemiBold from '../assets/Inter-SemiBold.ttf';
import fontBold from '../assets/Inter-Bold.ttf';
import { dayLabel, stationLabel } from './parse.js';
import { OG_DESIGN_HEIGHT, OG_DESIGN_WIDTH, OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from './og-size.js';

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

/** Dense full-sheet timetable — title stays readable; cells are intentionally tiny. */
export function buildTimetableSvg({ origin, dest, day, grid }) {
  const W = OG_DESIGN_WIDTH;
  const H = OG_DESIGN_HEIGHT;
  const originT = truncate(origin, 20);
  const destT = truncate(dest, 20);
  const title = `${originT} to ${destT}`;
  const trainCount = grid?.trainIds?.length || 0;
  const stationCount = grid?.stations?.length || 0;
  const subtitle =
    trainCount && stationCount
      ? `${day} timetable · ${trainCount} trains · ${stationCount} stations`
      : `${day} timetable`;

  let gridBody = '';
  if (grid && grid.stations?.length && grid.trainIds?.length) {
    const padX = 14;
    const trains = grid.trainIds;
    const stations = grid.stations;
    // Slim station col so many train columns fit; density is the point.
    const stationW = trains.length >= 24 ? 88 : trains.length >= 16 ? 110 : 150;
    const tableInnerW = W - padX * 2;
    const colW = Math.max(10, Math.floor((tableInnerW - stationW) / trains.length));
    const tableW = stationW + trains.length * colW;
    const left = Math.round((W - tableW) / 2);
    const top = 118;
    const footerTop = 598;
    const availH = footerTop - top;
    const rowH = Math.max(14, Math.floor(availH / (1 + stations.length)));
    const tableH = rowH * (1 + stations.length);
    const textY = Math.round(rowH * 0.72);
    // Tiny type on purpose — users should see the grid fabric, not read every cell.
    const timeFont = colW >= 36 ? 11 : colW >= 24 ? 9 : colW >= 16 ? 7 : 6;
    const stationFont = Math.min(12, Math.max(7, rowH - 4));
    const headFont = Math.min(timeFont, 9);
    const stationChars = stationW >= 140 ? 16 : stationW >= 100 ? 12 : 9;

    // Row bands (not per-cell rects) — cheaper SVG + smaller PNG for dense sheets.
    let bands = `<rect x="${left}" y="${top}" width="${tableW}" height="${rowH}" fill="#1e3a8a"/>`;
    stations.forEach((_, ri) => {
      const y = top + rowH + ri * rowH;
      bands += `<rect x="${left}" y="${y}" width="${tableW}" height="${rowH}" fill="${ri % 2 === 0 ? '#f8fafc' : '#e2e8f0'}"/>`;
    });

    let headerText = `<text x="${left + 6}" y="${top + textY}" fill="#93c5fd" font-size="${headFont}" font-family="${FONT}" font-weight="700">STN</text>`;
    trains.forEach((id, i) => {
      const x = left + stationW + i * colW + colW / 2;
      const label = colW >= 22 ? String(id).slice(-4) : String(id).slice(-3);
      headerText += `<text x="${x}" y="${top + textY}" fill="#dbeafe" font-size="${headFont}" font-family="${FONT}" font-weight="700" text-anchor="middle">${esc(label)}</text>`;
    });

    let bodyText = '';
    stations.forEach((st, ri) => {
      const y = top + rowH + ri * rowH + textY;
      bodyText += `<text x="${left + 5}" y="${y}" fill="#0f172a" font-size="${stationFont}" font-family="${FONT}" font-weight="700">${esc(truncate(st, stationChars))}</text>`;
      (grid.cells[ri] || []).forEach((t, ci) => {
        if (ci >= trains.length) return;
        const x = left + stationW + ci * colW + colW / 2;
        const val = t || '·';
        bodyText += `<text x="${x}" y="${y}" fill="#334155" font-size="${timeFont}" font-family="${FONT}" font-weight="600" text-anchor="middle">${esc(val)}</text>`;
      });
    });

    // Light column guides every 4 trains (readable structure without heavy strokes).
    let guides = '';
    for (let i = 1; i < trains.length; i++) {
      if (i % 4 !== 0) continue;
      const x = left + stationW + i * colW;
      guides += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + tableH}" stroke="#94a3b8" stroke-width="0.6" opacity="0.45"/>`;
    }

    gridBody = `<rect x="${left - 3}" y="${top - 3}" width="${tableW + 6}" height="${tableH + 6}" rx="8" fill="#0f172a" opacity="0.14"/>
      ${bands}${guides}${headerText}${bodyText}`;
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
  <text x="600" y="26" fill="#93c5fd" font-size="15" font-family="${FONT}" font-weight="800" letter-spacing="2" text-anchor="middle">METRORAIL NEXT TRAIN</text>
  <text x="600" y="68" fill="#ffffff" font-size="40" font-family="${FONT}" font-weight="800" text-anchor="middle">${esc(title)}</text>
  <text x="600" y="98" fill="#bfdbfe" font-size="17" font-family="${FONT}" font-weight="700" text-anchor="middle">${esc(subtitle)}</text>
  ${gridBody}
  <text x="600" y="618" fill="#93c5fd" font-size="15" font-family="${FONT}" font-weight="700" text-anchor="middle">Tap to open live boards · free · works offline</text>
</svg>`;
}

export function buildPlannerSvg({ from, to, time, day }) {
  const W = OG_DESIGN_WIDTH;
  const H = OG_DESIGN_HEIGHT;
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
