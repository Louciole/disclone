function logout(){
    const url = "/logout";
    let request = new XMLHttpRequest();
    request.open('POST', url, true);
    request.onload = function() { // request successful
        console.log("logged out",request.responseText)

        if (request.responseText === "ok"){
            window.location.href = "/auth";
        }
    };

    request.onerror = function() {
        console.log("request failed")
    };

    request.send();
}
window.logout = logout



export function setElement(element, value){
    console.log(element,'has been updated to:', value);
    eval(`${element} = value`);
    const subscriptions = document.querySelectorAll(`[class^="${element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')}"]`)
    for (let sub of subscriptions){
        const content = eval(sub.dataset.content)
        sub.innerHTML = content()
    }
}

export function pushElement(element, value){
    console.log(element,'has been added:', value);
    eval(`${element}.push(value)`);
    const subscriptions = document.querySelectorAll(`[class^="${element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')}"]`)
    for (let sub of subscriptions){
        console.log("we need to evaluate",sub)

        if(sub.dataset.repaint){
            const fn = eval(sub.dataset.repaint)
            fn()
        }else{
            const content = eval(sub.dataset.content)
            sub.innerHTML = content()
        }
    }
}

export function addElement(element, value){
    console.log(element,'has been added:', value);
    eval(`${element}[value.id] = value`);
    const subscriptions = document.querySelectorAll(`[class^="${element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')}"]`)
    for (let sub of subscriptions){
        console.log("we need to evaluate",sub)
        const content = eval(sub.dataset.content)
        sub.innerHTML = content()
    }
}

export function deleteElement(element, id){
    console.log(element,'has been removed:', element[id]);
    eval(`${element}.splice(id,1)`);
    const subscriptions = document.querySelectorAll(`[class^="${element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')}"]`)
    for (let sub of subscriptions){
        console.log("we need to evaluate",sub)
        const content = eval(sub.dataset.content)
        sub.innerHTML = content()
    }
}

function checkEnter(event, effect){
    if (event.key === "Enter"){
        console.log("enter pressed")
        effect()
    }
}
window.checkEnter = checkEnter

function getTimeStr(timestamp, options = { locale: "fr-FR" }) {
    const date = new Date(timestamp);

    const defaultOptions = {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
    };

    const mergedOptions = { ...defaultOptions, ...options };
    console.log("TIMESTR",date.toLocaleDateString(undefined, mergedOptions))
    return date.toLocaleDateString(undefined, mergedOptions);
}
window.getTimeStr = getTimeStr


function goodbye(){
    if (confirm('Voulez-vous vraiment vous désinscrire et supprimer votre compte de tous les services Carbonlab ? (toutes vos informations seront effacées)')) {
        const url = "/goodbye";
        let request = new XMLHttpRequest();
        request.open('POST', url, true);
        request.onload = function() { // request successful
            console.log("account deleted",request.responseText)

            if (request.responseText === "ok"){
                window.location.href = "/auth";
            }
        };

        request.onerror = function() {
            console.log("request failed")
        };

        request.send();
    } else {
        console.log("ouf 😖")
    }
}
window.goodbye = goodbye

export function difference(arrKeys, dict) {
    const result = [];
    const dictKeys = new Set(Object.keys(dict)); // Convert dict keys to a set for efficient lookup

    for (const key of arrKeys) {
        if (!dictKeys.has(key.toString())) {
            result.push(key);
        }
    }
    return Array.from(result);
}
