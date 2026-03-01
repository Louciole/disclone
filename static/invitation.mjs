import {initTranslations} from "./translations/translation.mjs";
import global from "/static/framework/global.mjs"
import {xhr} from "./framework/templating.mjs";
import {goTo} from "./framework/navigation.mjs";

window.global = global
global.state.jwt = document.cookie.split("auth=")[1] !== undefined
global.state.link = window.location.pathname.split('/')[1]
await initTranslations()


if (document.getElementById("main-selector valid")){
    const onload = function (){
        global.state.serverName = this.responseText
        goTo('main-selector valid',"invitation-snippet",undefined, true)
    }
    xhr(`/serverDisplay?invite=${global.state.link}`,onload)

}else{
    goTo('main-selector',"expired-invitation-snippet",undefined, true)
}
