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

    if (global.state.isMobile) {
        mobileDisplayContent()
    }

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
        setTimeout(() => loadDrivePreviews(), 0)
    }
    const url = parent_folder ? `get_drive_files?drive_id=${drive_id}&parent_folder=${parent_folder}` : `get_drive_files?drive_id=${drive_id}`
    xhr(url, onload, "GET", false)
}
window.loadDriveFiles = loadDriveFiles

function loadDriveFolders(drive_id, parent_folder = null) {
    const onload = function() {
        const folders = JSON.parse(this.responseText)
        if (!global.driveFolders) global.driveFolders = {}
        setElement(`global.driveFolders[${drive_id}]`, folders)
    }
    const url = parent_folder ? `get_drive_folders?drive_id=${drive_id}&parent_folder=${parent_folder}` : `get_drive_folders?drive_id=${drive_id}`
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
        ? `create_drive_folder?drive_id=${drive_id}&foldername=${encodeURIComponent(foldername)}&parent_folder=${parent_folder}`
        : `create_drive_folder?drive_id=${drive_id}&foldername=${encodeURIComponent(foldername)}`

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

    xhr(`delete_drive_folder?folder_id=${folder_id}`, onload, "POST", false)
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
            ? `upload_drive_file?drive_id=${drive_id}&filename=${encodeURIComponent(file.name)}&parent_folder=${parent_folder}`
            : `upload_drive_file?drive_id=${drive_id}&filename=${encodeURIComponent(file.name)}`

        // Send file content in the body, not in the URL
        xhr(url, onload, "POST", true, {"file": base64})
    }
    reader.readAsDataURL(file)
}
window.handleDriveFileSelect = handleDriveFileSelect

function downloadDriveFile(file_id, filename) {
    // Create a temporary link to download the file
    const link = document.createElement('a')
    link.href = `/download_drive_file?file_id=${file_id}`
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
}
window.downloadDriveFile = downloadDriveFile

function deleteDriveFile(file_id) {
    if (!confirm(_t('Are you sure you want to delete this file?'))) return

    const drive_id = global.state.activeChan.id
    const parent_folder = getCurrentDriveFolder()

    const onload = function() {
        console.log("File deleted:", this.responseText)
        // Reload drive content
        loadDriveContent(drive_id, parent_folder)
    }

    xhr(`delete_drive_file?file_id=${file_id}`, onload, "POST", false)
}
window.deleteDriveFile = deleteDriveFile


if (!global.driveSelection) global.driveSelection = []

function toggleDriveSelection(type, id, event) {
    event.stopPropagation()

    const entry = { type, id }
    const idx = global.driveSelection.findIndex(s => s.type === type && s.id === id)

    if (event.ctrlKey || event.metaKey) {
        // Toggle individual item
        if (idx !== -1) {
            global.driveSelection.splice(idx, 1)
        } else {
            global.driveSelection.push(entry)
        }
    } else {
        // Replace selection
        if (idx !== -1 && global.driveSelection.length === 1) {
            global.driveSelection = []
        } else {
            global.driveSelection = [entry]
        }
    }
    refreshDriveSelectionUI()
}
window.toggleDriveSelection = toggleDriveSelection

function clearDriveSelection() {
    global.driveSelection = []
    refreshDriveSelectionUI()
}
window.clearDriveSelection = clearDriveSelection

function refreshDriveSelectionUI() {
    document.querySelectorAll('.drive-file-item, .drive-folder-item').forEach(el => {
        el.classList.remove('drive-selected')
    })
    for (const s of global.driveSelection) {
        const selector = s.type === 'file'
            ? `.drive-file-item[data-file-id="${s.id}"]`
            : `.drive-folder-item[data-folder-id="${s.id}"]`
        const el = document.querySelector(selector)
        if (el) el.classList.add('drive-selected')
    }
}

function isDriveSelected(type, id) {
    return global.driveSelection.some(s => s.type === type && s.id === id)
}

function onDriveItemDrag(event, type, id) {
    // If the dragged item is not in the selection, replace selection with it
    if (!isDriveSelected(type, id)) {
        global.driveSelection = [{ type, id }]
        refreshDriveSelectionUI()
    }

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-drive-move', JSON.stringify(global.driveSelection))

    // Set drag image hint for multi-select
    if (global.driveSelection.length > 1) {
        const badge = document.createElement('div')
        badge.className = 'drive-drag-badge'
        badge.textContent = global.driveSelection.length + ' items'
        document.body.appendChild(badge)
        event.dataTransfer.setDragImage(badge, 0, 0)
        setTimeout(() => badge.remove(), 0)
    }
}
window.onDriveItemDrag = onDriveItemDrag

function onDriveFolderDragOver(event) {
    const data = event.dataTransfer.types.includes('application/x-drive-move')
    if (!data) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    const folderEl = event.currentTarget
    folderEl.classList.add('drive-drop-target')
}
window.onDriveFolderDragOver = onDriveFolderDragOver

function onDriveFolderDragLeave(event) {
    const folderEl = event.currentTarget
    // Only remove if actually leaving (not entering a child)
    if (!folderEl.contains(event.relatedTarget)) {
        folderEl.classList.remove('drive-drop-target')
    }
}
window.onDriveFolderDragLeave = onDriveFolderDragLeave

function isDescendantFolder(folderId, targetFolderId) {
    // Check locally if targetFolderId is a descendant of folderId
    // by traversing the current driveCurrentFolder stack and known folders
    const drive_id = global.state.activeChan.id

    // The backend also validates, this is just for UX
    if (parseInt(folderId) === parseInt(targetFolderId)) return true

    // Check the folder navigation stack — if target is in the current path
    const stack = global.driveCurrentFolder[drive_id] || []
    for (const entry of stack) {
        if (parseInt(entry.id) === parseInt(folderId)) {
            // folderId is an ancestor of the current view,
            // and targetFolderId is a child displayed here = it's a descendant
            return true
        }
    }

    return false
}

function onDriveFolderDrop(event, targetFolderId) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.remove('drive-drop-target')

    const raw = event.dataTransfer.getData('application/x-drive-move')
    if (!raw) return

    const items = JSON.parse(raw)
    if (!items || items.length === 0) return

    // Filter out the target folder itself and its ancestors (prevent recursion)
    const validItems = items.filter(item => {
        if (item.type === 'folder' && isDescendantFolder(item.id, targetFolderId)) return false
        return true
    })

    if (validItems.length === 0) return

    moveDriveItems(validItems, targetFolderId)
}
window.onDriveFolderDrop = onDriveFolderDrop

function onDriveRootDragOver(event) {
    const data = event.dataTransfer.types.includes('application/x-drive-move')
    if (!data) return

    // Don't highlight if we're already at root and not inside a subfolder drop target
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    event.currentTarget.classList.add('drive-drop-target')
}
window.onDriveRootDragOver = onDriveRootDragOver

function onDriveRootDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
        event.currentTarget.classList.remove('drive-drop-target')
    }
}
window.onDriveRootDragLeave = onDriveRootDragLeave

function onDriveRootDrop(event) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.remove('drive-drop-target')

    const raw = event.dataTransfer.getData('application/x-drive-move')
    if (!raw) return

    const items = JSON.parse(raw)
    if (!items || items.length === 0) return

    // Moving to root (null parent_folder)
    moveDriveItems(items, null)
}
window.onDriveRootDrop = onDriveRootDrop

function onDriveBreadcrumbDrop(event, targetFolderId) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.classList.remove('drive-drop-target')

    const raw = event.dataTransfer.getData('application/x-drive-move')
    if (!raw) return

    const items = JSON.parse(raw)
    if (!items || items.length === 0) return

    const validItems = items.filter(item => {
        if (item.type === 'folder' && targetFolderId && isDescendantFolder(item.id, targetFolderId)) return false
        return true
    })

    if (validItems.length === 0) return

    moveDriveItems(validItems, targetFolderId)
}
window.onDriveBreadcrumbDrop = onDriveBreadcrumbDrop

function moveDriveItems(items, targetFolder) {
    const drive_id = global.state.activeChan.id
    const parent_folder = getCurrentDriveFolder()

    const onload = function() {
        const resp = JSON.parse(this.responseText)
        if (resp.errors && resp.errors.length > 0) {
            console.warn("Move errors:", resp.errors)
        }
        // Reload current view
        loadDriveContent(drive_id, parent_folder)
        global.driveSelection = []
    }

    xhr(`move_drive_items?items=${encodeURIComponent(JSON.stringify(items))}&target_folder=${targetFolder || ''}`, onload, "POST", false)
}
window.moveDriveItems = moveDriveItems


const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']
const TEXT_EXTENSIONS = [
    'txt', 'md', 'csv', 'json', 'js', 'mjs', 'ts', 'py', 'html', 'htm',
    'css', 'xml', 'log', 'yml', 'yaml', 'ini', 'toml', 'sh', 'bat',
    'c', 'cpp', 'h', 'java', 'rs', 'go', 'rb', 'php', 'sql', 'r',
    'swift', 'kt', 'lua', 'pl', 'conf', 'cfg', 'env', 'gitignore',
    'dockerfile', 'makefile'
]
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov']
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus']

function getFileExtension(filename) {
    if (!filename) return ''
    const parts = filename.split('.')
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function getFilePreviewType(filename) {
    const ext = getFileExtension(filename)
    if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
    if (TEXT_EXTENSIONS.includes(ext)) return 'text'
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
    if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
    if (ext === 'pdf') return 'pdf'
    return 'generic'
}
window.getFilePreviewType = getFilePreviewType

function getDriveFilePreviewHtml(element) {
    const type = getFilePreviewType(element.filename)
    const ext = getFileExtension(element.filename).toUpperCase()
    const safeFilename = (element.filename || '').replace(/"/g, '&quot;').replace(/</g, '&lt;')

    switch (type) {
        case 'image':
            return `<div class="drive-file-preview drive-preview-image">
                <img src="/static/attachments/${element.filepath}" alt="${safeFilename}" loading="lazy"/>
            </div>`

        case 'text':
            return `<div class="drive-file-preview drive-preview-text" data-preview-type="text" data-file-id="${element.id}">
                <pre class="drive-text-content"><span class="drive-preview-loading">...</span></pre>
            </div>`

        case 'video':
            return `<div class="drive-file-preview drive-preview-video">
                <video src="/static/attachments/${element.filepath}" preload="metadata" muted></video>
            </div>`

        case 'audio':
            return `<div class="drive-file-preview drive-preview-audio">
                <img class="icon" src="/static/icons/material/headset.svg" alt="audio"/>
                <span class="drive-preview-label">${ext}</span>
            </div>`

        case 'pdf':
            return `<div class="drive-file-preview drive-preview-pdf">
                <embed src="/static/attachments/${element.filepath}#toolbar=0&navpanes=0&scrollbar=0" type="application/pdf" style="pointer-events:none;"/>
            </div>`

        default:
            return `<div class="drive-file-preview drive-preview-generic">
                <img class="icon" src="/static/icons/material/file.svg" alt="file"/>
                <span class="drive-preview-label">${ext || '?'}</span>
            </div>`
    }
}
window.getDriveFilePreviewHtml = getDriveFilePreviewHtml

function loadDrivePreviews() {
    const textPreviews = document.querySelectorAll('.drive-file-preview[data-preview-type="text"]:not([data-loaded])')
    for (const el of textPreviews) {
        const fileId = el.dataset.fileId
        if (!fileId) continue

        el.setAttribute('data-loaded', 'true')

        fetch(`/preview_drive_file?file_id=${fileId}`)
            .then(resp => {
                if (!resp.ok) throw new Error('Preview failed')
                return resp.text()
            })
            .then(text => {
                const pre = el.querySelector('pre')
                if (pre) {
                    pre.textContent = text
                }
            })
            .catch(() => {
                const pre = el.querySelector('pre')
                if (pre) pre.textContent = ''
            })
    }
}
window.loadDrivePreviews = loadDrivePreviews

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