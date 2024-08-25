export async function initTranslations(){
    if(document.cookie.includes("lang=")){
        global.settings.lang = document.cookie.split("lang=")[1].split(";")[0]
    }else{
        global.settings.lang = navigator.language.split("-")[0]
    }
    const pack = await import("/static/translations/" + global.settings.lang + ".mjs")
    console.log("pack",pack.lang)
    global.i18n = pack.lang
}

function setLang(code){
    document.cookie = "lang=" + code + ";path=/"
    document.location.reload()
}
window.setLang = setLang

function _t(key){
    const DEBUG = true
    if (DEBUG) {
        if(!global?.i18n[key]){
            console.warn("traduction :", key + " is missing")
        }
    }


    if(global.i18n){
        return global.i18n[key] ?? key;
    }
    return key;
}
window._t = _t

