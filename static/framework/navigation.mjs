import global from "./global.mjs";
import {setElement} from "./sakura.mjs";

export function initNav(){
    document.addEventListener('click', function (event) {
        if (global.state.activeFM && !global.state.activeFM.contains(event.target)) {
            global.state.activeFM.classList.toggle("visible")
            if (!openingFM){
                global.state.activeFM = undefined
            }else{
                openingFM=false
            }
        }
    }, false);

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
        global.state.socket.send(JSON.stringify(message))
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
        global.state.socket.send(JSON.stringify(message))
        console.log("client is idle")
    }
}

function openMenu(id, async=true){
    const menu = document.getElementById(id)
    if (menu){
        menu.style.display = "flex"
    }else{
        loadTemplate(id.concat(".html"), undefined, id, async)
    }
}
window.openMenu = openMenu

export function goTo(id, target, selected=undefined, async=true, postInsert=undefined){
    if (postInsert){
        loadTemplate(target.concat(".html"), id, undefined, false)
        postInsert()
    }else{
        loadTemplate(target.concat(".html"), id, undefined, async)
    }
    
    if(selected){
        let targetElt;
        if(global.state[selected.category]){
            global.state[selected.category].classList.remove("selected")
        }else if(selected.event){
            selected.event.currentTarget.parentElement.querySelector('.selected').classList.remove("selected")
        }else if(selected.id){
            targetElt = document.getElementById(selected.id)
            targetElt.parentElement.querySelector('.selected').classList.remove("selected")
        }

        if(selected.event){
            global.state[selected.category] = selected.event.currentTarget
        }else if(selected.id){
            global.state[selected.category] = targetElt
        }
        global.state[selected.category].classList.add("selected")
    }
}
window.goTo = goTo


let openingFM = false;

function toggleFM(id){
    const FM = document.getElementById(id)
    if(FM !== global.state.activeFM){
        openingFM = true
        if(global.state.activeFM){
            global.state.activeFM.classList.toggle("visible")
        }
        global.state.activeFM = FM
    }
}
window.toggleFM = toggleFM

export function closeFM(){
    if(global.state.activeFM){
        global.state.activeFM.classList.toggle("visible")
        global.state.activeFM = undefined
    }
}

function toggleModale(id, event){
    const FM = document.getElementById(id)
    if(FM !== global.state.activeFM){
        openingFM = true
        global.state.modaltarget = event.currentTarget
        if(global.state.activeFM){
            global.state.activeFM.classList.toggle("visible")
        }
        console.log(event.currentTarget,global.state.modaltarget)
        FM.style.top = event.clientY.toString().concat("px")
        FM.style.left = event.clientX.toString().concat("px")
        global.state.activeFM = FM
    }
}
window.toggleModale = toggleModale

function toggleGroup(){
    event.currentTarget.classList.toggle("closed")
}
window.toggleGroup = toggleGroup

function gotoStep(step,stepsID){
    const menu = document.getElementById(stepsID)
    menu.style.transform=`translateX(${-100*step/menu.childElementCount}%)`
}
window.gotoStep = gotoStep

function resetSelected(id){
    const selected = document.getElementById(id).querySelectorAll(".selected")
    for(let el of selected){
        el.classList.remove("selected")
    }
}

function closeMenu(cible = undefined,id='createServerSteps'){
    if(!cible){
        if(event.target !== event.currentTarget){
            return
        }
        event.target.style.display = "none";
    }else{
        const cibleEl= document.querySelector(cible)
        cibleEl.style.display = "none";
    }
    gotoStep(0,id)
    resetSelected(id)
}
window.closeMenu = closeMenu

function saveCursorPosition(event){
    global.state.previousCursor={start:event.srcElement.selectionStart, end:event.srcElement.selectionEnd}
}
window.saveCursorPosition = saveCursorPosition
