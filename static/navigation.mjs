import global from "./framework/global.mjs"
import {loadChan, loadConv, loadServer, lookFor} from "./crud.mjs";
import {setElement} from "./framework/vesta.mjs";
import {closeFM, goTo} from "./framework/navigation.mjs";
import {xhr} from "./framework/templating.mjs";

let emptyStr = '' //DO NOT REMOVE

function goToConv(convId){
    let targetElt
    if(global.state.activeConv){
        targetElt = document.getElementById("conv".concat(global.state.activeConv))
    }else{
        targetElt = document.getElementById("friendCat")
    }
    targetElt.classList.remove("selected")

    global.state.activeConv = convId
    loadConv(convId)

    // Load call state for this conversation
    if (loadCallState) {
        loadCallState(convId);
    }

    targetElt = document.getElementById("conv".concat(convId))
    targetElt.classList.add("selected")

    goTo('content','conversation',undefined,false)
}
window.goToConv = goToConv

function goToChannel(id){
    let targetElt
    if(global.state.activeChan){
        targetElt = document.getElementById("channel".concat(global.state.activeChan))
        targetElt?.classList.remove("selected")
    }

    global.state.activeConv = id
    global.state.activeChan = "-conv-"+id
    loadChan(id)

    targetElt = document.getElementById("channel".concat(global.state.activeChan))
    targetElt.classList.add("selected")

    goTo('content','server-channel',undefined,false)
}
window.goToChannel = goToChannel

function goToVocalChannel(id){
    let targetElt
    if(global.state.activeChan){
        targetElt = document.getElementById("channel".concat(global.state.activeChan))
        targetElt?.classList.remove("selected")
    }

    global.state.activeChan = "-voc-"+id

    if (!global.convs) global.convs = {}
    const room = lookFor(id, global.state.currentServer.dirs.rooms)
    global.convs[id] = {id: id, name: room ? room.name : "Salon vocal", type: "vocal"}

    targetElt = document.getElementById("channel".concat(global.state.activeChan))
    targetElt.classList.add("selected")

    goTo('content','server-vocal-content',undefined,false)
}
window.goToVocalChannel = goToVocalChannel

function goToDriveChannel(id){
    let targetElt
    if(global.state.activeChan){
        targetElt = document.getElementById("channel".concat(global.state.activeChan))
        targetElt?.classList.remove("selected")
    }

    global.state.activeChan = "-drive-"+id

    if (!global.convs) global.convs = {}
    const drive = lookFor(id, global.state.currentServer.dirs.drives)
    global.convs[id] = {id: id, name: drive ? drive.name : "Salon de stockage", type: "drive"}

    targetElt = document.getElementById("channel".concat(global.state.activeChan))
    targetElt.classList.add("selected")

    if (!global.driveCurrentFolder) global.driveCurrentFolder = {}
    if (!global.driveCurrentFolder[id]) global.driveCurrentFolder[id] = []

    loadDriveContent(id)

    goTo('content','server-drive-content',undefined,false)
}
window.goToDriveChannel = goToDriveChannel

function getCurrentDriveFolder() {
    const drive_id = global.state.activeConv
    const folderStack = global.driveCurrentFolder[drive_id] || []
    return folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null
}

function loadDriveContent(drive_id, parent_folder = null) {
    loadDriveFiles(drive_id, parent_folder)
    loadDriveFolders(drive_id, parent_folder)
}

function loadDriveFiles(drive_id, parent_folder = null) {
    const onload = function() {
        const files = JSON.parse(this.responseText)
        if (!global.driveFiles) global.driveFiles = {}
        setElement(`global.driveFiles[${drive_id}]`, files)
    }
    const url = parent_folder ? `getDriveFiles?drive_id=${drive_id}&parent_folder=${parent_folder}` : `getDriveFiles?drive_id=${drive_id}`
    xhr(url, onload, "GET", false)
}
window.loadDriveFiles = loadDriveFiles

function loadDriveFolders(drive_id, parent_folder = null) {
    const onload = function() {
        const folders = JSON.parse(this.responseText)
        if (!global.driveFolders) global.driveFolders = {}
        setElement(`global.driveFolders[${drive_id}]`, folders)
    }
    const url = parent_folder ? `getDriveFolders?drive_id=${drive_id}&parent_folder=${parent_folder}` : `getDriveFolders?drive_id=${drive_id}`
    xhr(url, onload, "GET", false)
}
window.loadDriveFolders = loadDriveFolders

function createNewDriveFolder() {
    const foldername = prompt(_t("Enter folder name:"))
    if (!foldername) return

    const drive_id = global.state.activeConv
    const parent_folder = getCurrentDriveFolder()

    const onload = function() {
        console.log("Folder created:", this.responseText)
        // Reload drive content
        loadDriveContent(drive_id, parent_folder)
    }

    const url = parent_folder
        ? `createDriveFolder?drive_id=${drive_id}&foldername=${encodeURIComponent(foldername)}&parent_folder=${parent_folder}`
        : `createDriveFolder?drive_id=${drive_id}&foldername=${encodeURIComponent(foldername)}`

    xhr(url, onload, "POST", false)
}
window.createNewDriveFolder = createNewDriveFolder

function openDriveFolder(folder_id) {
    const drive_id = global.state.activeConv
    const folder = (global.driveFolders[drive_id] || []).find(f => f.id === folder_id)

    if (!folder) return

    // Add to navigation stack
    if (!global.driveCurrentFolder[drive_id]) global.driveCurrentFolder[drive_id] = []
    global.driveCurrentFolder[drive_id].push({id: folder_id, name: folder.foldername})
    setElement(`global.driveCurrentFolder[${drive_id}]`, global.driveCurrentFolder[drive_id])

    // Load content of this folder
    loadDriveContent(drive_id, folder_id)
}
window.openDriveFolder = openDriveFolder

function navigateDriveFolderUp() {
    const drive_id = global.state.activeConv
    if (!global.driveCurrentFolder[drive_id] || global.driveCurrentFolder[drive_id].length === 0) return

    // Remove current folder from stack
    global.driveCurrentFolder[drive_id].pop()
    setElement(`global.driveCurrentFolder[${drive_id}]`, global.driveCurrentFolder[drive_id])

    // Get parent folder (or null for root)
    const parent_folder = global.driveCurrentFolder[drive_id].length > 0
        ? global.driveCurrentFolder[drive_id][global.driveCurrentFolder[drive_id].length - 1].id
        : null

    // Load content of parent folder
    loadDriveContent(drive_id, parent_folder)
}
window.navigateDriveFolderUp = navigateDriveFolderUp

function deleteDriveFolder(folder_id) {
    if (!confirm(_t('Are you sure you want to delete this folder and all its contents?'))) return

    const drive_id = global.state.activeConv
    const parent_folder = getCurrentDriveFolder()

    const onload = function() {
        console.log("Folder deleted:", this.responseText)
        // Reload drive content
        loadDriveContent(drive_id, parent_folder)
    }

    xhr(`deleteDriveFolder?folder_id=${folder_id}`, onload, "POST", false)
}
window.deleteDriveFolder = deleteDriveFolder

function uploadDriveFile() {
    const input = document.getElementById('drive-file-input')
    if (input) {
        input.click()
    }
}
window.uploadDriveFile = uploadDriveFile

function handleDriveFileSelect(event) {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = function(e) {
        const base64 = e.target.result
        const drive_id = global.state.activeConv
        const parent_folder = getCurrentDriveFolder()

        const onload = function() {
            console.log("File uploaded:", this.responseText)
            // Reload drive content
            loadDriveContent(drive_id, parent_folder)
            // Clear input
            event.target.value = ''
        }

        // Build URL with just metadata (not the file content)
        const url = parent_folder
            ? `uploadDriveFile?drive_id=${drive_id}&filename=${encodeURIComponent(file.name)}&parent_folder=${parent_folder}`
            : `uploadDriveFile?drive_id=${drive_id}&filename=${encodeURIComponent(file.name)}`

        // Send file content in the body, not in the URL
        xhr(url, onload, "POST", true, {"file": base64})
    }
    reader.readAsDataURL(file)
}
window.handleDriveFileSelect = handleDriveFileSelect

function downloadDriveFile(file_id, filename) {
    // Create a temporary link to download the file
    const link = document.createElement('a')
    link.href = `/downloadDriveFile?file_id=${file_id}`
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
}
window.downloadDriveFile = downloadDriveFile

function deleteDriveFile(file_id) {
    if (!confirm(_t('Are you sure you want to delete this file?'))) return

    const drive_id = global.state.activeConv
    const parent_folder = getCurrentDriveFolder()

    const onload = function() {
        console.log("File deleted:", this.responseText)
        // Reload drive content
        loadDriveContent(drive_id, parent_folder)
    }

    xhr(`deleteDriveFile?file_id=${file_id}`, onload, "POST", false)
}
window.deleteDriveFile = deleteDriveFile

function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
}
window.formatFileSize = formatFileSize

function formatDate(dateString) {
    if (!dateString) return 'Unknown'
    const date = new Date(dateString)
    const now = new Date()
    const diff = now - date
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`

    return date.toLocaleDateString()
}
window.formatDate = formatDate

function goToFriends(event){
    if(global.state.activeConv){
        let targetElt = document.getElementById("conv".concat(global.state.activeConv))
        targetElt.classList.remove("selected")
    }

    global.state.activeConv = undefined
    event.currentTarget.classList.add("selected")

    goTo('content',"friends",undefined,false)
    goTo('friends-block','main-friend')
}
window.goToFriends = goToFriends

function insertStandardEmoji(event,target){
    if (target === "currentInput"){
        // bug ? this does not trigger the typing event, we could use a real event instead
        let input

        //i know...
        if(event.currentTarget.parentElement.parentElement.parentElement.parentElement.parentElement.id === "std-emoji-board"){
            input = document.querySelector("#description-input")
        }else{
            input = document.querySelector("textarea.selected")
        }

        if(!global.state.previousCursor){
            global.state.previousCursor = {start:0, end:0}
        }
        input.value = input.value.slice(0,global.state.previousCursor.start).concat(event.currentTarget.innerHTML,input.value.slice(global.state.previousCursor.end))
        global.state.previousCursor = {start: global.state.previousCursor.start+event.currentTarget.innerHTML.length, end:global.state.previousCursor.start+event.currentTarget.innerHTML.length}
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }else if(target === "status"){
        setElement("global.user.status.emoji",event.currentTarget.innerHTML)
        closeFM('emoji-board')
    } else {
        target.innerHTML = event.currentTarget.innerHTML
    }
}
window.insertStandardEmoji = insertStandardEmoji

function updatePreview(formID, event, defaultValue, evaluation=undefined){
    if(global.state["currentForm"]?.id !== formID){
        global.state["currentForm"] = undefined
    }

    const save_menu = document.getElementById(formID)
    if(global.state["currentForm"]){
        if(!global.state["currentForm"][event.currentTarget.id] ){
            global.state["currentForm"][event.currentTarget.id] = {value: "", modified :false, defaultValue: eval(defaultValue)}
        }
        if(event.currentTarget.value !== global.state["currentForm"][event.currentTarget.id].value){
            if (event.currentTarget.value === eval(defaultValue)){
                global.state["currentForm"][event.currentTarget.id].value = event.currentTarget.value
                global.state["currentForm"].modified -= 1
                global.state["currentForm"][event.currentTarget.id].modified = false
                if(global.state["currentForm"].modified===0){
                    save_menu.style.display="none"
                }
            }else if(!global.state["currentForm"][event.currentTarget.id].modified){
                global.state["currentForm"][event.currentTarget.id]={value: event.currentTarget.value, modified :true,defaultValue: eval(defaultValue)}
                if(global.state["currentForm"].modified===0){
                    save_menu.style.display="flex"
                }
                global.state["currentForm"].modified += 1
            }else{
                global.state["currentForm"][event.currentTarget.id].value = event.currentTarget.value
            }

            if(evaluation){
                const pre = evaluation.title && event.currentTarget.value!=="" ? evaluation.title : ""
                updateDisplayedForm(event.currentTarget.id, pre.concat(eval(evaluation.value)))
            }else{
                updateDisplayedForm(event.currentTarget.id, event.currentTarget.value)
            }
        }
    }else if (event.currentTarget.value !== eval(defaultValue)){
        console.log(event.currentTarget.value)
        global.state["currentForm"] = { [event.currentTarget.id] : {value: event.currentTarget.value, modified :true, defaultValue: eval(defaultValue)}, modified: 1, id: formID}
        save_menu.style.display="flex"
        if(evaluation){
            const pre = evaluation.title && event.currentTarget.value!=="" ? evaluation.title : ""
            updateDisplayedForm(event.currentTarget.id, pre.concat(eval(evaluation.value)))
        }else{
            updateDisplayedForm(event.currentTarget.id, event.currentTarget.value)
        }
    }
}
window.updatePreview = updatePreview

function makePersonalServer(){
    if(confirm("Are you sure you want to convert this server into your personal server ? \n This action cannot be undone.")){
        const request = xhr("/createPersonalServer?server="+global.state.currentServer.id , undefined, "POST", false);
        if (request.status === 200) {
        } else {
            alert("Failed to create personal server: " + request.statusText);
        }
    }
}
window.makePersonalServer = makePersonalServer

export function updateDisplayedForm(id,value){
    const subs = document.querySelectorAll(".form-".concat(id))
    for (let sub of subs){
        sub.innerHTML = value
    }
}

function reset(){
    for (let key in global.state["currentForm"]){
        if (key !== "modified" && global.state["currentForm"][key].modified){
            const element = document.getElementById(key)
            element.value = global.state["currentForm"][key].defaultValue
        }
        updateDisplayedForm(key,global.state["currentForm"][key].defaultValue)
    }
    delete global.state["currentForm"]
    const save_menu = document.querySelector(".save-settings")
    save_menu.style.display="none"
}
window.reset = reset


function toggleDropdown(event) {
    if (event.currentTarget.parentElement.classList.contains("show")){
        event.currentTarget.parentElement.classList.remove("show");
        global.state.activeDropdown = undefined
    }else{
        if(global.state.activeDropdown){
            global.state.activeDropdown.classList.remove("show");
        }
        event.currentTarget.parentElement.classList.add("show");
        global.state.activeDropdown = event.currentTarget.parentElement
    }

}
window.toggleDropdown = toggleDropdown

function changeDropdown(event) {
    const dropdown = event.currentTarget.parentElement.parentElement;
    dropdown.querySelector(".dropdown-text").innerText = event.currentTarget.innerText;
    dropdown.querySelector(".selected").classList.remove("selected")
    event.currentTarget.classList.add("selected")
    dropdown.classList.remove("show");
}
window.changeDropdown = changeDropdown

function goToServer(event,id){
    global.state.currentServer = lookFor(id,global.servers)
    global.state.activeConv = undefined
    global.state.isServer = true
    loadServer(id)
    goTo('sec-selector','serverSelector',{'category':'currentTab' ,'event': event},true,()=> goToChannel(global.state.currentServer.dirs.channels[0].id))

}
window.goToServer = goToServer

function toggleProfileInfo(id,event){
    if (id !== global.state.profileInfo?.id) {
        closeFM()
    }
    setElement("global.state.profileInfo", global.users[id])
    toggleFM('profileInfo')

    const rect = event.currentTarget.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = rect.top;
    let left = rect.left + 60;

    const modalRect = global.state.activeFM.getBoundingClientRect();

    if (left + modalRect.width > viewportWidth) {
        if (rect.left - modalRect.width - 10 < 0) {
            left = viewportWidth - modalRect.width - 10;
            left = Math.max(left, 10);
        }else {
            left = rect.left - modalRect.width - 10;
        }

    }

    if (top + modalRect.height > viewportHeight) {
        top = rect.top - modalRect.height;
        if (top < 0) {
            top = Math.max(viewportHeight - modalRect.height - 10, 10); // clamp to bottom edge
        }
    }

    global.state.activeFM.style.top = top + 'px';
    global.state.activeFM.style.left = left + 'px';

}
window.toggleProfileInfo = toggleProfileInfo

function showAddRole(event){
    const elt = document.getElementById("addRole")
    elt.style.display = "flex"
    elt.style.bottom = window.innerHeight - event.currentTarget.getBoundingClientRect().top + 10 + "px"
    elt.style.left = event.currentTarget.getBoundingClientRect().left + "px"
}
window.showAddRole = showAddRole
