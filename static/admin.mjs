import {xhr} from "./framework/templating.mjs";
import global from "./framework/global.mjs";
import {loadChan} from "./crud.mjs";
import {goTo} from "./framework/navigation.mjs";
import {updateElement} from "./framework/sakura.mjs";

// Mapping des IDs de service vers leurs labels
const dashboardLabels = {
    'uniauth': '🔒️ Uniauth',
    'disclone': '✉️ Disclone',
    'synapse': '️📒‍ Synapse',
    'mass-mailing': '️ Mailing'
};

function getDashboardLabel() {
    return dashboardLabels[global.state.currentDashboard] || '✉️ Disclone';
}
window.getDashboardLabel = getDashboardLabel;

function setDashboard(service_id, tool = false) {
    const dashboardContainer = document.getElementById("dashboard");

    if (tool) {
        dashboardContainer.innerHTML = getTemplate("dashboard-tool-" + service_id);
    }else{
        dashboardContainer.innerHTML = getDashboard(service_id);
    }

    // Mettre à jour le state avec le service actuel
    global.state.currentDashboard = service_id;

    // Déclencher la mise à jour réactive du label
    updateElement('global.state.currentDashboard');

    // Fermer le dropdown
    const dropdown = document.getElementById("services-dropdown");
    if (dropdown && dropdown.classList.contains("show")) {
        dropdown.classList.remove("show");
        global.state.activeDropdown = undefined;
    }

    // Mettre à jour la classe selected
    const allItems = dropdown?.querySelectorAll(".dropdown-menu li");
    if (allItems) {
        allItems.forEach(item => item.classList.remove("selected"));
        const selectedItem = dropdown.querySelector(`.dash-${service_id}`);
        if (selectedItem) {
            selectedItem.classList.add("selected");
        }
    }
}
window.setDashboard = setDashboard

function getDashboard(service_id){

    const request = xhr(`/getDashboard?server=${global.state.currentServer.id}&service_id=${service_id}`, undefined, "GET", false);
    if (request.status === 200) {
        const dashboard = JSON.parse(request.responseText);
        console.log("Dashboard loaded:", dashboard);
        let dashboardContent = ""

        global.dashboard = dashboard;
        if (dashboard.users) {
            dashboardContent +=`<div class="dashboard-category">
            <h1>Users</h1>
            <div class="dashboard-content">
                ${dashboard.users.count}
            </div>
</div>`
        }

        if (dashboard.waitlist) {
            dashboardContent += getTemplate("dashboard-elt-waitlist");
        }

        return dashboardContent
    } else {
        console.error("Failed to load dashboard:", request.status, request.statusText);
    }
}
window.getDashboard = getDashboard

function createDashboard(){
    xhr("editServer?id="+global.state.currentServer.id+"&property=dashboard&action=create",undefined)
}
window.createDashboard = createDashboard

function goToDashboard(id){
    let targetElt
    if(global.state.activeConv){
        targetElt = document.getElementById("channel".concat(global.state.activeConv))
        targetElt.classList.remove("selected")
    }

    global.state.activeConv = undefined

    // Initialiser le dashboard actuel si non défini
    if (!global.state.currentDashboard) {
        global.state.currentDashboard = 'disclone';
    }

    // loadChan(id)

    targetElt = document.getElementById("channel".concat(id))
    targetElt.classList.add("selected")

    goTo('content','admin-channel',undefined,false)
}
window.goToDashboard = goToDashboard

function refreshDashboard() {
    const currentApp = global.state.currentDashboard || 'disclone';
    const endpoint = getUnibridgeEndpoint(currentApp);

    if (!endpoint) {
        console.error('No endpoint found for:', currentApp);
        return;
    }

    console.log(`Refreshing ${currentApp} via ${endpoint}`);

    // Afficher un indicateur de chargement (optionnel)
    const refreshBtn = document.getElementById('refresh-dashboard-btn');
    if (refreshBtn) {
        refreshBtn.classList.add('rotating');
    }

    fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        if (response.ok) {
            console.log(`${currentApp} refresh successful`);
            // Recharger le dashboard après le rafraîchissement
            const dashboardContainer = document.getElementById("dashboard");
            if (dashboardContainer) {
                dashboardContainer.innerHTML = getDashboard(currentApp);
            }
        } else {
            console.error(`${currentApp} refresh failed:`, response.status);
        }
    })
    .catch(error => {
        console.error(`Error refreshing ${currentApp}:`, error);
    })
    .finally(() => {
        // Retirer l'indicateur de chargement
        if (refreshBtn) {
            refreshBtn.classList.remove('rotating');
        }
    });
}
window.refreshDashboard = refreshDashboard;

// Configuration pour les endpoints
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const UNIBRIDGE_ENDPOINTS = {
    'uniauth': {
        localhost: '',
        production: ''
    },
    'disclone': {
        localhost: '',
        production: ''
    },
    'synapse': {
        localhost: 'http://localhost:5002/unibridgeRefresh',
        production: 'https://synapse.carbonlab.dev/unibridgeRefresh'
    },
    'mass-mailing': {
        localhost: '',
        production: ''
    }
};

// Fonction helper pour obtenir l'endpoint approprié
export function getUnibridgeEndpoint(appId) {
    const endpoints = UNIBRIDGE_ENDPOINTS[appId];
    if (!endpoints) {
        console.error(`No endpoint configured for app: ${appId}`);
        return null;
    }
    return isLocalhost ? endpoints.localhost : endpoints.production;
}

