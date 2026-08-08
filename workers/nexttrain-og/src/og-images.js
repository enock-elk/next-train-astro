/**
 * Stylized timetable / planner OG cards (SVG → PNG via resvg-wasm).
 */
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import { dayLabel, stationLabel } from './parse.js';

let wasmReady = null;

async function ensureWasm() {
  if (!wasmReady) {
    wasmReady = initWasm(resvgWasm);
  }
  await wasmReady;
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

/** Brand-blue timetable card resembling in-app grid exports. */
export function buildTimetableSvg({ origin, dest, day, grid }) {
  const W = 1200;
  const H = 630;
  const title = `${truncate(origin, 22)} → ${truncate(dest, 22)}`;
  const subtitle = `${day} timetable`;

  let gridBody = '';
  if (grid && grid.stations?.length) {
    const colW = 72;
    const rowH = 36;
    const left = 48;
    const top = 168;
    const stationW = 220;
    const trains = grid.trainIds || [];

    let headerCells = `<rect x="${left}" y="${top}" width="${stationW}" height="${rowH}" fill="#1e3a8a"/>
      <text x="${left + 12}" y="${top + 24}" fill="#93c5fd" font-size="14" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="700">STATION</text>`;
    trains.forEach((id, i) => {
      const x = left + stationW + i * colW;
      headerCells += `<rect x="${x}" y="${top}" width="${colW}" height="${rowH}" fill="#1e40af" stroke="#1e3a8a"/>
        <text x="${x + colW / 2}" y="${top + 24}" fill="#dbeafe" font-size="13" font-family="DejaVu Sans Mono,Liberation Mono,monospace" font-weight="700" text-anchor="middle">${esc(String(id).slice(-4))}</text>`;
    });

    let rows = '';
    grid.stations.forEach((st, ri) => {
      const y = top + rowH + ri * rowH;
      const bg = ri % 2 === 0 ? '#f8fafc' : '#e2e8f0';
      rows += `<rect x="${left}" y="${y}" width="${stationW}" height="${rowH}" fill="${bg}" stroke="#cbd5e1"/>
        <text x="${left + 12}" y="${y + 24}" fill="#0f172a" font-size="15" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="600">${esc(truncate(st, 18))}</text>`;
      (grid.cells[ri] || []).forEach((t, ci) => {
        const x = left + stationW + ci * colW;
        rows += `<rect x="${x}" y="${y}" width="${colW}" height="${rowH}" fill="${bg}" stroke="#cbd5e1"/>
          <text x="${x + colW / 2}" y="${y + 24}" fill="#1e293b" font-size="15" font-family="DejaVu Sans Mono,Liberation Mono,monospace" text-anchor="middle">${esc(t || '—')}</text>`;
      });
    });

    const tableW = stationW + trains.length * colW;
    const tableH = rowH * (1 + grid.stations.length);
    gridBody = `<rect x="${left - 4}" y="${top - 4}" width="${tableW + 8}" height="${tableH + 8}" rx="10" fill="#0f172a" opacity="0.08"/>
      ${headerCells}${rows}`;
  } else {
    gridBody = `<text x="600" y="340" fill="#e2e8f0" font-size="28" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" text-anchor="middle">Open in Next Train for the full grid</text>`;
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
  <text x="48" y="64" fill="#93c5fd" font-size="22" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="800" letter-spacing="2">METRORAIL NEXT TRAIN</text>
  <text x="48" y="118" fill="#ffffff" font-size="42" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="900">${esc(title)}</text>
  <text x="48" y="152" fill="#bfdbfe" font-size="22" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="600">${esc(subtitle)}</text>
  ${gridBody}
  <text x="48" y="600" fill="#93c5fd" font-size="20" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="700">Tap to open live boards · free · works offline</text>
</svg>`;
}

export function buildPlannerSvg({ from, to, time, day }) {
  const W = 1200;
  const H = 630;
  const timeLine = time ? `Depart ${time}` : 'Open your trip plan';
  const dayLine = day ? dayLabel(day) : 'Today';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f766e"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="48" y="64" fill="#99f6e4" font-size="22" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="800" letter-spacing="2">METRORAIL NEXT TRAIN</text>
  <text x="48" y="140" fill="#ccfbf1" font-size="26" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="700">TRIP PLAN</text>
  <text x="48" y="230" fill="#ffffff" font-size="52" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="900">${esc(truncate(stationLabel(from), 28))}</text>
  <text x="48" y="300" fill="#5eead4" font-size="36" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="800">↓</text>
  <text x="48" y="370" fill="#ffffff" font-size="52" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="900">${esc(truncate(stationLabel(to), 28))}</text>
  <text x="48" y="450" fill="#99f6e4" font-size="28" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="700">${esc(timeLine)} · ${esc(dayLine)}</text>
  <text x="48" y="600" fill="#99f6e4" font-size="20" font-family="DejaVu Sans,Liberation Sans,Arial,sans-serif" font-weight="700">Tap to open connections, times &amp; fares</text>
</svg>`;
}

export async function svgToPng(svg) {
  await ensureWasm();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { loadSystemFonts: false },
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
