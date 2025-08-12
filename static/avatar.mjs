import global from "/static/framework/global.mjs"

global.state.avatar = {}
global.state.avatar.layers = {
    "body": {"1.1": "#9c7a60"},
    "eyes": {"1.1": "#181212"},
    "clothes1": {"1.1": "#e3e0d2"},
    "clothes2": {"1.1": "#a04a30"},
    "nose": {"1.1": "#4b2e28"},
    "mouth": {"1.1": "#4b2e28"},
    "eyebrows": {"1.1": "#232f5e"},
    "hairLow2": {"1.1": "#1c2042"},
    "hairLow": {"1.1": "#1d5979"},
    "hairSide": {"1.1": "#dd9299"},
    "hairMain": {"1.1": "#4f3878"},
    "hairUp": {"1.1": "#51753c"},
}
global.state.avatar.currentVariation = {
    "body": "",
    "eyes": "",
    "clothes1": "",
    "clothes2": "",
    "nose": "",
    "mouth": "",
    "eyebrows": "",
    "hairLow2": "",
    "hairLow": "",
    "hairSide": "",
    "hairMain": "",
    "hairUp": "",
}

const steps = [
    {name: 'body', nullable: false},
    {name: 'eyes', nullable: true},
    {name: 'clothes1', nullable: true},
    {name: 'clothes2', nullable: true},
    {name: 'nose', nullable: true},
    {name: 'mouth', nullable: true},
    {name: 'eyebrows', nullable: true},
    {name: 'hairLow2', nullable: true},
    {name: 'hairLow', nullable: true},
    {name: 'hairSide', nullable: true},
    {name: 'hairMain', nullable: true},
    {name: 'hairUp', nullable: true},
];

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

window.initAvatar = function () {
    const canvas = document.createElement('canvas');
    canvas.id = 'avatarCanvas';
    canvas.width = 500;
    canvas.height = 500;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let promise = Promise.resolve();// chaining promises to ensure images load in order

    for (const [layer, variations] of Object.entries(global.state.avatar.layers)) {
        for (const [id, color] of Object.entries(variations)) {
            promise = promise.then(() =>
                loadImage(`/static/images/avatars/${layer}/${id}.png`).then(img => {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                })
            );
        }
    }

    return promise.then(() => {
        return canvas;
    });
}

async function drawAvatar(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const [layer, variations] of Object.entries(global.state.avatar.layers)) {
        let variation
        let variationId = global.state.avatar.currentVariation[layer]
        if (variationId === '') {
            variationId = '1.1'
            variation = variations['1.1'];
        } else if (variationId === "none") {
            debugger
            continue; // skip if no variation is selected
        }else{
            variation = variations[variationId];
        }
        await loadImage(`/static/images/avatars/${layer}/${variationId}.png`).then(img => {
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        });
    }
}

window.initAvatarDisplay = function(containerId, avatar = null) {
    if (avatar === null) {
        avatar = initAvatar();
    }

    const avatarContainer = document.getElementById(containerId);
    if (avatarContainer) {
        avatar
            .then(canvas => {
                avatarContainer.appendChild(canvas);
            })
            .catch(error => {
                console.error('Failed to load avatar:', error);
                avatarContainer.innerHTML = '<p>Error loading avatar.</p>';
            });

    } else {
        //retry
        setTimeout(() => {
            window.initAvatarDisplay(containerId, avatar);
        }, 200);
        console.warn(`Avatar container with ID "${containerId}" not found.`);
    }
};

window.initAvatarSteps = function() {
    return fillWith('avatarLayerElt', steps)
}

window.avatarVariations = function() {

    if (global.state.avatar.currentLayer === undefined) {
        global.state.avatar.currentLayer = steps[0];
    }
    const selected = global.state.avatar.currentLayer

    let layer = global.state.avatar.layers[selected.name];
    let options = []

    if (selected.nullable) {
        options.push({
            id: 'none',
            selected: global.state.avatar.currentVariation[global.state.avatar.currentLayer.name] === 'none',
            action: "changeAvatarPreview('none')"
        });
    }

    for (let id of Object.keys(layer)) {
        options.push({
            id: id,
            selected: global.state.avatar.currentVariation[global.state.avatar.currentLayer.name] === id,
            action: "changeAvatarPreview('" + id + "')"
        });
    }
    return fillWith('avatarVariationPreview', options)
}


window.changeAvatarPreview =  function (id) {
    global.state.avatar.currentVariation[global.state.avatar.currentLayer.name] = id;
    drawAvatar(document.getElementById('avatarCanvas'))
}

window.goToAvatarStep = function (step) {
    const elt = document.getElementById('avatar-variations');
    elt.innerHTML = avatarVariations();
}
