import {loadTemplate} from "/main.mjs"
import {loadConv, loadTab} from "./crud.mjs";
import global from "/global.mjs"

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

function goTo(id,target){
    loadTemplate(target.concat(".html"), id)
}
window.goTo = goTo


let activeFM;
let openingFM = false;

function toggleFM(id){
    openingFM=true
    activeFM=document.getElementById(id)
}
window.toggleFM = toggleFM

function toggleGroup(){
    event.currentTarget.classList.toggle("closed")
}
window.toggleGroup = toggleGroup

function gotoStep(step,stepsID){
    const menu = document.getElementById(stepsID)
    console.log(step)
    menu.style.transform=`translateX(${-100*step/menu.childElementCount}%)`
}
window.gotoStep = gotoStep

function closeMenu(cible = undefined){
    //TODO generalize reset page count
    if(!cible){
        if(event.target !== event.currentTarget){
            return
        }
        event.target.style.display = "none";
    }else{
        const cibleEl= document.querySelector(cible)
        cibleEl.style.display = "none";
    }
    gotoStep(0,'createServerSteps')
}
window.closeMenu = closeMenu

export function changeActiveTab(tabName){
    global.state.currentTab.classList.remove("selected")
    global.state.currentTab=event.currentTarget
    global.state.currentTab.classList.add("selected")
    loadTab(tabName)
}

export function changeActiveConv(convName){
    global.state.currentConv.classList.remove("selected")
    global.state.currentConv=event.currentTarget
    global.state.currentConv.classList.add("selected")
    loadConv(convName)
}

function navigateSettings(element){
    //TODO
}
