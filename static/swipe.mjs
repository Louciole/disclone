import global from "./framework/global.mjs"

/**
 * Discord-style swipe navigation for mobile.
 *
 * The two mobile "screens" (selectors = sections 1+2, content = section 3)
 * live in #app-track, a 200vw flex row translated by the --pane-x CSS var.
 * Swipe left  -> reveal content.
 * Swipe right -> reveal selectors.
 *
 * A horizontal swipe started inside an element that can still scroll
 * horizontally in that direction is handed to that element instead, so
 * carousels / the Drive grid / code blocks / the spreadsheet keep working.
 */

const THRESHOLD = 0.25;  // fraction of viewport travelled to commit
const VELOCITY  = 0.4;   // px/ms flick that commits regardless of distance
const SLOP      = 8;     // px before we decide the gesture axis

function vw(){ return window.innerWidth }

// Is the content pane currently showing?
function atContent(){ return document.body.dataset.pane === 'content' }

// Should this touch be ignored entirely?
function blocked(el){
    if (global.state.activeFM) return true                       // floating menu open
    if (el.closest('.menu-wrapper, .fullscreen-menu, .modale')) return true
    if (el.closest('textarea, input, select, [contenteditable="true"]')) return true
    const ae = document.activeElement
    if (ae && /^(TEXTAREA|INPUT|SELECT)$/.test(ae.tagName)) return true
    return false
}

/**
 * Walk up from `el` looking for an ancestor that can scroll horizontally in
 * the swipe direction. `dir` < 0 = finger moving left, > 0 = moving right.
 */
function consumesSwipe(el, dir){
    let node = el
    while (node && node !== document.body && node.nodeType === 1){
        if (node.scrollWidth > node.clientWidth + 1){
            const ox = getComputedStyle(node).overflowX
            if (ox === 'auto' || ox === 'scroll'){
                const max = node.scrollWidth - node.clientWidth
                if (dir < 0 && node.scrollLeft < max - 1) return true  // can scroll right
                if (dir > 0 && node.scrollLeft > 1)       return true  // can scroll left
            }
        }
        node = node.parentElement
    }
    return false
}

export function initSwipe(){
    if (!global.state.isMobile) return

    const body = document.body
    let startX = 0, startY = 0, dx = 0, t0 = 0
    let tracking = false, axis = null

    body.addEventListener('touchstart', e => {
        if (e.touches.length !== 1 || blocked(e.target)) { tracking = false; return }
        startX = e.touches[0].clientX
        startY = e.touches[0].clientY
        dx = 0; t0 = performance.now(); axis = null; tracking = true
    }, { passive: true })

    body.addEventListener('touchmove', e => {
        if (!tracking) return
        const ox = e.touches[0].clientX - startX
        const oy = e.touches[0].clientY - startY

        if (axis === null){
            if (Math.abs(ox) < SLOP && Math.abs(oy) < SLOP) return
            if (Math.abs(ox) <= Math.abs(oy)){ axis = 'y'; tracking = false; return } // vertical scroll
            // horizontal: defer to an inner horizontal scroller if it can take it
            if (consumesSwipe(e.target, ox)){ axis = 'scroll'; tracking = false; return }
            axis = 'x'
            body.classList.add('pane-dragging')
        }
        if (axis !== 'x') return

        const base = atContent() ? -vw() : 0
        dx = Math.max(-vw(), Math.min(0, base + ox))   // clamp within the track
        body.style.setProperty('--pane-x', dx + 'px')
        e.preventDefault()                              // we own this gesture now
    }, { passive: false })

    function end(){
        if (!tracking && axis !== 'x') return
        body.classList.remove('pane-dragging')
        if (axis === 'x'){
            const base = atContent() ? -vw() : 0
            const moved = dx - base                     // <0 toward content, >0 toward selectors
            const v = moved / Math.max(1, performance.now() - t0)
            const toContent = moved < 0 && (-moved > vw() * THRESHOLD || -v > VELOCITY)
            const toSelect  = moved > 0 && ( moved > vw() * THRESHOLD ||  v > VELOCITY)
            if (toContent)      mobileDisplayContent()
            else if (toSelect)  mobileHideContent()
            else body.style.setProperty('--pane-x', atContent() ? '-100vw' : '0px') // snap back
        }
        tracking = false; axis = null
    }

    body.addEventListener('touchend', end, { passive: true })
    body.addEventListener('touchcancel', end, { passive: true })
}

initSwipe()
