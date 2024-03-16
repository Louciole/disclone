import {addServer} from "/main.mjs"
import global from "/global.mjs"

export function xhr(endpoint,effect,method="GET", async=true){
    let xhr= new XMLHttpRequest();
    xhr.open(method, endpoint, async);
    xhr.onload=effect
    xhr.onerror = function() {
        console.log("request failed")
    };
    xhr.send();
    return xhr
}

function changeUsername(){
    const input = document.getElementById("username-input")
    let request = new XMLHttpRequest();
    request.open('POST', "/change?element=username&value=".concat(input.value), true);
    request.onload = function() { // request successful
        //TODO
    };

    request.onerror = function() {
        console.log("request failed")
    };

    request.send();
}
window.changeUsername = changeUsername

function newServer(){
    let request = new XMLHttpRequest();
    request.open('POST', "createServer", true);
    request.onload = function() {
        addServer("New Server")
    };

    request.onerror = function() {
        console.log("request failed")
    };
    request.send();
    closeMenu('#create-server')
}
window.newServer = newServer

export function loadServers(){
    const onload = function() {
        const response = JSON.parse(this.responseText)
        for (let i in response) {
            addServer(response[i].name)
        }
    };
    xhr("getUserServers",onload)
}

function difference(arrKeys, dict) {
    const result = [];
    const dictKeys = new Set(Object.keys(dict)); // Convert dict keys to a set for efficient lookup

    for (const key of arrKeys) {
        if (!dictKeys.has(key)) {
            result.push(key);
        }
    }
    return result;
}

function loadUsers(keys){
    console.log(global.users, keys);
    const diff = difference(keys, global.users)
    const onload = function() {
        const keys = JSON.parse(this.responseText)
        for(let key of keys){
            global.users[key.id] = key
        }
    };
    xhr("getUsersInfo?users="+diff, onload, "GET",false)
    console.log(global.users)
}


export function loadUser(){
    let request = new XMLHttpRequest();
    request.open('POST', "/getUserInfo", true);
    request.onload = function() { // request successful
        global.user=JSON.parse(request.responseText)
        global.users[global.user.id] = global.user

        const onFriendsLoaded = function(){
            global.user.friends = JSON.parse(this.responseText)
            loadUsers(global.user.friends.map(({ id }) => id))
        }

        xhr("friends?action=get", onFriendsLoaded)
    };

    request.onerror = function() {
        console.log("request failed")
    };

    request.send();
}

function friend(action, element){
    //element is the id of the invitation for an accept or the username for an add
    const domElt= document.getElementById(element)
    const effect = function() {
        console.log("invitation processed")
    };

    xhr("friends?action=".concat(action,"&arg=",domElt.value),effect)
}
window.friend = friend