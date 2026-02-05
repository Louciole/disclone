import {initNavigation, printWatermark, goTo} from "/static/framework/navigation.mjs"
import {initWebSockets} from "./framework/websockets.mjs";
import {loadServers, loadUser, loadConvs, loadUsers, handleMessageGroup, sendTyping, lookFor, orderServDirs} from "/static/crud.mjs"
import global from "/static/framework/global.mjs"
import {MDToHTML} from "/static/markdown/utils.mjs"; // DO NOT REMOVE
import {} from "/static/admin.mjs"; // DO NOT REMOVE
import {} from "/static/access.mjs"; // DO NOT REMOVE
import {} from "/static/avatar.mjs"; // DO NOT REMOVE
import {} from "/static/imageEditor.mjs"; // Image crop/resize editor
import { initDrag } from "./drag.mjs";
import emojis from "/static/emojis.mjs";
import {addElement, deleteElement, pushElement, setElement} from "/static/framework/vesta.mjs";
import {xhr} from "./framework/templating.mjs";
import {initTranslations} from "./translations/translation.mjs";
import CallManager from "/static/webrtc.mjs";
import {} from "/static/constants.mjs"; // Expose LANGUAGE_LABELS and parseJsonArray globally


global.state.currentTab = document.getElementById("logo")
const notifElt = document.getElementById("notif")
global.state.pendingConvMembers = {}
global.users = {}
global.convs = {}
global.privateConvs = {}


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

    global.state.callManager = new CallManager();

    console.log("Client ready", global)
    hideLoadingScreen()
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
window.getSlug = getSlug

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

function Save(endpoint="change"){
    console.log("saving",global.state["currentForm"])
    for (let key in global.state["currentForm"]){
        if (key !== "modified" && global.state["currentForm"][key].modified){
            const target = key.split("-")[0]
            console.log("target is ",target)
            if (endpoint === "editServer") {
                xhr(endpoint + "?id=".concat(global.state.currentServer.id, "&property=", target, "&value=", encodeURIComponent(global.state["currentForm"][key].value)), undefined, "POST", false)
                setElement("global.state.currentServer.".concat(target), global.state["currentForm"][key].value)
            }else if (endpoint === "editChannel") {
                const id = global.state.modaltarget.dataset.id
                const newValue = global.state["currentForm"][key].value

                const channelId = parseInt(id)
                let channelArray = null
                let channelIndex = -1

                channelIndex = global.state.currentServer.dirs.channels.findIndex(ch => ch.id === channelId)
                if (channelIndex !== -1) {
                    channelArray = global.state.currentServer.dirs.channels
                }

                if (channelIndex === -1) {
                    channelIndex = global.state.currentServer.dirs.rooms.findIndex(ch => ch.id === channelId)
                    if (channelIndex !== -1) {
                        channelArray = global.state.currentServer.dirs.rooms
                    }
                }

                if (channelIndex === -1) {
                    channelIndex = global.state.currentServer.dirs.drives.findIndex(ch => ch.id === channelId)
                    if (channelIndex !== -1) {
                        channelArray = global.state.currentServer.dirs.drives
                    }
                }

                if (channelArray && channelIndex !== -1) {
                    channelArray[channelIndex].name = newValue

                    orderServDirs(global.state.currentServer)
                }

                // Envoyer la requête en arrière-plan (si ça échoue, on pourrait rollback)
                xhr("editServer?id=".concat(global.state.currentServer.id, "&property=channel&value=", encodeURIComponent(newValue), "&field=name&targetId=", id), undefined, "POST", false)
            }else if (endpoint === "editRole") {
                const id = global.state.currentRole.id
                xhr("editServer?id=".concat(global.state.currentServer.id, "&property=role&value=", encodeURIComponent(global.state["currentForm"][key].value), "&field=name&targetId=", id), undefined, "POST", false)
                // setElement("global.state.currentServer.".concat(target), global.state["currentForm"][key].value)
            }else{
                xhr(endpoint+"?element=".concat(target,"&value=",encodeURIComponent(global.state["currentForm"][key].value)), undefined,"POST",false)
                setElement("global.user.".concat(target), global.state["currentForm"][key].value)
            }
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
            // Use timestamp as temporary ID (server should return real ID, but for now...)
            const tempId = Object.keys(global.convs[global.state.activeConv].messages || {}).length
            const message = {"id":tempId, "sender": global.user.id,"place":global.state.activeConv, "body": target.value, "timestamp":timestamp, "reply":global.convs[global.state.activeConv].reply, "attachments":attachments}
            handleMessageGroup(message)

            addElement('global.convs['.concat(global.state.activeConv,'].messages'), message)

            target.value = ''
            resizeHeight(event, target)
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

function resizeHeight(event, target = undefined){
    if (!target){
        target = event.currentTarget
    }
    const lines = 1 + (target.value?.match(/\n/g) || []).length;
    target.rows = lines > 25 ? 25 : lines;
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
            if(member != global.user.id){
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
        const og = global.convs[global.state.activeConv].messages?.[element.messages[0].reply]

        if (!og){ // FIXME when sending a message you dont get the id of your message back so the reply block is broken if the users responds
            return ""
        }

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
    if (userList == undefined) {
        return undefined
    }

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


function deleteServer(){
    if (confirm(_t('Voulez-vous vraiment supprimer votre serveur et tous ses contenus associés ? Cette action est irréversible.'))) {

        const onload = function() { // request successful
            console.log("server deleted")
            deleteElement("global.servers", global.state.currentServer.id)
            window.location.href = ("/channels")
        };
        xhr("deleteServer?id=".concat(global.state.currentServer.id), onload, "POST", true)

    } else {
        console.log("ouf 😖")
    }
}
window.deleteServer = deleteServer

initNavigation()
printWatermark("Disclone@carbonlab.dev", "https://github.com/Louciole/disclone")
await initTranslations()
goTo('content',"friends",undefined,true,()=>{goTo('friends-block','main-friend')})
loadTemplate("profile-info.html")
loadUser()
xhr("friends?action=getBlocked", onBlockedLoaded)
xhr("friends?action=get", onFriendsLoaded)
xhr("friends?action=invitations", onInvitationsLoaded)


loadServers()

// low priority
loadEmojis()
initDrag()


function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');

    // Fade out the loading screen
    loadingScreen.classList.add('fade-out');

    // Optional: wait until the transition ends before removing or showing content
    loadingScreen.addEventListener('transitionend', () => {
        loadingScreen.style.display = 'none';
    });
}


function showIncomingCallNotification(callData) {
    // TODO USE A TEMPLATE INSTEAD OF CREATING ELEMENTS LIKE A SAVAGE
    const isVideo = callData.call_type === 'video';
    const callTypeText = isVideo ? _t("appel vidéo") : _t("appel vocal");

    const initiator = callData.participants[0];
    const initiatorName = global.users[initiator]?.display || 'Un utilisateur';

    const notification = document.createElement('div');
    notification.className = 'incoming-call-notification';
    notification.innerHTML = `
        <div class="incoming-call-content">
            <img class="icon large" src="/static/icons/material/${isVideo ? 'videocam' : 'call'}.svg"/>
            <h3>${initiatorName}</h3>
            <p>${callTypeText} ${_t("entrant")}</p>
            <div class="incoming-call-actions">
                <button class="btn-accept" onclick="acceptCall(${callData.id}, ${isVideo})">
                    <img class="icon" src="/static/icons/material/call.svg"/>
                    ${_t("Accepter")}
                </button>
                <button class="btn-decline" onclick="declineCall(${callData.id})">
                    <img class="icon" src="/static/icons/material/call_end.svg"/>
                    ${_t("Refuser")}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(notification);

    const notifSound = document.getElementById('call-ringtone');
    if (notifSound) {
        notifSound.play().catch(e => console.log('Cannot play ringtone:', e));
    }
}
window.showIncomingCallNotification = showIncomingCallNotification;

window.acceptCall = async function(callId, hasVideo) {
    const notification = document.querySelector('.incoming-call-notification');
    if (notification) {
        notification.remove();
    }

    const ringtone = document.getElementById('call-ringtone');
    if (ringtone) {
        ringtone.pause();
        ringtone.currentTime = 0;
    }

    await joinCall(callId, hasVideo);
};

window.declineCall = function(callId) {
    // Supprimer la notification
    const notification = document.querySelector('.incoming-call-notification');
    if (notification) {
        notification.remove();
    }

    // Arrêter la sonnerie
    const ringtone = document.getElementById('call-ringtone');
    if (ringtone) {
        ringtone.pause();
        ringtone.currentTime = 0;
    }
};

window.addEventListener('load', () => {
    hideLoadingScreen()
});
