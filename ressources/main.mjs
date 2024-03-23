import {initNav, goTo} from "/navigation.mjs"
import {xhr, loadServers, loadUser, loadConvs} from "/crud.mjs"
import global from "/global.mjs"

const dom = document.querySelector("body")
global.state.currentTab = document.getElementById("logo")

const WEBSOCKETS = "ws://localhost:9877"

initWebSockets()
initNav()
loadUser()
loadConvs()
goTo('sec-column',"column-perso",undefined, false)
goTo('content',"friends")
loadServers()
goTo('sec-selector',"privateMessage")
loadEmojis()
goTo('friends-block','main-friend')


function initWebSockets(){
    const socket = new WebSocket(WEBSOCKETS);

    socket.onopen = function(event) {
        console.log("Connection opened to Python WebSocket server!");
        const message = {"content" : 'Hello from the JavaScript client!'};
        socket.send(JSON.stringify(message));
    };

    socket.onmessage = function(event) {
        console.log("Received message from Python server:", event.data);
    };

    socket.onerror = function(error) {
        console.error("WebSocket error:", error);
    };

}

export function loadTemplate(template, target=undefined, flex= undefined, async){
    const effect = function() {
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

    xhr( '/templates/'.concat(template), effect,"GET", async)
}

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

export function addServer(name){
    const servers = document.getElementById('servers')
    servers.insertAdjacentHTML("beforeend",`
        <div class="container">
            <div class="item serveur" onclick="goTo('sec-selector','serverSelector',{'category':'currentTab' ,'event': event})">${getSlug(name)}</div>
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

function fillWith(template, list){
    console.log("fillWith")
    const effect = function() {};
    const request = xhr( '/templates/'.concat(template,".html"), effect, "GET", false)

    let content = ""
    for (let element of list){
        content += eval('`' + request.responseText + '`')
    }
    return content
}
window.fillWith = fillWith

function Subscribe(element, content, className=undefined){
    console.log("Subscribe to",element, global, content,content())
    //subscribe content to element, content will be reevaluated on element change
    const domElement = document.createElement('div')
    domElement.className = element.replaceAll('.','-')
    if (className){
        domElement.classList.add(className)
    }
    domElement.innerHTML = content()
    domElement.dataset.content = content
    return domElement.outerHTML
}
window.Subscribe = Subscribe

export function setElement(element, value){
    console.log(element,'has been updated to:', value);
    eval(`${element} = value`);
    const subscriptions = document.querySelectorAll(`[class^="${element.replaceAll('.','-')}"]`)
    for (let sub of subscriptions){
        console.log("we need to evaluate",sub)
        const content = eval(sub.dataset.content)
        sub.innerHTML = content()
    }
}

function Save(element){
    const input = document.getElementById("display-name-input")

    const onSaved = function (){
    }
    //TODO make this correctly
    xhr("change?element=display&value=".concat(input.value), onSaved,"POST",false)
    setElement(element, input.value)
}
window.Save = Save

export function getRelevantUser(element){
    console.log("processing",element)
    if (global.user.id === element["kopinprincipal"]){
        return element["kopinsecondaire"]
    }else{
        return element["kopinprincipal"]
    }
}
window.getRelevantUser = getRelevantUser
