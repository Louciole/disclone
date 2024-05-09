import {addElement, addServer, deleteElement, displayNotif, getRelevantUser, pushElement, setElement} from "/main.mjs"
import global from "/global.mjs"

const WEBSOCKETS = "ws://localhost:9888"

window.onbeforeunload = function() {
    global.state.socket.onclose = function () {}; // disable onclose handler first
    global.state.socket.close();
};

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

    const regex = /^(?=.{3,}$)[a-zA-Z0-9_\-\.]*$/;
    if (!regex.test(input.value)) {
        input.setCustomValidity("Invalid username. It must be at least 2 characters in letters, numbers, '_', '-', and '.'.");
        input.reportValidity()
        return
    } else {
        input.setCustomValidity("");
    }

    const onload = function() { // request successful
        setElement('global.user.username', input.value)
        closeMenu('#change-username')
    };
    xhr("/change?element=username&value=".concat(input.value),onload,"POST")
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

export function loadConvs(){
    const onload = function() {
        const keys = JSON.parse(this.responseText)
        for(let key of keys){
            addElement("global.convs", key)
        }
    };
    xhr("getUserConvs",onload)
}

function difference(arrKeys, dict) {
    const result = [];
    const dictKeys = new Set(Object.keys(dict)); // Convert dict keys to a set for efficient lookup

    for (const key of arrKeys) {
        if (!dictKeys.has(key)) {
            result.push(key);
        }
    }
    return Array.from(result);
}

export function loadUsers(keys){
    const diff = difference(keys, global.users)

    if(diff.length === 0){
        return
    }

    const onload = function() {
        const keys = JSON.parse(this.responseText)
        for(let key of keys){
            global.users[key.id] = key
        }
    };
    xhr("getUsersInfo?users="+JSON.stringify(diff), onload, "GET",false)
}

export function loadConv(key){
    const onload = function() {
    };

    const request = xhr("getConvContent?convId="+JSON.stringify(key), onload, "GET",false)
    const elements = JSON.parse(request.responseText)
    for(let element in elements){
        global.convs[key][element] = elements[element]
    }

    let lastSender = undefined
    let lastTimestamp = undefined
    global.convs[key].messageGroups = []

    for(let message of global.convs[key].messages){
        message.body = message.body.replace(/</g, "&lt;")

        // si ça fait moins de 3 minutes de différence, que c'est la même personne et que la date n'a pas changée
        if(message.sender === lastSender && (new Date(message.timestamp)-new Date(lastTimestamp))/60000<3 && getTimeStr(message.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) === getTimeStr(lastTimestamp, { locale: "fr-FR",hour: undefined, minute: undefined})){
            global.convs[key].messageGroups[global.convs[key].messageGroups.length-1].messages.push(message)
        }else{
            lastSender = message.sender
            newMessageGroup(key, message)
        }
        lastTimestamp = message.timestamp
    }
}

export function loadUser(){
    let request = new XMLHttpRequest();
    request.open('POST', "/getUserInfo", true);
    request.onload = function() { // request successful
        setElement('global.user', JSON.parse(request.responseText))
        global.users[global.user.id] = global.user
        console.log("user loaded",global.user)
        initWebSockets()

        const onFriendsLoaded = function(){
            global.user.friends = JSON.parse(this.responseText)
            let usersToload = []
            for (let friendship of global.user.friends){
                usersToload.push(getRelevantUser(friendship))
            }
            loadUsers(usersToload)
        }

        xhr("friends?action=get", onFriendsLoaded)

        const onInvitationsLoaded = function(){
            global.user.invitations = JSON.parse(this.responseText)
            let usersToload = []
            for (let friendship of global.user.invitations){
                usersToload.push(getRelevantUser(friendship))
            }
            loadUsers(usersToload)
        }

        xhr("friends?action=invitations", onInvitationsLoaded)
    };

    request.onerror = function() {
        console.log("request failed")
    };

    request.send();
}

function friend(action, element, event = undefined){
    //element is the id of the invitation for an accept or the username for an add

    const effect = function() {
        if (action !== "add"){
            return
        }

        const status = document.querySelector(".add .status")
        const search= document.querySelector(".add .search")

        if(this.responseText === "ok"){
            status.classList.add("succeed")
            status.classList.remove("failed")
            search.classList.add("succeed")
            search.classList.remove("failed")
            status.innerHTML = "Well done ! Your friend request has been sent !"
        }else{
            status.classList.remove("succeed")
            status.classList.add("failed")
            search.classList.remove("succeed")
            search.classList.add("failed")
            status.innerHTML = this.responseText
        }
    };

    if(action === "add"){
        const domElt= document.getElementById(element)
        xhr("friends?action=".concat(action,"&arg=",encodeURIComponent(domElt.value)),effect)
    }else if(action === "accept"){
        xhr("friends?action=".concat(action,"&arg=",element),effect)

        // doing some magic here to update the local state
        const invitationNumber = Array.prototype.indexOf.call(event.currentTarget.parentElement.children, event.currentTarget) - 1
        global.user.friends.push(global.user.invitations[invitationNumber])
        deleteElement("global.user.invitations",invitationNumber)
    }else{
        xhr("friends?action=".concat(action,"&arg=",element),effect)
    }
}
window.friend = friend

function newMessageGroup(conv, message){
    global.convs[conv].messageGroups.push({"date": getTimeStr(message.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}), "messages":[message], "id":global.convs[conv].messageGroups.length})
}

export function handleMessageGroup(message){
    if (global.convs[message.place].messages.length !== 0){
        // si ça fait moins de 3 minutes de différence, que c'est la même personne et que la date n'a pas changée
        if(message.sender === global.convs[message.place].messages[global.convs[message.place].messages.length-1].sender && (new Date(message.timestamp)-new Date(global.convs[message.place].messages[global.convs[message.place].messages.length-1].timestamp))/60000<3 && getTimeStr(message.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) === getTimeStr(global.convs[message.place].messages[global.convs[message.place].messages.length-1].timestamp, { locale: "fr-FR",hour: undefined, minute: undefined})){
            global.convs[message.place].messageGroups[global.convs[message.place].messageGroups.length-1].messages.push(message)
        }else{
            newMessageGroup(message.place, message)
        }
    }else{
        newMessageGroup(message.place, message)
    }
}

function initWebSockets(){
    global.state.socket = new WebSocket(WEBSOCKETS);

    global.state.socket.onopen = function(event) {
        console.log("Connection opened to Python WebSocket server!");
        const message = {"type" : 'register', "uid": global.user.id};
        global.state.socket.send(JSON.stringify(message));
    };

    global.state.socket.onmessage = function(event) {
        console.log("Received message from Python server:", event.data);
        const message = JSON.parse(event.data)
        switch (message.type){
            case "register_request":
                //TODO handle multiserver xhr with the received servID
                xhr("authWS?connectionId=".concat(message.connectionId),undefined)
                break
            case "notif":
                switch (message.content.type){
                    case "message":
                        const currentDate = new Date()
                        const timestamp = currentDate.getTime()
                        message.content.content["timestamp"] = timestamp
                        handleMessageGroup(message.content.content)
                        pushElement('global.convs['.concat(message.content.content.place,'].messages'),message.content.content)
                        displayNotif(message.content)
                        break;
                    case "friend_request":
                        loadUsers([message.content.content["kopinprincipal"]])
                        pushElement('global.user.invitations', message.content.content)
                        break;
                    case "accepted_request":
                        loadUsers([message.content.content["kopinsecondaire"]])
                        pushElement('global.user.friends', message.content.content)
                        for(let i in global.user.invitations){
                            const request = global.user.invitations[i]
                            if (request.id === message.content.content.id){
                                deleteElement("global.user.invitations", i)
                                break
                            }
                        }
                        break;
                    case "added_conv":
                        addElement('global.convs', message.content.content)
                        break;
                    case "typing":
                        if(global.state.activeConv === message.content.conv){
                            const box = document.getElementById("typing-name")
                            box.parentElement.style.display="flex";
                            // todo handle multiple names
                            box.innerHTML = global.users[message.content.uid].display
                            setTimeout(() => box.parentElement.style.display="none", 5000)
                        }
                        break
                    default:
                        break;
                }
                break;
            default:
                break;
        }

    };

    global.state.socket.onerror = function(error) {
        console.error("WebSocket error:", error);
    };
}

export function sendTyping(){
    if(global.settings.silent_typing === undefined){
        global.settings.silent_typing = false
    }

    console.log("send typing",global.state.lastTyping)
    if( !global.settings.silent_typing && (!global.state.lastTyping || global.state.lastTyping+5000 < new Date().valueOf())){
        const message = {"type" : 'typing', "uid": global.user.id, "conv": global.state.activeConv};
        global.state.lastTyping = new Date().valueOf()
        global.state.socket.send(JSON.stringify(message))
    }
}
