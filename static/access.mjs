import {xhr} from "./framework/templating.mjs";

const rights = {
    "dashboard-read": {'name': 'dashboard-read', 'category': 'dashboard', 'description': 'See the dashboards'},
    "dashboard-create": {'name': 'dashboard-create' ,'category': 'dashboard', 'description': 'Create a new dashboard'}
}
window.rights = rights;

function getRights() {
    if (global.state.currentServer.userRights){
        return global.state.currentServer.userRights;
    }

    const userRoles = global.state.currentServer.members[global.user.id].roles;
    const serverRoles = global.state.currentServer.roles;
    const userRights = {};
    for (const role of userRoles) {
        if (serverRoles[role]) {
            if (Object.keys(serverRoles[role].permissions).length === 0) {
                continue;
            }
            for (const right of Object.keys(serverRoles[role].permissions)) {
                if (rights[right]) {
                    userRights[right] = rights[right];
                }
            }
        }
    }
    global.state.currentServer.userRights = userRights;
    return userRights;
}

function checkServRights(right) {
    const userRights = getRights();

    if(rights[right].category === 'dashboard') {
        if (!global.state.currentServer.op) {
            return false;
        }

        if(userRights[right]) {
            return true;
        }else{
            return false;
        }
    }
}
window.checkServRights = checkServRights

function editRolePerm(event, right){
    event.preventDefault();

    const onload = function() {
    }

    if (event.currentTarget.checked) {
        global.state.currentRole.permissions[right] = '';
    } else {
        delete global.state.currentRole.permissions[right];
    }
    const newValue = JSON.stringify(global.state.currentRole.permissions);
    xhr(`/editServer?property=role&id=${global.state.currentServer.id}&value=${newValue}&targetId=${global.state.currentRole.id}&field=permissions`,onload)
}
window.editRolePerm = editRolePerm
