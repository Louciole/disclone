let templates = {}

export function xhr(endpoint,effect,method="GET", async=true, body=undefined){
    let xhr= new XMLHttpRequest();
    xhr.open(method, endpoint, async);
    xhr.onload=effect
    xhr.onerror = function() {
        console.log("request failed")
    };
    if (body) {
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify(body));
    }else{
        xhr.send();
    }
    return xhr
}


function loadTemplate(template, target=undefined, flex= undefined, async){
    const effect = function() {
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

    xhr( '/static/templates/'.concat(template), effect,"GET", async)
}
window.loadTemplate = loadTemplate

function fillWith(template, list){
    // console.log("fillWith",template,list,typeof list)

    let request
    if(templates[template]){
        request={"responseText":templates[template]}
    }else{
        request = xhr( '/static/templates/'.concat(template,".html"), undefined, "GET", false)
        // console.log("adding to cache",templates, template)
        templates[template] = request.responseText
    }

    let content = ""
    if (typeof list == 'object'){
        for (let elementId in list){
            const element = list[elementId]
            content += eval('`' + request.responseText + '`')
        }
    }else if (!list){
        console.warn("fillWith called with undefined list")
        return content
    }else{
        for (let element of list){
            content += eval('`' + request.responseText + '`')
        }
    }

    return content
}
window.fillWith = fillWith

function Subscribe(element, content, className=undefined, params=undefined){
    //subscribe content to element, content will be reevaluated on element change
    const domElement = document.createElement('div')
    domElement.className = element.replaceAll('.','-').replaceAll('[','🪟').replaceAll(']','🥹')

    if (className){
        const classList = className.split(" ")
        for (let name of classList){
            domElement.classList.add(name)
        }
        domElement.dataset.defaultClass = domElement.className
    }

    if (params?.target === "class"){
        domElement.dataset.target = params.target
        domElement.className = domElement.className + " " + content()
    }else{
        domElement.innerHTML = content()
    }



    if (params?.element){
        domElement.dataset.element = params.element
    }

    if(params?.repaint){
        domElement.dataset.repaint = params.repaint
    }else{
        domElement.dataset.content = content
    }
    return domElement.outerHTML
}
window.Subscribe = Subscribe

function getTemplate(name){
    const request = xhr( '/static/templates/'.concat(name,".html"), ()=>{}, "GET", false)
    return eval('`' + request.responseText + '`')
}
window.getTemplate = getTemplate