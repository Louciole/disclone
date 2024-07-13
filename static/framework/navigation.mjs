import {loadTemplate} from "./templating.mjs";
import global from "./global.mjs";

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

function saveCursorPosition(event){
    global.state.previousCursor={start:event.srcElement.selectionStart, end:event.srcElement.selectionEnd}
}
window.saveCursorPosition = saveCursorPosition
