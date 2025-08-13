import {xhr} from "./framework/templating.mjs";

function getDashboard(service_id){
    const onload = function() {
        if (this.status === 200) {
            const dashboard = JSON.parse(this.responseText);
            console.log("Dashboard loaded:", dashboard);
            // You can process the dashboard data here
        } else {
            console.error("Failed to load dashboard:", this.status, this.statusText);
        }
    }

    xhr(`/getDashboard?server${global.state.currentServer}&service_id=${service_id}`, onload)
}
window.getDashboard = getDashboard

function createDashboard(){
    xhr("editServer?id="+global.state.currentServer.id+"&property=dashboard&action=create",undefined)
}
window.createDashboard = createDashboard