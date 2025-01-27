import {initNav, goTo} from "/static/framework/navigation.mjs"
import {loadServers, loadUser, loadConvs, loadUsers, handleMessageGroup, sendTyping, lookFor} from "/static/crud.mjs"
import global from "/static/framework/global.mjs"
import {MDToHTML} from "/static/markdown/utils.mjs"; // DO NOT REMOVE
import { initDrag } from "./drag.mjs";
import emojis from "/static/emojis.mjs";
import {addElement, pushElement, setElement} from "/static/framework/sakura.mjs";
import {xhr} from "./framework/templating.mjs";
import {initTranslations} from "./translations/translation.mjs";

window.global = global
global.state.dom = document.querySelector("body")
global.state.currentTab = document.getElementById("logo")
const notifElt = document.getElementById("notif")
const { hostname, port } = window.location;
global.state.location = { host:hostname, port:port, short:port ? hostname + ":" + port : hostname }

window.addEventListener('unload', () => {
    if (global.state?.socket.readyState !== WebSocket.CLOSED) {
        const message = {"type" : 'unregister', "clientID":global.state.clientID}
        global.state.socket.send(JSON.stringify(message))
        global.state.socket.close()
    }
});

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

print("                                            %c Disclone@Carbonlab.dev\n" +
    "%c⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀        %c -----------------------------------\n" +
    "%c⠀⠀⠀⠀⠀⠀⠀⢠⠀⠀⠀⠀⠀⠀⠀⠀⢰⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀       %c  Credits%c: Lou !  \n" +
    "%c⠀⠀⠀⠀⠀⠀⠀⠸⣷⣦⣀⠀⠀⠀⠀⠀⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⡀⠀⠀        %c Github%c: https://github.com/Louciole/disclone \n" +
    "%c⠀⠀⠀⠀⠀⠀⠀⠀⠙⣿⣿⣿⣦⠀⠠⠾⠿⣿⣷⠀⠀⠀⠀⠀⣠⣤⣄⠀⠀⠀\n" +
    "⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠟⢉⣠⣤⣶⡆⠀⣠⣈⠀⢀⣠⣴⣿⣿⠋⠀⠀⠀⠀      %c Powered by Sakura ! \n" +
    "%c⠀⢀⡀⢀⣀⣀⣠⣤⡄⢀⣀⡘⣿⣿⣿⣷⣼⣿⣿⣷⡄⠹⣿⡿⠁⠀⠀⠀⠀⠀\n" +
    "%c⠀⠀⠻⠿⢿⣿⣿⣿⠁⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⣁⠀⠋⠀⠀⠀⠀⠀⠀⠀ \n" +
    "⠀⠀⠀⠀⠀⠀⠈⠻⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇⢰⣄⣀⠀⠀⠀⠀⠀\n" +
    "%c⠀⠀ ⠀⠀⠀⠀⣠⡀⠀⣴⣿⣿⣿⣿⣿⣿⣿⡿⢿⡿⠀⣾⣿⣿⣿⣿⣶⡄⠀ \n" +
    "⠀⠀⠀⠀⠀⢀⣾⣿⣷⡀⠻⣿⣿⡿⠻⣿⣿⣿⣿⠀⠀⠈⠉⠉⠉⠀⠀⠀⠀⠀\n" +
    "⠀⠀⠀⠀⣠⣾⡿⠟⠉⠉⠀⢀⡉⠁⠀⠛⠛⢉⣠⣴⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀\n" +
    "%c⠀⠀⠀⠈⠉⠉⠀⠀⠀⠀⠀⢸⣿⣿⡿⠉⠀⠙⠿⣿⣿⣧⡀⠀⠀⠀⠀⠀⠀⠀\n" +
    "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣿⣿⠁⠀⠀⠀⠀⠀⠙⠿⣷⠀⠀⠀⠀⠀⠀⠀\n" +
    "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⠟⠀⠀⠀⠀⠀⠀⠀⠀⠃⠀⠀⠀⠀⠀⠀⠀")

const onBlockedLoaded = function(){
    global.user.blocked = {}
    let usersToload = []

    for(let blockship of JSON.parse(this.responseText)){
        usersToload.push(blockship.blocked)
        global.user.blocked[blockship.id] = blockship
    }
    loadUsers(usersToload)
}

const onFriendsLoaded = function(){
    global.user.friends = JSON.parse(this.responseText)
    let usersToload = []
    for (let friendship of global.user.friends){
        usersToload.push(getRelevantUser(friendship))
    }
    loadUsers(usersToload)
}

const onInvitationsLoaded = function(){
    global.user.invitations = JSON.parse(this.responseText)
    let usersToload = []
    for (let friendship of global.user.invitations){
        usersToload.push(getRelevantUser(friendship))
    }
    loadUsers(usersToload)
}

export function postWS(){
    const userList = JSON.stringify(Object.keys(global.users).map(cle => parseInt(cle)))
    xhr("subscribe?client="+global.state.clientID+"&cat=user&items="+userList,undefined)
    console.log("Client ready", global)
}

function statusText(){
    if(global.user?.status?.text){

        const default_msg = ["Online","Idle","Do not Disturb","Offline"]
        if(default_msg.includes(global.user.status.text)){
            global.user.status.text = _t(global.user.status.text)
        }

        if(global.user?.status?.emoji){
            return global.user.status.emoji.concat(" ",global.user.status.text)
        }else{
            return global.user.status.text
        }
    }else{
        return _t("Online")
    }
}
window.statusText = statusText

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

export function addServer(name,id){
    const servers = document.getElementById('servers')
    servers.insertAdjacentHTML("beforeend",`
        <div class="container">
            <div class="item serveur" onclick="goToServer(event,${id})">${getSlug(name)}</div>
            <div class="indicator"></div>
            <span class="tooltip left">${name}</span>
        </div>
    `)
}

function loadEmojis(){

    global.state.emojis = []

    for (let category of emojis) {
        let cat = {name:category.name, icon:category.icon, content:"",status:""}
        for (let emoji of category.content) {
            cat.content = cat.content.concat(`<div class="item" onclick="insertStandardEmoji(event,'currentInput')">${emoji.char}</div>`)
            cat.status = cat.status.concat(`<div class="item" onclick="insertStandardEmoji(event,'status')">${emoji.char}</div>`)
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
    if (global.user.id === element["kopinprincipal"]){
        return element["kopinsecondaire"]
    }else{
        return element["kopinprincipal"]
    }
}
window.getRelevantUser = getRelevantUser

function sendMessage(event){
    if (event.key === "Enter" && !event.shiftKey){
        const target = event.currentTarget

        const onload = function(){
            const attachments = this.responseText
            const currentDate = new Date();
            const timestamp = currentDate.getTime();
            const message = {"id":global.convs[global.state.activeConv].messages.length, "sender": global.user.id,"place":global.state.activeConv, "body": target.value, "timestamp":timestamp, "reply":global.convs[global.state.activeConv].reply, "attachments":attachments}
            handleMessageGroup(message)
            pushElement('global.convs['.concat(global.state.activeConv,'].messages'), message)
            target.value = ''
            resizeHeight(event)
            cancelReply()
        }

        if (target.value.trim() !== '' || global.state?.currentMessageImages?.length>0){
            xhr("sendMessage?conv=".concat(encodeURI(JSON.stringify({'id':global.state.activeConv})), "&content=", encodeURIComponent(target.value),"&reply=",global.convs[global.state.activeConv].reply), onload,"POST",true,{"attachments":global.state.currentMessageImages})
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
        return `<input value="${conv.name ? conv.name : ''}" onblur="renameConv(event,${conv.id})" onkeydown="checkEnter(event, ()=>{renameConv(event,${conv.id})})")>`
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

function getAnswerBlock(element){
    if(element.messages[0].reply){
        const og = lookFor(element.messages[0].reply, global.convs[global.state.activeConv].messages)

        return `<div class="inline reply">
<div class="replyLineBox">
    <div class="replyLine">
    </div>
</div>
<div class="circle red small"></div>
<b>@${global.users[og.sender].display}</b>
<a href="#message-${og.id}" class="ellipsis">${og.body}</a>
</div>`
    }else{
        return ""
    }
}
window.getAnswerBlock = getAnswerBlock

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

function notMe(userList, loadUser=false){
    for (let i in userList){
        if (userList[i] != global.user.id){
            if(loadUser){
                loadUsers([userList[i]])
            }
            return userList[i]
        }
    }
    return userList[0]
}
window.notMe = notMe

function getUserStatus(id, customOnly=false){
    if(global.users[id]?.status?.text){

        const default_msg = ["Online","Idle","Do not Disturb","Offline"]
        if(default_msg.includes(global.users[id].status.text)){
            if (customOnly){
                return ""
            }
            global.users[id].status.text = _t(global.users[id].status.text)
        }

        if(global.users[id]?.status?.emoji){
            return global.users[id].status.emoji.concat(" ",global.users[id].status.text)
        }else{
            return global.users[id].status.text
        }
    }else{
        return _t("Online")
    }
}
window.getUserStatus = getUserStatus


await initTranslations()
goTo('sec-column',"column-perso",undefined, true,()=>{goTo('sec-selector',"privateMessage")})
goTo('content',"friends",undefined,true,()=>{goTo('friends-block','main-friend')})

initNav()
loadUser()
xhr("friends?action=getBlocked", onBlockedLoaded)
xhr("friends?action=get", onFriendsLoaded)
xhr("friends?action=invitations", onInvitationsLoaded)
loadConvs()

loadServers()

// low priority
loadEmojis()
initDrag()
