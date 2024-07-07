import global from "/framework/global.mjs"

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