import {initNav, goTo} from "/navigation.mjs"
import {xhr, loadServers, loadUser, loadConvs, loadUsers, handleMessageGroup} from "/crud.mjs"
import global from "/global.mjs"
import {MDToHTML} from "/markdown/utils.mjs";

const dom = document.querySelector("body")
global.state.currentTab = document.getElementById("logo")
const notifElt = document.getElementById("notif")

initNav()
loadUser()
loadConvs()
goTo('sec-column',"column-perso",undefined, false)
goTo('content',"friends")
loadServers()
goTo('sec-selector',"privateMessage")
loadEmojis()
goTo('friends-block','main-friend')
console.log("Client ready", global)

console.log("result", MDToHTML(">BLBAL\n# Bonjour monde \n bip-boop \n - a \n - *b* \n - **c** \n - ***d*** \n ####sous-titre" ))

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
    console.log("fillWith",template,list,typeof list)
    const effect = function() {};
    const request = xhr( '/templates/'.concat(template,".html"), effect, "GET", false)

    let content = ""
    if (typeof list == 'object'){
        for (let elementId in list){
            const element = list[elementId]
            content += eval('`' + request.responseText + '`')
        }
    }else{
        for (let element of list){
            content += eval('`' + request.responseText + '`')
        }
    }

    return content
}
window.fillWith = fillWith

function repaintConv(sub, value){
    console.log("repainting conv", sub, value)

    if(global.convs[global.state.activeConv].messageGroups[global.convs[global.state.activeConv].messageGroups.length-1].messages.length > 1){
        sub.lastChild.remove()
        if (sub.children[sub.children.length-1].classList.contains("separator")){
            sub.children[sub.children.length-1].remove()
        }
    }
    sub.insertAdjacentHTML("beforeend", fillWith('messageGroup',[global.convs[global.state.activeConv].messageGroups[global.convs[global.state.activeConv].messageGroups.length-1]]))


    // au lieu de fillWith on prends l'élément modifié et on l'handle
    // pour un nouveau message on l'append au groupe
    // pour un nouveau groupe on l'ajoute a la conv active
}
window.repaintConv = repaintConv

function Subscribe(element, content, className=undefined, repaint=undefined){
    //subscribe content to element, content will be reevaluated on element change
    const domElement = document.createElement('div')
    domElement.className = element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')
    if (className){
        domElement.classList.add(className)
    }
    domElement.innerHTML = content()
    if(repaint){
        domElement.dataset.repaint = repaint
    }else{
        domElement.dataset.content = content
    }
    return domElement.outerHTML
}
window.Subscribe = Subscribe

export function setElement(element, value){
    console.log(element,'has been updated to:', value);
    eval(`${element} = value`);
    const subscriptions = document.querySelectorAll(`[class^="${element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')}"]`)
    for (let sub of subscriptions){
        const content = eval(sub.dataset.content)
        sub.innerHTML = content()
    }
}

export function pushElement(element, value){
    console.log(element,'has been added:', value);
    eval(`${element}.push(value)`);
    const subscriptions = document.querySelectorAll(`[class^="${element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')}"]`)
    for (let sub of subscriptions){
        console.log("we need to evaluate",sub)

        if(sub.dataset.repaint){
            const fn = eval(sub.dataset.repaint)
            fn()
        }else{
            const content = eval(sub.dataset.content)
            sub.innerHTML = content()
        }
    }
}

export function addElement(element, value){
    console.log(element,'has been added:', value);
    eval(`${element}[value.id] = value`);
    const subscriptions = document.querySelectorAll(`[class^="${element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')}"]`)
    for (let sub of subscriptions){
        console.log("we need to evaluate",sub)
        const content = eval(sub.dataset.content)
        sub.innerHTML = content()
    }
}

export function deleteElement(element, id){
    console.log(element,'has been removed:', element[id]);
    eval(`${element}.splice(id,1)`);
    const subscriptions = document.querySelectorAll(`[class^="${element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')}"]`)
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

function sendMessage(event){
    if (event.key === "Enter" && !event.shiftKey){
        const onload = () => {
        }

        if (event.currentTarget.value.trim() !== '' ){
            xhr("sendMessage?conv=".concat(encodeURI(JSON.stringify({'id':global.state.activeConv})), "&content=", encodeURIComponent(event.currentTarget.value)), onload())
            const currentDate = new Date();
            const timestamp = currentDate.getTime();
            const message = {"id":global.convs[global.state.activeConv].messages.length, "sender": global.user.id,"place":global.state.activeConv, "body": event.currentTarget.value, "timestamp":timestamp}
            handleMessageGroup(message)
            pushElement('global.convs['.concat(global.state.activeConv,'].messages'), message)
            event.currentTarget.value = ''
            resizeHeight(event)
        }
        event.preventDefault()
    }
}
window.sendMessage = sendMessage


function checkEnter(event, effect){
    if (event.key === "Enter"){
        console.log("enter pressed")
        effect()
    }
}
window.checkEnter = checkEnter

function resizeHeight(event){
    const lines = 1 + (event.currentTarget.value.match(/\n/g) || []).length;
    event.currentTarget.rows = lines > 25 ? 25 : lines;
}
window.resizeHeight = resizeHeight

function getTimeStr(timestamp, options = { locale: "fr-FR" }) {
    const date = new Date(timestamp);

    const defaultOptions = {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
    };

    const mergedOptions = { ...defaultOptions, ...options };

    return date.toLocaleDateString(undefined, mergedOptions);
}
window.getTimeStr = getTimeStr

function getConvName(conv){
    if(conv.name){
        return conv.name
    }

    let name = ""
    loadUsers(conv.members)

    for (let member in conv.members){
        member = conv.members[member]
        if(member !== global.user.id){
            name = name.concat(global.users[member].display)
        }
    }
    conv.name=name
    return name
}
window.getConvName = getConvName

function getSeparator(element){
    let date

    if(element.id>0){
        date = global.convs[global.state.activeConv].messageGroups[element.id-1].date
    }else{
        date = undefined
    }
    if(date !== element.date){
        return `<div class="separator"><p>${element.date}</p><div class="hr"></div></div>`
    }else{
        return ""
    }
}
window.getSeparator = getSeparator

export function displayNotif(notif){
    const notifSound = new Audio('sounds/notification.mp3');
    notifSound.play();
    //notifElt.style.display = "flex"
    //notifElt.innerText = notif.body
    //setTimeout(() => notifElt.style.display="none", 1500)
}

function notMe(userList){
    for (let i in userList){
        if (userList[i] != global.user.id){
            return userList[i]
        }
    }
}
window.notMe = notMe