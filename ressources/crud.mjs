import {addServer} from "/main.mjs"
import global from "/global.mjs"

export function xhr(endpoint,effect,method="GET"){
    let xhr= new XMLHttpRequest();
    xhr.open(method, endpoint, true);
    xhr.onload=effect
    xhr.onerror = function() {
        console.log("request failed")
    };
    xhr.send();
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

export function loadUser(){
    let request = new XMLHttpRequest();
    request.open('POST', "/getUserInfo", true);
    request.onload = function() { // request successful
        global.user=JSON.parse(request.responseText)
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