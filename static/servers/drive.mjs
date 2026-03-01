import global from "../framework/global.mjs";
import {goTo} from "../framework/navigation.mjs";
import {setElement} from "../framework/vesta.mjs";
import {xhr} from "../framework/templating.mjs";
import {lookFor} from "../crud.mjs";

function goToDriveChannel(id){
    let targetElt
    if(global.state.activeChan){
        targetElt = document.getElementById("channel".concat(global.state.activeChan.slug))
        targetElt?.classList.remove("selected")
    }

    global.state.activeChan = {id:id, slug:"-drive-"+id, type:"drive"}

    if (!global.convs) global.convs = {}
    const drive = lookFor(id, global.state.currentServer.dirs.drives)
    global.convs[id] = {id: id, name: drive ? drive.name : "Salon de stockage", type: "drive"}

    targetElt = document.getElementById("channel".concat(global.state.activeChan.slug))
    targetElt.classList.add("selected")

    if (!global.driveCurrentFolder) global.driveCurrentFolder = {}
    if (!global.driveCurrentFolder[id]) global.driveCurrentFolder[id] = []

    loadDriveContent(id)

    goTo('content','server-drive-content',undefined,false)
}
window.goToDriveChannel = goToDriveChannel

function getCurrentDriveFolder() {
    const drive_id = global.state.activeChan.id
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

    const drive_id = global.state.activeChan.id
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
    const drive_id = global.state.activeChan.id
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
    const drive_id = global.state.activeChan.id
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

    const drive_id = global.state.activeChan.id
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
        const drive_id = global.state.activeChan.id
        const parent_folder = getCurrentDriveFolder()

        const onload = function() {
            if (handleQuotaError(this)) {
                event.target.value = ''
                return
            }
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