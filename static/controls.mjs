import global from "./framework/global.mjs"
import {lookFor} from "./crud.mjs";

function deafen(){
    event.currentTarget.lastElementChild.classList.toggle("visible")
}
window.deafen = deafen

function mute(){
    event.currentTarget.lastElementChild.classList.toggle("visible")
}
window.mute = mute

function silent_typing(){
    event.currentTarget.lastElementChild.classList.toggle("visible")
    if(!global.settings.silent_typing){
        global.settings.silent_typing = false
    }
    window.localStorage.setItem("silent_typing", (!global.settings.silent_typing).toString())
    global.settings.silent_typing = !global.settings.silent_typing
}
window.silent_typing = silent_typing

function reply(msg_id){
    document.getElementById("replyBox").style.display = "flex"
    global.convs[global.state.activeConv].reply = msg_id
    document.getElementById("replyName").innerText = global.users[lookFor(msg_id.toString(),global.convs[global.state.activeConv].messages).sender].display
    document.querySelector(".chat-input textarea").focus()
}
window.reply = reply

function cancelReply(){
    global.convs[global.state.activeConv].reply = null
    document.getElementById("replyBox").style.display = "none"
}
window.cancelReply = cancelReply
