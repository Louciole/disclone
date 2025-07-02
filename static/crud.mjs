import {addServer, getRelevantUser} from "./main.mjs"
import {addElement, deleteElement, setElement, difference, pushElement, deleteVal} from "./framework/sakura.mjs"
import {initWebSockets} from "./framework/websockets.mjs"
import global from "./framework/global.mjs"
import {xhr} from "./framework/templating.mjs";
import {closeFM, goTo} from "./framework/navigation.mjs";

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
        global.servers[serv.id] = serv
        addServer(serv.name, serv.id)
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
        for (let i in response) {
            addServer(response[i].name, response[i].id)
        }
    };
    xhr("getUserServers",onload)
}

export function loadConvs(){
    const onload = function() {
        const keys = JSON.parse(this.responseText)
        for(let key of keys){
            global.privateConvs[key.id] = key // HACK
            global.convs[key.id] = global.privateConvs[key.id]
            addElement("global.privateConvs", key);
        }
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

    for(let message of global.convs[key].messages){
        message.body = message.body.replace(/</g, "&lt;")

        // si ça fait moins de 3 minutes de différence, que c'est la même personne et que la date n'a pas changée et que le message n'est pas une réponse
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

    for(let message of global.convs[key].messages){
        message.body = message.body.replace(/</g, "&lt;")

        // si ça fait moins de 3 minutes de différence, que c'est la même personne et que la date n'a pas changée et que le message n'est pas une réponse
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
        setElement('global.user', JSON.parse(request.responseText))
        global.users[global.user.id] = global.user
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

function newMessageGroup(conv, message){
    global.convs[conv].messageGroups.push({"date": getTimeStr(message.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}), "messages":[message], "id":global.convs[conv].messageGroups.length})
}

export function handleMessageGroup(message){
    console.log("handleMessageGroup",message)
    message.attachments = message.attachments ? JSON.parse(message.attachments) : []
    if (global.convs[message.place].messages.length !== 0){
        // si ça fait moins de 3 minutes de différence, que c'est la même personne que la date n'a pas changée ET que le message n'est pas une réponse
        if(message.sender === global.convs[message.place].messages[global.convs[message.place].messages.length-1].sender && (new Date(message.timestamp)-new Date(global.convs[message.place].messages[global.convs[message.place].messages.length-1].timestamp))/60000<3 && getTimeStr(message.timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) === getTimeStr(global.convs[message.place].messages[global.convs[message.place].messages.length-1].timestamp, { locale: "fr-FR",hour: undefined, minute: undefined}) && !message.reply){
            global.convs[message.place].messageGroups[global.convs[message.place].messageGroups.length-1].messages.push(message)
        }else{
            newMessageGroup(message.place, message)
        }
    }else{
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
    const conv = {"name":"New Conversation","members":members,"messageGroups":[],"messages":[],"private":false}

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
        uploadResizeFile(file);
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

let image;
let img = new Image()
let ctx
let win = {size:0,'x':0,'y':0}
let ratio = 1
let scale = 1;
let pos = {'x':0,'y':0}
let cursor = {'x':0,'y':0}
function uploadResizeFile(file) {
    openMenu("resize-image",false)
    const reader = new FileReader();

    reader.onload = function(e) {
        const canvas = document.getElementById("imageCanvas")
        image=canvas
        ctx = canvas.getContext('2d');
        img.onload = function() {
            canvas.width = img.width;
            canvas.height = img.height;
            ratio = img.width/canvas.getBoundingClientRect().width
            const wrapper = canvas.parentElement.parentElement
            wrapper.style.setProperty('--aspect-ratio',(img.width/img.height).toString())
            wrapper.style.setProperty('--width',(img.width / ratio).toString()+ "px")
            wrapper.style.setProperty('--height',(img.height / ratio).toString()+ "px")
            if(img.width >= img.height){
                wrapper.classList.remove("height")
                wrapper.classList.add("width")
                win.x = (img.width - img.height)/2
                win.y = 0
            }else {
                wrapper.classList.remove("width")
                wrapper.classList.add("height")
                win.x = 0
                win.y = (img.height - img.width)/2
            }

            ctx.drawImage(img, 0, 0);
            win.size = Math.min(img.width,img.height)
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}
window.uploadResizeImage = uploadResizeFile

function displayMessageImage(file){
    const reader = new FileReader();
    const canvas = document.getElementsByClassName("imageCanvas")[0]
    const box = document.getElementById("imageBox")
    box.style.display = "block"
    image = canvas
    ctx = canvas.getContext('2d');
    reader.onload = function(e) {
        global.state.currentMessageImages = [reader.result]
        img.onload = function() {
            const size = Math.max(img.width,img.height)
            canvas.width = size;
            canvas.height = size;
            const x = (size - img.width)/2
            const y = (size - img.height)/2
            console.log(size,img.width,img.height,"pos",x,y,size-x,size - y)
            ctx.drawImage(img, x, y, img.width, img.height);
        }
        img.src = event.target.result;
    }
    reader.readAsDataURL(file);
}

function removeImageMessage(event){
    const box = document.getElementById("imageBox")
    box.style.display = "none"
    // event.currentTarget.querySelector(".imageCanvas")[0].
    global.state.currentMessageImages = []
}
window.removeImageMessage = removeImageMessage

function startDrag(event){
    global.state.disableClose = true
    cursor = {'x':event.clientX,'y':event.clientY}
    image = event.currentTarget
    image.classList.add('dragging')
    document.onmouseup = closeDragElement;
    document.onmousemove = dragImage;
    global.temp = image
}
window.startDrag = startDrag

function closeDragElement(event) {
    document.onmouseup = null;
    document.onmousemove = null;
    image.classList.remove('dragging')
    setTimeout(()=>{global.state.disableClose = false}, 50);
    //todo cancel close menu event
}

function dragImage(event){
    const canvas = document.getElementById("imageCanvas")
    ratio = img.width/canvas.getBoundingClientRect().width

    const diffX = (event.clientX - cursor.x)/(30*scale)
    const diffY = (event.clientY - cursor.y)/(30*scale)

    const borderX = (img.width/ratio - (win.size/(scale*ratio)))/2
    const borderY = (img.height/ratio - (win.size/(scale*ratio)))/2

    pos.x = Math.max(-borderX,Math.min(pos.x+diffX,borderX))
    pos.y = Math.max(-borderY,Math.min(pos.y+diffY,borderY))

    image.parentElement.style.margin = `${pos.y}px 0 0 ${pos.x}px`
    console.log(image.parentElement.style.margin,win,scale,ratio)
}
window.dragImage = dragImage


function zoom(new_scale){
    scale = new_scale
    const canvas = document.getElementById("imageCanvas")
    ratio = img.width/canvas.getBoundingClientRect().width
    image.parentElement.style.setProperty('--scale',scale.toString())
}
window.zoom = zoom

function uploadProfileImage(field="pfp"){

    let cropStartX
    let cropStartY
    if (img.width > img.height){
        cropStartX = img.width - img.height - (pos.x*2*ratio)
        cropStartY = pos.y*2*ratio
    }else if(img.width < img.height){
        cropStartX = pos.x*2*ratio
        cropStartY = Math.min(0,img.height - img.width - (pos.y*2*ratio))
    }else{
        cropStartX = pos.x*2*ratio/scale
        cropStartY = pos.y*2*ratio/scale
    }
    console.log("cropping",cropStartX,cropStartY,win.size/scale,pos)
    const imageData = ctx.getImageData(cropStartX, cropStartY, win.size/scale, win.size/scale)

    const onImgLoaded = function(result) {
        const onload = function () {
            console.log(this.responseText)
        }
        console.log(result, {"value":result})

        xhr("change?element=".concat(field), onload,"POST",true,{"value":result})
    }
    imageDataToB64(imageData,onImgLoaded)
}
window.uploadProfileImage = uploadProfileImage

function imageDataToB64(imageData, onloaded) {
    const w = imageData.width
    const h = imageData.height
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    ctx.putImageData(imageData, 0, 0)

    canvas.toBlob(function (blob){
        const reader = new FileReader()
        reader.onload = function(){
            onloaded(event.target.result)
        }
        reader.onerror = () => {
            console.log("error")
        }
        // debugger
        reader.readAsDataURL(blob)
    }, "image/jpeg", 0.5)
}


export function loadServer(id){
    const onload = function() { // request successful
        console.log(this.responseText)
        const resp = JSON.parse(this.responseText)
        const serv = lookFor(id,global.servers)
        serv["dirs"] = {"channels" : resp.channels, "cat" : resp.cat}
        serv["members"] = resp.members
        serv["roles"] = resp.roles
        loadUsers(resp.members)
        orderServDirs(serv)
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

function orderServDirs(serv){
    serv?.dirs?.cat.sort((a, b) => a.place - b.place);
    serv?.dirs?.channels.sort((a, b) => a.place - b.place);

    for (let cat of serv.dirs.cat){
        cat.channels = []
    }

    let ordered = Object.values(serv.dirs.cat)
    for (let chan of serv.dirs.channels){
        if (chan.category){
            lookFor(chan.category,serv.dirs.cat).channels.push(chan)
        }else{
            //insert between categories
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

function createChan(){
    xhr("editServer?id="+global.state.currentServer.id+"&property=channel&action=create",undefined)
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
