// This in absolutely no spec, it comes exclusively from my deranged mind

export class Markdown {
    constructor() {
    }

    HTML_equiv = {
        "#":"<h${props.level}>${content}</h${props.level}>",
        "text":"${content}",
        "start li":"<li>${content}</li>",
        "*":"<i>${content}</i>",
        "**":"<b>${content}</b>",
        ">":"<div class='answer'>${content}</div>",
        "'''":"<div class='code-wrapper'><code>${content}</code><div class='circle grey' onclick='copyCode(event)'></div></div>",
        "~~":"<div class='crossed'>${content}</div>",
        "||":"<div class='spoiler' onclick='showSpoiler(event)'>${content}</div>",
        "link":"<a href='${props.link}' target='_blank'>${content}</a>",
        "color":"<div class='color' style='color: ${props.color}'>${content}</div>",
        "endline":"\n",
        "newline":"",
        ")":")",
        "'":"'",
        "(":"(",
        "/>":"/>",
        "]":"]",
        "/":"${content}/"
    }

    tokenize(str) {
        const tokenList = []
        let currentToken = new Token("newline")
        let commitEndline = false

        let char_id=0
        while (char_id < str.length ){

            //look for url
            if(str.slice(char_id,char_id+6) === "https:" || str.slice(char_id,char_id+5) === "http:" ){
                if (currentToken.content !== ""){
                    tokenList.push(currentToken)
                    currentToken = new Token("link")
                }else{
                    currentToken.type="link"
                }

                let look_id = 5
                let nextToken
                while (char_id+look_id<str.length){
                    if(str[char_id+look_id]=== "\n"){
                        nextToken = new Token("newline")
                        look_id++
                        break
                    }
                    if([" ",")","]"].includes(str[char_id+look_id])){
                        nextToken = new Token("text")
                        break
                    }
                    look_id++
                }
                currentToken.content = str.slice(char_id,char_id+look_id)
                currentToken.props.link = currentToken.content
                tokenList.push(currentToken)
                if(char_id+look_id>=str.length){
                    return tokenList;
                }
                char_id += look_id
                currentToken = nextToken
            }else{
                const char = str[char_id]
                switch (currentToken.type){
                    case "text":
                        switch (char){
                            case '*':
                                if (currentToken.content !== ""){
                                    tokenList.push(currentToken)
                                }
                                currentToken = new Token("*")
                                currentToken.props.level = 1
                                break
                            case '[':
                            case ']':
                            case '(':
                            case ')':
                                if (currentToken.content !== ""){
                                    tokenList.push(currentToken)
                                }
                                tokenList.push(new Token(char))
                                currentToken = new Token("text")
                                break
                            case '|':
                            case '~':
                            case "'":
                            case '/':
                            case '&':
                            case '<':
                                currentToken.type = char
                                break
                            case '\n':
                                if (commitEndline){
                                    commitEndline = false
                                    tokenList.push(currentToken)
                                    tokenList.push(new Token("endline"))
                                    currentToken = new Token("newline")
                                }else{
                                    currentToken.content = currentToken.content.concat(char)
                                    currentToken.props.consuming="text"
                                    currentToken.type="newline"
                                }
                                break
                            default:
                                currentToken.content = currentToken.content.concat(char)
                        }
                        break
                    case "#":
                        switch (char){
                            case '#':
                                currentToken.props.level = currentToken.props.level<3 ? currentToken.props.level+1 : 3
                                break
                            case '\n':
                                tokenList.push(currentToken)
                                currentToken = new Token("newline")
                                break
                            default:
                                currentToken.content = currentToken.content.concat(char)
                        }
                        break
                    case "newline":
                        switch (char){
                            case '#':
                                if (currentToken.content.trim() !== ""){
                                    currentToken.type=currentToken.props.consuming
                                    tokenList.push(currentToken)
                                }
                                currentToken = new Token("#")
                                currentToken.props["level"] = 1
                                break
                            case '-':
                                if (currentToken.content.trim() !== ""){
                                    currentToken.type=currentToken.props.consuming
                                    tokenList.push(currentToken)
                                }
                                currentToken = new Token("text")
                                tokenList.push(new Token("start li"))
                                commitEndline = true
                                break
                            case '>':
                                if (currentToken.content.trim() !== ""){
                                    currentToken.type=currentToken.props.consuming
                                    tokenList.push(currentToken)
                                }
                                currentToken = new Token("text")
                                tokenList.push(new Token(">"))
                                commitEndline = true
                                break
                            case '*':
                                currentToken = new Token("*")
                                currentToken.props.level = 1
                                break
                            case '|':
                            case '~':
                            case "'":
                            case '/':
                            case '&':
                            case '<':
                                currentToken.type = char
                                break
                            case '[':
                            case ']':
                            case '(':
                            case ')':
                                tokenList.push(new Token(char))
                                currentToken = new Token("text")
                                break
                            case ' ':
                                currentToken.content = currentToken.content.concat(char)
                                break
                            case '\n':
                                currentToken.type = "text"
                                tokenList.push(currentToken)
                                tokenList.push(new Token("endline"))
                                currentToken = new Token("newline")
                                break
                            default:
                                currentToken.type="text"
                                currentToken.content = currentToken.content.concat(char)
                        }
                        break
                    case "*":
                        switch (char){
                            case "*":
                                currentToken.props.level = currentToken.props.level<3 ? currentToken.props.level+1 : 3
                                break
                            case '\n':
                                tokenList.push(currentToken)
                                currentToken = new Token("newline")
                                currentToken.content = "\n"
                                if (commitEndline) {
                                    commitEndline = false
                                }
                                break
                            case '|':
                            case '~':
                            case '/':
                                tokenList.push(currentToken)
                                currentToken = new Token(char)
                                break
                            default:
                                tokenList.push(currentToken)
                                currentToken = new Token("text")
                                currentToken.content = currentToken.content.concat(char)
                        }
                        break
                    case '|':
                        switch (char){
                            case "|":
                                if (currentToken.content !== ""){
                                    currentToken.type = "text"
                                    tokenList.push(currentToken)
                                }
                                currentToken = new Token("||")
                                tokenList.push(currentToken)
                                currentToken = new Token("text")
                                break
                            default:
                                currentToken.type="text"
                                currentToken.content="|".concat(char)
                        }
                        break
                    case '~':
                        switch (char){
                            case "~":
                                if (currentToken.content !== ""){
                                    currentToken.type = "text"
                                    tokenList.push(currentToken)
                                }
                                currentToken = new Token("~~")
                                tokenList.push(currentToken)
                                currentToken = new Token("text")
                                break
                            default:
                                currentToken.type="text"
                                currentToken.content="~".concat(char)
                        }
                        break
                    case "'":
                        switch (char){
                            case "'":
                                if(!currentToken.props.level || currentToken.props.level<2){
                                    currentToken.props.level = currentToken.props.level ? currentToken.props.level+1 : 2
                                }else{
                                    currentToken = new Token("'''")
                                    currentToken.props.level=0
                                }
                                break
                            default:
                                currentToken.type = "text"
                                currentToken.content = currentToken.content.concat("'",char)
                        }
                        break
                    case "'''":
                        switch (char){
                            case "'":
                                if(currentToken.props.level<2){
                                    currentToken.props.level += 1
                                }else{
                                    tokenList.push(currentToken)
                                    currentToken = new Token("text")
                                }
                                break
                            default:
                                if(currentToken.props.level !==0){
                                    currentToken.content = currentToken.content.concat("'".repeat(currentToken.props.level))
                                    currentToken.props.level = 0
                                }
                                currentToken.content = currentToken.content.concat(char)
                        }
                        break
                    case "&":
                        if(str.slice(char_id, char_id+3) === "lt;"){
                            if (currentToken.content !== ""){
                                currentToken.type = "text"
                                tokenList.push(currentToken)
                            }
                            char_id+=2
                            currentToken = new Token("<")
                        }else{
                            currentToken.content = currentToken.content.concat(char)
                            currentToken.type = "text"
                        }
                        break
                    case "<":
                        switch (char){
                            case "$":
                                if (currentToken.content !== ""){
                                    currentToken.type = "text"
                                    tokenList.push(currentToken)
                                }
                                currentToken = new Token("color")
                                currentToken.props.color=""
                                break
                            default:
                                currentToken.type = "text"
                                currentToken.content = currentToken.content.concat("&lt;", char)
                        }
                        break
                    case "color":
                        switch (char){
                            case " ":
                                tokenList.push(currentToken)
                                currentToken = new Token("text")
                                break
                            case "\n":
                                tokenList.push(currentToken)
                                currentToken = new Token("newline")
                                break
                            default:
                                currentToken.props.color = currentToken.props.color.concat(char)
                        }
                        break
                    case "/":
                        switch (char){
                            case '>':
                                if (currentToken.content !== ""){
                                    currentToken.type = "text"
                                    tokenList.push(currentToken)
                                }
                                currentToken = new Token("/>")
                                tokenList.push(currentToken)
                                currentToken = new Token("text")
                                break
                            default:
                                currentToken.type = "text"
                                currentToken.content = currentToken.content.concat("/", char)
                        }
                        break
                }
                char_id += 1
            }
        }
        tokenList.push(currentToken)
        return tokenList;
    }

    render(tokens) {
        let result = ""
        for(let token_id = 0;  token_id < tokens.length; token_id+=1){
            const render = this.renderToken(tokens[token_id], token_id, tokens)
            token_id = render[1]
            result = result.concat(render[0])
        }
        return result;
    }

    renderToken(token, token_id, tokens){
        // console.log("render token",token,token_id,tokens)
        const old_id = token_id
        let content = ""
        switch(token.type) {
            case ">":
            case "start li":
                while (token_id + 1 < tokens.length && tokens[token_id + 1].type !== "endline") {
                    token_id += 1
                    const render = this.renderToken(tokens[token_id], token_id, tokens)
                    token_id = render[1]
                    content = content.concat(render[0])
                }
                token.content = content
                return [fillTemplate(this.HTML_equiv[token.type], token), token_id+1]
            case "*":
                // this is suboptimal because we're looking for same size closing
                // smth like *** a ** b * will not work as intended
                while (token_id + 1 < tokens.length && tokens[token_id + 1].type !== "endline") {
                    token_id += 1
                    if(tokens[token_id].type === "*" && tokens[token_id].props.level === token.props.level){
                        token.content = content
                        if (token.props.level % 2) {
                            if (token.props.level === 3) {
                                token.content = fillTemplate(this.HTML_equiv["**"], token)
                            }
                            return [fillTemplate(this.HTML_equiv["*"], token), token_id]
                        } else {
                            return [fillTemplate(this.HTML_equiv["**"], token), token_id]
                        }
                    }
                    const render = this.renderToken(tokens[token_id], token_id, tokens)
                    token_id = render[1]
                    content = content.concat(render[0])
                }
                token.content = "*".repeat(token.props.level)
                // should be optimized, because we just drop a part of the render here
                return [fillTemplate(this.HTML_equiv["text"], token), old_id]
            case "~~":
            case "||":
                while (token_id + 1 < tokens.length) {
                    token_id += 1
                    if(tokens[token_id].type === token.type){
                        token.content = content
                        return [fillTemplate(this.HTML_equiv[token.type], token), token_id]
                    }
                    const render = this.renderToken(tokens[token_id], token_id, tokens)
                    token_id = render[1]
                    content = content.concat(render[0])
                }
                token.content = token.type
                return [fillTemplate(this.HTML_equiv["text"], token), old_id]
            case "[":
                while (token_id + 1 < tokens.length) {
                    token_id += 1
                    if(tokens[token_id].type === "\n"){
                        break
                    }
                    if(tokens[token_id].type === "]"){
                        if(tokens[token_id+1].type === "(" && tokens[token_id+2].type === "link" && tokens[token_id+3].type === ")"){
                            token.content = content
                            token.props.link = tokens[token_id+2].content
                            return [fillTemplate(this.HTML_equiv["link"], token), token_id+3]
                        }else{
                            break
                        }
                    }
                    const render = this.renderToken(tokens[token_id], token_id, tokens)
                    token_id = render[1]
                    content = content.concat(render[0])
                }
                token.content = token.type
                return [fillTemplate(this.HTML_equiv["text"], token), old_id]
            case "color":
                while (token_id + 1 < tokens.length) {
                    token_id += 1
                    if(tokens[token_id].type === "/>"){
                        token.content = content
                        return [fillTemplate(this.HTML_equiv[token.type], token), token_id]
                    }
                    const render = this.renderToken(tokens[token_id], token_id, tokens)
                    token_id = render[1]
                    content = content.concat(render[0])
                }
                token.type="text"
                token.content = "<$"+token.props?.color
                return [fillTemplate(this.HTML_equiv[token.type], token), token_id]
            default:
                return [fillTemplate(this.HTML_equiv[token.type], token), token_id]
        }
    }
}

class Token{
    constructor(type) {
        this.type = type
        this.content=""
        this.props={}
    }
}

const fillTemplate = (template, vars = {}) => {
    const handler = new Function('vars', [
        'const tagged = ( ' + Object.keys(vars).join(', ') + ' ) =>',
        '`' + template + '`',
        'return tagged(...Object.values(vars))'
    ].join('\n'));
    const res = handler(vars)
    return res;
};
