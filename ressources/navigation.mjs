import {loadTemplate} from "/main.mjs"
import global from "/global.mjs"
import {loadConv, loadServers, xhr} from "./crud.mjs";

let emptyStr = ''

export function initNav(){
    document.addEventListener('click', function (event) {
        if (activeFM && !activeFM.contains(event.target)) {
            activeFM.classList.toggle("visible")
            if (!openingFM){
                activeFM = undefined
            }else{
                openingFM=false
            }
        }
    }, false);
}

function openMenu(id){
    const menu = document.getElementById(id)
    if (menu){
        menu.style.display = "flex"
    }else{
        loadTemplate(id.concat(".html"), undefined, id)
    }
}
window.openMenu = openMenu

export function goTo(id, target, selected=undefined, async=true){
    loadTemplate(target.concat(".html"), id, undefined, async)
    if(selected){
        console.log("yes ? and ?",selected)
        let targetElt;
        if(global.state[selected.category]){
            console.log("??? (1)")
            global.state[selected.category].classList.remove("selected")
        }else if(selected.event){
            console.log("trying to remove previously selected thingys",selected.event.currentTarget.parentElement.querySelector('.selected'))
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


let activeFM;
let openingFM = false;

function toggleFM(id){
    const FM = document.getElementById(id)
    if(FM !== activeFM){
        openingFM = true
        if(activeFM){
            activeFM.classList.toggle("visible")
        }
        activeFM = FM
    }
}
window.toggleFM = toggleFM

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

function getTemplate(name){
    const request = xhr( '/templates/'.concat(name,".html"), ()=>{}, "GET", false)
    return eval('`' + request.responseText + '`')
}
window.getTemplate = getTemplate

function goodbye(){
    if (confirm('Voulez-vous vraiment vous désinscrire et supprimer votre compte de tous les services Carbonlab ? (toutes vos informations seront effacées)')) {
        const url = "/goodbye";
        let request = new XMLHttpRequest();
        request.open('POST', url, true);
        request.onload = function() { // request successful
            console.log("account deleted",request.responseText)

            if (request.responseText === "ok"){
                window.location.href = "/auth";
            }
        };

        request.onerror = function() {
            console.log("request failed")
        };

        request.send();
    } else {
        console.log("ouf 😖")
    }
}
window.goodbye = goodbye

function goToConv(convId){
    let targetElt
    if(global.state.activeConv){
        targetElt = document.getElementById("conv".concat(global.state.activeConv))
    }else{
        targetElt = document.getElementById("friendCat")
    }
    targetElt.classList.remove("selected")

    global.state.activeConv = convId
    loadConv(convId)

    targetElt = document.getElementById("conv".concat(convId))
    targetElt.classList.add("selected")

    goTo('content','conversation',undefined,false)
}
window.goToConv = goToConv

function goToFriends(event){
    if(global.state.activeConv){
        let targetElt = document.getElementById("conv".concat(global.state.activeConv))
        targetElt.classList.remove("selected")
    }

    global.state.activeConv = undefined
    event.currentTarget.classList.add("selected")

    goTo('content',"friends",undefined,false)
    goTo('friends-block','main-friend')
}
window.goToFriends = goToFriends

function insertStandardEmoji(event,target){
    if (target === "currentInput"){
        // bug ? this does not trigger the typing event, we could use a real event instead
        const input = document.querySelector("textarea.selected")
        if(!global.state.previousCursor){
            global.state.previousCursor = {start:0, end:0}
        }
        input.value = input.value.slice(0,global.state.previousCursor.start).concat(event.currentTarget.innerHTML,input.value.slice(global.state.previousCursor.end))
        global.state.previousCursor = {start: global.state.previousCursor.start+event.currentTarget.innerHTML.length, end:global.state.previousCursor.start+event.currentTarget.innerHTML.length}
    }else {
        target.innerHTML = event.currentTarget.innerHTML
    }
}
window.insertStandardEmoji = insertStandardEmoji

function saveCursorPosition(event){
    global.state.previousCursor={start:event.srcElement.selectionStart, end:event.srcElement.selectionEnd}
}
window.saveCursorPosition = saveCursorPosition

function updatePreview(event, defaultValue, evaluation=undefined){
    const save_menu = document.querySelector(".save-settings")
    if(global.state["currentForm"]){
        if(!global.state["currentForm"][event.currentTarget.id] ){
            global.state["currentForm"][event.currentTarget.id] = {value: "", modified :false, defaultValue: eval(defaultValue)}
        }
        if(event.currentTarget.value !== global.state["currentForm"][event.currentTarget.id].value){
            if (event.currentTarget.value === eval(defaultValue)){
                global.state["currentForm"][event.currentTarget.id].value = event.currentTarget.value
                global.state["currentForm"].modified -= 1
                global.state["currentForm"][event.currentTarget.id].modified = false
                if(global.state["currentForm"].modified===0){
                    save_menu.style.display="none"
                }
            }else if(!global.state["currentForm"][event.currentTarget.id].modified){
                global.state["currentForm"][event.currentTarget.id]={value: event.currentTarget.value, modified :true,defaultValue: eval(defaultValue)}
                if(global.state["currentForm"].modified===0){
                    save_menu.style.display="flex"
                }
                global.state["currentForm"].modified += 1
            }else{
                global.state["currentForm"][event.currentTarget.id].value = event.currentTarget.value
            }

            if(evaluation){
                const pre = evaluation.title && event.currentTarget.value!=="" ? evaluation.title : ""
                updateDisplayedForm(event.currentTarget.id, pre.concat(eval(evaluation.value)))
            }else{
                updateDisplayedForm(event.currentTarget.id, event.currentTarget.value)
            }
        }
    }else if (event.currentTarget.value !== eval(defaultValue)){
        console.log(event.currentTarget.value)
        global.state["currentForm"] = { [event.currentTarget.id] : {value: event.currentTarget.value, modified :true, defaultValue: eval(defaultValue)}, modified: 1}
        save_menu.style.display="flex"
        if(evaluation){
            const pre = evaluation.title && event.currentTarget.value!=="" ? evaluation.title : ""
            updateDisplayedForm(event.currentTarget.id, pre.concat(eval(evaluation.value)))
        }else{
            updateDisplayedForm(event.currentTarget.id, event.currentTarget.value)
        }
    }
}
window.updatePreview = updatePreview

export function updateDisplayedForm(id,value){
    const subs = document.querySelectorAll(".form-".concat(id))
    for (let sub of subs){
        sub.innerHTML = value
    }
}

function reset(){
    for (let key in global.state["currentForm"]){
        if (key !== "modified" && global.state["currentForm"][key].modified){
            const element = document.getElementById(key)
            element.value = global.state["currentForm"][key].defaultValue
        }
        updateDisplayedForm(key,global.state["currentForm"][key].defaultValue)
    }
    delete global.state["currentForm"]
    const save_menu = document.querySelector(".save-settings")
    save_menu.style.display="none"
}
window.reset = reset

