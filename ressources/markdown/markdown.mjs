// This in absolutely no spec, it comes exclusively from my deranged mind

export class Markdown {
    constructor() {
    }

    //TODO
    // * ** ''' link color ~~ ||
    HTML_equiv = {
        "#":"<h${props.level}><xmp>${content}</xmp></h${props.level}>",
        "text":"<xmp>${content}</xmp>",
        "start li":"<li>${content}</li>",
        "*":"<i>${content}</i>",
        "**":"<b>${content}</b>",
        ">":"<div class='answer'><xmp>${content}</xmp></div>",
        "'''":"<code>${content}</code>",
        "~~":"<div class='crossed'>${content}</div>",
        "||":"<div class='spoiler'>${content}</div>",
        "link":"<a href='${props.link}'><xmp>${content}<xmp></a>",
        "color":"<div style='color: ${props.color}'>${content}</div>",
        "endline":"\n",
        "newline":""
    }

    tokenize(str) {
        const tokenList = []
        let currentToken = new Token("newline")
        let commitEndline = false

        for (let char of str){
            switch (currentToken.type){
                case "text":
                    switch (char){
                        case '*':
                            if (currentToken.content !== ""){
                                tokenList.push(currentToken)
                            }
                            currentToken = new Token("*")
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
                        case ' ':
                            currentToken.content = currentToken.content.concat(char)
                            break
                        default:
                            currentToken.type="text"
                            currentToken.content = currentToken.content.concat(char)
                    }
                    break
                case "*":
                    switch (char){
                        case "*":
                            currentToken.type="**"
                            tokenList.push(currentToken)
                            currentToken = new Token("text")
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
                            tokenList.push(currentToken)
                            currentToken = new Token("text")
                            currentToken.content = currentToken.content.concat(char)
                    }
                    break
            }
        }
        tokenList.push(currentToken)
        return tokenList;
    }

    render(tokens) {
        let result = ""
        for(let token_id = 0;  token_id < tokens.length; token_id+=1){
            const token = tokens[token_id]
            let content = ""
            switch(token.type){
                case ">":
                case "start li":
                    while (token_id+1<tokens.length && tokens[token_id+1].type !== "endline"){
                        token_id+=1
                        content = content.concat(fillTemplate(this.HTML_equiv[tokens[token_id].type],tokens[token_id]))
                    }
                    token.content = content
                    result = result.concat(fillTemplate(this.HTML_equiv[token.type],token))
                    break
                case "**":
                    while (tokens[token_id+1].type !== "endline"){
                        token_id+=1
                        content = content.concat(fillTemplate(this.HTML_equiv[tokens[token_id].type],tokens[token_id]))
                    }
                    token.content = content
                    result = result.concat(fillTemplate(this.HTML_equiv["-"],token))
                    break
                default:
                    result = result.concat(fillTemplate(this.HTML_equiv[token.type],token))
            }

        }
        console.log("result : ",result)
        return result;
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
