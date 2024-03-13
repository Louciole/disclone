const dom = document.querySelector("body")
let currentTab = document.getElementById("logo")
var currentConv;
let user={}

import {initNav} from "/navigation.mjs"


initFront()
initNav()

function initFront(){
    loadTab("privateMessage")
    loadConv("friends")
    loadServers()
    loadEmojis()
    loadUser()
}

export function loadTemplate(template, target=undefined, flex= undefined){
    const effect = function() {
        console.log(target, flex)
        if (target){
            //maybe not using eval
            document.getElementById(target).innerHTML = eval('`' + this.responseText + '`');
        }else{
            dom.insertAdjacentHTML('beforeend',eval('`' + this.responseText + '`'))
        }
        if (flex){
            document.getElementById(flex).style.display = "flex"
        }
    };

    xhr( '/templates/'.concat(template), effect)
}

function loadUser(){
    let request = new XMLHttpRequest();
    request.open('POST', "/getUserInfo", true);
    request.onload = function() { // request successful
        user=JSON.parse(request.responseText)
    };

    request.onerror = function() {
        console.log("request failed")
    };

    request.send();
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

function loadTab(tabName){
    const effect = function() {
        document.getElementById('sec-selector').innerHTML = this.responseText;
        currentConv=document.querySelector("#sec-selector .selected")
    };

    xhr(tabName.concat("Selector.html"),effect)
}

function loadConv(name){
    const effect = function() {
        document.getElementById('content').innerHTML = this.responseText;
        currentConv=document.querySelector("#sec-selector .selected")
    };

    xhr(name.concat(".html"),effect)
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

export function xhr(filename,effect){
    let xhr= new XMLHttpRequest();
    xhr.open('GET', filename, true);
    xhr.onload=effect
    xhr.onerror = function() {
        console.log("request failed")
    };
    xhr.send();
}

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

function navigateSettings(element){
    //TODO
}
