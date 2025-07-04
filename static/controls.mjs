import global from "./framework/global.mjs"
import {handleMessageGroup, lookFor} from "./crud.mjs";
import {pushElement} from "./framework/sakura.mjs";
import {xhr} from "./framework/templating.mjs";

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

function editMsg(msg_id){
    // get the message element
    const msgBox = document.querySelector('#message-'+msg_id.toString())
    const msgContent = msgBox.querySelector('.content')
    const msg = lookFor(1,global.convs[global.state.activeConv].messages)
    // hide the message
    console.log(msg)
    msgContent.style.display = 'none'
    // display the input

    const editElt = msgBox.querySelector('.edit')
    let textarea
    if (editElt){
        editElt.style.display = "block"
        textarea = editElt.querySelector('textarea')

    }else{
        const div = document.createElement('div')

        div.style.width = 'calc(100% - 1rem);'
        div.style.height = 'fit-content'
        div.classList.add('edit')
        div.innerHTML = `<textarea onkeydown="onEdition(event,${msg_id})" rows="5" maxlength="250" oninput="resizeHeight(event)" onblur="saveCursorPosition(event)">${msg.body}</textarea>
<div class="helper">échap pour <div class=action onclick="cancelEdition(${msg_id})">annuler</div> • entrée pour <div class="action" onclick="saveEdition(${msg_id})">enregistrer</div></div>`


        msgBox.appendChild(div)
        // focus the new input
        textarea = div.querySelector('textarea')

    }
    const length = textarea.value.length;
    textarea.focus();
    textarea.setSelectionRange(length, length);


}
window.editMsg = editMsg

function delMsg(msg_id){
    if (confirm('Voulez-vous vraiment supprimer ce message ?')) {

        const onload = function() { // request successful
            //TODO delete message
        };
        xhr("deleteMessage?message="+msg_id, onload)
    }
}
window.delMsg = delMsg

function onEdition(event,id){
    if(event.key === "Enter" && !event.shiftKey){
        const target = event.currentTarget

        saveEdition(id)
        event.preventDefault()
    }else if(event.key === "Escape"){
        cancelEdition(id)
    }
}
window.onEdition = onEdition

function saveEdition(id){
    const msgBox = document.querySelector('#message-'+id.toString())
    const editor = msgBox.querySelector('.edit')
    const content = msgBox.querySelector('.content')
    const textarea = editor.querySelector('textarea')

    const onEdited = function (){
        console.log("edited")
        //TODO edit message in global, edit content, show content and hide editor
        // META TODO add edition notification and show edition
    }

    if (textarea.value.trim() !== ''){
        xhr("editMessage?message=".concat(id,"&content=",encodeURIComponent(textarea.value.trim())), onEdited)
    }


}
window.saveEdition = saveEdition

function cancelEdition(id){
    const msgBox = document.querySelector('#message-'+id.toString())

    const target = msgBox.querySelector('.edit')
    target.style.display = "none"

    const msgContent = msgBox.querySelector('.content')
    msgContent.style.display = "block"
}
window.cancelEdition = cancelEdition

function cancelReply(){
    global.convs[global.state.activeConv].reply = null
    document.getElementById("replyBox").style.display = "none"
}
window.cancelReply = cancelReply
