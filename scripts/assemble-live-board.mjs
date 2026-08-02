/**
 * Assembles Phase 2 live-board modules from SPA extracts + ESM shims.
 *
 * DANGER: live-board.js / live-board-ui.js are now hand-maintained. Re-running
 * this overwrites ship-blocker patches (MAX_RADIUS_KM, allStations sync, pin
 * wiring, etc). Refuses unless FORCE_ASSEMBLE=1.
 *
 *   FORCE_ASSEMBLE=1 node scripts/assemble-live-board.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

if (process.env.FORCE_ASSEMBLE !== '1') {
  console.error(`
assemble-live-board.mjs is locked.

live-board.js / live-board-ui.js are hand-maintained. Blind reassembly will
erase MAX_RADIUS_KM imports, window.allStations sync, and pin/analytics fixes.

If you truly need to regenerate from src/lib/_extract, run:
  FORCE_ASSEMBLE=1 node scripts/assemble-live-board.mjs
`);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extract = path.join(root, 'src/lib/_extract');
const lib = path.join(root, 'src/lib');

const read = (name) => fs.readFileSync(path.join(extract, name), 'utf8').replace(/^\uFEFF/, '');

const shimHeader = `/**
 * METRORAIL NEXT TRAIN - LIVE BOARD ENGINE (Phase 2 port from SPA)
 * Hand-maintained. Do NOT re-run assemble-live-board.mjs without FORCE_ASSEMBLE=1
 * — that script overwrites patches in this file.
 */
import {
    $userRegion, $currentRouteId, $userProfile, $fullDatabase, $schedules,
    $globalStationIndex, $masterStationList, $globalExclusions, $globalDisruptions,
    $isSimMode, $simTime
} from '../store.js';
import {
    ROUTES, SPECIAL_DATES, FARE_CONFIG, DEFAULT_EXCLUSIONS, REFRESH_CONFIG, DYNAMIC_BASE_URL,
    MAX_RADIUS_KM
} from './config.js';
import {
    normalizeStationName, timeToSeconds, formatTimeDisplay, safeStorage,
    getDistanceFromLatLonInKm, escapeHTML
} from './utils.js';
import {
    parseJSONSchedule, currentTime, currentDayType, currentDayIndex,
    loadAllSchedules, guardianFetch
} from './logic.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal } from './ui.js';

// --- Store-backed globals (SPA parity shims) ---
let allStations = [];
let lastTrackedOD = null;
export let currentScheduleData = {};
let refreshTimer = null;

const getCurrentRouteId = () => $currentRouteId.get();
const getCurrentRegion = () => $userRegion.get() || 'GP';
const getFullDatabase = () => $fullDatabase.get();
const getSchedules = () => $schedules.get() || {};
const getGlobalStationIndex = () => $globalStationIndex.get() || {};
const getGlobalExclusions = () => $globalExclusions.get() || {};
const getGlobalDisruptions = () => $globalDisruptions.get() || {};
const getUserProfile = () => $userProfile.get() || 'Adult';
const getCurrentTime = () => (typeof window !== 'undefined' && window.currentTime) ? window.currentTime : currentTime;
const getCurrentDayType = () => (typeof window !== 'undefined' && window.currentDayType) ? window.currentDayType : currentDayType;
const getCurrentDayIndex = () => (typeof window !== 'undefined' && window.currentDayIndex !== undefined) ? window.currentDayIndex : currentDayIndex;

function stationSelectEl() { return typeof document !== 'undefined' ? document.getElementById('station-select') : null; }
function pretoriaTimeEl() { return typeof document !== 'undefined' ? document.getElementById('pretoria-time') : null; }
function pienaarspoortTimeEl() { return typeof document !== 'undefined' ? document.getElementById('pienaarspoort-time') : null; }
function pretoriaHeaderEl() { return typeof document !== 'undefined' ? document.getElementById('pretoria-header') : null; }
function pienaarspoortHeaderEl() { return typeof document !== 'undefined' ? document.getElementById('pienaarspoort-header') : null; }
function lastUpdatedEl() { return typeof document !== 'undefined' ? document.getElementById('last-updated-date') : null; }
function locateBtnEl() { return typeof document !== 'undefined' ? document.getElementById('locate-btn') : null; }

function trackAnalyticsEvent(name, params) {
    try {
        if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
            window.gtag('event', name, params || {});
        }
    } catch (e) {}
}

`;

// Transform SPA fragment identifiers → store getters / DOM helpers
function transform(src) {
    let s = src;
    // Strip window. assignments on function declarations we'll re-export
    s = s.replace(/window\.getLookaheadDayInfo\s*=\s*function/g, 'export function getLookaheadDayInfo');
    s = s.replace(/window\.simulateNextActiveService\s*=\s*function/g, 'export function simulateNextActiveService');
    s = s.replace(/window\.checkDisruption\s*=\s*function/g, 'export function checkDisruption');
    s = s.replace(/window\.getTripDisruptions\s*=\s*function/g, 'export function getTripDisruptions');
    s = s.replace(/function isTrainExcluded/g, 'export function isTrainExcluded');
    s = s.replace(/function getSharedStationCount/g, 'export function getSharedStationCount');
    s = s.replace(/function getTargetStations/g, 'export function getTargetStations');
    s = s.replace(/function hasForwardOverlap/g, 'export function hasForwardOverlap');
    s = s.replace(/function formatEffectiveDate/g, 'export function formatEffectiveDate');
    s = s.replace(/function buildMasterStationList/g, 'export function buildMasterStationList');
    s = s.replace(/function calculateTimeDiffString/g, 'export function calculateTimeDiffString');
    s = s.replace(/function resolveZoneForRoute/g, 'export function resolveZoneForRoute');
    s = s.replace(/function getRouteFare/g, 'export function getRouteFare');
    s = s.replace(/function getDetailedFare/g, 'export function getDetailedFare');
    s = s.replace(/function findNextTrains/g, 'export function findNextTrains');
    s = s.replace(/function findNextJourneyToDestA/g, 'export function findNextJourneyToDestA');
    s = s.replace(/function findNextJourneyToDestB/g, 'export function findNextJourneyToDestB');
    s = s.replace(/function findNextDirectTrain/g, 'export function findNextDirectTrain');
    s = s.replace(/function findTransfers/g, 'export function findTransfers');
    s = s.replace(/function findConnections/g, 'export function findConnections');
    s = s.replace(/function findNearestStation/g, 'export function findNearestStation');
    s = s.replace(/function populateStationList/g, 'export function populateStationList');
    s = s.replace(/function updateLastUpdatedText/g, 'export function updateLastUpdatedText');
    s = s.replace(/function renderComingSoon/g, 'function renderComingSoonLocal');
    s = s.replace(/function startSmartRefresh/g, 'export function startSmartRefresh');
    s = s.replace(/function scheduleNextRefresh/g, 'export function scheduleNextRefresh');

    // Globals → getters
    s = s.replace(/\bcurrentRouteId\b/g, 'getCurrentRouteId()');
    s = s.replace(/\bcurrentRegion\b/g, 'getCurrentRegion()');
    s = s.replace(/\bfullDatabase\b/g, 'getFullDatabase()');
    s = s.replace(/\bglobalStationIndex\b/g, 'getGlobalStationIndex()');
    s = s.replace(/\bglobalExclusions\b/g, 'getGlobalExclusions()');
    s = s.replace(/\bglobalDisruptions\b/g, 'getGlobalDisruptions()');
    s = s.replace(/\bcurrentUserProfile\b/g, 'getUserProfile()');
    // schedules as object — avoid replacing property access carefully
    s = s.replace(/(?<![\w$.])schedules(?!\s*=)/g, 'getSchedules()');
    s = s.replace(/\bcurrentTime\b/g, 'getCurrentTime()');
    s = s.replace(/\bcurrentDayType\b/g, 'getCurrentDayType()');
    s = s.replace(/\bcurrentDayIndex\b/g, 'getCurrentDayIndex()');

    // DOM globals
    s = s.replace(/\bstationSelect\b/g, 'stationSelectEl()');
    s = s.replace(/\bpretoriaTimeEl\b/g, 'pretoriaTimeEl()');
    s = s.replace(/\bpienaarspoortTimeEl\b/g, 'pienaarspoortTimeEl()');
    s = s.replace(/\bpretoriaHeader\b/g, 'pretoriaHeaderEl()');
    s = s.replace(/\bpienaarspoortHeader\b/g, 'pienaarspoortHeaderEl()');
    s = s.replace(/\blastUpdatedEl\b/g, 'lastUpdatedEl()');
    s = s.replace(/\blocateBtn\b/g, 'locateBtnEl()');

    // Fix double-call bugs from naive replace on already-getter forms
    s = s.replace(/getCurrentRouteId\(\)\(\)/g, 'getCurrentRouteId()');
    s = s.replace(/getCurrentRegion\(\)\(\)/g, 'getCurrentRegion()');
    s = s.replace(/getFullDatabase\(\)\(\)/g, 'getFullDatabase()');
    s = s.replace(/getSchedules\(\)\(\)/g, 'getSchedules()');
    s = s.replace(/getGlobalStationIndex\(\)\(\)/g, 'getGlobalStationIndex()');
    s = s.replace(/getGlobalExclusions\(\)\(\)/g, 'getGlobalExclusions()');
    s = s.replace(/getGlobalDisruptions\(\)\(\)/g, 'getGlobalDisruptions()');
    s = s.replace(/getUserProfile\(\)\(\)/g, 'getUserProfile()');
    s = s.replace(/getCurrentTime\(\)\(\)/g, 'getCurrentTime()');
    s = s.replace(/getCurrentDayType\(\)\(\)/g, 'getCurrentDayType()');
    s = s.replace(/getCurrentDayIndex\(\)\(\)/g, 'getCurrentDayIndex()');
    s = s.replace(/stationSelectEl\(\)\(\)/g, 'stationSelectEl()');
    s = s.replace(/pretoriaTimeEl\(\)\(\)/g, 'pretoriaTimeEl()');
    s = s.replace(/pienaarspoortTimeEl\(\)\(\)/g, 'pienaarspoortTimeEl()');
    s = s.replace(/pretoriaHeaderEl\(\)\(\)/g, 'pretoriaHeaderEl()');
    s = s.replace(/pienaarspoortHeaderEl\(\)\(\)/g, 'pienaarspoortHeaderEl()');
    s = s.replace(/lastUpdatedEl\(\)\(\)/g, 'lastUpdatedEl()');
    s = s.replace(/locateBtnEl\(\)\(\)/g, 'locateBtnEl()');

    // MASTER_STATION_LIST / allStations
    s = s.replace(/MASTER_STATION_LIST\s*=/g, 'window.MASTER_STATION_LIST =');
    s = s.replace(/\ballStations\s*=/g, 'allStations =');

    // Renderer / UI callbacks that live on window
    s = s.replace(/typeof renderComingSoon === 'function'/g, "typeof window.Renderer !== 'undefined'");
    s = s.replace(/renderComingSoon\(/g, 'window.Renderer.renderComingSoon(');
    s = s.replace(/typeof renderPlaceholder === 'function'/g, "typeof window.Renderer !== 'undefined'");
    s = s.replace(/renderPlaceholder\(\)/g, 'window.Renderer.renderPlaceholder(pretoriaTimeEl(), pienaarspoortTimeEl())');
    s = s.replace(/typeof renderAtDestination === 'function'/g, "typeof window.Renderer !== 'undefined'");
    s = s.replace(/renderAtDestination\(/g, 'window.Renderer.renderAtDestination(');
    s = s.replace(/typeof renderNoService === 'function'/g, "typeof window.renderNoService === 'function'");
    s = s.replace(/typeof processAndRenderJourney === 'function'/g, "typeof window.processAndRenderJourney === 'function'");
    s = s.replace(/processAndRenderJourney\(/g, 'window.processAndRenderJourney(');
    s = s.replace(/typeof updateFareDisplay === 'function'/g, "typeof window.updateFareDisplay === 'function'");
    s = s.replace(/updateFareDisplay\(/g, 'window.updateFareDisplay(');
    s = s.replace(/typeof Renderer !== 'undefined'/g, "typeof window.Renderer !== 'undefined'");
    s = s.replace(/(?<!window\.)Renderer\./g, 'window.Renderer.');

    // Sim mode
    s = s.replace(/window\.isSimMode/g, '$isSimMode.get()');
    s = s.replace(/window\.simTimeStr/g, '($simTime.get() || "")');
    s = s.replace(/typeof \$isSimMode\.get\(\) !== 'undefined' && \$isSimMode\.get\(\)/g, '$isSimMode.get()');
    s = s.replace(/\(typeof \$isSimMode\.get\(\) !== 'undefined'\) \? \$isSimMode\.get\(\) : false/g, '$isSimMode.get()');

    // Null-safe station select: wrap reads; leave assignments as stationSelectEl() && (stationSelectEl().x = ...)
    s = s.replace(/stationSelectEl\(\)\.value\s*=/g, '__SS_ASSIGN_VALUE__=');
    s = s.replace(/stationSelectEl\(\)\.innerHTML\s*=/g, '__SS_ASSIGN_INNER__=');
    s = s.replace(/stationSelectEl\(\)\.disabled\s*=/g, '__SS_ASSIGN_DISABLED__=');
    s = s.replace(/stationSelectEl\(\)\.appendChild/g, '__SS_APPEND__');
    s = s.replace(/stationSelectEl\(\)\.value/g, '(stationSelectEl() && stationSelectEl().value)');
    s = s.replace(/stationSelectEl\(\)\.options/g, '(stationSelectEl() && stationSelectEl().options)');
    s = s.replace(/__SS_ASSIGN_VALUE__=/g, 'stationSelectEl() && (stationSelectEl().value =');
    s = s.replace(/__SS_ASSIGN_INNER__=/g, 'stationSelectEl() && (stationSelectEl().innerHTML =');
    s = s.replace(/__SS_ASSIGN_DISABLED__=/g, 'stationSelectEl() && (stationSelectEl().disabled =');
    // Close paren for assignments that end with `;`
    s = s.replace(/stationSelectEl\(\) && \(stationSelectEl\(\)\.value = ([^;]+);/g, 'stationSelectEl() && (stationSelectEl().value = $1);');
    s = s.replace(/stationSelectEl\(\) && \(stationSelectEl\(\)\.innerHTML = ([^;]+);/g, 'stationSelectEl() && (stationSelectEl().innerHTML = $1);');
    s = s.replace(/stationSelectEl\(\) && \(stationSelectEl\(\)\.disabled = ([^;]+);/g, 'stationSelectEl() && (stationSelectEl().disabled = $1);');
    s = s.replace(/__SS_APPEND__/g, 'stationSelectEl() && stationSelectEl().appendChild');

    // Null-safe board DOM writes
    s = s.replace(/pretoriaTimeEl\(\)\.innerHTML/g, 'pretoriaTimeEl() && (pretoriaTimeEl().innerHTML');
    s = s.replace(/pienaarspoortTimeEl\(\)\.innerHTML/g, 'pienaarspoortTimeEl() && (pienaarspoortTimeEl().innerHTML');
    s = s.replace(/pretoriaHeaderEl\(\)\.innerHTML/g, 'pretoriaHeaderEl() && (pretoriaHeaderEl().innerHTML');
    s = s.replace(/pienaarspoortHeaderEl\(\)\.innerHTML/g, 'pienaarspoortHeaderEl() && (pienaarspoortHeaderEl().innerHTML');
    // Fix the common pattern `el && (el.innerHTML = ""; other` from dual assign line
    s = s.replace(/pretoriaTimeEl\(\) && \(pretoriaTimeEl\(\)\.innerHTML = ""; pienaarspoortTimeEl\(\) && \(pienaarspoortTimeEl\(\)\.innerHTML = "";/g,
        'if (pretoriaTimeEl()) pretoriaTimeEl().innerHTML = ""; if (pienaarspoortTimeEl()) pienaarspoortTimeEl().innerHTML = "";');

    // syncPlannerFromMain may not exist
    s = s.replace(/syncPlannerFromMain\([^)]*\);?/g, '/* syncPlannerFromMain deferred */');

    // Strip BOM leftovers
    s = s.replace(/\uFEFF/g, '');

    return s;
}

const engineParts = [
    read('lookahead.js'),
    read('helpers-exclusions.js'),
    read('disruptions.js'),
    read('fare-helpers.js'),
    read('find-next.js'),
    read('nearest-populate.js'),
    read('last-updated.js'),
    read('smart-refresh.js'),
].map(transform).join('\n\n');

const footer = `

// Sync window shims used by renderer / planner
export function attachLiveBoardGlobals() {
    if (typeof window === 'undefined') return;
    window.getLookaheadDayInfo = getLookaheadDayInfo;
    window.simulateNextActiveService = simulateNextActiveService;
    window.checkDisruption = checkDisruption;
    window.getTripDisruptions = getTripDisruptions;
    window.isTrainExcluded = isTrainExcluded;
    window.findNextTrains = findNextTrains;
    window.populateStationList = populateStationList;
    window.findNearestStation = findNearestStation;
    window.calculateTimeDiffString = calculateTimeDiffString;
    window.getRouteFare = getRouteFare;
    window.getDetailedFare = getDetailedFare;
    window.startSmartRefresh = startSmartRefresh;
    window.updateLastUpdatedText = updateLastUpdatedText;
    window.allStations = allStations;
}

export function getAllStations() { return allStations; }
export { allStations };
`;

fs.writeFileSync(path.join(lib, 'live-board.js'), shimHeader + '\n' + engineParts + '\n' + footer);
console.log('Wrote live-board.js', fs.statSync(path.join(lib, 'live-board.js')).size);

// --- live-board-ui.js ---
const uiHeader = `/**
 * LIVE BOARD UI ORCHESTRATION (Phase 2)
 */
import { ROUTES, FARE_CONFIG } from './config.js';
import { normalizeStationName, timeToSeconds, formatTimeDisplay, safeStorage, escapeHTML } from './utils.js';
import { $currentRouteId, $userRegion, $userProfile, $fullDatabase } from '../store.js';
import { currentTime, currentDayType, loadAllSchedules } from './logic.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal } from './ui.js';
import {
    getLookaheadDayInfo, simulateNextActiveService, getAllStations,
    getRouteFare, getDetailedFare, populateStationList, findNextTrains,
    updateLastUpdatedText, calculateTimeDiffString
} from './live-board.js';

const getCurrentTime = () => (typeof window !== 'undefined' && window.currentTime) ? window.currentTime : currentTime;
`;

function transformUi(src) {
    let s = src;
    s = s.replace(/window\._renderNextTrainList\s*=\s*function/g, 'export function _renderNextTrainList');
    s = s.replace(/function setupNextTrainAutocomplete/g, 'export function setupNextTrainAutocomplete');
    s = s.replace(/function renderNoService/g, 'export function renderNoService');
    s = s.replace(/function processAndRenderJourney/g, 'export function processAndRenderJourney');
    s = s.replace(/function renderNextAvailableTrain/g, 'export function renderNextAvailableTrain');
    s = s.replace(/function updateFareDisplay/g, 'export function updateFareDisplay');
    s = s.replace(/window\.openFareModal\s*=\s*function/g, 'export function openFareModal');
    s = s.replace(/function loadUserProfile/g, 'export function loadUserProfile');
    s = s.replace(/window\.selectProfile\s*=\s*function|function selectProfile/g, 'export function selectProfile');
    s = s.replace(/window\.resetProfile\s*=\s*function|function resetProfile/g, 'export function resetProfile');
    s = s.replace(/function updatePinUI/g, 'export function updatePinUI');
    s = s.replace(/window\.openScheduleModal\s*=\s*function|function openScheduleModal/g, 'export function openScheduleModal');
    s = s.replace(/window\.renderFullScheduleGrid\s*=\s*function|function renderFullScheduleGrid/g, 'export function renderFullScheduleGrid');
    s = s.replace(/function updateNextTrainView/g, 'export function updateNextTrainView');
    s = s.replace(/function getRoutesForCurrentRegion/g, 'export function getRoutesForCurrentRegion');

    s = s.replace(/\ballStations\b/g, 'getAllStations()');
    s = s.replace(/getAllStations\(\)\(\)/g, 'getAllStations()');
    s = s.replace(/\bfullDatabase\b/g, '$fullDatabase.get()');
    s = s.replace(/\$fullDatabase\.get\(\)\(\)/g, '$fullDatabase.get()');
    s = s.replace(/\bcurrentRouteId\b/g, '$currentRouteId.get()');
    s = s.replace(/\$currentRouteId\.get\(\)\(\)/g, '$currentRouteId.get()');
    s = s.replace(/\bcurrentRegion\b/g, '($userRegion.get() || "GP")');
    s = s.replace(/\bcurrentUserProfile\s*=/g, '$userProfile.set(');
    // Close $userProfile.set( assignments that end with `;`  — handle common string/literal assigns
    s = s.replace(/\$userProfile\.set\(\s*("(?:Adult|Scholar|Pensioner|Military)"|savedProfile|type)\s*;/g, '$userProfile.set($1);');
    s = s.replace(/\bcurrentUserProfile\b/g, '($userProfile.get() || "Adult")');
    s = s.replace(/\bcurrentTime\b/g, 'getCurrentTime()');
    s = s.replace(/getCurrentTime\(\)\(\)/g, 'getCurrentTime()');
    s = s.replace(/\bstationSelect\b/g, '(document.getElementById("station-select"))');
    s = s.replace(/\(document\.getElementById\("station-select"\)\)\(\)/g, '(document.getElementById("station-select"))');
    s = s.replace(/(?<!window\.)Renderer\./g, 'window.Renderer.');
    s = s.replace(/typeof Renderer !== 'undefined'/g, "typeof window.Renderer !== 'undefined'");
    s = s.replace(/trackAnalyticsEvent\([^;]*\);?/g, '/* analytics */');
    s = s.replace(/function showToast[\s\S]*?(?=\nexport function|\nfunction [a-zA-Z]|\$)/, '/* showToast imported from ui.js */\n');
    s = s.replace(/let toastTimeout;?/g, '');
    s = s.replace(/let profileModal;?/g, 'let profileModal;');
    s = s.replace(/\uFEFF/g, '');
    return s;
}

const uiBody = [
    read('autocomplete.js'),
    read('process-render.js'),
    read('pin-profile.js'),
    read('open-schedule.js'),
    read('full-grid.js'),
    read('update-next-train-view.js'),
].map(transformUi).join('\n\n');

const uiFooter = `

export function attachLiveBoardUiGlobals() {
    if (typeof window === 'undefined') return;
    window._renderNextTrainList = _renderNextTrainList;
    window.processAndRenderJourney = processAndRenderJourney;
    window.renderNoService = renderNoService;
    window.renderNextAvailableTrain = renderNextAvailableTrain;
    window.updateFareDisplay = updateFareDisplay;
    window.openFareModal = openFareModal;
    window.openScheduleModal = openScheduleModal;
    window.renderFullScheduleGrid = renderFullScheduleGrid;
    window.selectProfile = selectProfile;
    window.updatePinUI = updatePinUI;
    window.updateNextTrainView = updateNextTrainView;
}

export function initLiveBoardUi() {
    attachLiveBoardUiGlobals();
    setupNextTrainAutocomplete();
    loadUserProfile();
    updatePinUI();
    updateNextTrainView();

    const pinBtn = document.getElementById('pin-route-btn');
    if (pinBtn && !pinBtn.dataset.bound) {
        pinBtn.dataset.bound = '1';
        pinBtn.addEventListener('click', () => {
            triggerHaptic();
            const routeId = $currentRouteId.get();
            const region = $userRegion.get() || 'GP';
            if (!routeId) return;
            const key = 'defaultRoute_' + region;
            if (safeStorage.getItem(key) === routeId) safeStorage.removeItem(key);
            else safeStorage.setItem(key, routeId);
            updatePinUI();
            showToast(safeStorage.getItem(key) === routeId ? 'Route pinned' : 'Pin removed', 'success', 1500);
        });
    }

    const routeBtn = document.getElementById('route-selector-btn');
    if (routeBtn && !routeBtn.dataset.bound) {
        routeBtn.dataset.bound = '1';
        routeBtn.addEventListener('click', () => {
            triggerHaptic();
            if (typeof window.Renderer !== 'undefined') {
                const routes = getRoutesForCurrentRegion();
                window.Renderer.renderRouteMenu('route-list', routes, $currentRouteId.get());
            }
            openSmoothModal('route-modal');
        });
    }

    const stationSelect = document.getElementById('station-select');
    if (stationSelect && !stationSelect.dataset.bound) {
        stationSelect.dataset.bound = '1';
        stationSelect.addEventListener('change', () => {
            const searchInput = document.getElementById('station-search-input');
            if (searchInput && stationSelect.value) {
                searchInput.value = stationSelect.value.replace(/ STATION/g, '');
                searchInput.dataset.resolvedValue = stationSelect.value;
            }
            findNextTrains();
            updateNextTrainView();
        });
    }

    const locateBtn = document.getElementById('locate-btn');
    if (locateBtn && !locateBtn.dataset.bound) {
        locateBtn.dataset.bound = '1';
        locateBtn.addEventListener('click', () => {
            if (typeof window.findNearestStation === 'function') window.findNearestStation(false);
        });
    }

    const shareBtn = document.getElementById('share-app-btn');
    if (shareBtn && !shareBtn.dataset.bound) {
        shareBtn.dataset.bound = '1';
        shareBtn.addEventListener('click', async () => {
            triggerHaptic();
            const shareData = { title: 'Metrorail Next Train', text: 'Check live Metrorail schedules', url: location.origin + location.pathname };
            try {
                if (navigator.share) await navigator.share(shareData);
                else {
                    await navigator.clipboard.writeText(shareData.url);
                    showToast('Link copied to clipboard!', 'success');
                }
            } catch (e) {
                try {
                    await navigator.clipboard.writeText(shareData.url);
                    showToast('Link copied to clipboard!', 'success');
                } catch (e2) { showToast('Could not share', 'error'); }
            }
        });
    }

    document.getElementById('close-modal-btn')?.addEventListener('click', () => closeSmoothModal('schedule-modal'));
    document.getElementById('close-modal-btn-2')?.addEventListener('click', () => closeSmoothModal('schedule-modal'));

    // Legal links on live board footer
    document.querySelectorAll('#view-next-train button').forEach((btn) => {
        const t = (btn.textContent || '').trim();
        if (t === 'Terms of Use' && !btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => window.openLegal && window.openLegal('terms'));
        }
        if (t === 'Privacy Policy' && !btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => window.openLegal && window.openLegal('privacy'));
        }
    });
}
`;

fs.writeFileSync(path.join(lib, 'live-board-ui.js'), uiHeader + '\n' + uiBody + '\n' + uiFooter);
console.log('Wrote live-board-ui.js', fs.statSync(path.join(lib, 'live-board-ui.js')).size);

console.log('Done.');
