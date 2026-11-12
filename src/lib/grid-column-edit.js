/**
 * Operator grid edits. A new start time at the first station fills the rest
 * of that column from the other trains' station-to-station gaps.
 */

const JUNK_STATION = /last\s*updated|inter-station|^variant$|^via\b|^km\b|^total$|^hours?$|^minutes?$|^notes?$/i;

export function isGridStationName(name) {
    const text = String(name || '').trim();
    if (!text || text === '-') return false;
    if (JUNK_STATION.test(text)) return false;
    return true;
}

/** Seconds from midnight, or null when the cell is not a clock. */
export function parseSheetClock(raw) {
    const match = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] || 0);
    if (hour > 27 || minute > 59 || second > 59) return null;
    return hour * 3600 + minute * 60 + second;
}

/** Sheet clock, same shape as the dump (`5:35:00`). */
export function formatSheetClock(totalSeconds) {
    let sec = Math.round(Number(totalSeconds) || 0);
    sec = ((sec % 86400) + 86400) % 86400;
    const hour = Math.floor(sec / 3600);
    const minute = Math.floor((sec % 3600) / 60);
    const second = sec % 60;
    return `${hour}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

/** `05:35` for the grid. Non-clocks stay as written, blanks stay blank. */
export function displaySheetClock(raw) {
    const sec = parseSheetClock(raw);
    if (sec == null) {
        const text = String(raw || '').trim();
        if (!text || text === '-') return '';
        return text;
    }
    const hour = Math.floor(sec / 3600) % 24;
    const minute = Math.floor((sec % 3600) / 60);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function stationRowIndexes(rows) {
    const indexes = [];
    (rows || []).forEach((row, index) => {
        if (isGridStationName(row?.STATION || row?.station)) indexes.push(index);
    });
    return indexes;
}

function clockAt(rows, rowIndex, trainId) {
    return parseSheetClock(rows?.[rowIndex]?.[trainId]);
}

function median(samples) {
    if (!samples.length) return null;
    const sorted = samples.slice().sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
}

function gapSeconds(fromSec, toSec) {
    let delta = toSec - fromSec;
    if (delta < 0 && fromSec >= 18 * 3600 && toSec <= 6 * 3600) delta += 86400;
    if (delta <= 0 || delta > 3 * 3600) return null;
    return delta;
}

/**
 * Write a column from the first station.
 * An existing train keeps the stops it already calls at.
 * A new train (`fillBlanks`) calls where at least half the other trains call.
 */
export function fillTrainColumn(rows, trainId, startSec, trainIds, opts = {}) {
    const indexes = stationRowIndexes(rows);
    if (!indexes.length || !trainId || startSec == null) return { filled: 0 };
    const others = (trainIds || []).filter((id) => id && id !== trainId);
    const origin = indexes[0];
    const targets = [origin];
    for (let n = 1; n < indexes.length; n += 1) {
        const rowIndex = indexes[n];
        const had = clockAt(rows, rowIndex, trainId) != null;
        if (opts.fillBlanks) {
            const callers = others.filter((id) => clockAt(rows, rowIndex, id) != null).length;
            const need = others.length ? Math.ceil(others.length / 2) : 1;
            if (callers >= need) targets.push(rowIndex);
        } else if (had) {
            targets.push(rowIndex);
        }
    }
    let cursor = startSec;
    let previous = origin;
    rows[origin][trainId] = formatSheetClock(cursor);
    let filled = 1;
    for (let t = 1; t < targets.length; t += 1) {
        const rowIndex = targets[t];
        const samples = [];
        others.forEach((id) => {
            const from = clockAt(rows, previous, id);
            const to = clockAt(rows, rowIndex, id);
            if (from == null || to == null) return;
            const gap = gapSeconds(from, to);
            if (gap != null) samples.push(gap);
        });
        const delta = median(samples);
        if (delta == null) continue;
        cursor += delta;
        rows[rowIndex][trainId] = formatSheetClock(cursor);
        previous = rowIndex;
        filled += 1;
    }
    return { filled };
}

export function clearTrainTime(rows, trainId, rowIndex) {
    const row = rows?.[rowIndex];
    if (!row || !trainId || !Object.prototype.hasOwnProperty.call(row, trainId)) return false;
    delete row[trainId];
    return true;
}

export function removeTrainFromRows(rows, trainId) {
    (rows || []).forEach((row) => {
        if (row && Object.prototype.hasOwnProperty.call(row, trainId)) delete row[trainId];
    });
}
