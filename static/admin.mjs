import {xhr} from "./framework/templating.mjs";
import global from "./framework/global.mjs";
import {loadChan} from "./crud.mjs";
import {goTo} from "./framework/navigation.mjs";


function setDashboard(service_id, tool = false) {
    const dashboardContainer = document.getElementById("dashboard");

    if (tool) {
        dashboardContainer.innerHTML = getTemplate("dashboard-tool-" + service_id);
    }else{
        dashboardContainer.innerHTML = getDashboard(service_id);
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
    // loadChan(id)

    targetElt = document.getElementById("channel".concat(id))
    targetElt.classList.add("selected")

    goTo('content','admin-channel',undefined,false)
}
window.goToDashboard = goToDashboard
