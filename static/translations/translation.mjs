export async function initTranslations(){
    if(document.cookie.includes("disclone_lang=")){
        global.settings.lang = document.cookie.split("disclone_lang=")[1].split(";")[0]
    }else{
        global.settings.lang = navigator.language.split("-")[0]
    }

    let pack;
    try {
        pack = await import("/static/translations/" + global.settings.lang + ".mjs")
    } catch (e) {
        global.settings.lang = "en"
        pack = await import("/static/translations/" + global.settings.lang + ".mjs")
    }

    global.i18n = pack.lang
}

function setLang(code){
    document.cookie = "disclone_lang=" + code + ";path=/"
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

function setLangDropdownText() {
    if(global.settings.lang !== 'fr') {
        let elt = document.querySelector('#lang-dropdown .selected')
        elt.classList.remove("selected")
        elt = document.querySelector('#lang-dropdown .lang-'.concat(global.settings.lang))
        elt.classList.add("selected")
        document.querySelector('#lang-dropdown .dropdown-text').innerText = elt.innerText
    }
}
window.setLangDropdownText = setLangDropdownText

