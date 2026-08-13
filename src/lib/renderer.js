/**
 * METRORAIL NEXT TRAIN - RENDERER ENGINE (V7_06.17 - Astro MPA Migration)
 * ------------------------------------------------
 * This module handles all DOM injection, HTML string generation, and timetable snapshots.
 * It separates the "View" from the "Logic" (ui.js/logic.js).
 */

import { 
    $userRegion, $currentRouteId, $userProfile, $fullDatabase, $schedules, 
    $globalStationIndex, $globalExclusions 
} from '../store.js';

import { 
    ROUTES, CHANGELOG_DATA, CORRIDOR_META, getCorridorLabel
} from './config.js';

import { MANUAL_GRID_ORDER } from './grid-order.js';

import { 
    normalizeStationName, timeToSeconds, formatTimeDisplay, isRealTime, escapeHTML, safeStorage,
    formatRouteLabelHtml, formatRouteLabelPlain, shortSharedSourceLabel,
    scheduleCacheSlot, routeSheetKeyForDay
} from './utils.js';

import { 
    currentTime, currentDayType, currentDayIndex 
} from './logic.js';

import { showToast, triggerHaptic } from './ui.js';
import { decorateJourneyLive, trainHasLivePing, isRideCheckInEnabled } from './ride-pings.js';

// Delay-report UI is off for cutover (DELAY_REPORTS_UI_ENABLED=false). Keep stubs here so
// renderer does not static-import delay-reports → firebase-vendor on the home critical path.
function buildTrainReportSlotHtml() {
    return '';
}
function buildTrainTitleReportButton({ label, className = '' }) {
    return `<span class="${className}"><span class="truncate">${escapeHTML(label)}</span></span>`;
}

// --- Astro MPA Migration Shims ---
const getCurrentDayType = () => typeof window !== 'undefined' && window.currentDayType ? window.currentDayType : 'weekday';
const getCurrentDayIndex = () => typeof window !== 'undefined' && window.currentDayIndex !== undefined ? window.currentDayIndex : 1;
const getCurrentTime = () => typeof window !== 'undefined' && window.currentTime ? window.currentTime : "12:00:00";
const isTrainExcluded = (train, route, day) => typeof window !== 'undefined' && window.isTrainExcluded ? window.isTrainExcluded(train, route, day) : false;

export const Renderer = {

    // --- 1. DYNAMIC MENU GENERATION ---

    renderRouteMenu: (containerId, routes, activeRouteId) => {
        if (typeof document === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;

        const categoryOrder = [
            ...new Set(Object.values(CORRIDOR_META).map((m) => m.label)),
            'Other Routes',
        ];
        const groups = {};
        Object.values(routes).forEach(route => {
            if (route.id === 'special_event') return;
            const cat = getCorridorLabel(route) || 'Other Routes';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(route);
        });

        let html = '';

        if (routes['special_event'] && routes['special_event'].isActive) {
            const r = routes['special_event'];
            const isActive = r.id === activeRouteId;
            const activeBg = isActive ? 'bg-yellow-100 dark:bg-yellow-900/40' : 'hover:bg-yellow-50 dark:hover:bg-yellow-900/20';
            html += `
                <div id="special-event-section" class="mb-3 rounded-xl overflow-hidden border border-yellow-200 dark:border-yellow-800 shadow-sm">
                    <li class="text-[10px] font-black text-yellow-600 dark:text-yellow-400 uppercase tracking-widest px-4 py-2 bg-yellow-50 dark:bg-yellow-900/30 flex items-center animate-pulse"><span class="mr-1">⭐</span> SPECIAL EVENT</li>
                    <li class="list-none">
                        <a class="block px-4 py-3 ${activeBg} transition-colors cursor-pointer flex items-center justify-between text-sm font-black text-yellow-700 dark:text-yellow-400" data-route-id="${r.id}">
                            <div class="flex items-center min-w-0 pr-2">
                                <span class="mr-2 flex-shrink-0">⭐</span>
                                <span class="truncate">${r.name}</span>
                            </div>
                            ${isActive ? '<svg class="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>' : ''}
                        </a>
                    </li>
                </div>
            `;
        }

        const activeRegString = $userRegion.get() || 'GP';
        const savedDefault = safeStorage.getItem('defaultRoute_' + activeRegString);
        
        if (savedDefault && routes[savedDefault] && savedDefault !== 'special_event') {
            const r = routes[savedDefault];
            const isActive = r.id === activeRouteId;
            const activeBg = isActive ? 'bg-blue-50 dark:bg-blue-900/20 font-black text-blue-700 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 font-bold';
            const dotColor = Renderer._getDotColor(r.colorClass);
            
            html += `
                <div id="pinned-section" class="mb-3 rounded-xl overflow-hidden border border-blue-200 dark:border-blue-900/50 shadow-sm">
                    <li class="list-none">
                        <a class="block px-4 py-3 ${activeBg} transition-colors cursor-pointer flex items-center justify-between text-sm" data-route-id="${r.id}">
                            <div class="flex items-center min-w-0 pr-2">
                                <span class="w-3 h-3 rounded-full mr-3 flex-shrink-0 ${dotColor} ${isActive ? 'ring-2 ring-blue-300 dark:ring-blue-700' : ''}"></span>
                                <span class="text-[10px] font-black text-blue-500 dark:text-blue-400 uppercase tracking-widest mr-2 flex-shrink-0">Pinned:</span>
                                <span class="truncate">${formatRouteLabelHtml(r.name)}</span>
                            </div>
                        </a>
                    </li>
                </div>
            `;
        }

        categoryOrder.forEach(cat => {
            if (groups[cat]) {
                html += `<li class="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest text-center pb-2 pt-4 list-none select-none">${cat}</li>`;
                html += `<div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-4 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">`;
                
                groups[cat].forEach(r => {
                    const isActive = r.id === activeRouteId;
                    const activeBg = isActive ? 'bg-blue-50 dark:bg-blue-900/20 font-black text-blue-700 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200 font-medium';
                    const displayName = formatRouteLabelHtml(r.name);
                    
                    if (!r.isActive) {
                        html += `
                            <li class="list-none opacity-60 bg-gray-50 dark:bg-gray-800/30">
                                <a class="block px-4 py-3 cursor-not-allowed flex items-center justify-between text-sm text-gray-500 dark:text-gray-400" data-route-id="${r.id}">
                                    <div class="flex items-center min-w-0 pr-2">
                                        <div class="w-7 h-7 rounded-md flex items-center justify-center mr-3 flex-shrink-0 bg-gray-200 dark:bg-gray-700 text-gray-400 shadow-sm">
                                            <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="16" rx="2" ry="2"></rect><path d="M4 11h16"></path><path d="M12 3v8"></path><path d="M8 19l-2 3"></path><path d="M18 22l-2-3"></path><path d="M8 15h0"></path><path d="M16 15h0"></path></svg>
                                        </div>
                                        <span class="truncate">${displayName}</span>
                                    </div>
                                    <span class="ml-2 text-[8px] bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded uppercase font-black tracking-widest flex-shrink-0">Soon</span>
                                </a>
                            </li>
                        `;
                    } else {
                        let tileBg = 'bg-gray-100 dark:bg-gray-800 text-gray-500';
                        if (r.colorClass.includes('green')) tileBg = 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400';
                        else if (r.colorClass.includes('orange')) tileBg = 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400';
                        else if (r.colorClass.includes('purple')) tileBg = 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400';
                        else if (r.colorClass.includes('indigo')) tileBg = 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400';
                        else if (r.colorClass.includes('blue')) tileBg = 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400';
                        else if (r.colorClass.includes('yellow')) tileBg = 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400';
                        else if (r.colorClass.includes('red')) tileBg = 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
                        else if (r.colorClass.includes('lime')) tileBg = 'bg-lime-100 dark:bg-lime-900/30 text-lime-600 dark:text-lime-400';

                        html += `
                            <li class="list-none">
                                <a class="block px-4 py-3.5 ${activeBg} transition-colors cursor-pointer flex items-center justify-between text-sm group rounded-lg mx-2 mb-1 w-[calc(100%-1rem)]" data-route-id="${r.id}">
                                    <div class="flex items-center min-w-0 pr-2">
                                        <div class="w-7 h-7 rounded-md flex items-center justify-center mr-3 flex-shrink-0 ${tileBg} shadow-sm group-hover:scale-105 transition-transform">
                                            <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="16" rx="2" ry="2"></rect><path d="M4 11h16"></path><path d="M12 3v8"></path><path d="M8 19l-2 3"></path><path d="M18 22l-2-3"></path><path d="M8 15h0"></path><path d="M16 15h0"></path></svg>
                                        </div>
                                        <span class="truncate">${displayName}</span>
                                    </div>
                                    ${isActive ? '<svg class="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>' : ''}
                                </a>
                            </li>
                        `;
                    }
                });
                html += `</div>`;
            }
        });

        container.innerHTML = html;
    },

    renderWelcomeList: (containerId, routes, onSelectCallback) => {
        if (typeof document === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = "";
        
        Object.values(routes).forEach(route => {
            if (route.id === 'special_event') return;

            const btn = document.createElement('button');
            const displayName = formatRouteLabelHtml(route.name);
            
            if (route.isActive) {
                let borderColor = 'border-gray-500';
                if (route.colorClass.includes('orange')) borderColor = 'border-orange-500';
                else if (route.colorClass.includes('purple')) borderColor = 'border-purple-500';
                else if (route.colorClass.includes('green')) borderColor = 'border-green-500';
                else if (route.colorClass.includes('blue')) borderColor = 'border-blue-500';
                else if (route.colorClass.includes('red')) borderColor = 'border-red-500';
                else if (route.colorClass.includes('yellow')) borderColor = 'border-yellow-500';
                else if (route.colorClass.includes('indigo')) borderColor = 'border-indigo-500';

                btn.className = `w-full text-left p-4 rounded-xl shadow-md flex items-center justify-between group transition-all transform hover:scale-[1.02] active:scale-95 bg-white dark:bg-gray-800 border-l-4 ${borderColor}`;
                
                btn.innerHTML = `
                    <div class="min-w-0 pr-2">
                        <span class="block text-sm font-bold text-gray-900 dark:text-white truncate">${displayName}</span>
                        <span class="text-xs text-gray-500 dark:text-gray-400">View schedules</span>
                    </div>
                    <svg class="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                `;

                if (typeof onSelectCallback === 'function') {
                    btn.onclick = () => onSelectCallback(route.id);
                }
            } else {
                btn.className = `w-full text-left p-4 rounded-xl shadow-md flex items-center justify-between bg-gray-50 dark:bg-gray-800/40 border-l-4 border-gray-300 dark:border-gray-700 opacity-80 cursor-not-allowed transition-all`;
                
                btn.innerHTML = `
                    <div class="min-w-0 pr-2">
                        <span class="block text-sm font-bold text-gray-500 dark:text-gray-400 truncate">${displayName}</span>
                        <span class="text-[10px] font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest mt-0.5 inline-block">🚧 Coming Soon</span>
                    </div>
                    <svg class="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                `;

                btn.onclick = () => {
                    if (typeof showToast === 'function') {
                        showToast(`The ${formatRouteLabelPlain(route.name)} schedule is launching soon!`, 'info', 2500);
                    }
                };
            }

            container.appendChild(btn);
        });
    },

    // --- 2. LAYOUT PLACEHOLDERS & ERRORS ---

    renderSkeletonLoader: (element) => {
        if (!element) return;
        element.innerHTML = `
            <div class="flex flex-row items-center w-full space-x-3 h-24 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-lg p-2">
                <div class="relative w-1/2 h-full bg-gray-300 dark:bg-gray-700 rounded-lg shadow-sm flex-shrink-0"></div>
                <div class="w-1/2 flex flex-col justify-center items-center space-y-2">
                    <div class="h-3 bg-gray-300 dark:bg-gray-700 rounded w-3/4"></div>
                    <div class="h-2 bg-gray-300 dark:bg-gray-700 rounded w-1/2"></div>
                    <div class="h-5 bg-gray-300 dark:bg-gray-700 rounded w-full mt-1"></div>
                </div>
            </div>
        `;
    },

    renderPlaceholder: (element1, element2) => {
        // Shake the *visible* station field (search input). #station-select stays hidden.
        const triggerShake = `
            const inp = document.getElementById('station-search-input');
            const sel = document.getElementById('station-select');
            const target = (inp && !inp.classList.contains('hidden')) ? inp : sel;
            if (target) {
                target.classList.add('animate-shake', 'ring-4', 'ring-blue-300');
                setTimeout(() => target.classList.remove('animate-shake', 'ring-4', 'ring-blue-300'), 500);
                target.focus?.();
            }
        `.replace(/\n/g, ' ');

        const placeholderHTML = `
            <div onclick="${triggerShake}" class="min-h-[96px] h-auto flex flex-col justify-center items-center text-gray-400 dark:text-gray-500 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors group w-full shadow-sm border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800/50">
                <svg class="w-6 h-6 mb-1 opacity-50 group-hover:scale-110 transition-transform text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                <span class="text-xs font-bold group-hover:text-blue-500 transition-colors">Select station above</span>
            </div>`;

        if (element1) element1.innerHTML = placeholderHTML;
        if (element2) element2.innerHTML = placeholderHTML;
    },

    renderRouteError: (element, error) => {
        const html = `<div class="text-center p-3 bg-red-100 dark:bg-red-900 rounded-md border border-red-400 dark:border-red-700"><div class="text-xl mb-1">⚠️</div><p class="text-red-800 dark:text-red-200 text-sm font-medium">Connection failed. Please check internet.</p></div>`;
        if (element) element.innerHTML = html;
    },

    renderComingSoon: (element, routeName) => {
        const msg = `
            <div class="flex flex-col items-center justify-center p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 border-dashed border-gray-300 dark:border-gray-600 text-center w-full">
                <div class="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4 shadow-inner">
                    <span class="text-3xl">🚧</span>
                </div>
                <h3 class="text-xl font-black text-gray-900 dark:text-white mb-2">Route Under Construction</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
                    We are currently building the digital timetable for the <strong class="text-blue-600 dark:text-blue-400">${formatRouteLabelHtml(routeName)}</strong> corridor.
                </p>
                
                <div class="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800 w-full text-left">
                    <p class="text-xs font-bold text-blue-800 dark:text-blue-300 mb-1 uppercase tracking-wider">Do you commute on this line?</p>
                    <p class="text-xs text-gray-700 dark:text-gray-300 mb-4">
                        If you have recent photos of the official station timetables, you can help us launch this route faster!
                    </p>
                    <a href="https://docs.google.com/forms/d/e/1FAIpQLSe7lhoUNKQFOiW1d6_7ezCHJvyOL5GkHNH1Oetmvdqgee16jw/viewform" target="_blank" class="flex items-center justify-center w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-lg shadow transition-colors text-sm group">
                        <svg class="w-4 h-4 mr-2 group-hover:-translate-y-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4 4m0 0L8 8m4-4v12"></path></svg>
                        Share Schedules
                    </a>
                </div>
            </div>
        `;
        if (element) {
            const pHeader = document.getElementById('pretoria-header');
            const pienHeader = document.getElementById('pienaarspoort-header');
            
            if (pHeader) pHeader.parentElement.style.display = 'none';
            if (pienHeader) pienHeader.parentElement.style.display = 'none';
            
            const parent = element.closest('.space-y-6') || element.closest('.space-y-4');
            if (parent) {
                parent.innerHTML = msg;
            } else {
                element.innerHTML = msg;
            }
        }
    },

    renderAtDestination: (element) => {
        if (!element) return;
        element.innerHTML = `
            <div class="h-24 flex flex-col justify-center items-center gap-1.5">
                <svg class="w-7 h-7 text-blue-500 dark:text-blue-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
                </svg>
                <div class="text-sm font-bold text-gray-900 dark:text-white">You're here</div>
            </div>
        `;
    },

    renderNoWeekendService: (element, destination, firstNextTrain, dayOffset) => {
        let timeHTML = 'N/A';
        const nextDayInfo = typeof window.getLookaheadDayInfo === 'function'
            ? window.getLookaheadDayInfo(dayOffset || 1)
            : { name: 'Monday', type: 'weekday' };

        if (firstNextTrain) {
            const rawTime = firstNextTrain.departureTime || firstNextTrain.train1.departureTime;
            const departureTime = formatTimeDisplay(rawTime);
            let timeDiffStr = (typeof window.calculateTimeDiffString === 'function')
                ? window.calculateTimeDiffString(rawTime, dayOffset)
                : "";
            if (timeDiffStr) timeDiffStr = timeDiffStr.replace(/(\d+)h\s(\d+)m/, '$1 hr $2 min').replace(/(\d+)m\)/, '$1 min)');
            timeHTML = `<div class="text-xl font-bold text-gray-900 dark:text-white">${departureTime}</div><div class="text-xs text-gray-700 dark:text-gray-300 font-medium">${timeDiffStr}</div>`;
        } else {
            timeHTML = `<div class="text-lg font-bold text-gray-500">No Data</div>`;
        }

        const safeDestForClick = escapeHTML(destination).replace(/&#39;/g, "\\'");
        const buttonHTML = `<button onclick="window.openScheduleModal('${safeDestForClick}', '${nextDayInfo.type}')" class="mt-2 text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide border border-blue-200 dark:border-blue-800 px-3 py-1 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">See ${nextDayInfo.name} Schedule</button>`;

        let dayText = nextDayInfo.name;
        if (dayText !== "Tomorrow") dayText = `on ${dayText}`;

        element.innerHTML = `
            <div class="flex flex-col justify-center items-center w-full py-3 px-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in-up">
                <div class="text-sm font-bold text-red-600 dark:text-red-400">No weekend service</div>
                <p class="text-[10px] text-gray-500 dark:text-gray-400 mt-1 text-center px-2 leading-snug">This route does not run on Saturdays</p>
                <p class="text-[10px] text-gray-400 dark:text-gray-50 mt-2">First train ${dayText} is at:</p>
                <div class="text-center p-2 bg-gray-50 dark:bg-gray-900/50 rounded-md transition-all mt-1 w-3/4 shadow-sm border border-gray-100 dark:border-gray-800">
                    ${timeHTML}
                </div>
                ${buttonHTML}
            </div>
        `;
    },

    renderNoService: (element, destination, firstNextTrain, dayOffset, openModalCallback) => {
        let timeHTML = 'N/A';
        
        const nextDayInfo = typeof window.getLookaheadDayInfo === 'function' 
            ? window.getLookaheadDayInfo(dayOffset || 1) 
            : { name: 'Monday', type: 'weekday' };

        if (firstNextTrain) {
            const rawTime = firstNextTrain.departureTime || firstNextTrain.train1.departureTime;
            const departureTime = formatTimeDisplay(rawTime);
            let timeDiffStr = (typeof window.calculateTimeDiffString === 'function') 
                ? window.calculateTimeDiffString(rawTime, dayOffset) 
                : ""; 
            
            if (timeDiffStr) timeDiffStr = timeDiffStr.replace(/(\d+)h\s(\d+)m/, '$1 hr $2 min').replace(/(\d+)m\)/, '$1 min)');
            
            timeHTML = `<div class="text-xl font-bold text-gray-900 dark:text-white">${departureTime}</div><div class="text-xs text-gray-700 dark:text-gray-300 font-medium">${timeDiffStr}</div>`;
        } else {
            timeHTML = `<div class="text-lg font-bold text-gray-500">No Data</div>`;
        }
        
        const safeDestForClick = escapeHTML(destination).replace(/&#39;/g, "\\'");
        const buttonHTML = `<button onclick="window.openScheduleModal('${safeDestForClick}', '${nextDayInfo.type}')" class="mt-2 text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide border border-blue-200 dark:border-blue-800 px-3 py-1 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">Check ${nextDayInfo.name} Schedule</button>`;

        let dayText = nextDayInfo.name;
        if (dayText !== "Tomorrow") dayText = `on ${dayText}`;

        // --- GUARDIAN PHASE 4: CROSS-CORRIDOR LIVE BOARD DISRUPTION EVALUATOR ---
        let disruptionHtml = '';
        if (typeof window.getTripDisruptions === 'function' && true) {
            let stopsArray = [];
            const origin = (typeof (document.getElementById("station-select")) !== 'undefined' && (document.getElementById("station-select"))) ? (document.getElementById("station-select")).value : "";
            if (origin && typeof (window.allStations || []) !== 'undefined' && (window.allStations || []).length > 0) {
                const oIdx = (window.allStations || []).findIndex(s => normalizeStationName(s) === normalizeStationName(origin));
                const dIdx = (window.allStations || []).findIndex(s => normalizeStationName(s) === normalizeStationName(destination));
                if (oIdx !== -1 && dIdx !== -1) {
                    const start = Math.min(oIdx, dIdx);
                    const end = Math.max(oIdx, dIdx);
                    for (let i = start; i <= end; i++) stopsArray.push({ station: (window.allStations || [])[i] });
                } else {
                    stopsArray = [{ station: origin }, { station: destination }];
                }
            } else {
                stopsArray = [{ station: origin || "" }, { station: destination }];
            }

            const activeDisruptions = window.getTripDisruptions((window._liveRouteId), stopsArray);
            if (activeDisruptions && activeDisruptions.length > 0) {
                const routeDisruption = activeDisruptions.find(d => d.tier === 'CRITICAL') || activeDisruptions[0];
                
                const isCritical = routeDisruption.tier === 'CRITICAL';
                const btnClass = isCritical
                    ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-800/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/50' 
                    : 'bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-800/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800/50';

                const svgIcon = isCritical 
                    ? `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
                    : `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

                const labelText = routeDisruption.buttonText ? escapeHTML(routeDisruption.buttonText) : (isCritical ? 'Line Severed' : 'Expect Delays');
                
                disruptionHtml = `
                    <div class="mt-1 flex justify-center w-full px-2">
                        <button type="button" onclick="window.openDisruptionModal('${routeDisruption.id}')" class="${btnClass} px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border transition-colors shadow-sm flex items-center animate-pulse truncate max-w-full focus:outline-none">
                            ${svgIcon} <span class="truncate">${labelText}</span>
                        </button>
                    </div>
                `;
            }
        }

        element.innerHTML = `
            <div class="flex flex-col justify-center items-center w-full py-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in-up">
                <div class="text-sm font-bold text-gray-600 dark:text-gray-400">No service today</div>
                ${disruptionHtml}
                <p class="text-[10px] text-gray-400 dark:text-gray-50 mt-1">First train ${dayText} is at:</p>
                <div class="text-center p-2 bg-gray-50 dark:bg-gray-900/50 rounded-md transition-all mt-1 w-3/4 shadow-sm border border-gray-100 dark:border-gray-800">
                    ${timeHTML}
                </div>
                ${buttonHTML}
            </div>
        `;
    },

    renderNextAvailableTrain: (element, destination, firstTrain, dayName, dayType, dayOffset) => {
        const rawTime = firstTrain.departureTime || firstTrain.train1.departureTime;
        const departureTime = formatTimeDisplay(rawTime);
        let timeDiffStr = (typeof window.calculateTimeDiffString === 'function') 
            ? window.calculateTimeDiffString(rawTime, dayOffset) 
            : "";
        
        if (timeDiffStr) timeDiffStr = timeDiffStr.replace(/(\d+)h\s(\d+)m/, '$1 hr $2 min').replace(/(\d+)m\)/, '$1 min)');
        
        const safeDest = escapeHTML(destination);
        const safeDestForClick = safeDest.replace(/&#39;/g, "\\'"); 

        let dayText = dayName;
        if (dayText !== "Tomorrow") dayText = `on ${dayText}`;

        // --- GUARDIAN PHASE 4: CROSS-CORRIDOR LIVE BOARD DISRUPTION EVALUATOR ---
        let disruptionHtml = '';
        if (typeof window.getTripDisruptions === 'function' && true) {
            let stopsArray = [];
            const origin = (typeof (document.getElementById("station-select")) !== 'undefined' && (document.getElementById("station-select"))) ? (document.getElementById("station-select")).value : "";
            if (origin && typeof (window.allStations || []) !== 'undefined' && (window.allStations || []).length > 0) {
                const oIdx = (window.allStations || []).findIndex(s => normalizeStationName(s) === normalizeStationName(origin));
                const dIdx = (window.allStations || []).findIndex(s => normalizeStationName(s) === normalizeStationName(destination));
                if (oIdx !== -1 && dIdx !== -1) {
                    const start = Math.min(oIdx, dIdx);
                    const end = Math.max(oIdx, dIdx);
                    for (let i = start; i <= end; i++) stopsArray.push({ station: (window.allStations || [])[i] });
                } else {
                    stopsArray = [{ station: origin }, { station: destination }];
                }
            } else {
                stopsArray = [{ station: origin || "" }, { station: destination }];
            }

            const activeDisruptions = window.getTripDisruptions((window._liveRouteId), stopsArray);
            if (activeDisruptions && activeDisruptions.length > 0) {
                const routeDisruption = activeDisruptions.find(d => d.tier === 'CRITICAL') || activeDisruptions[0];
                
                const isCritical = routeDisruption.tier === 'CRITICAL';
                const btnClass = isCritical
                    ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-800/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/50' 
                    : 'bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-800/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800/50';

                const svgIcon = isCritical 
                    ? `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
                    : `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

                const labelText = routeDisruption.buttonText ? escapeHTML(routeDisruption.buttonText) : (isCritical ? 'Line Severed' : 'Expect Delays');
                
                disruptionHtml = `
                    <div class="mt-1 flex justify-center w-full px-2">
                        <button type="button" onclick="window.openDisruptionModal('${routeDisruption.id}')" class="${btnClass} px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border transition-colors shadow-sm flex items-center animate-pulse truncate max-w-full focus:outline-none">
                            ${svgIcon} <span class="truncate">${labelText}</span>
                        </button>
                    </div>
                `;
            }
        }

        element.innerHTML = `
            <div class="flex flex-col justify-center items-center w-full py-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in-up">
                <div class="text-sm font-bold text-gray-600 dark:text-gray-400">No more trains today</div>
                ${disruptionHtml}
                <p class="text-[10px] text-gray-400 dark:text-gray-50 mt-1">First train ${dayText} is at:</p>
                <div class="text-center p-2 bg-gray-50 dark:bg-gray-900/50 rounded-md transition-all mt-1 w-3/4 shadow-sm border border-gray-100 dark:border-gray-800">
                    <div class="text-xl font-bold text-gray-900 dark:text-white">${departureTime}</div>
                    <div class="text-xs text-gray-700 dark:text-gray-300 font-medium">${timeDiffStr}</div>
                </div>
                <button onclick="window.openScheduleModal('${safeDestForClick}', '${dayType}')" class="mt-2 text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide border border-blue-200 dark:border-blue-800 px-3 py-1 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">See ${dayName} Schedule</button>
            </div>
        `;
    },

    renderJourney: (element, journey, destination) => {
        element.innerHTML = "";
        
        let timeClass = "bg-gray-200 dark:bg-gray-900";
        if (journey.isLastTrain) {
            timeClass = "bg-red-100 dark:bg-red-900 border-2 border-red-500";
        } else if (journey.isFirstTrain) {
            timeClass = "bg-green-100 dark:bg-green-900 border-2 border-green-500";
        }
        
        const rawTime = journey.departureTime || journey.train1.departureTime;
        const safeTrainName = escapeHTML(journey.train || journey.train1.train);
        const safeDest = escapeHTML(destination);
        const liveStation = (typeof document !== 'undefined' && document.getElementById('station-select')?.value) || '';
        const liveTrainId = journey.train || journey.train1?.train || '';
        const liveArrRaw = journey.arrivalTime || journey.train1?.arrivalAtTransfer || '';
        const liveDeco = decorateJourneyLive(liveTrainId, liveStation, rawTime, liveArrRaw);
        const clockTime = liveDeco.useLive ? liveDeco.liveTime : rawTime;
        const safeDepTime = escapeHTML(formatTimeDisplay(clockTime));
        let timeDiffStr = (typeof window.calculateTimeDiffString === 'function') 
            ? window.calculateTimeDiffString(clockTime) 
            : "";
            
        if (timeDiffStr) timeDiffStr = timeDiffStr.replace(/(\d+)h\s(\d+)m/, '$1 hr $2 min').replace(/(\d+)m\)/, '$1 min)');
        const schedNote = liveDeco.schedNote
            ? `<div class="text-[9px] font-semibold text-gray-500 dark:text-gray-400 mt-0.5">${escapeHTML(liveDeco.schedNote)}</div>`
            : '';
        const liveHintHtml = liveDeco.liveHint
            ? `<div class="text-[9px] font-bold text-blue-600 dark:text-blue-300 mt-0.5">${escapeHTML(liveDeco.liveHint)}</div>`
            : '';
        const livePulseHtml = trainHasLivePing(liveTrainId)
            ? `<button type="button" data-focus-train="${escapeHTML(String(liveTrainId))}" class="nt-live-train-pulse shrink-0 p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-full" aria-label="Train ${escapeHTML(String(liveTrainId))} is live — open map"><span class="block w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.35)] animate-pulse"></span></button>`
            : '';
        const onTrainHtml = (isRideCheckInEnabled() && liveTrainId)
            ? `<button type="button" class="nt-on-train-btn mt-1 w-full text-[9px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 hover:underline focus:outline-none" data-on-train="${escapeHTML(String(liveTrainId))}" data-station="${escapeHTML(liveStation)}" data-dest="${escapeHTML(destination || '')}" data-route="${escapeHTML((typeof window !== 'undefined' && window._liveRouteId) || '')}" data-time="${escapeHTML(String(rawTime || ''))}">I’m on this train</button>`
            : '';
        
        const safeDestForClick = safeDest.replace(/&#39;/g, "\\'"); 
        const buttonHtml = `<button onclick="window.openScheduleModal('${safeDestForClick}')" class="absolute bottom-0 left-0 w-full text-[9px] uppercase tracking-tight font-bold py-1.5 px-0.5 bg-black bg-opacity-10 hover:bg-opacity-20 dark:bg-white dark:bg-opacity-10 dark:hover:bg-opacity-20 rounded-b-lg transition-colors leading-tight focus:outline-none">See Upcoming Trains</button>`;

        let sharedTag = "";
        if (journey.isShared && journey.sourceRoute) {
             const routeName = shortSharedSourceLabel(journey.sourceRoute);

             if (journey.isDivergent) {
                 const divDest = Renderer._applyUIIntercepts(journey.actualDestName);
                 sharedTag = `<span class="block text-[9px] uppercase font-bold text-red-600 dark:text-red-400 mt-0.5 bg-red-100 dark:bg-red-900 px-1 rounded w-fit mx-auto border border-red-200 dark:border-red-700">⚠️ To ${divDest}</span>`;
             } else {
                 sharedTag = `<span class="block text-[9px] uppercase font-bold text-purple-600 dark:text-purple-400 mt-0.5 bg-purple-100 dark:bg-purple-900 px-1 rounded w-fit mx-auto">From ${routeName}</span>`;
             }
        }

        // --- GUARDIAN PHASE 4: CROSS-CORRIDOR LIVE BOARD DISRUPTION EVALUATOR ---
        let disruptionHtml = '';
        let isForceTerminated = false;
        let overrideActualDest = null;
        
        if (typeof window.getTripDisruptions === 'function' && true) {
            let stopsArray = [];
            const origin = (typeof (document.getElementById("station-select")) !== 'undefined' && (document.getElementById("station-select"))) ? (document.getElementById("station-select")).value : "";
            if (origin && typeof (window.allStations || []) !== 'undefined' && (window.allStations || []).length > 0) {
                const oIdx = (window.allStations || []).findIndex(s => normalizeStationName(s) === normalizeStationName(origin));
                const dIdx = (window.allStations || []).findIndex(s => normalizeStationName(s) === normalizeStationName(destination));
                if (oIdx !== -1 && dIdx !== -1) {
                    const start = Math.min(oIdx, dIdx);
                    const end = Math.max(oIdx, dIdx);
                    for (let i = start; i <= end; i++) stopsArray.push({ station: (window.allStations || [])[i] });
                } else {
                    stopsArray = [{ station: origin }, { station: destination }];
                }
            } else {
                stopsArray = [{ station: origin || "" }, { station: destination }];
            }

            const activeDisruptions = window.getTripDisruptions((window._liveRouteId), stopsArray);
            if (activeDisruptions && activeDisruptions.length > 0) {
                // Priority: CRITICAL first, then WARNING
                const routeDisruption = activeDisruptions.find(d => d.tier === 'CRITICAL') || activeDisruptions[0];
                
                const isCritical = routeDisruption.tier === 'CRITICAL';
                const btnClass = isCritical
                    ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-800/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/50' 
                    : 'bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-800/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800/50';

                const svgIcon = isCritical 
                    ? `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
                    : `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

                const labelText = routeDisruption.buttonText ? escapeHTML(routeDisruption.buttonText) : (isCritical ? 'Line Severed' : 'Expect Delays');
                
                disruptionHtml = `
                    <div class="mt-1.5 flex justify-center w-full px-1">
                        <button type="button" onclick="window.openDisruptionModal('${routeDisruption.id}')" class="${btnClass} px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border transition-colors shadow-sm flex items-center animate-pulse truncate max-w-full focus:outline-none">
                            ${svgIcon} <span class="truncate">${labelText}</span>
                        </button>
                    </div>
                `;

                // Terminal Truncation Logic for CRITICAL Severances
                if (routeDisruption.tier === 'CRITICAL' && routeDisruption.stations && routeDisruption.stations.length >= 2) {
                    if (origin && typeof (window.allStations || []) !== 'undefined' && (window.allStations || []).length > 0) {
                        
                        const getNormalizedIdx = (station) => {
                            if (!station) return -1;
                            const normTarget = normalizeStationName(station);
                            return (window.allStations || []).findIndex(s => normalizeStationName(s) === normTarget);
                        };

                        const originIdx = getNormalizedIdx(origin);
                        const cutAIdx = getNormalizedIdx(routeDisruption.stations[0]);
                        const cutBIdx = getNormalizedIdx(routeDisruption.stations[1]);
                        const destIdx = getNormalizedIdx(destination);

                        if (originIdx !== -1 && destIdx !== -1 && cutAIdx !== -1 && cutBIdx !== -1) {
                            const minCut = Math.min(cutAIdx, cutBIdx);
                            const maxCut = Math.max(cutAIdx, cutBIdx);
                            const minTrip = Math.min(originIdx, destIdx);
                            const maxTrip = Math.max(originIdx, destIdx);

                            // If trip originates on one side of the cut and destination is on the other
                            if (minTrip <= minCut && maxTrip >= maxCut) {
                                const distA = Math.abs(cutAIdx - originIdx);
                                const distB = Math.abs(cutBIdx - originIdx);
                                const terminalStation = distA < distB ? routeDisruption.stations[0] : routeDisruption.stations[1];
                                
                                overrideActualDest = terminalStation;
                                isForceTerminated = true;
                            }
                        }
                    }
                }
            }
        }
        // ---------------------------------------------------------

        const reportStation = (typeof document !== 'undefined' && document.getElementById('station-select')?.value) || '';
        const reportRouteId = (typeof window !== 'undefined' && window._liveRouteId) || '';
        const reportTrainId = journey.train || journey.train1?.train || '';
        const reportArr = journey.arrivalTime || journey.train1?.arrivalAtTransfer || '';
        const reportCtx = {
            routeId: reportRouteId,
            trainId: reportTrainId,
            scheduledTime: rawTime,
            arrivalTime: reportArr,
            station: reportStation,
            destination: destination || '',
        };
        const reportSlotHtml = buildTrainReportSlotHtml(reportCtx);

        if (journey.type === 'direct') {
            let actualDest = journey.actualDestination ? Renderer._applyUIIntercepts(normalizeStationName(journey.actualDestination)) : '';
            if (isForceTerminated && overrideActualDest) {
                actualDest = Renderer._applyUIIntercepts(normalizeStationName(overrideActualDest));
            }
            const normDest = Renderer._applyUIIntercepts(normalizeStationName(destination));
            
            let trainTitle = `Direct Train ${safeTrainName}`;
            let titleColor = "text-gray-900 dark:text-white";
            
            if (journey.isLastTrain) {
                trainTitle = `Direct Train ${safeTrainName}`;
                titleColor = "text-red-600 dark:text-red-400";
            }

            const shownArr = liveDeco.useLive && liveDeco.liveArrival ? liveDeco.liveArrival : journey.arrivalTime;
            let detailLine = shownArr ? `Arrives ${escapeHTML(formatTimeDisplay(shownArr))}` : "Arrival time n/a.";
            let detailColor = "text-gray-700 dark:text-gray-300";

            if (actualDest && normDest && actualDest !== normDest) {
                detailLine = `Terminates at ${actualDest}`;
                detailColor = isForceTerminated ? "text-red-600 dark:text-red-400 font-black" : "text-orange-700 dark:text-orange-400 font-bold";
            }

            const titleBtn = buildTrainTitleReportButton({
                label: trainTitle,
                ...reportCtx,
                className: `inline-flex items-center justify-center max-w-full text-[11px] font-bold ${titleColor} leading-tight mb-1 uppercase tracking-wide focus:outline-none hover:opacity-80 active:scale-[0.98] transition`,
            });

            element.innerHTML = `
                <div class="flex flex-row items-stretch w-full gap-2.5 sm:gap-3">
                    <!-- TIME BOX -->
                    <div class="relative w-[42%] min-w-[7.75rem] max-w-[10.5rem] h-auto min-h-[96px] flex flex-col justify-center items-center text-center p-1 pb-7 ${timeClass} rounded-lg shadow-sm flex-shrink-0 self-stretch">
                        <div class="text-2xl font-black text-gray-900 dark:text-white leading-tight">${safeDepTime}</div>
                        <div class="text-xs text-gray-700 dark:text-gray-300 font-bold">${timeDiffStr}</div>
                        ${liveHintHtml}
                        ${schedNote}
                        ${sharedTag}
                        ${buttonHtml}
                    </div>
                    
                    <!-- DESCRIPTION BOX -->
                    <div class="flex-1 min-w-0 h-auto min-h-[96px] flex flex-col justify-center items-center text-center p-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg overflow-hidden self-stretch">
                        <div class="flex items-center justify-center gap-1 max-w-full">${livePulseHtml}${titleBtn}</div>
                        <div class="text-[10px] ${detailColor} leading-tight truncate w-full px-1 min-w-0" title="${detailLine}">
                            ${detailLine}
                        </div>
                        ${disruptionHtml}
                        ${reportSlotHtml}
                        ${onTrainHtml}
                    </div>
                </div>
            `;
        } else if (journey.type === 'transfer') {
            const conn = journey.connection; 
            const nextFull = journey.nextFullJourney; 
            
            const rawDest = journey.train1.headboardDestination || journey.train1.terminationStation;
            const displayDest = Renderer._applyUIIntercepts(escapeHTML(rawDest));
            const arrivalAtTransfer = escapeHTML(formatTimeDisplay(journey.train1.arrivalAtTransfer));
            
            const connTrain = escapeHTML(conn.train);
            const connDest = Renderer._applyUIIntercepts(escapeHTML(conn.actualDestination));
            const connDep = escapeHTML(formatTimeDisplay(conn.departureTime));
            const finalDestTitle = Renderer._applyUIIntercepts(escapeHTML(destination));

            let train1Label = `Train ${safeTrainName}`;
            let titleColor = "text-gray-900 dark:text-white";
            if (journey.isLastTrain) titleColor = "text-red-600 dark:text-red-400";

            const shuttleBtn = buildTrainTitleReportButton({
                label: `Shuttle ${train1Label}`,
                ...reportCtx,
                className: `inline-flex items-center justify-center max-w-full text-[11px] font-black ${titleColor} uppercase tracking-wide mb-0.5 focus:outline-none hover:opacity-80`,
            });
            const connectBtn = buildTrainTitleReportButton({
                label: `Connect Train ${conn.train}`,
                routeId: reportRouteId,
                trainId: conn.train,
                scheduledTime: conn.departureTime,
                arrivalTime: '',
                station: reportStation,
                destination: conn.actualDestination || destination || '',
                className: 'inline-flex items-center justify-center max-w-full text-[11px] font-black text-blue-700 dark:text-blue-300 uppercase tracking-wide mb-0.5 focus:outline-none hover:opacity-80',
            });
            
            let bottomBlock = "";
            
            if (nextFull) {
                const nextTrain = escapeHTML(nextFull.train);
                const nextDep = escapeHTML(formatTimeDisplay(nextFull.departureTime));
                
                bottomBlock = `
                    <div class="text-[9px] leading-tight w-full space-y-1 min-w-0">
                        <div class="mb-1">
                             ${connectBtn}
                             <div class="text-[9px] text-gray-600 dark:text-gray-400 font-bold truncate w-full">To ${connDest} <span class="font-normal opacity-80">(From ${connDep})</span></div>
                        </div>
                        <div class="italic text-gray-500 dark:text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-1 mt-1 truncate w-full" title="${finalDestTitle}: Train ${nextTrain} from ${nextDep}">
                            ${finalDestTitle}: Train ${nextTrain} from ${nextDep}
                        </div>
                    </div>
                `;
            } else {
                bottomBlock = `
                    <div class="text-[10px] leading-tight w-full min-w-0">
                        ${connectBtn}
                        <div class="text-[9px] text-gray-600 dark:text-gray-400 font-bold truncate w-full">To ${connDest} <span class="font-normal opacity-80">(From ${connDep})</span></div>
                    </div>
                `;
            }
            
            element.innerHTML = `
                <div class="flex flex-row items-stretch w-full gap-2.5 sm:gap-3">
                    <!-- TIME BOX -->
                    <div class="relative w-[42%] min-w-[7.75rem] max-w-[10.5rem] h-auto min-h-[110px] flex flex-col justify-center items-center text-center p-1 pb-7 ${timeClass} rounded-lg shadow-sm flex-shrink-0 self-stretch">
                        <div class="text-2xl font-black text-gray-900 dark:text-white leading-tight">${safeDepTime}</div>
                        <div class="text-xs text-gray-700 dark:text-gray-300 font-bold">${timeDiffStr}</div>
                        ${liveHintHtml}
                        ${schedNote}
                        ${sharedTag}
                        ${buttonHtml}
                    </div>
                    
                    <!-- DESCRIPTION BOX -->
                    <div class="flex-1 min-w-0 flex flex-col justify-center items-center text-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg h-full min-h-[110px] overflow-hidden self-stretch">
                        <div class="border-b border-gray-200 dark:border-gray-700 pb-2 mb-2 w-full min-w-0">
                            <div class="flex items-center justify-center gap-1 max-w-full">${livePulseHtml}${shuttleBtn}</div>
                            <div class="text-[9px] text-gray-600 dark:text-gray-400 font-bold truncate w-full px-1" title="To ${displayDest} (Arr ${arrivalAtTransfer})">To ${displayDest} <span class="font-normal opacity-80">(Arr ${arrivalAtTransfer})</span></div>
                        </div>
                        ${bottomBlock}
                        ${disruptionHtml}
                        ${reportSlotHtml}
                        ${onTrainHtml}
                    </div>
                </div>
            `;
        }
    },


    // --- 3. TIMETABLE DAILY MATRIX COMPILER ---

    _buildGridHTML: (schedule, sheetName, routeId, dayIdx, highlightNextTrain = true, isExport = false) => {
        const trainCols = schedule.headers.slice(1).filter(header => /^\d{4}[a-zA-Z]*$/.test(header.trim()));
        let sortedCols = [];

        if (MANUAL_GRID_ORDER[sheetName]) {
            const manualOrder = MANUAL_GRID_ORDER[sheetName];
            manualOrder.forEach(tNum => { if (trainCols.includes(tNum)) sortedCols.push(tNum); });
            const manualSet = new Set(manualOrder);
            const remainingCols = trainCols.filter(t => !manualSet.has(t));
            remainingCols.sort((a, b) => a.localeCompare(b));
            sortedCols = [...sortedCols, ...remainingCols];
        } else {
            // Earliest-time fallback when no manual order exists for this sheet
            const colStats = trainCols.map(colId => {
                let earliestTime = 86400 * 2;
                let hasData = false;
                for (const row of schedule.rows) {
                    const val = row[colId];
                    if (isRealTime(val)) {
                        const t = timeToSeconds(val);
                        if (t > 0) {
                            if (t < earliestTime) earliestTime = t;
                            hasData = true;
                        }
                    }
                }
                return { id: colId, time: earliestTime, hasData };
            });
            colStats.sort((a, b) => {
                if (!a.hasData && !b.hasData) return a.id.localeCompare(b.id);
                if (!a.hasData) return 1;
                if (!b.hasData) return -1;
                return a.time - b.time;
            });
            sortedCols = colStats.map(c => c.id);
        }

        let selectedStation = "";
        if (!isExport && typeof document !== 'undefined') {
            const selectEl = document.getElementById('station-select');
            if (selectEl && 'value' in selectEl && selectEl.value) {
                selectedStation = selectEl.value;
            }
        }

        let activeColIndex = -1;
        
        if (highlightNextTrain && !isExport && typeof currentTime !== 'undefined') {
             const nowSec = timeToSeconds(getCurrentTime());
             for (let i = 0; i < sortedCols.length; i++) {
                 let targetTimeSec = 0;
                 let foundTime = false;

                 if (selectedStation) {
                     const targetRow = schedule.rows.find(r => r.STATION === selectedStation);
                     if (targetRow) {
                         const val = targetRow[sortedCols[i]];
                         if (val && val !== "-" && /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(String(val).trim())) {
                             targetTimeSec = timeToSeconds(val);
                             foundTime = true;
                         }
                     }
                 }
                 
                 if (!foundTime) {
                     for (const row of schedule.rows) {
                         const val = row[sortedCols[i]];
                         if (val && val !== "-" && /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(String(val).trim())) {
                             targetTimeSec = timeToSeconds(val);
                             foundTime = true;
                             break;
                         }
                     }
                 }

                 if (foundTime && targetTimeSec >= nowSec) { activeColIndex = i; break; }
             }
        }

        const showRightAnchor = isExport && sortedCols.length >= 20;
        const getAbbrev = (name) => {
            const map = {
                "PRETORIA": "PTA", "JOHANNESBURG": "JHB", "GERMISTON": "GERM", "MABOPANE": "MABO",
                "SAULSVILLE": "SAUL", "BELLE OMBRE": "BELL", "PIENAARSPOORT": "PIEN", "KEMPTON PARK": "KEMP",
                "CAPE TOWN": "CPT", "BELLVILLE": "BELL", "KOEDOESPOORT": "KOED", "ATTERIDGEVILLE": "ATTR",
                "LERALLA": "LERA", "KWESINE": "KWES", "RANDFONTEIN": "RAND", "NALEDI": "NALD"
            };
            const upper = name.trim().toUpperCase();
            return map[upper] || upper.substring(0, 4);
        };

        const isTallGrid = !isExport && schedule.rows.length > 15;
        const paddingClass = isExport ? 'p-2' : (isTallGrid ? 'py-2 px-3' : 'p-3'); 
        const fontSizeClass = isExport ? 'text-sm' : 'text-xs'; 
        const minWidthClass = showRightAnchor ? 'min-w-[46px]' : 'min-w-[70px]';
        
        let tableClass = isExport ? (showRightAnchor ? 'export-compact' : '') : 'bg-white dark:bg-gray-900';
        let theadClass = isExport ? '' : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-200'; 
        let stickyHeaderClass = isExport ? '' : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700'; 
        let borderClass = isExport ? 'border-gray-300' : 'border-gray-300 dark:border-gray-700';
        let tbodyClass = isExport ? '' : 'bg-white dark:bg-gray-900';
        let stickyCellClass = isExport ? '' : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white';

        let gridNoticeHtml = '';
        const globalExclData = $globalExclusions.get();
        if (!isExport && globalExclData && globalExclData[routeId] && globalExclData[routeId]['_grid_notice']) {
            const noticeText = globalExclData[routeId]['_grid_notice'].text;
            if (noticeText && noticeText.trim() !== '') {
                const cleanText = escapeHTML(noticeText);
                gridNoticeHtml = `
                    <div class="bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500 p-3 mx-3 my-4 text-[11px] sm:text-xs text-blue-800 dark:text-blue-300 font-medium shadow-sm rounded-r flex items-start">
                        <span class="mr-2 text-sm leading-none">ℹ️</span>
                        <div>
                            <b class="font-black uppercase tracking-wider block mb-0.5">Service Update</b>
                            <span class="leading-relaxed">${cleanText}</span>
                        </div>
                    </div>
                `;
            }
        }

        let html = `
            ${gridNoticeHtml}
            <table class="w-full ${fontSizeClass} text-left border-collapse ${tableClass}">
                <thead class="text-[10px] uppercase ${theadClass} sticky top-0 z-20 shadow-sm">
                    <tr>
                        <th class="sticky left-0 z-30 ${stickyHeaderClass} ${paddingClass} border-b border-r font-bold min-w-[140px] shadow-lg text-left pl-3">Station</th>
                        ${sortedCols.map((h, i) => {
                            const isHighlight = i === activeColIndex;
                            const exclusionType = isTrainExcluded(h, routeId, dayIdx);
                            
                            let bgClass = '';
                            let headerContent = h;
                            
                            if (exclusionType === 'special') {
                                const splIcon = `<svg class="inline-block w-2 h-2 mr-0.5 mb-[1px]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
                                if (isExport) {
                                    bgClass = 'export-spl-col relative';
                                    headerContent = `<span style="position:absolute; top:2px; left:0; width:100%; font-size:7px; color:#16a34a; font-weight:900; letter-spacing:0.5px; display:flex; justify-content:center; align-items:center;">${splIcon} SPL</span>${h}`;
                                } else {
                                    bgClass = 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 opacity-95 relative';
                                    headerContent = `<span class="absolute top-[2px] left-0 w-full text-[8px] text-green-600 dark:text-green-500 font-black tracking-tight leading-none flex justify-center items-center">${splIcon} SPL</span>${h}`;
                                }
                            } else if (exclusionType) {
                                const banIcon = `<svg class="inline-block w-2 h-2 mr-0.5 mb-[1px]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`;
                                if (isExport) {
                                    bgClass = 'export-banned-col relative';
                                    headerContent = `<span style="position:absolute; top:2px; left:0; width:100%; font-size:7px; color:#dc2626; font-weight:900; letter-spacing:0.5px; display:flex; justify-content:center; align-items:center;">${banIcon} NO SVC</span>${h}`;
                                } else {
                                    bgClass = 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 opacity-90 relative';
                                    headerContent = `<span class="absolute top-[2px] left-0 w-full text-[8px] text-red-600 dark:text-red-500 font-black tracking-tight leading-none flex justify-center items-center">${banIcon} NO SVC</span>${h}`;
                                }
                            } else if (!isExport && isHighlight) {
                                bgClass = 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300 font-bold';
                            }

                            return `<th class="${paddingClass} border-b border-r ${borderClass} whitespace-nowrap text-center ${bgClass} ${minWidthClass}" ${isHighlight ? 'id="grid-active-col"' : ''}>${headerContent}</th>`;
                        }).join('')}
                        ${showRightAnchor ? `<th class="right-anchor-header sticky right-0 z-30 ${stickyHeaderClass} ${paddingClass} border-b border-l ${borderClass} font-bold min-w-[50px] shadow-[-4px_0_10px_rgba(0,0,0,0.05)] text-center bg-gray-100 dark:bg-gray-800">STN</th>` : ''}
                    </tr>
                </thead>
                <tbody class="divide-y ${borderClass} ${tbodyClass}">
        `;

        let validRowIndex = 0;
        schedule.rows.forEach(row => {
            if (!row.STATION || row.STATION.toLowerCase().includes('updated')) return; 
            const cleanStation = row.STATION.replace(' STATION', '');
            let hasData = false;
            sortedCols.forEach(col => { if (row[col] && row[col] !== "-" && row[col] !== "") hasData = true; });
            if (!hasData) return;

            const isSelectedRow = (!isExport && row.STATION === selectedStation);
            const isZebra = (validRowIndex % 2 === 1);
            let currentStickyCellClass = stickyCellClass;
            
            if (isSelectedRow) {
                currentStickyCellClass = isExport ? '' : 'bg-blue-50 dark:bg-blue-900 border-gray-300 dark:border-gray-700 text-blue-900 dark:text-blue-100';
            } else if (isZebra && !isExport) {
                currentStickyCellClass = 'bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white';
            }

            let rowClass = isSelectedRow ? 'bg-blue-50 dark:bg-blue-900/20' : (isZebra && !isExport ? 'bg-gray-50 dark:bg-gray-800/40' : '');
            if (isZebra && isExport) rowClass += ' export-zebra';

            html += `
                <tr class="${rowClass.trim()}">
                    <td class="sticky left-0 z-10 ${currentStickyCellClass} ${paddingClass} border-r font-bold truncate max-w-[140px] shadow-lg border-b text-left pl-3">${cleanStation}</td>
                    ${sortedCols.map((col, i) => {
                        let val = row[col] || "-";
                        if (val !== "-") {
                            if (isRealTime(val)) {
                                val = formatTimeDisplay(val); 
                            } else {
                                val = "-";
                            }
                        }

                        const isHighlight = i === activeColIndex;
                        const exclusionType = isTrainExcluded(col, routeId, dayIdx);

                        let cellClass = `${paddingClass} text-center border-r ${borderClass} border-b`;
                        
                        if (val !== "" && val !== "-") {
                            cellClass += " font-mono font-medium";
                            if (exclusionType === 'special') {
                                if (isExport) cellClass += " export-spl-cell";
                                else cellClass += " text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 opacity-95 font-bold";
                            } else if (exclusionType) {
                                if (isExport) cellClass += " export-banned-cell";
                                else cellClass += " text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 opacity-50 font-normal";
                            } else {
                                if (!isExport) {
                                    cellClass += " text-gray-900 dark:text-gray-200";
                                    if (isHighlight) cellClass += " bg-blue-50 dark:bg-blue-900/20 font-bold text-blue-800 dark:text-blue-300";
                                }
                            }
                        } else { 
                            if (exclusionType === 'special') {
                                if (isExport) cellClass += " export-spl-cell";
                                else cellClass += " bg-green-50 dark:bg-green-900/10";
                            } else if (exclusionType) {
                                if (isExport) cellClass += " export-banned-cell";
                                else cellClass += " bg-red-50 dark:bg-red-900/10";
                            } else if (!isExport) {
                                cellClass += " text-gray-300 dark:text-gray-700"; 
                            }
                        }
                        
                        if (isExport && val === "-") val = "";
                        
                        return `<td class="${cellClass}">${val}</td>`;
                    }).join('')}
                    ${showRightAnchor ? `<td class="right-anchor-col sticky right-0 z-10 ${currentStickyCellClass || (isExport ? '' : 'bg-gray-50 dark:bg-gray-800/80')} ${paddingClass} border-l ${borderClass} border-b font-mono font-bold text-center shadow-[-4px_0_10px_rgba(0,0,0,0.05)] text-gray-500 dark:text-gray-400 text-[10px] sm:text-xs">${getAbbrev(cleanStation)}</td>` : ''}
                </tr>
            `;
            validRowIndex++;
        });

        html += `</tbody></table>`;
        return html;
    },

    /**
     * Saturday / holiday grid for routes with no weekend timetable:
     * station list from weekday sheet + professional no-service notice (no train columns).
     */
    _buildNoSaturdayGridHTML: (weekdaySchedule, routeName = '') => {
        if (!weekdaySchedule?.rows?.length) {
            return `<div class="flex items-center justify-center h-full p-6 text-center text-sm text-gray-500">No station list available.</div>`;
        }

        const stations = [];
        weekdaySchedule.rows.forEach((row) => {
            if (!row.STATION || String(row.STATION).toLowerCase().includes('updated')) return;
            const clean = String(row.STATION).replace(/ STATION/gi, '').trim();
            if (clean && !stations.includes(clean)) stations.push(clean);
        });

        const stationRows = stations.map((name, i) => {
            const zebra = i % 2 === 1 ? 'bg-gray-50 dark:bg-gray-800/40' : '';
            return `<tr class="${zebra}">
                <td class="sticky left-0 z-10 bg-white dark:bg-gray-900 ${zebra ? 'dark:bg-gray-800' : ''} py-2.5 px-3 border-r border-b border-gray-300 dark:border-gray-700 font-bold text-xs text-gray-900 dark:text-white truncate max-w-[160px] text-left">${escapeHTML(name)}</td>
                ${i === 0 ? `<td rowspan="${Math.max(stations.length, 1)}" class="align-middle border-b border-gray-300 dark:border-gray-700 p-4 sm:p-6 bg-white dark:bg-gray-900">
                    <div class="mx-auto max-w-sm rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/90 dark:bg-amber-950/40 px-4 py-5 sm:px-5 sm:py-6 text-center shadow-sm">
                        <div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                        </div>
                        <p class="text-sm font-black uppercase tracking-wide text-amber-900 dark:text-amber-200">No weekend service</p>
                        <p class="mt-2 text-xs leading-relaxed text-amber-800/90 dark:text-amber-200/80">Metrorail does not run Saturday or public-holiday trains on this route${routeName ? ` (${escapeHTML(formatRouteLabelPlain(String(routeName)))})` : ''}.</p>
                        <p class="mt-3 text-[11px] font-medium text-gray-600 dark:text-gray-400">Stations are listed for reference.</p>
                        <button type="button" onclick="window.renderFullScheduleGrid&&window.renderFullScheduleGrid(window._gridSwapDir||'A','weekday')" class="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm focus:outline-none">
                            Switch to Mon - Fri
                        </button>
                    </div>
                </td>` : ''}
            </tr>`;
        }).join('');

        return `
            <div class="w-full h-full overflow-auto">
                <table class="w-full border-collapse bg-white dark:bg-gray-900 text-xs">
                    <thead class="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-200 sticky top-0 z-20">
                        <tr>
                            <th class="py-2.5 px-3 border-b border-r border-gray-300 dark:border-gray-700 text-left font-bold min-w-[120px] sticky left-0 z-30 bg-gray-100 dark:bg-gray-800">Station</th>
                            <th class="py-2.5 px-3 border-b border-gray-300 dark:border-gray-700 text-center font-bold">Weekend timetable</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y border-gray-300 dark:border-gray-700">
                        ${stationRows || `<tr><td colspan="2" class="p-6 text-center text-gray-500">No stations found.</td></tr>`}
                    </tbody>
                </table>
            </div>`;
    },

    // --- 4. CHANGELOG & EMOJI CORES ---

    _toTitleCase: (str) => {
        if (!str) return '';
        return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    },
    
    _getDotColor: (colorClass) => {
        if (!colorClass) return 'bg-gray-400';
        if (colorClass.includes('green')) return 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]';
        if (colorClass.includes('orange')) return 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]';
        if (colorClass.includes('purple')) return 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]';
        if (colorClass.includes('indigo')) return 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]'; 
        if (colorClass.includes('blue')) return 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]';
        if (colorClass.includes('yellow')) return 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]';
        if (colorClass.includes('red')) return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
        return 'bg-gray-400';
    },

    _applyUIIntercepts: (stationName) => {
        if (!stationName) return '';
        let name = stationName.replace(/ STATION/gi, '').trim();
        const upperName = name.toUpperCase();
        if (upperName === 'ELANDSFONTEIN' || upperName === 'RHODESFIELD') return 'Kempton Park';
        if (upperName === 'DURBAN YARD') return 'Durban';
        return Renderer._toTitleCase(name);
    },

    renderChangelogModal: (changelogData) => {
        if (typeof document === 'undefined') return;
        const sidenav = document.getElementById('sidenav');
        const overlay = document.getElementById('sidenav-overlay');
        if (sidenav && sidenav.classList.contains('open')) {
            sidenav.classList.remove('open', 'translate-x-0');
            sidenav.classList.add('translate-x-full');
            if (overlay) {
                overlay.classList.add('opacity-0');
                overlay.classList.add('hidden');
            }
            document.body.classList.remove('sidenav-open', 'modal-active');
        }

        try { history.pushState({ modal: 'changelog' }, '', '#changelog'); } catch (e) {}

        let modal = document.getElementById('changelog-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'changelog-modal';
            modal.className = 'fixed inset-0 bg-black bg-opacity-70 z-[140] hidden flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
            modal.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm p-0 overflow-hidden transform transition-all scale-95 flex flex-col max-h-[85vh]">
                    <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
                        <h3 class="font-bold text-lg text-gray-900 dark:text-white">What's New</h3>
                        <button type="button" onclick="if(window.closeSmoothModal) closeSmoothModal('changelog-modal'); else history.back();" class="text-gray-500 hover:text-gray-900 dark:hover:text-white p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                    <div class="p-6 overflow-y-auto flex-grow space-y-6" id="changelog-list"></div>
                    <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-center">
                        <button type="button" onclick="if(window.closeSmoothModal) closeSmoothModal('changelog-modal'); else history.back();" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors">Got it!</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
        }

        const listContainer = document.getElementById('changelog-list');
        if (listContainer) {
            listContainer.innerHTML = '';
            if (!changelogData || changelogData.length === 0) {
                listContainer.innerHTML = '<p class="text-center text-gray-500 italic">No updates found.</p>';
            } else {
                changelogData.forEach((entry, index) => {
                    const isLatest = index === 0;
                    const verId = entry.id || String(entry.version || '').split('<')[0].trim().replace(/\s+/g, '_');
                    const titleHtml = entry.title
                        ? `<br><span class="text-sm text-blue-600 dark:text-blue-400">${entry.title}</span>`
                        : '';
                    const features = (entry.features || []).slice(0, 5);
                    listContainer.innerHTML += `
                        <div class="relative pl-4 border-l-2 ${isLatest ? 'border-blue-500' : 'border-gray-300 dark:border-gray-700'}">
                            ${isLatest ? '<span class="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-900"></span>' : '<span class="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-gray-700"></span>'}
                            <div class="mb-1 flex items-baseline justify-between gap-2">
                                <h4 class="font-bold text-gray-900 dark:text-white ${isLatest ? 'text-lg' : 'text-sm'}">${verId}${titleHtml}</h4>
                                <span class="text-xs text-gray-500 dark:text-gray-400 font-mono shrink-0">${entry.date || ''}</span>
                            </div>
                            <ul class="space-y-2">
                                ${features.map(f => `<li class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">${f}</li>`).join('')}
                            </ul>
                        </div>`;
                });
            }
        }

        if (typeof window !== 'undefined' && window.openSmoothModal) {
            window.openSmoothModal('changelog-modal');
        } else {
            modal.classList.remove('hidden');
        }
    }
};

// --- 5. CANVAS GRID EXPORT & SOCIAL SHARE SHIELD ---

export async function takeGridSnapshot(direction = 'A', dayType = 'weekday') {
    if (typeof window === 'undefined') return;
    if (typeof triggerHaptic === 'function') triggerHaptic(); 

    if (typeof window.html2canvas === 'undefined') {
        if (typeof showToast === 'function') showToast("Loading snapshot engine...", "info", 1500);
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } catch(e) {
            if (typeof showToast === 'function') showToast("Failed to load snapshot engine.", "error");
            return;
        }
    }

    if (typeof showToast === 'function') showToast("📄 Generating Commuter Notice...", "info", 4000);

    const activeRouteId = $currentRouteId.get();
    const route = ROUTES[activeRouteId];
    if (!route) return;

    const selectedDay = dayType || 'weekday';
    // Resolve weekday / saturday / pub_to_* cache slots (WC public_holiday → pub sheets).
    const keyA = scheduleCacheSlot(selectedDay, route.region, 'a');
    const keyB = scheduleCacheSlot(selectedDay, route.region, 'b');
    const firebaseKeyA = routeSheetKeyForDay(route, selectedDay, 'a') || route.sheetKeys?.[keyA];
    const firebaseKeyB = routeSheetKeyForDay(route, selectedDay, 'b') || route.sheetKeys?.[keyB];
    const schedA = $schedules.get()?.[keyA];
    const schedB = $schedules.get()?.[keyB];

    const bgColor = '#ffffff'; 
    const textColor = '#111827'; 
    const borderColor = '#cbd5e1'; 
    const accentColor = '#2563eb';
    const mutedColor = '#6b7280';
    const tableHeaderBg = '#f1f5f9'; 
    const headerTextColor = '#1e293b'; 
    const zebraBg = '#f8fafc'; 

    let dummyDayIdx = (selectedDay === 'weekday' || selectedDay === 'sunday') ? 1 : 6;

    let hasExceptions = false;
    const checkExclusions = (sched) => {
        if (!sched || !sched.headers) return;
        const trainCols = sched.headers.slice(1).filter(header => /^\d{4}[a-zA-Z]*$/.test(header.trim()));
        for (const t of trainCols) {
            if (isTrainExcluded(t, activeRouteId, dummyDayIdx)) {
                hasExceptions = true;
                break;
            }
        }
    };
    checkExclusions(schedA);
    checkExclusions(schedB);

    const exportContainer = document.createElement('div');
    exportContainer.style.position = 'fixed';
    exportContainer.style.left = '-9999px';
    exportContainer.style.top = '0';
    exportContainer.style.width = 'auto'; 
    exportContainer.style.minWidth = '800px'; 
    exportContainer.style.padding = '20px';
    exportContainer.style.fontFamily = 'system-ui, sans-serif';
    exportContainer.style.backgroundColor = bgColor;
    exportContainer.style.color = textColor;
    
    exportContainer.classList.remove('dark');

    const destAName = Renderer._applyUIIntercepts(route.destA).toUpperCase();
    const destBName = Renderer._applyUIIntercepts(route.destB).toUpperCase();
    const dateText = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    const scheduleTypeLabel = selectedDay === 'weekday' || selectedDay === 'sunday'
        ? 'WEEKDAY'
        : (selectedDay === 'public_holiday' ? 'PUBLIC HOLIDAY'
            : (selectedDay === 'saturday' ? 'SATURDAY' : 'WEEKEND'));
    const finalScheduleTypeLabel = hasExceptions ? `AMENDED ${scheduleTypeLabel}` : scheduleTypeLabel;
    
    const displayRouteName = formatRouteLabelPlain(route.name);
    
    let effectiveDateText = "";
    if (schedA && schedA.lastUpdated) {
        effectiveDateText = schedA.lastUpdated.replace(/^last updated[:\s-]*/i, '').trim();
    }
    
    let exportGridNoticeHtml = '';
    const globalExclData = $globalExclusions.get();
    if (globalExclData && globalExclData[activeRouteId] && globalExclData[activeRouteId]['_grid_notice']) {
        const noticeText = globalExclData[activeRouteId]['_grid_notice'].text;
        if (noticeText && noticeText.trim() !== '') {
            const cleanText = escapeHTML(noticeText);
            exportGridNoticeHtml = `
                <div style="background-color: #eff6ff; border-left: 5px solid ${accentColor}; padding: 12px 16px; margin-bottom: 24px; font-size: 14px; color: #1e3a8a; border-radius: 0 6px 6px 0; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: flex; align-items: flex-start;">
                    <span style="margin-right: 10px; font-size: 18px; line-height: 1;">ℹ️</span>
                    <div>
                        <div style="font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-size: 12px;">Service Update</div>
                        <div style="font-weight: 600; line-height: 1.4;">${cleanText}</div>
                    </div>
                </div>
            `;
        }
    }

    const htmlA = schedA 
        ? Renderer._buildGridHTML(schedA, firebaseKeyA || keyA, activeRouteId, dummyDayIdx, false, true) 
        : `<div class="p-8 text-center italic border rounded" style="color:${mutedColor}; border-color:${borderColor}">No service scheduled for this direction.</div>`;
        
    const htmlB = schedB 
        ? Renderer._buildGridHTML(schedB, firebaseKeyB || keyB, activeRouteId, dummyDayIdx, false, true) 
        : `<div class="p-8 text-center italic border rounded" style="color:${mutedColor}; border-color:${borderColor}">No service scheduled for this direction.</div>`;

    exportContainer.innerHTML = `
        <div class="mb-6 border-b-4 pb-4" style="border-color: ${accentColor}">
            <div class="flex justify-between items-end">
                <div>
                    <h1 class="text-4xl font-black uppercase tracking-tight mb-1" style="color: ${accentColor}">Commuter Notice</h1>
                    <h2 class="text-xl font-bold uppercase tracking-widest" style="color: ${mutedColor}">${displayRouteName} Corridor</h2>
                </div>
                <div class="text-right">
                    <div class="text-2xl font-bold" style="color: ${textColor}">${finalScheduleTypeLabel} TIMETABLE</div>
                    ${effectiveDateText ? `<div class="text-sm font-bold uppercase mt-1" style="color: ${mutedColor}">EFFECTIVE FROM: ${effectiveDateText}</div>` : ''}
                </div>
            </div>
        </div>

        ${exportGridNoticeHtml}

        <div class="mb-8">
            <div class="p-2 mb-0 border-l-4" style="background-color: ${tableHeaderBg}; border-color: ${accentColor}">
                <h3 class="font-bold text-lg uppercase" style="color: ${textColor}"> ${destBName} ➔ ${destAName}</h3>
            </div>
            <div class="schedule-table-wrapper">
                ${htmlA}
            </div>
        </div>

        <div class="flex items-center justify-center my-8 opacity-50">
            <div class="h-px w-full" style="background-color: ${borderColor}"></div>
            <span class="px-4 text-xs font-bold uppercase" style="color: ${mutedColor}">Return Service</span>
            <div class="h-px w-full" style="background-color: ${borderColor}"></div>
        </div>

        <div class="mb-8">
            <div class="p-2 mb-0 border-l-4" style="background-color: ${tableHeaderBg}; border-color: ${accentColor}">
                <h3 class="font-bold text-lg uppercase" style="color: ${textColor}"> ${destAName} ➔ ${destBName}</h3>
            </div>
            <div class="schedule-table-wrapper">
                ${htmlB}
            </div>
        </div>

        <div class="mt-8 p-5 rounded-lg flex justify-between items-end" style="background-color: ${tableHeaderBg}; border: 1px solid ${borderColor}">
            <div class="flex flex-col space-y-1.5 text-left">
                <span class="text-xs font-mono font-bold" style="color: #4b5563">GENERATED: ${dateText}</span>
                <span class="font-black text-sm" style="color: #374151">Data Source: PRASA / Metrorail Facebook</span>
            </div>
            <div class="flex flex-col text-right">
                <span class="font-black text-2xl tracking-tight leading-none mb-1.5" style="color: ${accentColor}">NextTrain.co.za</span>
                <span class="text-[10px] font-bold uppercase tracking-wider mt-1" style="color: #6b7280">Unofficial Guide • Not affiliated with PRASA</span>
            </div>
        </div>
    `;

    const tables = exportContainer.querySelectorAll('table');
    tables.forEach(t => {
        t.style.width = '100%';
        t.style.borderCollapse = 'collapse';
        
        const isCompact = t.classList.contains('export-compact');
        
        t.querySelectorAll('th').forEach(headerCell => {
            headerCell.style.position = 'relative'; 
            headerCell.style.backgroundColor = tableHeaderBg;
            headerCell.style.color = headerTextColor;
            headerCell.style.border = `1px solid ${borderColor}`;
            headerCell.className = headerCell.className;
            headerCell.style.padding = isCompact ? '8px 3px' : '8px 6px'; 
            headerCell.style.fontSize = isCompact ? '12.5px' : '13px';
            headerCell.style.fontWeight = '900';
            headerCell.style.textAlign = 'center';
            if (isCompact) headerCell.style.letterSpacing = '-0.5px'; 
        });
        
        t.querySelectorAll('td').forEach(td => {
            td.style.border = `1px solid ${borderColor}`;
            td.style.padding = isCompact ? '6px 2.5px' : '6px'; 
            td.style.color = textColor;
            td.style.fontSize = isCompact ? '13.5px' : '15px'; 
            td.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
            td.style.textAlign = 'center'; 
            td.style.fontWeight = '600'; 
            if (isCompact) td.style.letterSpacing = '-0.5px'; 
        });

        t.querySelectorAll('th.export-spl-col').forEach(headerCell => {
            headerCell.style.backgroundColor = '#f0fdf4'; 
            headerCell.style.color = '#166534'; 
        });
        t.querySelectorAll('th.export-banned-col').forEach(headerCell => {
            headerCell.style.backgroundColor = '#fef2f2'; 
            headerCell.style.color = '#991b1b'; 
        });
        t.querySelectorAll('td.export-spl-cell').forEach(td => {
            td.style.backgroundColor = '#f0fdf4';
            td.style.color = '#15803d'; 
            td.style.fontWeight = '800';
        });
        t.querySelectorAll('td.export-banned-cell').forEach(td => {
            td.style.backgroundColor = '#fef2f2';
            td.style.color = '#ef4444'; 
            td.style.opacity = '0.5'; 
        });

        t.querySelectorAll('tr.export-zebra td:not(.export-spl-cell):not(.export-banned-cell)').forEach(td => {
            td.style.backgroundColor = zebraBg;
        });

        t.querySelectorAll('.right-anchor-header').forEach(headerCell => {
            headerCell.style.backgroundColor = '#e2e8f0'; 
            headerCell.style.color = '#475569';
            headerCell.style.letterSpacing = 'normal'; 
            headerCell.style.padding = '8px 6px'; 
        });
        
        t.querySelectorAll('.right-anchor-col').forEach(td => {
            td.style.backgroundColor = '#f1f5f9';
            td.style.color = '#64748b';
            td.style.fontWeight = '800';
            td.style.fontSize = '13px';
            td.style.letterSpacing = 'normal'; 
            td.style.padding = '6px 6px'; 
        });

        t.querySelectorAll('.sticky').forEach(el => {
            el.style.position = 'static';
            el.classList.remove('sticky');
        });
        
        t.querySelectorAll('th:first-child, td:first-child').forEach(cell => {
            cell.style.textAlign = 'left';
            cell.style.paddingLeft = '12px';
            cell.style.paddingRight = '12px';
            cell.style.letterSpacing = 'normal';
        });

        t.querySelectorAll('td:first-child').forEach(td => {
            td.style.fontFamily = 'system-ui, -apple-system, sans-serif';
            td.style.fontWeight = '800';
            td.style.color = '#1f2937';
        });
    });

    document.body.appendChild(exportContainer);

    try {
        await new Promise(r => setTimeout(r, 100));

        const canvas = await window.html2canvas(exportContainer, {
            scale: 2,
            backgroundColor: bgColor,
            logging: false,
            useCORS: true
        });

        canvas.toBlob(async (blob) => {
            const timestampStr = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 12); 
            const fileName = `Schedule_${route.name.replace(/\s|<->/g,'_').replace(/_+/g, '_')}_${selectedDay}_${timestampStr}.png`;
            const file = new File([blob], fileName, { type: "image/png" });
            const blobUrl = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.download = fileName;
            link.href = blobUrl;
            link.click();
            
            window._pendingShareFile = file;
            window._pendingShareText = `Commuter Notice: ${formatRouteLabelPlain(route.name)} (${selectedDay})`;
            
            const canShare = navigator.canShare && navigator.canShare({ files: [file] });
            const shareBtnHTML = canShare 
                ? `<button onclick="triggerNoticeShare()" class="bg-white text-blue-600 px-3 py-1 rounded text-xs font-bold shadow-sm hover:bg-gray-100 transition-colors ml-3 whitespace-nowrap border border-gray-200">SHARE 📤</button>` 
                : '';

            if (typeof showToast === 'function') {
                showToast("✅ Image saved to gallery!", "success", 8000, shareBtnHTML);
            }
            
            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('grid_save_image', { 
                    route_id: activeRouteId,
                    day_type: selectedDay,
                    direction: direction 
                });
            }
            
            document.body.removeChild(exportContainer);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000); 
        });
    } catch (e) {
        console.error(e);
        if (typeof showToast === 'function') showToast("Snapshot failed.", "error");
        if(document.body.contains(exportContainer)) document.body.removeChild(exportContainer);
    }
}

export async function triggerNoticeShare() {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    
    if (window._pendingShareFile && window._pendingShareText) {
        try {
            const data = {
                title: 'Next Train Schedule',
                text: window._pendingShareText,
                files: [window._pendingShareFile]
            };
            if (navigator.canShare && navigator.canShare(data)) {
                await navigator.share(data);
            } else {
                if (typeof showToast === 'function') showToast("Sharing files not supported on this browser.", "error");
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error("Share failed:", e);
                if (typeof showToast === 'function') showToast("Share failed.", "error");
            }
        }
    } else {
        if (typeof showToast === 'function') showToast("No image to share. Please take a new snapshot.", "error");
    }
}

// Global window namespaces
if (typeof window !== 'undefined') {
    window.Renderer = Renderer;
    window.takeGridSnapshot = takeGridSnapshot;
    window.triggerNoticeShare = triggerNoticeShare;
}