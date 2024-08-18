import {initNav, goTo} from "/static/framework/navigation.mjs"
import {loadServers, loadUser, loadConvs, loadUsers, handleMessageGroup, sendTyping} from "/static/crud.mjs"
import global from "/static/framework/global.mjs"
import {MDToHTML} from "/static/markdown/utils.mjs"; // DO NOT REMOVE
import emojis from "/static/emojis.mjs";
import {pushElement, setElement} from "/static/framework/sakura.mjs";
import {xhr} from "./framework/templating.mjs";

window.global = global
global.state.dom = document.querySelector("body")
global.state.currentTab = document.getElementById("logo")
const notifElt = document.getElementById("notif")

function print(...args){
    const green ="#68f66e"
    const blue ="#4284f5"
    const yellow ="#fef972"
    const red ="#ee6966"
    const pink ="#fb7bfa"
    const purple ="#6a76fa"

    const colors = [green,blue,green,"white",green,blue,"white",yellow,blue,"white",yellow,"white",yellow,red,pink,purple];
    console.log(`%c${args.join(' ')}`, ...colors.map(c => `color: ${c};`));
    // console.log(colors.map(c => `%c${c}`).join(''), ...colors.map(c => `background: ${c};`));
}

print("          _____                        %c Disclone@Carbonlab.dev\n" +
    "%c         /\\    \\                  %c -----------------------------------\n" +
    "%c        /::\\    \\                %c  Credits%c: Lou !  \n" +
    "%c       /::::\\    \\                 %cGithub%c: https://github.com/Louciole/disclone \n" +
    "%c      /::::::\\    \\       \n" +
    "     /:::/\\:::\\    \\               %cPowered by Sakura ! \n" +
    "%c    /:::/  \\:::\\    \\    \n" +
    "%c   /:::/    \\:::\\    \\   \n" +
    "  /:::/    / \\:::\\    \\  \n" +
    " /:::/    /   \\:::\\    \\ \n" +
    "/:::/____/     \\:::\\____\\\n" +
    "\\:::\\    \\      \\::/    /\n" +
    "%c \\:::\\    \\      \\/____/ \n" +
    "  \\:::\\    \\             \n" +
    "   \\:::\\    \\            \n" +
    "    \\:::\\    \\           \n" +
    "%c     \\:::\\    \\          \n" +
    "      \\:::\\    \\         \n" +
    "       \\:::\\____\\        \n" +
    "        \\::/    /        \n" +
    "         \\/____/         \n" +
    "                         ")
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

global.state.dom.addEventListener("mousemove", (event) => resetIdle());
setInterval(checkIdle,60000)
setInterval(checkStatus,60000)

function resetIdle(){
    if (global.user.status.mode !== 0){
        return
    }

    if (global.state.idle && global.state.idle.state){
        const message = {"type" : 'changeActivity', "idle": false, "clientID":global.state.clientID};
        setElement("global.user.status", {icon: "green", text:"Online"})
        global.state.socket.send(JSON.stringify(message))
    }
    global.state.idle = {state: false, time:new Date().valueOf()}
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

function checkIdle(){
    if (global.user.status.mode !== 0 || global.state.idle.state){
        return
    }

    const mins = 15
    if(global.state.idle.time + (mins*60000) < new Date().valueOf()){
        global.state.idle.state = true
        setElement("global.user.status", {icon: "orange", text:"Idle"})
        const message = {"type" : 'changeActivity', "idle": true, "clientID":global.state.clientID};
        global.state.socket.send(JSON.stringify(message))
        console.log("client is idle")
    }
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

    global.state.emojis = []

    for (let category of emojis) {
        let cat = {name:category.name, icon:category.icon, content:""}
        for (let emoji of category.content) {
            cat.content = cat.content.concat(`<div class="item" onclick="insertStandardEmoji(event,'currentInput')">${emoji.char}</div>`)
        }
        global.state.emojis.push(cat)
    }
}

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

function Save(){
    console.log("saving",global.state["currentForm"])
    for (let key in global.state["currentForm"]){
        if (key !== "modified" && global.state["currentForm"][key].modified){
            const target = key.split("-")[0]
            console.log("target is ",target)
            xhr("change?element=".concat(target,"&value=",encodeURIComponent(global.state["currentForm"][key].value)), undefined,"POST",false)
            setElement("global.user.".concat(target), global.state["currentForm"][key].value)
        }
    }
    delete global.state["currentForm"]
    const save_menu = document.querySelector(".save-settings")
    save_menu.style.display="none"
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

export function getPrivateConvUser(element){
    for (let user of element.members){
        if (global.user.id !== user) {
            loadUsers([user])
            return global.users[user]
        }
    }

}
window.getPrivateConvUser = getPrivateConvUser

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
    }else{
        sendTyping()
    }
}
window.sendMessage = sendMessage

function resizeHeight(event){
    const lines = 1 + (event.currentTarget.value.match(/\n/g) || []).length;
    event.currentTarget.rows = lines > 25 ? 25 : lines;
}
window.resizeHeight = resizeHeight

function getConvName(conv,inputable = false){
    if (conv.private || !inputable){
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
    }else{
        const input = document.createElement("input")
        input.value = conv.name ? conv.name : ""
        return input
    }
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
    const notifSound = new Audio('static/sounds/notification.mp3');
    notifSound.play();
    const bubbles = document.getElementsByClassName("notifIndicator")
    if(notif.content.place){
        const conv_elt = document.getElementById("conv"+notif.content?.place.toString())
        if (conv_elt){
            conv_elt.style.setProperty("color", "var(--text)")
        }
        if(!global.state.notifs){
            global.state.notifs = {}
        }
        if(!global.state.notifs.convs){
            global.state.notifs.convs = []
        }
        pushElement("global.state.notifs.convs",{n: 1, conv:global.convs[notif.content.place]})
    }else{
        for(let bubble of bubbles){
            bubble.style.display="flex"
        }
    }
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