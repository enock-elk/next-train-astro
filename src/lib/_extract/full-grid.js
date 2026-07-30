window.renderFullScheduleGrid = function(direction = 'A', dayOverride = null) {
    if (!schedules || Object.keys(schedules).length === 0) {
        showToast("Loading latest schedules... please wait.", "info", 2000);
        return;
    }

    const route = typeof ROUTES !== 'undefined' ? ROUTES[currentRouteId] : null;
    if (!route) return;

    let selectedDay = dayOverride || currentDayType;
    let targetDayIdx = (typeof currentDayIndex !== 'undefined') ? currentDayIndex : new Date().getDay();

    let autoForwarded = false;

    if (!dayOverride) {
        let hasServiceToday = false;
        
        if (currentDayType !== 'sunday') {
            const testSheetKey = `${currentDayType}_to_${direction.toLowerCase()}`;
            const testSchedule = schedules[testSheetKey];
            
            if (testSchedule && testSchedule.rows && testSchedule.rows.length > 0) {
                const headers = testSchedule.headers.slice(1);
                for (const t of headers) {
                    if (typeof isTrainExcluded === 'function' && !isTrainExcluded(t, currentRouteId, targetDayIdx)) {
                        hasServiceToday = true;
                        break;
                    } else if (typeof isTrainExcluded !== 'function') {
                        hasServiceToday = true;
                        break;
                    }
                }
            }
        }

        if (!hasServiceToday) {
            const dest = direction === 'A' ? route.destA : route.destB;
            const selectedStation = stationSelect ? stationSelect.value : "";
            const simResult = typeof window.simulateNextActiveService === 'function'
                ? window.simulateNextActiveService(selectedStation, dest)
                : null;
            
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
    } else {
        const isSameType = (dayOverride === currentDayType);
        if (!isSameType) {
            if (dayOverride === 'weekday') targetDayIdx = 1; 
            else if (dayOverride === 'saturday') targetDayIdx = 6;
            else if (dayOverride === 'sunday') targetDayIdx = 0;
        }
    }

    let sheetDayType = 'weekday';
    if (selectedDay === 'saturday') {
        sheetDayType = 'saturday';
    } else if (selectedDay === 'sunday') {
        sheetDayType = 'weekday';
    } else {
        sheetDayType = 'weekday';
    }

    const existingModal = document.getElementById('full-schedule-modal');
    const isFirstOpen = !existingModal || existingModal.classList.contains('hidden');

    if (isFirstOpen) {
        trackAnalyticsEvent('view_full_grid', { 
            route: route.name, 
            direction: direction,
            day: selectedDay 
        });
    }

    const destName = Renderer._applyUIIntercepts(direction === 'A' ? route.destA : route.destB).toUpperCase();
    const oppositeDestName = Renderer._applyUIIntercepts(direction === 'A' ? route.destB : route.destA).toUpperCase();
    
    const sheetKey = `${sheetDayType}_to_${direction.toLowerCase()}`;
    const schedule = schedules[sheetKey];

    if (!schedule || !schedule.rows || schedule.rows.length === 0) {
        showToast(`No ${sheetDayType} schedule available for this route.`, "error");
        return;
    }

    let modal = document.getElementById('full-schedule-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'full-schedule-modal';
        modal.className = 'fixed inset-0 bg-white dark:bg-gray-900 z-[95] hidden flex items-center justify-center p-0 full-screen backdrop-blur-md transition-opacity duration-300';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-900 rounded-none shadow-2xl w-full h-full flex flex-col transform transition-transform duration-300 scale-100 overflow-hidden relative">
                <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-100 dark:bg-gray-800 z-20 relative">
                <h3 class="flex-grow min-w-0 pr-2"></h3>
                <button onclick="if(location.hash === '#grid') { history.back(); } else { const m = document.getElementById('full-schedule-modal'); if(m) m.classList.add('hidden'); }" class="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition flex-shrink-0" aria-label="Close Grid">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                 </button>
                </div>
                <!-- ðŸ›¡ï¸ GUARDIAN FIX: Elevated z-index to z-[60] so dropdown completely escapes table stacking context -->
                <div id="grid-controls" class="px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center shadow-sm relative"></div>
                <div id="grid-container" class="flex-grow overflow-auto bg-white dark:bg-gray-900 relative pb-32 z-10"></div>
                <div class="p-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 z-20 relative">
                    <button onclick="if(location.hash === '#grid') { history.back(); } else { const m = document.getElementById('full-schedule-modal'); if(m) m.classList.add('hidden'); }" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-lg shadow-md transition-colors text-sm">Close Timetable</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const container = document.getElementById('grid-container');
    const headerTitle = modal.querySelector('h3');
    const controlsDiv = modal.querySelector('#grid-controls');
    
    let effectiveDate = "Standard Schedule";
    if (schedule.lastUpdated) {
        const cleanDate = schedule.lastUpdated.replace(/^last updated[:\s-]*/i, '').trim();
        effectiveDate = `Effective: ${cleanDate}`;
    }

    if (headerTitle) {
        headerTitle.innerHTML = `
            <div class="flex flex-col w-full">
                <span class="text-sm font-black uppercase text-blue-600 dark:text-blue-400 tracking-wider truncate">Trains to ${destName}</span>
                <span class="text-[10px] text-gray-400 font-mono mt-0.5 truncate">${effectiveDate}</span>
            </div>
        `;
    }

    if (controlsDiv) {
            // GUARDIAN UX FIX: Dynamically update parent container layout to wrap safely if fat buttons exceed mobile bounds
            controlsDiv.className = "px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-3 justify-between items-center shadow-md relative";

            const isWk = sheetDayType === 'weekday';
            const shareUrl = `https://nexttrain.co.za/?action=route&route=${currentRouteId}&view=grid&dir=${direction}&day=${selectedDay}`;
            const shareText = `Check out the ${sheetDayType} schedule to ${destName}`;
            
            window.shareCurrentGrid = async () => {
                if (typeof triggerHaptic === 'function') triggerHaptic(); 
                const data = { title: 'Next Train Schedule', text: shareText, url: shareUrl };
                try {
                    if (navigator.share) await navigator.share(data);
                    else {
                        const textArea = document.createElement('textarea');
                        textArea.value = shareUrl;
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textArea);
                        alert('Schedule link copied to clipboard!');
                    }
                } catch (e) {}
            };

            let wkLabel = "Mon - Fri";
            let satLabel = "Sat / Hol";

            // ðŸ›¡ï¸ GUARDIAN UX: Outside click listener for the custom Grid Dropdown
            if (!window._gridOutsideClickListener) {
                window._gridOutsideClickListener = (e) => {
                    const list = document.getElementById('grid-day-list');
                    const chevron = document.getElementById('grid-day-chevron');
                    if (list && !list.classList.contains('hidden') && !e.target.closest('#grid-day-dropdown-container')) {
                        if(window.toggleDropdownScrim) window.toggleDropdownScrim();
                        else {
                            list.classList.add('hidden');
                            if (chevron) chevron.classList.remove('rotate-180');
                        }
                    }
                };
                document.addEventListener('click', window._gridOutsideClickListener);
            }

            controlsDiv.innerHTML = `
                <div class="flex items-center space-x-1 sm:space-x-2 min-w-0 flex-1 relative" id="grid-day-dropdown-container">
                    <!-- Custom Dropdown Trigger (Reverted to Compact) -->
                    <button onclick="if(window.toggleDropdownScrim) window.toggleDropdownScrim('grid-day-list', 'grid-day-chevron'); else { document.getElementById('grid-day-list').classList.toggle('hidden'); document.getElementById('grid-day-chevron').classList.toggle('rotate-180'); }" class="flex justify-between items-center text-[9px] sm:text-[10px] font-bold bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-gray-700 dark:text-gray-200 focus:outline-none shadow-sm min-w-[85px] sm:min-w-[95px]">
                        <span id="grid-day-display" class="truncate mr-1">${isWk ? wkLabel : satLabel}</span>
                        <svg id="grid-day-chevron" class="w-3 h-3 text-gray-500 transform transition-transform shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    
                    <!-- Hidden Dropdown List (Premium UI Retained & Scaled Up) -->
                    <ul id="grid-day-list" class="absolute z-[200] top-[115%] left-0 mt-1 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl hidden flex-col overflow-hidden text-left min-w-[170px]">
                        <li onclick="if(window.toggleDropdownScrim) window.toggleDropdownScrim(); else { document.getElementById('grid-day-list').classList.add('hidden'); document.getElementById('grid-day-chevron').classList.remove('rotate-180'); } renderFullScheduleGrid('${direction}', 'weekday')" class="px-4 py-4 text-sm sm:text-base font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 flex items-center ${isWk ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">
                            <svg class="w-5 h-5 mr-3 shrink-0 ${isWk ? 'text-blue-500' : 'text-gray-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            ${wkLabel}
                        </li>
                        <li onclick="if(window.toggleDropdownScrim) window.toggleDropdownScrim(); else { document.getElementById('grid-day-list').classList.add('hidden'); document.getElementById('grid-day-chevron').classList.remove('rotate-180'); } renderFullScheduleGrid('${direction}', 'saturday')" class="px-4 py-4 text-sm sm:text-base font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors flex items-center ${!isWk ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">
                            <svg class="w-5 h-5 mr-3 shrink-0 ${!isWk ? 'text-blue-500' : 'text-gray-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            ${satLabel}
                        </li>
                    </ul>

                    <!-- Swap Button (Reverted to Compact) -->
                    <button onclick="renderFullScheduleGrid('${direction === 'A' ? 'B' : 'A'}', '${selectedDay}')" class="text-[9px] sm:text-[10px] font-bold bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-1.5 rounded border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors whitespace-nowrap shadow-sm truncate shrink-0 ml-1 sm:ml-2">
                        â‡„ ${typeof Renderer !== 'undefined' ? Renderer._applyUIIntercepts(oppositeDestName) : oppositeDestName}
                    </button>
                </div>
                
                <!-- Actions Container & Buttons (Reverted to Compact) -->
                <div class="flex items-center space-x-1 border-l border-gray-200 dark:border-gray-700 pl-1.5 ml-1 shrink-0">
                    <button onclick="takeGridSnapshot('${direction}', '${selectedDay}')" class="flex items-center justify-center space-x-1 px-1.5 py-1.5 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 transition shadow-sm border border-gray-200 dark:border-gray-600 whitespace-nowrap focus:outline-none min-w-0" title="Save Image">
                        <svg class="w-3 h-3 text-gray-600 dark:text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        <span class="text-[9px] font-bold text-gray-700 dark:text-gray-300 truncate">Download</span>
                    </button>
                    <button onclick="shareCurrentGrid()" class="flex items-center justify-center space-x-1 px-1.5 py-1.5 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded hover:bg-blue-100 transition shadow-sm border border-blue-200 dark:border-blue-800 whitespace-nowrap focus:outline-none min-w-0" title="Share Link">
                        <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
                        <span class="text-[9px] font-bold truncate">Share</span>
                    </button>
                </div>
            `;
        }

    const isTodayType = !autoForwarded && (
                        (currentDayType === 'weekday' && sheetDayType === 'weekday') || 
                        (currentDayType !== 'weekday' && sheetDayType === 'saturday')
                    );
    
    const html = typeof Renderer !== 'undefined' ? Renderer._buildGridHTML(schedule, route.sheetKeys[sheetKey], currentRouteId, targetDayIdx, isTodayType, false) : '';

    container.innerHTML = html;
    modal.classList.remove('hidden');
    history.pushState({ modal: 'grid' }, '', '#grid');

    setTimeout(() => {
        const activeCol = document.getElementById('grid-active-col');
        if (activeCol) activeCol.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 100);
};