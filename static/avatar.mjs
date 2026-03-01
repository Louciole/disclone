import global from "/static/framework/global.mjs"

global.state.avatar = {}
global.state.avatar.layers = {
    "hairLow": {"1.1": "#1d5979"},
    "body": {"1.1": "#9c7a60"},
    "eyes": {"1.1": "#181212"},
    "clothes1": {"1.1": "#e3e0d2"},
    "clothes2": {"1.1": "#a04a30"},
    "nose": {"1.1": "#4b2e28"},
    "mouth": {"1.1": "#4b2e28"},
    "eyebrows": {"1.1": "#232f5e"},
    "hairLow2": {"1.1": "#1c2042"},
    "hairMain": {"1.1": "#4f3878"},
    "hairUp": {"1.1": "#51753c"},
    "hairSide": {"1.1": "#dd9299"},
    "hairFront": {"1.1": "#652538"},
}
global.state.avatar.currentVariation = {
    "body": "1.1",
    "eyes": "1.1",
    "clothes1": "1.1",
    "clothes2": "1.1",
    "nose": "1.1",
    "mouth": "1.1",
    "eyebrows": "1.1",
    "hairLow2": "1.1",
    "hairLow": "1.1",
    "hairSide": "1.1",
    "hairMain": "1.1",
    "hairUp": "1.1",
    "hairFront": "1.1",
}

const steps = [
    {name: 'body', nullable: false, id:0},
    {name: 'eyes', nullable: true, id:1},
    {name: 'clothes1', nullable: true, id:2},
    {name: 'clothes2', nullable: true, id:3},
    {name: 'nose', nullable: true, id:4},
    {name: 'mouth', nullable: true, id:5},
    {name: 'eyebrows', nullable: true, id:6},
    {name: 'hairLow2', nullable: true, id:7},
    {name: 'hairLow', nullable: true, id:8},
    {name: 'hairSide', nullable: true, id:9},
    {name: 'hairMain', nullable: true, id:10},
    {name: 'hairUp', nullable: true, id:11},
    {name: 'hairFront', nullable: true, id:12},
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
    const elt = document.getElementById('avatar-variations');
    elt.innerHTML = avatarVariations();
}

window.goToAvatarStep = function (step) {
    global.state.avatar.currentLayer = steps[step];
    const elt = document.getElementById('avatar-variations');
    elt.innerHTML = avatarVariations();
}
