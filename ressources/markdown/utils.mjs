import {Markdown} from "./markdown.mjs";

export function textToHTML(text){
    console.log("#TESTING MARKDOWN ENGINE")
    console.log("input : ",text)
    const engine = new Markdown()

    const tokens = engine.tokenize(text)
    console.log("tokens : ", tokens)
    return engine.parse(tokens)
}