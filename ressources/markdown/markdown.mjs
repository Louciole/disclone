export class Markdown {
    constructor() {
    }

    tokenize(str) {
        const tokenList = []
        let currentToken = new Token("text")

        for (let char of str){
            switch (currentToken.type){
                case "text":
                    switch (char){
                        case '#':
                            if (currentToken.content !== ""){
                                tokenList.push(currentToken)
                            }
                            currentToken = new Token("#")
                            tokenList.push(currentToken)
                            currentToken = new Token("text")
                            break
                        case '-':
                            if (currentToken.content !== ""){
                                tokenList.push(currentToken)
                            }
                            currentToken = new Token("-")
                            tokenList.push(currentToken)
                            currentToken = new Token("text")
                            break
                        case '*':
                            if (currentToken.content !== ""){
                                tokenList.push(currentToken)
                            }
                            currentToken = new Token("*")
                            tokenList.push(currentToken)
                            currentToken = new Token("text")
                            break
                        case '\n':
                            tokenList.push(currentToken)
                            tokenList.push(new Token("break"))
                            currentToken = new Token("text")
                            break
                        default:
                            currentToken.content = currentToken.content.concat(char)
                    }
                    break
            }
        }
        tokenList.push(currentToken)
        return tokenList;
    }

    parse(tokens) {
        const result = tokens
        return result;
    }
}

class Token{
    constructor(type) {
        this.type = type
        this.content=""
    }

}