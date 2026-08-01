/**
 * Full timetable grid UI + route deep-link handling
 */
import { ROUTES } from './config.js';
import { safeStorage, escapeHTML } from './utils.js';
import { $currentRouteId, $userRegion, $schedules } from '../store.js';
import { loadAllSchedules, executeRegionSwap } from './logic.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal, toggleDropdownScrim } from './ui.js';
import { simulateNextActiveService } from './live-board.js';
import {
    buildRouteShareUrl,
    parseRouteDeepLinkParams,
    stripShareParamsFromUrl,
} from './share-links.js';

function closeFullGridModal() {
    if (typeof location !== 'undefined' && location.hash === '#grid') {
        history.back();
        return;
    }
    closeSmoothModal('full-schedule-modal');
}

function buildGridShareUrl(routeId, direction, dayType) {
    const day = dayType === 'saturday' || dayType === 'sunday' ? dayType : 'weekday';
    const dir = direction === 'B' ? 'B' : 'A';
    return buildRouteShareUrl({ routeId, view: 'grid', dir, day });
}

export function buildFareShareUrl(routeId) {
    return buildRouteShareUrl({ routeId, view: 'fares' });
}

export function parseRouteDeepLink() {
    if (typeof location === 'undefined') return null;
    const link = parseRouteDeepLinkParams(location.search);
    if (!link || !ROUTES[link.routeId]) return null;
    // Grid day: weekend board uses saturday schedules for sat/sun deep links
    const day = link.day === 'saturday' || link.day === 'sunday' ? 'saturday' : 'weekday';
    return {
        routeId: link.routeId,
        view: link.view,
        dir: link.dir,
        day,
    };
}

/**
 * Cold-start / share deep link: open the linked route (and grid when view=grid).
 * If the user has no default for that region (cold start / empty prefs), adopt
 * the shared route as their default. Never overwrite an existing default.
 */
export async function applyRouteDeepLink() {
    const link = parseRouteDeepLink();
    if (!link) return false;

    const route = ROUTES[link.routeId];
    if (!route) return false;

    const defaultKey = 'defaultRoute_' + route.region;
    const existingDefault = safeStorage.getItem(defaultKey);
    const hasUsableDefault = !!(existingDefault && ROUTES[existingDefault] && ROUTES[existingDefault].region === route.region);

    if (safeStorage.getItem('welcomeSeen') !== 'true') {
        safeStorage.setItem('welcomeSeen', 'true');
    }
    // Cold start / no defaults: pin the shared route as theirs
    if (!hasUsableDefault) {
        safeStorage.setItem(defaultKey, link.routeId);
    }

    if (route.region !== ($userRegion.get() || 'GP')) {
        executeRegionSwap(route.region, true);
    }

    $currentRouteId.set(link.routeId);

    // Strip share params — renderFullScheduleGrid will push #grid so Close/Back stays in-app
    stripShareParamsFromUrl();

    await loadAllSchedules(true);

    if (link.view === 'grid') {
        setTimeout(() => renderFullScheduleGrid(link.dir, link.day), 80);
    } else if (link.view === 'fares' || link.view === 'fare') {
        setTimeout(async () => {
            try {
                const { openFareModalForCurrentRoute } = await import('./live-board-ui.js');
                openFareModalForCurrentRoute();
            } catch (_) { /* ignore */ }
        }, 120);
    }
    return true;
}

export function renderFullScheduleGrid(direction = 'A', dayOverride = null) {
    triggerHaptic();
    const routeId = $currentRouteId.get();
    const route = ROUTES[routeId];
    const scheds = $schedules.get() || {};
    if (!route || !window.Renderer?._buildGridHTML || !scheds || Object.keys(scheds).length === 0) {
        showToast('Loading latest schedules... please wait.', 'info', 2000);
        return;
    }

    const currentDayType = (typeof window !== 'undefined' && window.currentDayType) || 'weekday';
    let selectedDay = dayOverride || currentDayType;
    let targetDayIdx = (typeof window !== 'undefined' && typeof window.currentDayIndex === 'number')
        ? window.currentDayIndex
        : new Date().getDay();
    let autoForwarded = false;

    if (!dayOverride) {
        let hasServiceToday = false;
        if (currentDayType !== 'sunday') {
            const testKey = `${currentDayType}_to_${direction.toLowerCase()}`;
            const testSchedule = scheds[testKey];
            if (testSchedule?.rows?.length) {
                for (const t of testSchedule.headers.slice(1)) {
                    if (typeof window.isTrainExcluded === 'function') {
                        if (!window.isTrainExcluded(t, routeId, targetDayIdx)) {
                            hasServiceToday = true;
                            break;
                        }
                    } else {
                        hasServiceToday = true;
                        break;
                    }
                }
            }
        }
        if (!hasServiceToday) {
            const dest = direction === 'A' ? route.destA : route.destB;
            const stationSelect = document.getElementById('station-select');
            const selectedStation = stationSelect ? stationSelect.value : '';
            const simResult = simulateNextActiveService(selectedStation, dest);
            if (simResult && simResult.daysAhead > 0) {
                selectedDay = simResult.dayInfo.type;
                targetDayIdx = simResult.dayInfo.idx;
                autoForwarded = true;
            } else if (currentDayType === 'sunday') {
                selectedDay = 'weekday';
                targetDayIdx = 1;
                autoForwarded = true;
            }
        }
    } else if (dayOverride !== currentDayType) {
        if (dayOverride === 'weekday') targetDayIdx = 1;
        else if (dayOverride === 'saturday') targetDayIdx = 6;
        else if (dayOverride === 'sunday') targetDayIdx = 0;
    }

    // Sunday maps to weekday sheets; saturday uses saturday sheets
    const sheetDayType = selectedDay === 'saturday' ? 'saturday' : 'weekday';
    const sheetKey = `${sheetDayType}_to_${direction.toLowerCase()}`;
    const schedule = scheds[sheetKey];
    if (!schedule?.rows?.length) {
        showToast(`No ${sheetDayType} schedule available for this route.`, 'error');
        return;
    }

    let modal = document.getElementById('full-schedule-modal');
    const isFirstOpen = !modal || modal.classList.contains('hidden');
    if (isFirstOpen && typeof window.trackAnalyticsEvent === 'function') {
        window.trackAnalyticsEvent('view_full_grid', {
            route: route.name,
            direction,
            day: selectedDay,
        });
    }

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'full-schedule-modal';
        modal.className = 'fixed inset-0 bg-white dark:bg-gray-900 z-[95] hidden flex items-center justify-center p-0 full-screen backdrop-blur-md transition-opacity duration-300';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-900 rounded-none shadow-2xl w-full h-full flex flex-col overflow-hidden relative transform">
                <div class="px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center gap-2 bg-gray-50 dark:bg-gray-800 z-20 shrink-0">
                    <h3 class="flex-grow min-w-0"></h3>
                    <button type="button" id="close-full-grid-btn" class="p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 shrink-0" aria-label="Close">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div id="grid-controls" class="px-2 py-1.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center shadow-sm relative z-[60] shrink-0"></div>
                <div id="grid-container" class="flex-grow overflow-auto bg-white dark:bg-gray-900 relative z-10"></div>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('close-full-grid-btn')?.addEventListener('click', () => {
            triggerHaptic();
            closeFullGridModal();
        });
    }

    const destName = window.Renderer._applyUIIntercepts(direction === 'A' ? route.destA : route.destB).toUpperCase();
    const oppositeDestName = window.Renderer._applyUIIntercepts(direction === 'A' ? route.destB : route.destA).toUpperCase();
    let effectiveDate = 'Standard Schedule';
    if (schedule.lastUpdated) {
        const cleanDate = String(schedule.lastUpdated).replace(/^last updated[:\s-]*/i, '').trim();
        effectiveDate = `Effective: ${cleanDate}`;
    }

    const headerTitle = modal.querySelector('h3');
    if (headerTitle) {
        headerTitle.innerHTML = `
            <div class="flex flex-col w-full min-w-0 leading-tight">
                <span class="text-xs font-black uppercase text-blue-600 dark:text-blue-400 tracking-wider truncate">Trains To ${escapeHTML(destName)}</span>
                <span class="text-[9px] text-gray-400 font-mono truncate">${escapeHTML(effectiveDate)}</span>
            </div>`;
    }

    const isWk = sheetDayType === 'weekday';
    const wkLabel = 'Mon - Fri';
    const satLabel = 'Sat / Hol';
    const shareUrl = buildGridShareUrl(routeId, direction, sheetDayType);
    const shareText = `Check out the ${sheetDayType} schedule to ${destName}`;

    if (typeof window !== 'undefined') {
        window._gridShareState = { routeId, dir: direction, day: sheetDayType };
        window.shareCurrentGrid = async () => {
            triggerHaptic();
            const data = { title: 'Next Train Schedule', text: shareText, url: shareUrl };
            try {
                if (navigator.share) await navigator.share(data);
                else {
                    await navigator.clipboard.writeText(shareUrl);
                    showToast('Schedule link copied to clipboard!', 'success');
                }
            } catch {
                try {
                    await navigator.clipboard.writeText(shareUrl);
                    showToast('Schedule link copied to clipboard!', 'success');
                } catch {
                    showToast('Could not share link.', 'error');
                }
            }
        };
    }

    if (!window._gridOutsideClickListener) {
        window._gridOutsideClickListener = (e) => {
            const list = document.getElementById('grid-day-list');
            const chevron = document.getElementById('grid-day-chevron');
            if (list && !list.classList.contains('hidden') && !e.target.closest('#grid-day-dropdown-container')) {
                if (typeof toggleDropdownScrim === 'function') toggleDropdownScrim();
                else {
                    list.classList.add('hidden');
                    if (chevron) chevron.classList.remove('rotate-180');
                }
            }
        };
        document.addEventListener('click', window._gridOutsideClickListener);
    }

    const controlsDiv = document.getElementById('grid-controls');
    if (controlsDiv) {
        controlsDiv.innerHTML = `
            <div class="flex items-center gap-1 min-w-0 flex-1 relative" id="grid-day-dropdown-container">
                <button type="button" id="grid-day-trigger" class="flex justify-between items-center text-[9px] sm:text-[10px] font-bold bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none shadow-sm min-w-[80px]">
                    <span id="grid-day-display" class="truncate mr-1">${isWk ? wkLabel : satLabel}</span>
                    <svg id="grid-day-chevron" class="w-3 h-3 text-gray-500 transform transition-transform shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                <ul id="grid-day-list" class="absolute z-[200] top-[115%] left-0 mt-1 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl hidden flex-col overflow-hidden text-left min-w-[160px]">
                    <li data-day="weekday" class="px-3 py-3 text-sm font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 flex items-center ${isWk ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">
                        ${wkLabel}
                    </li>
                    <li data-day="saturday" class="px-3 py-3 text-sm font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors flex items-center ${!isWk ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">
                        ${satLabel}
                    </li>
                </ul>
                <button type="button" id="grid-swap-dir-btn" class="text-[9px] sm:text-[10px] font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-1 rounded border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors whitespace-nowrap shadow-sm truncate shrink-0" title="Swap direction">
                    ↔ ${escapeHTML(oppositeDestName)}
                </button>
            </div>
            <div class="flex items-center gap-1 border-l border-gray-200 dark:border-gray-700 pl-1.5 ml-1 shrink-0">
                <button type="button" id="grid-export-btn" class="flex items-center gap-1 px-1.5 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 transition shadow-sm border border-gray-200 dark:border-gray-600" title="Download">
                    <svg class="w-3 h-3 text-gray-600 dark:text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    <span class="text-[9px] font-bold text-gray-700 dark:text-gray-300">Download</span>
                </button>
                <button type="button" id="grid-share-btn" class="flex items-center gap-1 px-1.5 py-1 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded hover:bg-blue-100 transition shadow-sm border border-blue-200 dark:border-blue-800" title="Share Link">
                    <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
                    <span class="text-[9px] font-bold">Share</span>
                </button>
            </div>`;

        document.getElementById('grid-day-trigger')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof toggleDropdownScrim === 'function') toggleDropdownScrim('grid-day-list', 'grid-day-chevron');
            else {
                document.getElementById('grid-day-list')?.classList.toggle('hidden');
                document.getElementById('grid-day-chevron')?.classList.toggle('rotate-180');
            }
        });
        controlsDiv.querySelectorAll('#grid-day-list li[data-day]').forEach((li) => {
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof toggleDropdownScrim === 'function') toggleDropdownScrim();
                else {
                    document.getElementById('grid-day-list')?.classList.add('hidden');
                    document.getElementById('grid-day-chevron')?.classList.remove('rotate-180');
                }
                renderFullScheduleGrid(direction, li.getAttribute('data-day'));
            });
        });
        document.getElementById('grid-swap-dir-btn')?.addEventListener('click', () => {
            renderFullScheduleGrid(direction === 'A' ? 'B' : 'A', sheetDayType);
        });
        document.getElementById('grid-export-btn')?.addEventListener('click', () => {
            if (typeof window.takeGridSnapshot === 'function') window.takeGridSnapshot(direction, sheetDayType);
        });
        document.getElementById('grid-share-btn')?.addEventListener('click', () => {
            if (typeof window.shareCurrentGrid === 'function') window.shareCurrentGrid();
        });
    }

    const isTodayType = !autoForwarded && (
        (currentDayType === 'weekday' && sheetDayType === 'weekday') ||
        (currentDayType !== 'weekday' && sheetDayType === 'saturday')
    );
    const routeSheetKey = route.sheetKeys?.[sheetKey] || sheetKey;
    const html = window.Renderer._buildGridHTML(schedule, routeSheetKey, routeId, targetDayIdx, isTodayType, false);
    const grid = document.getElementById('grid-container');
    if (grid) grid.innerHTML = html;

    openSmoothModal('full-schedule-modal');
    if (location.hash !== '#grid') {
        history.pushState({ modal: 'grid' }, '', '#grid');
    }

    setTimeout(() => {
        document.getElementById('grid-active-col')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 100);
}

export function attachTimetableGridGlobals() {
    if (typeof window === 'undefined') return;
    window.renderFullScheduleGrid = renderFullScheduleGrid;
    window.applyRouteDeepLink = applyRouteDeepLink;
}
