// this is adapted from iota Editor
// https://github.com/Louciole/iota/blob/main/static/dragHandler.mjs

import {xhr} from "./framework/templating.mjs";

const PROXIMITY_THRESHOLD = convertRemToPixels(0.5)

let animationFrameRequested = false
let lastTargeted
let lastSnapZone
let DOM_OVERLAY
let dragType
let currentPos = {parent: null, prev:null, next:null}

export function convertRemToPixels(rem) {
    return rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

export function initDrag() {
    document.addEventListener("drag", onDrag);
    lastTargeted = null
    lastSnapZone = null
    document.addEventListener("dragend", onDragEnd);
}

function onDrag(e) {
    document.body.addEventListener('dragover', e => {
        let targeted = document.elementFromPoint(e.clientX, e.clientY)
        //si on est au-dessus d'un enfant de drag-wrapper
        if (targeted.closest("#server-selector") && !(dragType === "cat" && targeted.dataset.type !== "cat")) {
            if (dragType === "cat"){
                targeted = targeted.parentElement
            }
            const boundingRect = targeted.getBoundingClientRect()
            const HALF_HEIGHT = boundingRect.top + (boundingRect.bottom - boundingRect.top) / 2

            // si proche bordure bas
            // console.log(e.clientY, PROXIMITY_THRESHOLD, boundingRect, targeted)
            if (e.clientY + PROXIMITY_THRESHOLD >= boundingRect.bottom) {
                addSnapZone(boundingRect.x, boundingRect.bottom, 'horizontal', boundingRect.width)
                currentPos = {parent: null, prev: targeted, next: targeted.nextSibling}
                console.log("1 - ADD AFTER")
            } else if (e.clientY - PROXIMITY_THRESHOLD <= boundingRect.top) {
                // sinon proche bordure haut
                addSnapZone(boundingRect.x, boundingRect.top, 'horizontal', boundingRect.width)
                currentPos = {parent: null, prev: targeted.previousSibling, next: targeted}
                console.log("2 - ADD BEFORE")
            } else if (targeted.childElementCount === 0) {
                // si vide
                // addSnapZone(boundingRect.x, HALF_HEIGHT, 'horizontal', boundingRect.width)
                // console.log("3 - ADD INSIDE")
            }
        }

        if (!animationFrameRequested) {
            animationFrameRequested = true
            requestAnimationFrame(() => {
                    animationFrameRequested = false
                }
            )
        }
    }, {once: true});// is it stupid ? yes -- is it useless also yes but it's made to get cursor coordinates on firefox because they don't want to fix this bug since 2009
}

function onDragEnd(e) {
    if (lastSnapZone) {
        lastSnapZone.remove()
    }
}

function allowSnippetDrop(e) {
    e.preventDefault();
}
window.allowSnippetDrop = allowSnippetDrop;

function dropSnippet(e) {
    e.preventDefault();

    const id = e.dataTransfer.getData("id");
    console.log(dragType,id, currentPos,currentPos.prev?.dataset?.id, currentPos.next?.dataset?.id)
    if(dragType === "cat"){
        if (currentPos.prev){
            if(currentPos.prev.firstElementChild.dataset.id == id){
                return
            }
            if(currentPos.next) {
                const newPos = (parseFloat(currentPos.prev.firstElementChild.dataset.pos) + parseFloat(currentPos.next.firstElementChild.dataset.pos))/2
                moveElement(id, newPos)
            }else{
                const newPos = parseFloat(currentPos.prev.firstElementChild.dataset.pos) + 0.1
                moveElement(id, newPos)
            }
        }else{
            if(currentPos.next.firstElementChild.dataset.id == id){
                return
            }
            const newPos = parseFloat(currentPos.next.firstElementChild.dataset.pos)/2
            moveElement(id, newPos)
        }

    }
}
window.dropSnippet = dropSnippet;

function moveElement(id, newPos) {
    console.log("dropping", id, "newpos",newPos)
    xhr('editServer?property=channel&id='+id.toString()+'&value='+JSON.stringify(newPos)+'&field=place', undefined, "POST", true)
}

function addSnapZone(x, y, mode = 'horizontal', size) {
    if (lastSnapZone) {
        lastSnapZone.remove()
    }
    //TODO ADD GESTION FIRST ELEMENT LAST ELEMENT
    const SNAP_ZONE = document.createElement("div")
    SNAP_ZONE.classList.add("snap-zone")
    SNAP_ZONE.classList.add(mode)
    SNAP_ZONE.style.top = `${y}px`
    SNAP_ZONE.style.left = `${x}px`
    if (mode === 'horizontal') {
        SNAP_ZONE.style.width = `${size}px`
    } else if (mode === 'vertical') {
        SNAP_ZONE.style.height = `${size}px`
    }
    lastSnapZone = SNAP_ZONE
    DOM_OVERLAY.appendChild(SNAP_ZONE)
}

function onSnippetDrag(e) {
    e.dataTransfer.setData("id", e.target.dataset.id);
    console.log("dragging", e.target)
    dragType = e.target.dataset.type;
    DOM_OVERLAY = document.querySelector("#drag-wrapper")
}
window.onSnippetDrag = onSnippetDrag;
