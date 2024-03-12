var currentTab;
var currentConv;
let activeFM;
let openingFM = false;

import {settings} from "/settings.mjs"

initFront()

function initFront(){
    currentTab=document.getElementById("logo")
    loadTab("privateMessage")
    loadConv("friends")
    loadServers()
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
    loadEmojis()
}

function changeActiveTab(tabName){
    currentTab.classList.remove("selected")
    currentTab=event.currentTarget
    currentTab.classList.add("selected")
    loadTab(tabName)
}

function changeActiveConv(convName){
    currentConv.classList.remove("selected")
    currentConv=event.currentTarget
    currentConv.classList.add("selected")
    loadConv(convName)
}

function createServer(){
    const createMenu=document.getElementById("create-server")
    createMenu.style.display="flex"
}
window.createServer = createServer

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

function loadTab(tabName){
    const effect = function() {
        document.getElementById('sec-selector').innerHTML = this.responseText;
        currentConv=document.querySelector("#sec-selector .selected")
    };

    loadSelector(tabName.concat("Selector.html"),effect)
}

function loadConv(name){
    const effect = function() {
        document.getElementById('content').innerHTML = this.responseText;
        currentConv=document.querySelector("#sec-selector .selected")
    };

    loadSelector(name.concat(".html"),effect)
}

function loadServers(){
    let request = new XMLHttpRequest();
    request.open('POST', "getUserServers", true);
    request.onload = function() {
        const response = JSON.parse(request.responseText)
        for (let i in response) {
            addServer(response[i].name)
        }
    };

    request.onerror = function() {
        console.log("request failed")
    };
    request.send();
}

function loadSelector(filename,effect){
    let xhr= new XMLHttpRequest();
    xhr.open('GET', filename, true);
    xhr.onload=effect
    xhr.send();
}

function deafen(){
    event.currentTarget.lastElementChild.classList.toggle("visible")
}
window.deafen = deafen

function mute(){
    event.currentTarget.lastElementChild.classList.toggle("visible")
}
window.mute = mute

function silent_typing(){
    event.currentTarget.lastElementChild.classList.toggle("visible")
}
window.silent_typing = silent_typing

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

function getSlug(name){
    const words = name.split(' ')
    let i = 0
    let slug= ''
    while (i < words.length && i<2){
        slug= slug + words[i][0]
        i++
    }
    return slug
}

function addServer(name){
    const servers = document.getElementById('servers')
    servers.insertAdjacentHTML("beforeend",`
        <div class="container">
            <div class="item serveur" onclick="changeActiveTab('server')">${getSlug(name)}</div>
            <div class="indicator"></div>
            <span class="tooltip left">${name}</span>
        </div>
    `)
}

function loadEmojis(){
    const board = document.getElementById('emoji-board')
}

function openSettings(){
    const settings = document.getElementById('settings')
    settings.style.display = "flex"
}
window.openSettings = openSettings

function logout(){
    const url = "/logout";
    let request = new XMLHttpRequest();
    request.open('POST', url, true);
    request.onload = function() { // request successful
        console.log("logged out",request.responseText)

        if (request.responseText === "ok"){
            window.location.href = "/auth";
        }
    };

    request.onerror = function() {
        console.log("request failed")
    };

    request.send();
}
window.logout = logout

function navigateSettings(element){
    //TODO
}
