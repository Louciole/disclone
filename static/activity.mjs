import global from "./framework/global.mjs";
import {setElement} from "./framework/vesta.mjs";

export function initActivity(){
    global.state.idle = {state: false, time: new Date().valueOf()}
    global.state.dom.addEventListener("mousemove", (event) => resetIdle());
    setInterval(checkIdle,60000)
    setInterval(checkStatus,60000)
}

function checkStatus(){
    if (!global.user.status.expiration){
        return
    }
    if (new Date(global.user.status.expiration) < new Date().valueOf()){
        global.user.status.emoji = null
        global.user.status.text = getDefaultMessage(global.user.status.mode)
        global.user.status.expiration = null
        changeStatus(global.user.status.mode)
    }
}

function resetIdle(){
    if(!global.state.idle){
        global.state.idle = {state: false, time:new Date().valueOf()}
    }
    if (global.user.status.mode != 0){
        return
    }

    if (global.state.idle.state){
        const default_msg = ["Online","Idle","Do not Disturb","Offline"]

        let status = global.user.status
        status.icon = "green"
        if(default_msg.includes(global.user.status.text)) {
            status.text = "Online"
        }
        setElement("global.user.status", status)

        const message = {"type" : 'changeActivity', "idle": false, "clientID":global.state.clientID}
        global.state.websocket.send(JSON.stringify(message))
    }
    global.state.idle = {state: false, time:new Date().valueOf()}
}

function checkIdle(){
    if (global.user.status.mode != 0 || global.state.idle?.state){
        return
    }
    console.log("checking idle")
    const mins = 15
    if(global.state.idle.time + (mins*60000) < new Date().valueOf()){
        const default_msg = ["Online","Idle","Do not Disturb","Offline"]

        let status = global.user.status
        status.icon = "orange"
        if(default_msg.includes(global.user.status.text)) {
            status.text = "Idle"
        }
        global.state.idle.state = true
        setElement("global.user.status", status)
        const message = {"type" : 'changeActivity', "idle": true, "clientID":global.state.clientID};
        global.state.websocket.send(JSON.stringify(message))
        console.log("client is idle")
    }
}