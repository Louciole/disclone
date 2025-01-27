import {initTranslations} from "./translations/translation.mjs";
import global from "/static/framework/global.mjs"
import {xhr} from "./framework/templating.mjs";
import {goTo} from "./framework/navigation.mjs";

window.global = global
await initTranslations()

if (document.getElementById("main-selector valid")){
    goTo('main-selector valid',"invitation-snippet",undefined, true)

}else{
    goTo('main-selector',"expired-invitation-snippet",undefined, true)
}
