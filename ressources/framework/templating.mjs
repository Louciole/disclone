import {xhr} from "../crud.mjs";
let templates = {}

export function loadTemplate(template, target=undefined, flex= undefined, async){
    const effect = function() {
        console.log("xhr sent received",target,document.getElementById(target))
        if (target){
            //maybe not using eval
            document.getElementById(target).innerHTML = eval('`' + this.responseText + '`');
        }else{
            global.state.dom.insertAdjacentHTML('beforeend',eval('`' + this.responseText + '`'))
        }
        if (flex){
            document.getElementById(flex).style.display = "flex"
        }
    };

    xhr( '/templates/'.concat(template), effect,"GET", async)
}

function fillWith(template, list){
    console.log("fillWith",template,list,typeof list)

    let request
    if(templates[template]){
        request={"responseText":templates[template]}
    }else{
        request = xhr( '/templates/'.concat(template,".html"), undefined, "GET", false)
        console.log("adding to cache",templates, template)
        templates[template] = request.responseText
    }

    let content = ""
    if (typeof list == 'object'){
        for (let elementId in list){
            const element = list[elementId]
            content += eval('`' + request.responseText + '`')
        }
    }else{
        for (let element of list){
            content += eval('`' + request.responseText + '`')
        }
    }

    return content
}
window.fillWith = fillWith

function Subscribe(element, content, className=undefined, repaint=undefined){
    //subscribe content to element, content will be reevaluated on element change
    const domElement = document.createElement('div')
    domElement.className = element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')
    if (className){
        domElement.classList.add(className)
    }
    domElement.innerHTML = content()
    if(repaint){
        domElement.dataset.repaint = repaint
    }else{
        domElement.dataset.content = content
    }
    return domElement.outerHTML
}
window.Subscribe = Subscribe

function getTemplate(name){
    const request = xhr( '/templates/'.concat(name,".html"), ()=>{}, "GET", false)
    return eval('`' + request.responseText + '`')
}
window.getTemplate = getTemplate