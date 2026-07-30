function loadUserProfile() {
    profileModal = document.getElementById('profile-modal');
    const settingsProfileDisplay = document.getElementById('settings-profile-display');
    const savedProfile = safeStorage.getItem('userProfile');
    
    if (savedProfile) {
        currentUserProfile = savedProfile;
    } else {
        currentUserProfile = "Adult";
        safeStorage.setItem('userProfile', "Adult");
    }
    
    if(settingsProfileDisplay) settingsProfileDisplay.textContent = currentUserProfile;
}

window.selectProfile = function(profileType) {
    currentUserProfile = profileType;
    safeStorage.setItem('userProfile', profileType);
    
    const settingsProfileDisplay = document.getElementById('settings-profile-display');
    if(settingsProfileDisplay) settingsProfileDisplay.textContent = profileType;
    
    if(profileModal) {
        closeSmoothModal('profile-modal');
    }
    showToast(`Profile set to: ${profileType}`, "success");
    findNextTrains(); 
};

window.resetProfile = function() {
    triggerHaptic();
    if(profileModal) {
        history.pushState({ modal: 'profile' }, '', '#profile');
        window.closeAppHub(); 
        setTimeout(() => { openSmoothModal('profile-modal'); }, 50);
    }
};

function updatePinUI() {
    const savedDefault = safeStorage.getItem('defaultRoute_' + currentRegion); 
    const isPinned = savedDefault === currentRouteId;
    if (pinOutline && pinFilled && pinRouteBtn) {
        if (isPinned) { pinOutline.classList.add('hidden'); pinFilled.classList.remove('hidden'); pinRouteBtn.title = "Unpin this route"; } 
        else { pinOutline.classList.remove('hidden'); pinFilled.classList.add('hidden'); pinRouteBtn.title = "Pin this route as default"; }
    }
    if (typeof Renderer !== 'undefined' && typeof ROUTES !== 'undefined') Renderer.renderRouteMenu('route-list', getRoutesForCurrentRegion(), currentRouteId);
}

function updateSidebarActiveState() {
    if (typeof Renderer !== 'undefined' && typeof ROUTES !== 'undefined') Renderer.renderRouteMenu('route-list', getRoutesForCurrentRegion(), currentRouteId);
}
