import {loadTemplate} from "/main.mjs"
import global from "/global.mjs"
import {xhr} from "./crud.mjs";

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

function goTo(id, target, selected=undefined, async=true){
    loadTemplate(target.concat(".html"), id, undefined, async)
    if(selected){
        if(global.state[selected.category]){
            global.state[selected.category].classList.remove("selected")
        }

        if(selected.event){
            global.state[selected.category] = selected.event.currentTarget
        }else{
            global.state[selected.category] = selected.target
        }
        global.state[selected.category].classList.add("selected")
    }
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
