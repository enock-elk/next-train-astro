function updateNextTrainView() {
    const fareBox = document.getElementById('fare-container');
    const container = fareBox ? fareBox.parentNode : null;
    if (!container) return;

    const currentRoute = typeof ROUTES !== 'undefined' ? ROUTES[currentRouteId] : null;
    if (!currentRoute || !currentRoute.isActive) {
        const gridTrigger = document.getElementById('grid-trigger-container');
        if (gridTrigger) gridTrigger.classList.add('hidden');
        return;
    }

    if (!document.getElementById('grid-trigger-container')) {
        const triggerDiv = document.createElement('div');
        triggerDiv.id = 'grid-trigger-container';
        triggerDiv.className = "mb-5 mt-2 px-1"; 
        triggerDiv.innerHTML = `
            <button onclick="triggerHaptic(); renderFullScheduleGrid('A')" class="w-full flex items-center justify-center space-x-3 bg-blue-600 hover:bg-blue-700 text-white font-black py-3.5 rounded-xl shadow-lg ring-4 ring-blue-100 dark:ring-blue-900 transition-all transform active:scale-95 group focus:outline-none">
                <span class="text-xl">📅</span>
                <span class="tracking-wide">VIEW FULL TIMETABLE</span>
            </button>
        `;
        container.insertBefore(triggerDiv, fareBox);
    } else {
        const gridTrigger = document.getElementById('grid-trigger-container');
        if (gridTrigger) gridTrigger.classList.remove('hidden');
    }
}
