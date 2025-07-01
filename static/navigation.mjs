import global from "./framework/global.mjs"
import {loadChan, loadConv, loadServer, lookFor} from "./crud.mjs";
import {setElement} from "./framework/sakura.mjs";
import {closeFM, goTo} from "./framework/navigation.mjs";

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

    targetElt = document.getElementById("conv".concat(convId))
    targetElt.classList.add("selected")

    goTo('content','conversation',undefined,false)
}
window.goToConv = goToConv

function goToChannel(id){
    let targetElt
    if(global.state.activeConv){
        targetElt = document.getElementById("channel".concat(global.state.activeConv))
        targetElt.classList.remove("selected")
    }

    global.state.activeConv = id
    loadChan(id)

    targetElt = document.getElementById("channel".concat(id))
    targetElt.classList.add("selected")

    goTo('content','server-channel',undefined,false)
}
window.goToChannel = goToChannel

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

function updatePreview(event, defaultValue, evaluation=undefined){
    const save_menu = document.querySelector(".save-settings")
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
        global.state["currentForm"] = { [event.currentTarget.id] : {value: event.currentTarget.value, modified :true, defaultValue: eval(defaultValue)}, modified: 1}
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
