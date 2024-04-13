import {Markdown} from "./markdown.mjs";

export function MDToHTML(text){
    console.log("input : ",text)
    const engine = new Markdown()

    const tokens = engine.tokenize(text)
    console.log("tokens : ", tokens)
    return engine.render(tokens)
}
window.MDToHTML = MDToHTML