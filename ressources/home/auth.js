function loginSubmit(event) {
    let url = "/login";
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);

    if (urlParams.has('parrain')){
        const parrain = urlParams.get('parrain')
        url+="?parrain="+parrain
    }
    const errorBox = document.querySelector("#messageframe");
    let request = new XMLHttpRequest();
    request.open('POST', url, true);
    request.onload = function() { // request successful
        console.log(request.responseText)
        if (request.responseText === "ok"){
            window.location.href = "/projects";
        }else if(request.responseText === "verif"){
            window.location.href = "/verif";
        }else{
            errorBox.innerHTML=request.responseText
        }
    };

    request.onerror = function() {
        console.log("request failed")
    };

    request.send(new FormData(event.target));
    event.preventDefault();
}

function signupSubmit(event){
    const url = "/signup";
    const errorBox = document.querySelector("#messageframe");

    let request = new XMLHttpRequest();
    request.open('POST', url, true);
    request.onload = function() { // request successful
        if (request.responseText === "ok"){
            window.location.href = "/channels/@me";
        }else{
            errorBox.innerHTML=request.responseText
        }
    };

    request.onerror = function() {
        console.log("request failed")
    };

    console.log(new FormData(event.target))
    request.send(new FormData(event.target));
    event.preventDefault();
}

function attachFormSubmitEvent(formId,fn){
    document.getElementById(formId).addEventListener("submit", fn);
}

function resendValidation(){
    const resendBtn = document.querySelector("#resend");
    setTimeout(() => {activateBtn(resendBtn)}, 10000)
    resendBtn.style.color="lightgray"
    resendBtn.onclick="none"

    const url = "/resendVerif";
    const errorBox = document.querySelector("#messageframe");

    let request = new XMLHttpRequest();
    request.open('POST', url, true);
    request.onload = function() {
    };

    request.onerror = function() {
        console.log("request failed")
    };
    request.send();
}

function activateBtn(btn){
    btn.style.color="grey"
    btn.onclick=resendValidation
}