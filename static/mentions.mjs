import global from "/static/framework/global.mjs"

// ─── Mention Autocomplete System ─────────────────────────────────────────────
// Detects @/# triggers in the textarea, shows a popup with matching
// users / roles / channels, and inserts the raw-ID token on selection.

let autocompletePopup = null
let currentTrigger = null   // '@' or '#'
let triggerStart = -1       // caret position where the trigger char was typed
let selectedIndex = 0
let candidates = []

// Expose a way for sendMessage to know the popup is active
window.isMentionAutocompleteOpen = function() {
    return autocompletePopup && autocompletePopup.style.display !== "none" && candidates.length > 0
}

// ─── Candidate building ──────────────────────────────────────────────────────

function buildUserCandidates(query) {
    const results = []
    const q = query.toLowerCase()

    // Always offer @everyone and @here first (server-only)
    if (global.state?.isServer) {
        if ("everyone".startsWith(q)) results.push({ type: "everyone", display: "everyone", sub: "Notify all members" })
        if ("here".startsWith(q)) results.push({ type: "here", display: "here", sub: "Notify online members" })
    }

    // Roles (server-only)
    if (global.state?.isServer && global.state?.currentServer?.roles) {
        for (const rid in global.state.currentServer.roles) {
            const role = global.state.currentServer.roles[rid]
            if (role.name.toLowerCase().includes(q)) {
                results.push({ type: "role", id: rid, display: role.name, color: role.color, sub: "Role" })
            }
        }
    }

    // Users – in a server, use the member list; in a DM, use conv members
    const userIds = new Set()
    if (global.state?.isServer && global.state?.currentServer?.members) {
        for (const uid in global.state.currentServer.members) userIds.add(parseInt(uid))
    } else if (global.state?.activeConv && global.convs?.[global.state.activeConv]?.members) {
        for (const uid of global.convs[global.state.activeConv].members) userIds.add(parseInt(uid))
    }

    for (const uid of userIds) {
        const user = global.users[uid]
        if (!user) continue
        const match = (user.display || "").toLowerCase().includes(q) || (user.username || "").toLowerCase().includes(q)
        if (match) {
            results.push({ type: "user", id: uid, display: user.display, username: user.username, pfp: user.pfp })
        }
    }

    return results.slice(0, 15)
}

function buildChannelCandidates(query) {
    if (!global.state?.isServer || !global.state?.currentServer?.dirs?.channels) return []
    const q = query.toLowerCase()
    return global.state.currentServer.dirs.channels
        .filter(ch => ch.name.toLowerCase().includes(q))
        .slice(0, 15)
        .map(ch => ({ type: "channel", id: ch.id, display: ch.name }))
}

// ─── Popup rendering ─────────────────────────────────────────────────────────

function createPopupIfNeeded(textarea) {
    if (autocompletePopup) return
    autocompletePopup = document.createElement("div")
    autocompletePopup.className = "mention-autocomplete"
    // Insert in the same flex column as the chat-wrapper, just before it
    const wrapper = textarea.closest(".chat-wrapper")
    if (wrapper && wrapper.parentElement) {
        wrapper.parentElement.insertBefore(autocompletePopup, wrapper)
    } else {
        textarea.parentElement.appendChild(autocompletePopup)
    }
}

function renderPopup() {
    if (!autocompletePopup) return
    if (candidates.length === 0) {
        closePopup()
        return
    }

    let html = ""
    candidates.forEach((c, i) => {
        const selected = i === selectedIndex ? "selected" : ""
        switch (c.type) {
            case "user":
                html += `<div class="mention-ac-item ${selected}" data-index="${i}" onmousedown="mentionSelect(${i})">
                    <div class="mention-ac-avatar" style="${c.pfp ? "background-image:url(/static/attachments/" + c.pfp + ")" : ""}"></div>
                    <div class="mention-ac-info">
                        <span class="mention-ac-name">${c.display}</span>
                        <span class="mention-ac-sub">${c.username || ""}</span>
                    </div>
                </div>`
                break
            case "role":
                html += `<div class="mention-ac-item ${selected}" data-index="${i}" onmousedown="mentionSelect(${i})">
                    <div class="mention-ac-dot" style="background:${c.color || "#A8A8A8"}"></div>
                    <div class="mention-ac-info">
                        <span class="mention-ac-name">${c.display}</span>
                        <span class="mention-ac-sub">Role</span>
                    </div>
                </div>`
                break
            case "channel":
                html += `<div class="mention-ac-item ${selected}" data-index="${i}" onmousedown="mentionSelect(${i})">
                    <img class="mention-ac-icon" src="/static/icons/material/hashtag.svg"/>
                    <div class="mention-ac-info">
                        <span class="mention-ac-name">${c.display}</span>
                    </div>
                </div>`
                break
            case "everyone":
            case "here":
                html += `<div class="mention-ac-item ${selected}" data-index="${i}" onmousedown="mentionSelect(${i})">
                    <div class="mention-ac-dot" style="background:#faa61a"></div>
                    <div class="mention-ac-info">
                        <span class="mention-ac-name">@${c.display}</span>
                        <span class="mention-ac-sub">${c.sub}</span>
                    </div>
                </div>`
                break
        }
    })

    autocompletePopup.innerHTML = html
    autocompletePopup.style.display = "flex"
}

function closePopup() {
    if (autocompletePopup) {
        autocompletePopup.style.display = "none"
        autocompletePopup.innerHTML = ""
        autocompletePopup.remove()
        autocompletePopup = null
    }
    currentTrigger = null
    triggerStart = -1
    candidates = []
    selectedIndex = 0
}

// ─── Selection ───────────────────────────────────────────────────────────────

function selectCandidate(textarea, index) {
    const c = candidates[index]
    if (!c) return

    let insertText = ""
    switch (c.type) {
        case "user":     insertText = `<@${c.id}>`; break
        case "role":     insertText = `<@&${c.id}>`; break
        case "channel":  insertText = `<#${c.id}>`; break
        case "everyone": insertText = `<@everyone>`; break
        case "here":     insertText = `<@here>`; break
    }

    // Replace from triggerStart (the '@' or '#') to the current caret
    const before = textarea.value.substring(0, triggerStart)
    const after = textarea.value.substring(textarea.selectionEnd)
    textarea.value = before + insertText + " " + after

    // Place caret right after inserted token
    const newPos = before.length + insertText.length + 1
    textarea.selectionStart = textarea.selectionEnd = newPos

    closePopup()
}

window.mentionSelect = function(index) {
    const textarea = document.querySelector(".chat-input textarea")
    if (textarea) selectCandidate(textarea, index)
}

// ─── Click handler for user mentions in rendered messages ────────────────────
window.mentionUserClick = function(uid, event) {
    if (typeof toggleProfileInfo === 'function' && event) {
        toggleProfileInfo(uid, event)
    }
}

// ─── Global event handlers (called from template inline attributes) ──────────

/**
 * Called from textarea oninput — detects @/# triggers and shows autocomplete
 */
window.mentionOnInput = function(event) {
    const textarea = event.currentTarget
    const val = textarea.value
    const caret = textarea.selectionEnd

    // Walk backwards from caret to find a trigger
    let i = caret - 1
    while (i >= 0) {
        const ch = val[i]
        if (ch === ' ' || ch === '\n') { closePopup(); return }
        if (ch === '@' || ch === '#') {
            // Don't trigger if preceded by '<' (already a raw-ID token being typed naturally – shouldn't happen from user, but be safe)
            if (i > 0 && val[i - 1] === '<') { closePopup(); return }
            currentTrigger = ch
            triggerStart = i
            break
        }
        i--
    }
    if (i < 0) { closePopup(); return }

    const query = val.substring(triggerStart + 1, caret)
    if (query.length > 30) { closePopup(); return }

    createPopupIfNeeded(textarea)

    if (currentTrigger === '@') {
        candidates = buildUserCandidates(query)
    } else {
        candidates = buildChannelCandidates(query)
    }

    selectedIndex = 0
    renderPopup()
}

/**
 * Called from textarea onkeydown — navigates the autocomplete with arrows, selects with Enter/Tab
 * Returns true if the event was consumed (caller should not process further)
 */
window.mentionOnKeyDown = function(event) {
    if (!autocompletePopup || autocompletePopup.style.display === "none" || candidates.length === 0) return false

    switch (event.key) {
        case "ArrowDown":
            event.preventDefault()
            selectedIndex = (selectedIndex + 1) % candidates.length
            renderPopup()
            return true
        case "ArrowUp":
            event.preventDefault()
            selectedIndex = (selectedIndex - 1 + candidates.length) % candidates.length
            renderPopup()
            return true
        case "Tab":
        case "Enter":
            event.preventDefault()
            event.stopPropagation()
            selectCandidate(event.currentTarget, selectedIndex)
            return true
        case "Escape":
            event.preventDefault()
            closePopup()
            return true
    }
    return false
}

/**
 * Called from textarea onblur — closes the popup with a delay (so mousedown on items fires first)
 */
window.mentionOnBlur = function() {
    setTimeout(closePopup, 150)
}



