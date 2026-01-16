import {xhr} from "./framework/templating.mjs";
import global from "./framework/global.mjs";
import {loadChan} from "./crud.mjs";
import {goTo} from "./framework/navigation.mjs";
import {updateElement} from "./framework/vesta.mjs";

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
            let count
            if (!dashboard.users.count){
                count = Object.keys(dashboard.users).length
            }else{
                count = dashboard.users.count
            }
            dashboardContent +=`<div class="dashboard-category">
            <h1>Users</h1>
            <div class="dashboard-content">
                ${count}
            </div>
</div>`
        }

        if (dashboard.waitlist) {
            dashboardContent += getTemplate("dashboard-elt-waitlist");
        }

        for (let key in dashboard) {
            if (key.endsWith("_count")){
                dashboardContent +=`<div class="dashboard-category">
            <h1>${key.split("_")[0]}s</h1>
            <div class="dashboard-content">
                ${dashboard[key][0].count}
            </div>
</div>`
            }
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
        targetElt = document.getElementById("channel".concat(global.state.activeChan))
        targetElt.classList.remove("selected")
    }

    global.state.activeChan = "-dashboard-"+id

    // Initialiser le dashboard actuel si non défini
    if (!global.state.currentDashboard) {
        global.state.currentDashboard = 'disclone';
    }

    // loadChan(id)

    targetElt = document.getElementById("channel".concat(global.state.activeChan))
    targetElt.classList.add("selected")

    goTo('content','admin-channel',undefined,false)
}
window.goToDashboard = goToDashboard

function refreshDashboard() {
    const currentApp = global.state.currentDashboard || 'disclone';
    console.log(`Refreshing ${currentApp} via proxy`);

    // Afficher un indicateur de chargement (optionnel)
    const refreshBtn = document.getElementById('refresh-dashboard-btn');
    if (refreshBtn) {
        refreshBtn.classList.add('rotating');
    }

    xhr('/refreshDashboard?service='+currentApp, ()=>{
        console.log(`${currentApp} refresh successful`);

        const dashboardContainer = document.getElementById("dashboard");
        if (dashboardContainer) {
            dashboardContainer.innerHTML = getDashboard(currentApp);
        }

        if (refreshBtn) {
            refreshBtn.classList.remove('rotating');
        }
    })

}
window.refreshDashboard = refreshDashboard;
