import global from "./framework/global.mjs"
import {loadChan, loadConv, loadNote, loadServer, lookFor} from "./crud.mjs";
import {setElement} from "./framework/vesta.mjs";
import {closeFM, goTo} from "./framework/navigation.mjs";
import {xhr} from "./framework/templating.mjs";
import {} from "./servers/drive.mjs"
let emptyStr = '' //DO NOT REMOVE

/**
 * Check if scrolled to bottom and mark conversation notifications as read
 */
function checkAndMarkConvAsRead() {
    if (!global.state.activeConv) return

    const scrollable = document.querySelector('#content .scrollable.bottom-margin')
    if (!scrollable) return

    // Check if scrolled to bottom (within 50px threshold)
    const isAtBottom = scrollable.scrollTop > -50

    if (isAtBottom && global.user.notifs) {
        // Find notification for current conversation
        const notif = global.user.notifs.find(n => n.conversation === global.state.activeConv)

        if (notif) {
            // Call backend to delete the notification
            const onload = function() {
                try {
                    // Remove notification from global.user.notifs array
                    const index = global.user.notifs.findIndex(n => n.id === notif.id)
                    if (index > -1) {
                        global.user.notifs.splice(index, 1)
                        setElement('global.user.notifs', global.user.notifs)
                    }
                } catch (e) {
                    console.error("Error updating notifications:", e)
                }
            }

            xhr(`consult_notifs?notif_id=${notif.id}`, onload, "POST")
        }
    }
}

function goToConv(convId){
    let targetElt
    if(global.state.activeConv){
        targetElt = document.getElementById("conv".concat(global.state.activeConv))
    }else{
        targetElt = document.getElementById("friendCat")
    }
    if (targetElt){
        targetElt.classList.remove("selected")
    }

    global.state.activeConv = convId
    loadConv(convId)

    // Load call state for this conversation
    if (loadCallState) {
        loadCallState(convId);
    }

    if (global.state.isMobile) {
        mobileDisplayContent()
    }

    targetElt = document.getElementById("conv".concat(convId))
    targetElt.classList.add("selected")

    global.state.isServer = false
    goTo('content','conversation',undefined,false)

    // Attach scroll listener to mark notifications as read
    setTimeout(() => {
        const scrollable = document.querySelector('#content .scrollable.bottom-margin')
        if (scrollable) {
            // Remove old listener if exists to prevent duplicates
            scrollable.removeEventListener('scroll', checkAndMarkConvAsRead)
            // Add new listener
            scrollable.addEventListener('scroll', checkAndMarkConvAsRead)
            // Check immediately in case already at bottom (e.g., when opening conv)
            checkAndMarkConvAsRead()
        }
    }, 100)
}
window.goToConv = goToConv

function mobileDisplayContent(){
    const content = document.getElementById('content')
    const secColumn = document.getElementById('sec-column')
    const maincolumn = document.getElementById('main-selector')

    content.style.display="flex"
    secColumn.style.display="none"
    maincolumn.style.display="none"
}
window.mobileDisplayContent = mobileDisplayContent

function mobileHideContent(){
    const content = document.getElementById('content')
    const secColumn = document.getElementById('sec-column')
    const maincolumn = document.getElementById('main-selector')

    content.style.display="none"
    secColumn.style.display="flex"
    maincolumn.style.display="flex"
}
window.mobileHideContent = mobileHideContent

function goToChannel(id){
    let targetElt
    if(global.state.activeChan){
        targetElt = document.getElementById("channel".concat(global.state.activeChan.slug))
        targetElt?.classList.remove("selected")
    }

    global.state.activeConv = id
    global.state.activeChan = {id:id, slug:"-conv-"+id, type:"conv"}
    loadChan(id)

    if (global.state.isMobile) {
        mobileDisplayContent()
    }

    targetElt = document.getElementById("channel".concat(global.state.activeChan.slug))
    targetElt.classList.add("selected")

    goTo('content','server-channel',undefined,false)
}
window.goToChannel = goToChannel

function goToVocalChannel(id){
    let targetElt
    if(global.state.activeChan){
        targetElt = document.getElementById("channel".concat(global.state.activeChan.slug))
        targetElt?.classList.remove("selected")
    }

    global.state.activeChan = {id:id, slug:"-vocal-"+id, type:"vocal"}

    if (!global.convs) global.convs = {}
    const room = lookFor(id, global.state.currentServer.dirs.vocals)
    global.convs[id] = {id: id, name: room ? room.name : "Note Channel", type: "note"}

    if (global.state.isMobile) {
        mobileDisplayContent()
    }

    targetElt = document.getElementById("channel".concat(global.state.activeChan.slug))
    targetElt.classList.add("selected")

    goTo('content','server-vocal-content',undefined,false)
}
window.goToVocalChannel = goToVocalChannel

function goToNoteChannel(id){
    let targetElt
    if(global.state.activeChan){
        targetElt = document.getElementById("channel".concat(global.state.activeChan.slug))
        targetElt?.classList.remove("selected")
    }

    global.state.activeChan = {id:id, slug:"-note-"+id, type:"note"}

    if (!global.convs) global.convs = {}
    loadNote(id)

    if (global.state.isMobile) {
        mobileDisplayContent()
    }

    targetElt = document.getElementById("channel".concat(global.state.activeChan.slug))
    targetElt.classList.add("selected")


}
window.goToNoteChannel = goToNoteChannel


function goToFriends(event){
    if(global.state.activeConv){
        let targetElt = document.getElementById("conv".concat(global.state.activeConv))
        targetElt.classList.remove("selected")
    }

    global.state.activeConv = undefined
    event.currentTarget.classList.add("selected")

    if (global.state.isMobile) {
        mobileDisplayContent()
    }

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
    } else if (target === "reaction") {
        const messageId = global.state.reactionPickerTarget;
        const emoji = event.currentTarget.innerHTML;
        toggleReaction(messageId, emoji);
        closeFM('reaction-picker');
    } else {
        target.innerHTML = event.currentTarget.innerHTML
    }
}
window.insertStandardEmoji = insertStandardEmoji

function openReactionPicker(event, messageId) {
    global.state.reactionPickerTarget = messageId;
    toggleFM('reaction-picker');
    const picker = document.getElementById('reaction-picker');
    const rect = event.currentTarget.getBoundingClientRect();
    picker.style.top = `${Math.max(10, rect.top - picker.offsetHeight - 10)}px`;
    picker.style.left = `${rect.left - picker.offsetWidth }px`;
    picker.style.bottom = 'unset'
    picker.style.width = 'fit-content'
}
window.openReactionPicker = openReactionPicker;

function toggleReaction(messageId, emoji) {
    const convId = global.state.activeConv;
    if (!convId || !global.convs[convId] || !global.convs[convId].messages[messageId]) return;

    // let msgReactions = global.convs[convId].messages[messageId].reactions;
    // let hasReacted = msgReactions[emoji]?.includes(global.user.id)
    // const newReactions = { ...msgReactions };
    //
    // if (hasReacted) {
    //     if (newReactions[emoji].length <= 0) {
    //         delete newReactions[emoji];
    //     } else {
    //         if(newReactions[emoji]) {
    //              newReactions[emoji] = newReactions[emoji].filter(v => v !== global.user.id);
    //         }
    //     }
    // } else {
    //     if (!newReactions[emoji]) {
    //         newReactions[emoji] = [];
    //     }
    //     if(newReactions[emoji] && !newReactions[emoji]?.includes(global.user.id)) {
    //          newReactions[emoji].push(global.user.id);
    //     }
    // }

    // setElement(`global.convs[${convId}].messages[${messageId}].reactions`, newReactions);
    
    xhr(`toggle_reaction?message_id=${messageId}&emoji=${encodeURIComponent(emoji)}`, (e) => {
        if (e.target.status === 200) {
            const response = JSON.parse(e.target.responseText);
            setElement(`global.convs[${global.state.activeConv}].messages[${messageId}].reactions`, response.reactions);
        } else {
             console.error("Failed to toggle reaction");
        }
    }, "POST");
}
window.toggleReaction = toggleReaction;


function renderReactionTooltipText(place, messageId, emoji, voters) {
    const msg = global.convs[place]?.messages?.[messageId];
    if (!msg || !msg.reactions || !msg.reactions[emoji]) return '';

    if (voters.length === 0) return '';
    
    // Show up to 3 names, then 'and X others'
    let displayNames = [];
    let othersCount = 0;
    
    for(let i=0; i < voters.length; i++) {
       const vid = voters[i];
       if (vid === global.user.id) {
           displayNames.push(_t("Vous"));
       } else if (global.users[vid]) {
           displayNames.push(global.users[vid].display);
       } else {
           displayNames.push(`User #${vid}`);
           loadUsers([vid]);
       }
    }
    
    if (displayNames.length > 3) {
        othersCount = displayNames.length - 3;
        displayNames = displayNames.slice(0, 3);
    }
    
    let text = displayNames.join(', ');
    if (othersCount > 0) {
        text += ` ${_t('et')} ${othersCount} ${_t('autres')}`;
    }
    
    return `<div class="emoji-big">${emoji}</div><div class="voters">${text}</div>`;
}
window.renderReactionTooltipText = renderReactionTooltipText;

function openReactionVoters(place, messageId, emoji) {
    const msg = global.convs[place]?.messages?.[messageId];
    if (!msg || !msg.reactions) return;

    const allReactions = msg.reactions;
    const options = [];
    const votes = {};
    const allVoters = new Set();
    let selectedOptionId = 1;
    let currentId = 1;

    for (const [reactionEmoji, reactionVoters] of Object.entries(allReactions)) {
        if (reactionVoters && reactionVoters.length > 0) {
            options.push({ id: currentId, text: reactionEmoji });
            votes[currentId] = reactionVoters;
            reactionVoters.forEach(voterId => allVoters.add(voterId));

            if (reactionEmoji === emoji) {
                selectedOptionId = currentId;
            }
            currentId++;
        }
    }

    if (options.length === 0) return;

    const data = {
        totalVoters: allVoters.size,
        poll: { question: `${_t('Réactions')}` },
        options: options,
        votes: votes
    };
    
    global.state.pollVotersData = data;
    global.state.pollVotersSelectedOption = selectedOptionId;
    
    openMenu('poll-voters');
    setTimeout(() => {window.renderPollVotersContent();}, 100);
}
window.openReactionVoters = openReactionVoters;

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
        const request = xhr("/create_personal_server?server_id="+global.state.currentServer.id , undefined, "POST", false);
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
