import {initNav, changeActiveTab} from "/navigation.mjs"
import {xhr, loadServers, loadUser} from "/crud.mjs"
import global from "/global.mjs"

const dom = document.querySelector("body")
global.state.currentTab = document.getElementById("logo")

initNav()
loadUser()

goTo('sec-column',"column-perso")
goTo('sec-selector',"privateMessage")
goTo('content',"friends")
loadServers()
loadEmojis()
goTo('friends-block','main-friend')


export function loadTemplate(template, target=undefined, flex= undefined){
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

    xhr( '/templates/'.concat(template), effect)
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

function Subscribe(element, content){
    console.log("Subscribe to",element)
    //subscribe content to element, content will be reevaluated on element change
    const domElement = document.createElement('div')
    domElement.className = element
    domElement.rawContent = content
    domElement.innerHTML = content()
    return domElement.outerHTML
}
window.Subscribe = Subscribe

function setElement(element, value){
    console.log(element,'has been updated to:', value);
    element = value;
    const subscriptions = document.querySelector(element.name.toString())
    for (let sub of subscriptions){
        sub.innerHTML = eval(`${sub.rawContent()}`)
    }
}

function Save(element){
    const input = document.getElementById("display-name-input")
    const onSaved = function (){

    }
    //TODO make this correctly
    xhr("change?element=display&value=".concat(input.value), onSaved)
}
window.Save = Save
