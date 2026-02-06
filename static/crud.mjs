import {getRelevantUser} from "./main.mjs"
import {
    addElement,
    deleteElement,
    setElement,
    difference,
    pushElement,
    deleteVal,
    updateElement
} from "./framework/vesta.mjs"
import {initWebSockets} from "./framework/websockets.mjs"
import global from "./framework/global.mjs"
import {xhr} from "./framework/templating.mjs";
import {goTo, initNavigation} from "./framework/navigation.mjs";

function changeUsername(){
    const input = document.getElementById("username-input")

    const regex = /^(?=.{3,}$)[a-zA-Z0-9_\-\.]*$/;
    if (!regex.test(input.value)) {
        input.setCustomValidity("Invalid username. It must be at least 2 characters in letters, numbers, '_', '-', and '.'.");
        input.reportValidity()
        return
    } else {
        input.setCustomValidity("");
    }

    const onload = function() { // request successful
        setElement('global.user.username', input.value)
        closeMenu('#change-username')
    };
    xhr("/change?element=username&value=".concat(input.value),onload,"POST")
}
window.changeUsername = changeUsername

function newServer(){
    let request = new XMLHttpRequest();
    request.open('POST', "createServer", true);
    request.onload = function() {
        const serv = {name:"New Server",id:JSON.parse(request.responseText)}
        setElement(`global.servers[${serv.id}]`, serv)
    };

    request.onerror = function() {
        console.log("request failed")
    };
    request.send();
    closeMenu('#create-server')
}
window.newServer = newServer

export function loadServers(){
    const onload = function() {
        const response = JSON.parse(this.responseText)
        global.servers = response
        setElement(`global.servers`, response)
    };
    xhr("getUserServers",onload)
}

export function loadConvs(){
    const onload = function() {
        const keys = JSON.parse(this.responseText)
        for(let key of keys){
            global.privateConvs[key.id] = key // HACK
            global.convs[key.id] = global.privateConvs[key.id]
            global.convs[key.id].ongoingCall = null; // Initialize call state
            addElement("global.privateConvs", key);
            loadUsers(global.convs[key.id].members)
        }

        updateElement("global.convs")
        goTo('sec-column',"column-perso",undefined, true,()=>{goTo('sec-selector',"privateMessage")})

    };
    xhr("getUserConvs",onload)
}

export function loadUsers(keys){
    const diff = difference(keys, global.users)

    if(diff.length === 0){
        return
    }

    const onload = function() {
        const keys = JSON.parse(this.responseText)
        for(let key of keys){
            global.users[key.id] = key
        }
    };
    xhr("getUsersInfo?users="+JSON.stringify(diff), onload, "GET",false)
}
window.loadUsers = loadUsers

export function loadConv(key){
    const onload = function() {
    };

    const request = xhr("getConvContent?convId="+JSON.stringify(key), onload, "GET",false)
    const elements = JSON.parse(request.responseText)
    elements.attachments = elements.attachments ? JSON.parse(elements.attachments) : []
    for(let element in elements){
        global.convs[key][element] = elements[element]
    }

    let lastSender = undefined
    let lastTimestamp = undefined
    global.convs[key].messageGroups = []

    const messagesArray = global.convs[key].messages || []
    global.convs[key].messages = {}  // Source of truth: all messages by ID

    for(let message of messagesArray){
        message.body = message.body.replace(/</g, "&lt;")

        // si ça fait moins de 3 minutes de différence, que c'est la même personne et que la date n'a pas changée et que le message n'est pas une réponse
        global.convs[key].messages[message.id] = message

        // Group consecutive messages from same sender
        if(message.sender === lastSender && (new Date(message.timestamp)-new Date(lastTimestamp))/60000<3 && getTimeStr(message.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) === getTimeStr(lastTimestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) && !message.reply){
            global.convs[key].messageGroups[global.convs[key].messageGroups.length-1].messages.push(message)
        }else{
            lastSender = message.sender
            newMessageGroup(key, message)
        }
        lastTimestamp = message.timestamp
    }
}

export function loadChan(key){
    const onload = function() {
    };

    const request = xhr("getChanContent?convId="+JSON.stringify(key), onload, "GET",false)
    const elements = JSON.parse(request.responseText)
    elements.attachments = elements.attachments ? JSON.parse(elements.attachments) : []

    global.convs[key] = {}
    for(let element in elements){
        global.convs[key][element] = elements[element]
    }

    let lastSender = undefined
    let lastTimestamp = undefined
    global.convs[key].messageGroups = []

    // Convert messages array to dict
    const messagesArray = global.convs[key].messages || []
    global.convs[key].messages = {}  // Source of truth: all messages by ID

    for(let message of messagesArray){
        message.body = message.body.replace(/</g, "&lt;")

        global.convs[key].messages[message.id] = message

        // Group consecutive messages - messageGroups contain REFERENCES to messages dict objects
        if(message.sender === lastSender && (new Date(message.timestamp)-new Date(lastTimestamp))/60000<3 && getTimeStr(message.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) === getTimeStr(lastTimestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) && !message.reply){
            global.convs[key].messageGroups[global.convs[key].messageGroups.length-1].messages.push(message)
        }else{
            lastSender = message.sender
            newMessageGroup(key, message)
        }
        lastTimestamp = message.timestamp
    }
}

export function loadUser(){
    let request = new XMLHttpRequest();
    request.open('POST', "/getUserInfo", true);
    request.onload = function() { // request successful

        const response = JSON.parse(request.responseText)
        for (let key in response){
            global.user[key] = response[key]
        }
        updateElement('global.user', global.user)

        global.users[global.user.id] = global.user
        loadConvs()
        initWebSockets()
    };

    request.onerror = function() {
        console.log("request failed")
    };

    request.send();
}

function friend(action, element, event = undefined){
    //element is the id of the invitation for an accept or the username for an add

    const effect = function() {
        if (action !== "add"){
            return
        }

        const status = document.querySelector(".add .status")
        const search= document.querySelector(".add .search")

        if(this.responseText === "ok"){
            status.classList.add("succeed")
            status.classList.remove("failed")
            search.classList.add("succeed")
            search.classList.remove("failed")
            status.innerHTML = "Well done ! Your friend request has been sent !"
        }else{
            status.classList.remove("succeed")
            status.classList.add("failed")
            search.classList.remove("succeed")
            search.classList.add("failed")
            status.innerHTML = this.responseText
        }
    };

    if(action === "add"){
        const domElt= document.getElementById(element)
        xhr("friends?action=".concat(action,"&arg=",encodeURIComponent(domElt.value)),effect)
    }else if(action === "accept"){
        xhr("friends?action=".concat(action,"&arg=",element),effect)

        // doing some magic here to update the local state
        const invitationNumber = Array.prototype.indexOf.call(event.currentTarget.parentElement.children, event.currentTarget) - 1
        global.user.friends.push(global.user.invitations[invitationNumber])
        global.user.friends[global.user.friends.length-1].private = true
        deleteElement("global.user.invitations",invitationNumber)
    }else if(action === "remove"){
        element = lookFor(element.getAttribute("data-id"),global.user.friends)
        if (confirm("Do you really want to remove ".concat(global.users[getRelevantUser(element)].display," from your friends ?"))){
            const remEffect = function(){
                deleteElement("global.user.friends",element)
            }
            xhr("friends?action=".concat(action,"&arg=",element.id),remEffect)
            closeFM()
        }
    }else if(action === "removeYES"){
        if (element.confirm){
            if (! confirm("Do you really want to remove ".concat(global.users[element.id].display," from your friends ?"))){
                return
            }
        }

        for (let friendship in global.user.friends) {
            if (getRelevantUser(friend) === element.id) {
                const remEffect = function () {
                    deleteElement("global.user.friends", element.id)
                }
                xhr("friends?action=".concat(action, "&arg=", element.id), remEffect)
                break
            }
        }
    }
    else{
        xhr("friends?action=".concat(action,"&arg=",element),effect)
    }
}
window.friend = friend

// this function should be used only in non performance critical cases
export function lookFor(element, array){
    for(let i in array){
        if(array[i].id.toString() == element){
            return array[i]
        }
    }
}

/**
 * Get the last message ID from messages dict
 * @param {number} convId - Conversation ID
 * @returns {number|null} Last message ID or null if no messages
 */
function getLastMessageId(convId) {
    const messages = global.convs[convId]?.messages
    if (!messages) return null

    const keys = Object.keys(messages)
    if (keys.length === 0) return null

    // Get the last key (messages are added in order, so last key = last message)
    return parseInt(keys[keys.length - 1])
}

/**
 * Create a new message group
 * @param {number} conv - Conversation ID
 * @param {object} message - Message object (reference will be stored, not a copy)
 */
function newMessageGroup(conv, message){
    global.convs[conv].messageGroups.push({
        "date": getTimeStr(message.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}),
        "messages":[message],  // Array of REFERENCES to message objects
        "id":global.convs[conv].messageGroups.length
    })
}

/**
 * Handle grouping of a new message
 * Groups consecutive messages from the same sender within 3 minutes
 * @param {object} message - Message object to group
 */
export function handleMessageGroup(message){
    console.log("handleMessageGroup",message)
    message.attachments = message.attachments ? JSON.parse(message.attachments) : []

    const lastMsgId = getLastMessageId(message.place)
    if (lastMsgId !== null){
        const lastMsg = global.convs[message.place].messages[lastMsgId]
        // Group if same sender, < 3 min apart, same day, and not a reply
        if(message.sender === lastMsg.sender && (new Date(message.timestamp)-new Date(lastMsg.timestamp))/60000<3 && getTimeStr(message.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) === getTimeStr(lastMsg.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) && !message.reply){
            // Add reference to existing group
            global.convs[message.place].messageGroups[global.convs[message.place].messageGroups.length-1].messages.push(message)
        }else{
            // Create new group
            newMessageGroup(message.place, message)
        }
    }else{
        // First message - create new group
        newMessageGroup(message.place, message)
    }
}

export function sendTyping(){
    if(global.settings.silent_typing === undefined){
        global.settings.silent_typing = false
    }

    console.log("send typing",global.state.lastTyping)
    if( !global.settings.silent_typing && (!global.state.lastTyping || global.state.lastTyping+5000 < new Date().valueOf())){
        const message = {"type" : 'typing', "uid": global.user.id, "conv": global.state.activeConv};
        global.state.lastTyping = new Date().valueOf()
        global.state.socket.send(JSON.stringify(message))
    }
}

function changeStatus(mode){
    const default_msg = {"0":"Online","1":"Idle","2":"Do not Disturb","3":"Offline"}
    const status = {"mode":mode,"text": global.user.status.text !== default_msg[global.user.status.mode]?global.user.status.text:null, "emoji": global.user.status.emoji?global.user.status.emoji:null, "expiration":global.user.status.expiration?global.user.status.expiration:null}

    const onload = function() { // request successful
        const default_icons = {"0":"green","1":"orange","2":"RED","3":"spymode"}

        status.text = status.text?status.text:default_msg[status.mode]
        status.icon = status.icon?status.icon:default_icons[status.mode]
        setElement('global.user.status', status)
        closeMenu('#custom-status')
    };
    xhr("/change?element=status&value=".concat(JSON.stringify(status)),onload,"POST")
}
window.changeStatus = changeStatus

function setCustomStatus(){
    const input = document.getElementById("input-status")
    const modeDrop = document.getElementById("drop-status-mode").querySelector(".selected")
    const expDrop = document.getElementById("drop-status-exp").querySelector(".selected")

    const now = new Date()
    const brusselsOffset = -now.getTimezoneOffset() * 60 * 1000; // Negative offset for CET/CEST

    const hour = new Date(now.getTime() + brusselsOffset)
    hour.setHours(hour.getHours() + 1)

    const hours = new Date(now.getTime() + brusselsOffset)
    hours.setHours(hours.getHours() + 4)

    const half = new Date(now.getTime() + brusselsOffset)
    half.setMinutes(half.getMinutes() + 30)

    const tomorrow = new Date(now.getTime() + brusselsOffset)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)

    const exps = [tomorrow,hours,hour,half]
    const exp = expDrop.getAttribute("data-value") != 4 ? exps[expDrop.getAttribute("data-value")] : null

    const status = {"mode":modeDrop.getAttribute("data-value"),"text": input.value, "emoji":global.user.status.emoji,"expiration":exp}

    const onload = function() { // request successful
        const default_icons = {"0":"green","1":"orange","2":"RED","3":"spymode"}

        status.text = status.text?status.text:getDefaultMessage(status.mode)
        status.icon = status.icon?status.icon:default_icons[status.mode]
        setElement('global.user.status', status)
        closeMenu('#custom-status')
    };
    xhr("/change?element=status&value=".concat(JSON.stringify(status)),onload,"POST")
}
window.setCustomStatus = setCustomStatus

function getDefaultMessage(mode){
    const default_msg = {"0":"Online","1":"Idle","2":"Do not Disturb","3":"Offline"}
    return default_msg[mode]
}
window.getDefaultMessage = getDefaultMessage

function blockUser(id){
    const effect = function() {
        const response = this.responseText.split(" ")
        if(response[0] ==="ok"){
            friend('removeYES', {"id":id})
            addElement("global.user.blocked",{"id":parseInt(response[1]), "blocked":id})
        }
    };

    xhr("block?user=".concat(id),effect)
}
window.blockUser = blockUser

function initPendingMembers(){
    if (!global.state.pendingConvMembers[global.state.activeConv]){
        global.state.pendingConvMembers[global.state.activeConv] = global.convs[global.state.activeConv].members
    }
    return ""
}
window.initPendingMembers = initPendingMembers

function addPendingUser(event, id){
    console.log("addPendingUser",global.state.pendingConvMembers[global.state.activeConv])
    if (event.currentTarget.checked) {
        if (global.state.pendingConvMembers[global.state.activeConv].length >= 10){
            event.currentTarget.checked = false
            return
        }
        pushElement("global.state.pendingConvMembers[" + global.state.activeConv + "]", id)
        if (global.state.pendingConvMembers[global.state.activeConv].length > 2){
            const btn = document.getElementById("createConvBtn")
            btn.classList.remove("disabled")
        }
    }else {
        deleteVal("global.state.pendingConvMembers[" + global.state.activeConv + "]", id)
        if (global.state.pendingConvMembers[global.state.activeConv].length <= 2){
            const btn = document.getElementById("createConvBtn")
            btn.classList.add("disabled")
        }
    }
    console.log(global.state.pendingConvMembers[global.state.activeConv])
}
window.addPendingUser = addPendingUser

function createConv(event){
    if (event.currentTarget.classList.contains("disabled")){
        return
    }

    let selfId
    for(let i in global.state.pendingConvMembers[global.state.activeConv]){
        if(global.state.pendingConvMembers[global.state.activeConv][i] === global.user.id){
            selfId = i
            break
        }
    }

    global.state.pendingConvMembers[global.state.activeConv].splice(selfId,1)
    const members = global.state.pendingConvMembers[global.state.activeConv]
    const conv = {"name":"New Conversation","members":members,"messageGroups":[],"messages":{},"private":false}

    const onload = function() {
        conv.id = parseInt(this.responseText)
        addElement("global.convs", conv)
        closeMenu("#add-users")
    };
    xhr("createConv?name=".concat(conv.name,"&members=",JSON.stringify(conv.members)),onload)
}
window.createConv = createConv

function renameConv(event,id){
    if (event.currentTarget.value.length < 1 || event.currentTarget.value.trim() === global.convs[id].name){
        return
    }

    const name = event.currentTarget.value.trim()
    console.log("renameConv",id,event.currentTarget)
    const onload = function() { // request successful
        setElement('global.convs['+id+'].name', name)
    };
    xhr("/editConv?element=name&value=".concat(name,"&id=",id),onload,"POST")
}
window.renameConv = renameConv

function dropImage(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('dragging');

    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        handleImageUpload(file);
    }
}
window.dropImage = dropImage

function dropImageMessage(event) {
    event.preventDefault()
    document.querySelector('.dragging').classList.remove('dragging')

    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0]
        displayMessageImage(file)
    }
}
window.dropImageMessage = dropImageMessage

function pasteImageMessage(event) {
    const items = event.clipboardData?.items;
    if (!items) return;

    // Iterate through clipboard items and handle images
    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Check if the item is an image
        if (item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            if (file) {
                displayMessageImage(file);
            }
        }
    }
}
window.pasteImageMessage = pasteImageMessage

import imageEditor from "/static/imageEditor.mjs"

/**
 * Open image resize menu and initialize editor
 * @param {File} file - Image file to edit
 * @param {number} cropRatio - Crop ratio (1 = square/circle, 3 = banner)
 */
function uploadResizeFile(file, cropRatio = 1) {
    openMenu("resize-image", false)

    // Reset zoom slider
    const slider = document.querySelector('#resize-image input[type="range"]')
    if (slider) slider.value = 1

    imageEditor.init(file, cropRatio).catch(err => {
        console.error("Failed to load image:", err)
        closeMenu('#resize-image')
    })
}
window.uploadResizeImage = uploadResizeFile

function displayMessageImage(file){
    const reader = new FileReader();
    const canvas = document.getElementsByClassName("imageCanvas")[0]
    const box = document.getElementById("imageBox")
    box.style.display = "block"
    const ctx = canvas.getContext('2d');
    const img = new Image()
    reader.onload = function(e) {
        // Initialize array if needed, then append the new image
        if (!global.state.currentMessageImages) {
            global.state.currentMessageImages = []
        }
        global.state.currentMessageImages.push(reader.result)

        img.onload = function() {
            const size = Math.max(img.width,img.height)
            canvas.width = size;
            canvas.height = size;
            const x = (size - img.width)/2
            const y = (size - img.height)/2
            ctx.drawImage(img, x, y, img.width, img.height);
        }
        img.src = e.target.result;
    }
    reader.readAsDataURL(file);
}

function removeImageMessage(event){
    const box = document.getElementById("imageBox")
    box.style.display = "none"
    global.state.currentMessageImages = []
}
window.removeImageMessage = removeImageMessage

/**
 * Open banner editor with file picker (opens loadImage menu directly)
 */
function openBannerEditor() {
    global.state.uploadImage = "banner" // Flag for upload target
    openMenu('loadImage', false)
}
window.openBannerEditor = openBannerEditor

/**
 * Handle image upload from loadImage menu (detects banner vs pfp)
 */
function handleImageUpload(file) {
    if (!file) return

    const isBanner = global.state.uploadImage === "banner"
    const cropRatio = isBanner ? 3 : 1 // 3:1 for banners, 1:1 for avatars

    uploadResizeFile(file, cropRatio)
}
window.handleImageUpload = handleImageUpload

function uploadProfileImage(field="pfp"){
    const isBanner = global.state.uploadImage === "banner"
    const outputSize = isBanner ? 600 : 256 // 600px wide for banners, 256x256 for avatars

    imageEditor.getCroppedImageData(outputSize).then(result => {
        const onload = function () {
            if (global.state.uploadImage === "serverAvatar") {
                global.state.uploadImage = ""
                try {
                    const response = JSON.parse(this.responseText)
                    if (response.pfp) {
                        setElement('global.state.currentServer.pfp', response.pfp)
                        updateElement("global.servers")
                    }
                } catch (e) {
                    console.error("Failed to parse server pfp response:", e)
                }
            } else if (isBanner) {
                // Banner upload
                global.state.uploadImage = ""
                try {
                    const response = JSON.parse(this.responseText)
                    if (response.banner) {
                        setElement('global.user.banner', response.banner)
                    }
                } catch (e) {
                    console.error("Failed to parse banner response:", e)
                }
            } else {
                // Profile picture upload
                try {
                    const response = JSON.parse(this.responseText)
                    if (response.pfp) {
                        setElement('global.user.pfp', response.pfp)
                    }
                } catch (e) {
                    console.error("Failed to parse user pfp response:", e)
                }
            }
        }

        if (global.state.uploadImage === "serverAvatar"){
            xhr("editServer?property=pfp&id=".concat(global.state.currentServer.id), onload,"POST",true,{"value":result})
        } else if (isBanner) {
            xhr("change?element=banner", onload,"POST",true,{"value":result})
        } else {
            xhr("change?element=".concat(field), onload,"POST",true,{"value":result})
        }
        closeMenu('#resize-image')
        closeMenu('#loadImage')
    }).catch(err => {
        console.error("Failed to crop image:", err)
    })
}
window.uploadProfileImage = uploadProfileImage


export function loadServer(id){
    const onload = function() { // request successful
        console.log(this.responseText)
        const resp = JSON.parse(this.responseText)
        const serv = lookFor(id,global.servers)

        // Preserve community server properties (languages, tags, description, etc.)
        // These are loaded by getUserServers but not included in getServContent
        const preservedProps = {
            languages: serv.languages,
            tags: serv.tags,
            description: serv.description,
            is_community: serv.is_community,
            is_featured: serv.is_featured,
            member_count: serv.member_count
        };

        if (resp.op) {
            serv.op = resp.op
        }
        const dashboards = resp.dashboards ? resp.dashboards : []
        const rooms = resp.rooms ? resp.rooms : []
        const drives = resp.drives ? resp.drives : []
        const notes = resp.notes ? resp.notes : []
        serv["dirs"] = {"channels" : resp.channels, "dashboards" : dashboards , "rooms" : rooms, "drives" : drives, "notes": notes, "cat" : resp.cat}

        serv["members"] = {}
        let userList = []
        for (let member of resp.members){
            serv["members"][member.id] = member
            userList.push(member.id)
        }
        serv["roles"] = {}
        for (let role of resp.roles){
            serv["roles"][role.id] = role
        }

        serv["type"]= resp.type

        // Restore preserved properties
        Object.assign(serv, preservedProps);

        loadUsers(userList)
        orderServDirs(serv)

        // Déclencher la réactivité Vesta en mettant à jour le global state
        setElement(`global.servers[${id}]`, serv);

        // Si c'est le serveur actuel, mettre à jour currentServer pour déclencher Subscribe
        if (global.state.currentServer?.id === id) {
            setElement('global.state.currentServer', serv);
        }
    };
    xhr("getServContent?servID=".concat(id.toString()),onload,"GET",false)
}

function firstGreater(arr, target) {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i].place >= target) {
            return i;
        }
    }
}

export function orderServDirs(serv){
    serv?.dirs?.cat.sort((a, b) => a.place - b.place);
    serv?.dirs?.channels.sort((a, b) => a.place - b.place);
    serv?.dirs?.dashboards.sort((a, b) => a.place - b.place);
    serv?.dirs?.rooms.sort((a, b) => a.place - b.place);
    serv?.dirs?.drives.sort((a, b) => a.place - b.place);

    for (let cat of serv.dirs.cat){
        cat.channels = []
    }

    let ordered = Object.values(serv.dirs.cat)
    for (let chan of serv.dirs.channels){
        chan.type = "textual"
        if (chan.category){
            lookFor(chan.category,serv.dirs.cat).channels.push(chan)
        }else{
            //insert between categories
            ordered.splice(firstGreater(ordered,chan.place), 0, chan);
        }
    }
    for (let room of serv.dirs.rooms){
        room.type = "vocal"
        room.name = room.name || "Salon vocal"
        if (room.category){
            lookFor(room.category,serv.dirs.cat).channels.push(room)
        }else{
            //insert between categories
            ordered.splice(firstGreater(ordered,room.place), 0, room);
        }
    }
    for (let drive of serv.dirs.drives){
        drive.type = "drive"
        if (drive.category){
            lookFor(drive.category,serv.dirs.cat).channels.push(drive)
        }else{
            //insert between categories
            ordered.splice(firstGreater(ordered,drive.place), 0, drive);
        }
    }
    for (let chan of serv.dirs.dashboards){
        chan.type = "dashboard"
        if (chan.category){
            lookFor(chan.category,serv.dirs.cat).dashboards.push(chan)
        }else{
            //insert between categories
            ordered.splice(firstGreater(ordered,chan.place), 0, chan);
        }
    }
    for (let chan of serv.dirs.notes){
        chan.type = "note"
        if (chan.category){
            lookFor(chan.category,serv.dirs.cat).notes.push(chan)
        }else{
            ordered.splice(firstGreater(ordered,chan.place), 0, chan);
        }
    }
    console.log("ME ",ordered)
    setElement("global.state.currentServer['displayed-dirs']", ordered)
}

function createInvitation(){
    xhr("createInvitation?server="+global.state.currentServer.id,function(){
        global.state.currentInvitationId = this.responseText
        openMenu('server-invitation')
    })
}
window.createInvitation = createInvitation

function createChan(type = 'textual'){
    const channelType = type || 'textual';

    const onChannelCreated = function() {
        try {
            const response = JSON.parse(this.responseText);
            const newChannel = response.channel;
            const channelTypeStr = response.type;

            // Ajouter le type au canal
            if (channelTypeStr === 'textual') {
                newChannel.type = 'textual';
                global.state.currentServer.dirs.channels.push(newChannel);
            } else if (channelTypeStr === 'vocal') {
                newChannel.type = 'vocal';
                newChannel.name = newChannel.name || "Salon vocal";
                global.state.currentServer.dirs.rooms.push(newChannel);
            } else if (channelTypeStr === 'drive') {
                newChannel.type = 'drive';
                global.state.currentServer.dirs.drives.push(newChannel);
            } else if (channelTypeStr === 'note') {
                newChannel.type = 'note';
                global.state.currentServer.dirs.notes.push(newChannel);
            }

            // Re-ordonner et mettre à jour l'affichage
            orderServDirs(global.state.currentServer);

        } catch (e) {
            console.error("Error creating channel:", e);
        }
    };

    xhr("editServer?id="+global.state.currentServer.id+"&property=channel&action=create&channelType="+channelType, onChannelCreated);

    const menu = document.getElementById('create-channel');
    if(menu) menu.style.display = 'none';
}
window.createChan = createChan

function createRole(){
    const onload = function() {
        addElement("global.state.currentServer.roles",{"name":"new role", "id":this.responseText, "permissions":{}})
        global.state.currentRole = global.state.currentServer.roles[this.responseText]
        goTo( 'setting-server-content', 'server-role-settings')
    }

    xhr("editServer?id="+global.state.currentServer.id+"&property=role&action=create",onload)
}
window.createRole = createRole

function setRoleColor(event){
    const color = getComputedStyle(event.currentTarget).getPropertyValue('--color')

    const onload = function() {
        setElement("global.state.currentRole.color",color)
    }
    xhr("editServer?id="+global.state.currentServer.id+"&property=role&field=color&value="+encodeURIComponent(color)+"&targetId="+global.state.currentRole.id, onload)
}
window.setRoleColor = setRoleColor

function attributeRole(roleId){
    const onload = function() {
        if (this.status !== 200) {
            return;
        }

        addElement("global.state.currentServer.members[global.state.profileInfo.id].roles", roleId)
        const elt = document.getElementById("addRole")
        elt.style.display = "none"
    }

    xhr("editServer?id="+global.state.currentServer.id+"&property=role&action=attribute&value="+roleId+"&targetId="+global.state.profileInfo.id, onload)
}
window.attributeRole = attributeRole

// Minimal API Keys actions used by the devs-settings template
function createApiKey(){
    const name = document.getElementById('api-key-name').value.trim()
    const perms = []

    if(!name){
        // simple client-side validation
        alert('Please provide a name for the API key')
        return
    }

    const payload = {name: name, permissions: perms}
    const onload = function(){
        // Expecting server to return the newly created key object: {id, name, key, created, permissions}
        try{
            const newKey = JSON.parse(this.responseText)
            // mark visible so it is shown unmasked once
            newKey.visible = true
            addElement('global.user.apiKeys', newKey)

            // show modal with the raw key value
            const val = newKey.key || ''
            const preview = document.getElementById('new-api-key-value')
            if(preview){ preview.textContent = val; preview.style.cursor = 'pointer'; preview.onclick = copyCreatedKey }
            const modal = document.getElementById('createdKeyModal')
            if(modal) modal.style.display = 'block'

            // clear input
            const inp = document.getElementById('api-key-name')
            if(inp) inp.value = ''
        }catch(e){
            console.log('createApiKey: invalid response', this.responseText)
        }
    }

    xhr('createApiKey', onload, 'POST', true, payload)
}
window.createApiKey = createApiKey

function revokeKey(id){
    if(!confirm(''+_t('Are you sure you want to revoke this API key?'))){
        return
    }
    const onload = function(){
        // remove from global.user.apiKeys
        if(!global.user || !global.user.apiKeys) return
        for(let i = 0; i < global.user.apiKeys.length; i++){
            if(global.user.apiKeys[i].id.toString() === id.toString()){
                deleteElement('global.user.apiKeys', i)
                break
            }
        }
    }
    xhr('revokeApiKey?id='+encodeURIComponent(id), onload)
}
window.revokeKey = revokeKey

function regenerateKey(id){
    if(!confirm(''+_t('Regenerate this API key ? The previous value will stop working.'))){
        return
    }
    const onload = function(){
        try{
            const resp = JSON.parse(this.responseText)
            // resp should contain the new key string and maybe metadata
            const newKeyValue = resp.key || resp

            if(!global.user || !global.user.apiKeys) return
            for(let i=0;i<global.user.apiKeys.length;i++){
                if(global.user.apiKeys[i].id.toString() === id.toString()){
                    // update value and mark visible once
                    global.user.apiKeys[i].key = newKeyValue
                    global.user.apiKeys[i].visible = true
                    // show modal with new value
                    const preview = document.getElementById('new-api-key-value')
                    if(preview) { preview.textContent = newKeyValue; preview.style.cursor = 'pointer'; preview.onclick = copyCreatedKey }
                    const modal = document.getElementById('createdKeyModal')
                    if(modal) modal.style.display = 'block'
                    // update element so subscribers react
                    setElement('global.user.apiKeys['+i+'].key', newKeyValue)
                    setElement('global.user.apiKeys['+i+'].visible', true)
                    break
                }
            }
        }catch(e){
            console.log('regenerateKey: invalid response', this.responseText)
        }
    }
    xhr('regenerateApiKey?id='+encodeURIComponent(id), onload)
}
window.regenerateKey = regenerateKey

// Copy-to-clipboard helper for the created/regenerated key preview
function copyCreatedKey(){
    const preview = document.getElementById('new-api-key-value')
    if(!preview) return
    const text = preview.textContent ? preview.textContent.trim() : ''
    if(!text) return

    navigator.clipboard.writeText(text).then(()=>{ showCopyFeedback(preview) }).catch(()=>{ fallbackCopy(text, preview) })

}
window.copyCreatedKey = copyCreatedKey


function showCopyFeedback(anchor){
    // small transient feedback element
    const f = document.createElement('div')
    f.className = 'muted'
    f.style.marginTop = '8px'
    f.textContent = _t('Copied to clipboard')
    anchor.parentElement.appendChild(f)
    setTimeout(()=>{ try{ f.remove() }catch(e){} }, 1500)
}

function loadUserApiKeys(){
    const onload = function(){
        try{
            const keys = JSON.parse(this.responseText)
            // ensure structure and default visibility
            if(!global.user) global.user = {}
            global.user.apiKeys = keys.map(function(k){
                k.visible = false
                // ensure created is a string
                if(k.created) k.created = k.created.toString()
                return k
            })
            // trigger reactive update
            setElement('global.user.apiKeys', global.user.apiKeys)
        }catch(e){
            console.log('loadUserApiKeys: invalid response', this.responseText)
        }
    }
    xhr('getUserApiKeys', onload)
}
window.loadUserApiKeys = loadUserApiKeys

function addEmail(){
    const input = document.getElementById("new-email-input")
    const emailValue = input.value.trim()

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailValue)) {
        input.setCustomValidity("Invalid email address.");
        input.reportValidity()
        return
    } else {
        input.setCustomValidity("");
    }

    const onload = function() {
        const response = JSON.parse(this.responseText)
        if (response.error) {
            alert(response.error)
        } else {
            // Add the new email to the list
            if (!global.user.additional_emails) {
                global.user.additional_emails = []
            }
            pushElement('global.user.additional_emails', response)
            input.value = ''
        }
    };
    xhr("/addEmail?email=".concat(encodeURIComponent(emailValue)), onload, "POST")
}
window.addEmail = addEmail

function removeEmail(emailId){
    if (!confirm('Are you sure you want to remove this email address?')) {
        return
    }

    const onload = function() {
        const response = JSON.parse(this.responseText)
        if (response.error) {
            alert(response.error)
        } else {
            // Remove the email from the list
            if (global.user.additional_emails) {
                const index = global.user.additional_emails.findIndex(e => e.id === emailId)
                if (index !== -1) {
                    deleteVal('global.user.additional_emails', index)
                }
            }
        }
    };
    xhr("/removeEmail?id=".concat(emailId), onload, "POST")
}
window.removeEmail = removeEmail

// ==================== Community Server Functions ====================

function toggleCommunityServer() {
    const checkbox = document.getElementById('is-community-checkbox');
    const communitySettings = document.getElementById('community-settings');
    const isCommunity = checkbox.checked;

    if (communitySettings) {
        communitySettings.style.display = isCommunity ? '' : 'none';
    }

    // Save to server
    xhr(`editServer?id=${global.state.currentServer.id}&property=is_community&value=${isCommunity}`,
        () => {
            global.state.currentServer.is_community = isCommunity;
            if (isCommunity) {
                // Initialize tags if needed
                if (!global.state.currentServer.tags) {
                    setElement('global.state.currentServer.tags', []);
                }
            }
        },
        "POST", false);
}
window.toggleCommunityServer = toggleCommunityServer;

function addLanguage() {
    const select = document.getElementById('language-add-select');
    const language = select.value;

    if (!language) return;

    const languages = global.state.currentServer?.languages || [];
    const languagesList = typeof languages === 'string' ? JSON.parse(languages) : languages;

    if (languagesList.includes(language)) {
        alert('Cette langue est déjà ajoutée.');
        select.value = '';
        return;
    }

    languagesList.push(language);

    xhr(`editServer?id=${global.state.currentServer.id}&property=languages&value=${encodeURIComponent(JSON.stringify(languagesList))}`,
        () => {
            // Utiliser setElement pour déclencher la réactivité Vesta
            setElement('global.state.currentServer.languages', languagesList);
            select.value = '';
        },
        "POST", false);
}
window.addLanguage = addLanguage;

function removeLanguage(language) {
    const languages = global.state.currentServer?.languages || [];
    const languagesList = typeof languages === 'string' ? JSON.parse(languages) : languages;

    const index = languagesList.indexOf(language);
    if (index > -1) {
        languagesList.splice(index, 1);
    }

    xhr(`editServer?id=${global.state.currentServer.id}&property=languages&value=${encodeURIComponent(JSON.stringify(languagesList))}`,
        () => {
            // Utiliser setElement pour déclencher la réactivité Vesta
            setElement('global.state.currentServer.languages', languagesList);
        },
        "POST", false);
}
window.removeLanguage = removeLanguage;

function addServerTag() {
    const input = document.getElementById('new-tag-input');
    const tag = input.value.trim();

    if (!tag) return;

    if (tag.length > 20) {
        alert('Les tags ne peuvent pas dépasser 20 caractères.');
        return;
    }

    const tags = global.state.currentServer?.tags || [];
    const tagsList = typeof tags === 'string' ? JSON.parse(tags) : tags;

    if (tagsList.includes(tag)) {
        alert('Ce tag existe déjà.');
        return;
    }

    if (tagsList.length >= 10) {
        alert('Vous ne pouvez pas ajouter plus de 10 tags.');
        return;
    }

    tagsList.push(tag);

    xhr(`editServer?id=${global.state.currentServer.id}&property=tags&value=${encodeURIComponent(JSON.stringify(tagsList))}`,
        () => {
            // Utiliser setElement pour déclencher la réactivité Vesta
            setElement('global.state.currentServer.tags', tagsList);
            input.value = '';
        },
        "POST", false);
}
window.addServerTag = addServerTag;

function removeServerTag(index) {
    const tags = global.state.currentServer?.tags || [];
    const tagsList = typeof tags === 'string' ? JSON.parse(tags) : tags;

    tagsList.splice(index, 1);

    xhr(`editServer?id=${global.state.currentServer.id}&property=tags&value=${encodeURIComponent(JSON.stringify(tagsList))}`,
        () => {
            // Utiliser setElement pour déclencher la réactivité Vesta
            setElement('global.state.currentServer.tags', tagsList);
        },
        "POST", false);
}
window.removeServerTag = removeServerTag;

