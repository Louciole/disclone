export class Markdown {
    constructor() {
    }

    HTML_equiv = {
        "#":"<h${props.level}>${content}</h${props.level}>",
        "text":"${content}",
        "-":"<li>${content}</li>",
        "*":"<i>${content}</i>",
        "**":"<b>${content}</b>",
        ">":"<div class='answer'>${content}</div>",
        "'''":"<code>${content}</code>",
        "~~":"<div class='crossed'>${content}</div>",
        "||":"<div class='spoiler'>${content}</div>",
        "link":"<a href='${props.link}'>${content}</a>",
        "color":"<div style='color: ${props.color}'>${content}</div>"
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
                            tokenList.push(currentToken)
                            currentToken = new Token("text")
                            break
                        case '\n':
                            if (commitEndline){
                                commitEndline = false
                                tokenList.push(currentToken)
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
                        case ' ':
                            currentToken.content = currentToken.content.concat(char)
                            break
                        default:
                            currentToken.type="text"
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
        for(let token_id in tokens){
            const token = tokens[token_id]
            switch(token.type){
                case "start li":
                    result = result.concat(fillTemplate(this.HTML_equiv["-"],tokens[token_id+1]))
                    token_id+=1
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
