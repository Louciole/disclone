var currentTab;
var currentConv;
let activeFM;
let openingFM = false;

function initFront(){
    currentTab=document.getElementById("logo")
    loadTab("privateMessage")
    loadConv("friends")
    document.addEventListener('click', function (event) {
        if (activeFM && !activeFM.contains(event.target)) {
            activeFM.classList.toggle("visible")
            if (!openingFM){
                activeFM = undefined
            }else{
                openingFM=false
            }
        }
    }, false);
    loadEmojis()
}

function changeActiveTab(tabName){
    currentTab.classList.remove("selected")
    currentTab=event.currentTarget
    currentTab.classList.add("selected")
    loadTab(tabName)
}

function changeActiveConv(convName){
    currentConv.classList.remove("selected")
    currentConv=event.currentTarget
    currentConv.classList.add("selected")
    loadConv(convName)
}

function createServer(){
    const createMenu=document.getElementById("create-server")
    createMenu.style.display="flex"
}

function closeMenu(cible = undefined){
    //TODO generalize reset page count
    if(!cible){
        if(event.target !== event.currentTarget){
            return
        }
        event.target.style.display = "none";
    }else{
        const cibleEl= document.querySelector(cible)
        cibleEl.style.display = "none";
    }
    gotoStep(0,'createServerSteps')
}

function loadTab(tabName){
    const effect = function() {
        document.getElementById('sec-selector').innerHTML = this.responseText;
        currentConv=document.querySelector("#sec-selector .selected")
    };

    loadSelector(tabName.concat("Selector.html"),effect)
}

function loadConv(name){
    const effect = function() {
        document.getElementById('content').innerHTML = this.responseText;
        currentConv=document.querySelector("#sec-selector .selected")
    };

    loadSelector(name.concat(".html"),effect)
}

function loadSelector(filename,effect){
    let xhr= new XMLHttpRequest();
    xhr.open('GET', filename, true);
    xhr.onload=effect
    xhr.send();
}

function deafen(){
    event.currentTarget.lastElementChild.classList.toggle("visible")
}

function mute(){
    event.currentTarget.lastElementChild.classList.toggle("visible")
}

function silent_typing(){
    event.currentTarget.lastElementChild.classList.toggle("visible")
}

function toggleFM(id){
    openingFM=true
    activeFM=document.getElementById(id)
}

function toggleGroup(){
    event.currentTarget.classList.toggle("closed")
}

function gotoStep(step,stepsID){
    const menu = document.getElementById(stepsID)
    console.log(step)
    menu.style.transform=`translateX(${-100*step/menu.childElementCount}%)`
}

function newServer(){
    const servers = document.getElementById('servers')
    servers.insertAdjacentHTML("beforeend",`
        <div class="container">
            <div class="item serveur" onclick="changeActiveTab('server')">NS</div>
            <div class="indicator"></div>
            <span class="tooltip left">Nouveau serveur</span>
        </div>
    `)
    closeMenu('#create-server')
}

function loadEmojis(){
    const board = document.getElementById('emoji-board')
}
