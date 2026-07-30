window._renderNextTrainList = function() {
    const input = document.getElementById('station-search-input');
    const select = document.getElementById('station-select');
    const list = document.getElementById('next-train-autocomplete-list');
    if (!input || !select || !list) return;

    list.innerHTML = '';
    const matches = allStations;

    if (matches.length === 0) {
        const li = document.createElement('li');
        
        // GUARDIAN BUGFIX: Protect users from seeing "No stations on this route" when the app is merely loading the database.
        if (!fullDatabase) {
            li.className = "p-4 text-sm text-blue-600 dark:text-blue-400 font-bold flex items-center justify-center bg-blue-50 dark:bg-blue-900/20";
            li.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Loading stations... please wait`;
        } else {
            li.className = "p-4 text-sm text-gray-400 italic text-center";
            li.textContent = "No stations on this route";
        }
        
        list.appendChild(li);
    } else {
        matches.forEach(station => {
            const li = document.createElement('li');
            li.className = "p-3.5 border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-base sm:text-lg font-medium text-gray-700 dark:text-gray-200 transition-colors";
            li.textContent = station.replace(' STATION', '');
            li.onclick = () => {
                input.value = station.replace(' STATION', '');
                select.value = station;
                const event = new Event('change');
                select.dispatchEvent(event);
                list.classList.add('hidden');
            };
            list.appendChild(li);
        });
    }
    list.classList.remove('hidden');
};

function setupNextTrainAutocomplete() {
    const input = document.getElementById('station-search-input');
    const select = document.getElementById('station-select');
    if (!input || !select) return;

    select.classList.add('hidden');
    input.classList.remove('hidden');

    if (input.parentNode && getComputedStyle(input.parentNode).position === 'static') {
        input.parentNode.style.position = 'relative';
    }

    let chevron = document.getElementById('next-train-chevron');
    if (!chevron && input.parentNode) {
        chevron = document.createElement('div');
        chevron.id = 'next-train-chevron';
        chevron.className = "absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 cursor-pointer p-2 hover:text-blue-500 z-10 transition-colors";
        chevron.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>`;
        input.parentNode.appendChild(chevron);
    }

    let list = document.getElementById('next-train-autocomplete-list');
    if (!list && input.parentNode) {
        list = document.createElement('ul');
        list.id = 'next-train-autocomplete-list';
        // ðŸ›¡ï¸ GROWTH MODE PHASE 7: Removed scroll-locks (overscroll-contain touch-pan-y) to fix mobile scroll freezing
        list.className = "absolute z-50 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-b-lg shadow-xl max-h-60 overflow-y-auto hidden mt-1 left-0 custom-scrollbar text-left";
        input.parentNode.appendChild(list);
        
        input.addEventListener('click', (e) => { 
            e.stopPropagation();
            if (list.classList.contains('hidden')) {
                window._renderNextTrainList(); 
            } else {
                list.classList.add('hidden');
            }
        });
        
        if (chevron) {
            chevron.addEventListener('click', (e) => { 
                e.stopPropagation(); 
                if (list.classList.contains('hidden')) {
                    window._renderNextTrainList();
                } else {
                    list.classList.add('hidden');
                }
            });
        }
        
        document.addEventListener('click', (e) => { 
            if (!input.contains(e.target) && !list.contains(e.target) && (!chevron || !chevron.contains(e.target))) {
                if (!list.classList.contains('hidden')) {
                    list.classList.add('hidden');
                }
            } 
        });
    }
}
// --- RENDERER BRIDGES ---

function getRoutesForCurrentRegion() {
    const regionalRoutes = {};
    if (typeof ROUTES === 'undefined') return regionalRoutes;
    for (const key in ROUTES) {
        if (ROUTES[key].region === currentRegion) {
            regionalRoutes[key] = ROUTES[key];
        }
    }
    return regionalRoutes;
}