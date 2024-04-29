import {Markdown} from "./markdown.mjs";

export function MDToHTML(text){
    const engine = new Markdown()
    const tokens = engine.tokenize(text)
    console.log("text",text,"tokens",tokens)
    return engine.render(tokens)
}
window.MDToHTML = MDToHTML

export function showSpoiler(event){
    event.currentTarget.classList.toggle("clicked")
}
window.showSpoiler = showSpoiler

export function copyCode(event){
    navigator.clipboard.writeText(event.currentTarget.parentElement.firstElementChild.innerHTML).then(
        event.currentTarget.style.background = "var(--green)"
    )
}
window.copyCode = copyCode
