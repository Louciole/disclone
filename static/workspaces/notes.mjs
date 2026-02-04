import {Markdown} from "../markdown/markdown.mjs";

class Editor {
    constructor() {
        this.blocks = {}
        this.blocks[0]={"id":0, "type":"text", "content": ""}
    }

    createNote(title) {
        // this.createBlock("heading", "# " + title);
        this.createBlock("text", "put your content here...");
    }

    createBlock(type, content) {

    }

    moveBlock(blockId, newPosition) {

    }

    deleteBlock(blockId) {

    }

    editBlock(block, newContent) {

    }

    onInput(blockId, event) {
        const block = this.blocks[blockId];
        if (block.type === "text") {
            const parser = new InitiatorParser(event.currentTarget.textContent)
            const parsedInitiator = parser.parse()
            if (parsedInitiator.initiator) {
                block.type = parsedInitiator.initiator.type
                block.content = parsedInitiator.content
                event.currentTarget.setAttribute("data-placeholder", blockTypes[block.type].placeholder)
                event.currentTarget.classList.add("note-"+block.type)
                event.currentTarget.textContent = block.content
            }else{
                block.content = event.currentTarget.textContent
                event.currentTarget.innerHTML = MDToPreview(event.currentTarget.textContent)
                this.putCursorToEnd(event.currentTarget) // TODO put cursor to last position instead of end
            }
        }else{
            const cursorPosition = this.saveCursorPosition(event.currentTarget);
            block.content = event.currentTarget.textContent
            event.currentTarget.innerHTML = MDToPreview(event.currentTarget.textContent)
            this.restoreCursorPosition(event.currentTarget, cursorPosition);
        }

        console.log("Input event:",this.blocks[blockId], event.currentTarget.textContent);
    }

    onKeyDown(blockId, event) {
        const block = this.blocks[blockId];

        if (block.type === "text") {
            return
        }

        if(event.key === "Backspace" && block.content === ""){
            block.content = blockTypes[block.type].initiator
            event.currentTarget.classList.remove("note-"+block.type)
            event.currentTarget.textContent = block.content

            this.putCursorToEnd(event.currentTarget)

            event.currentTarget.focus();

            block.type = "text"
            event.currentTarget.setAttribute("data-placeholder", blockTypes[block.type].placeholder)
            event.preventDefault();
        }
    }

    onBlur(blockId, event) {
        // switching from editor preview to rendered view

    }

    onFocus(blockId, event) {
        // switching from rendered view to editor preview

    }

    putCursorToEnd(element) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    saveCursorPosition(element) {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return null;

        const range = selection.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(element);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        const caretOffset = preCaretRange.toString().length;

        return caretOffset;
    }

    restoreCursorPosition(element, caretOffset) {
        if (caretOffset === null) return;

        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(element, 0);
        range.collapse(true);

        let currentOffset = 0;
        const nodeIterator = document.createNodeIterator(
            element,
            NodeFilter.SHOW_TEXT,
            null
        );

        let currentNode;
        while ((currentNode = nodeIterator.nextNode())) {
            const nodeLength = currentNode.textContent.length;
            if (currentOffset + nodeLength >= caretOffset) {
                range.setStart(currentNode, caretOffset - currentOffset);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
            currentOffset += nodeLength;
        }

        // If we couldn't find the exact position, put cursor at end
        this.putCursorToEnd(element);
    }

}
window.NoteEditor = Editor;

const blockTypes = {
    "text": {placeholder: "Press '/' for commands"},
    "heading1": {placeholder: "Heading 1", initiator: "#"},
    "heading2": {placeholder: "Heading 2", initiator: "##"},
    "heading3": {placeholder: "Heading 3", initiator: "###"},
    "small": {placeholder: "small text", initiator: "-#"},
}

const initiators = [
{"type":"heading1", "initiator":"#"},
{"type":"heading2", "initiator":"##"},
{"type":"heading3", "initiator":"###"},
{"type":"small", "initiator":"-#"},
]


class InitiatorParser{
    constructor(content){
        this.content = content
        this.possibleInitiators = initiators
    }

    parse(){
        for(let i = 0; i < this.content.length; i+=1) {

            const char = this.content[i]
            let newPossibleInitiators = []
            for (let j = 0; j < this.possibleInitiators.length; j += 1) {
                const initiator = this.possibleInitiators[j]
                if (char === initiator.initiator[i]) {
                    newPossibleInitiators.push(initiator)
                }
            }

            if (newPossibleInitiators.length === 0) {
                // if no indicator check exact match with latests possible initiators
                if (this.possibleInitiators.length > 0 && i === this.possibleInitiators[0].initiator.length) {
                    return {initiator: this.possibleInitiators[0], content: this.stripContent(this.content.slice(i))}
                }
                return {initiator: null, content: ""}
            } else if (newPossibleInitiators.length === 1 && i + 1 === newPossibleInitiators[0].initiator.length) {
                // Only return when we've matched the complete initiator
                return {initiator: newPossibleInitiators[0], content: this.stripContent(this.content.slice(i+1))}
            }
            this.possibleInitiators = newPossibleInitiators
        }

        return {initiator: null, content: ""}
    }

    stripContent(content){
        if (content.startsWith(' ') || content.startsWith(' ')) {
            content = content.slice(1)
        }
        return content
    }
}

const preview_equiv = {
    "#":"${'#'.repeat(props.level)} ${content}",
    "text":"${content}",
    "start li":"<li>${content}</li>",
    "*":"<span class='preview-will-be-hidden'>*</span><i class='i'>${content}</i><span class='preview-will-be-hidden'>*</span>",
    "**":"<span class='preview-will-be-hidden'>**</span><b>${content}</b><span class='preview-will-be-hidden'>**</span>",
    ">":"<span class='answer'>${content}</span>",
    "'''":"<div class='code-wrapper'><code>${content}</code><div class='circle grey' onclick='copyCode(event)'></div></div>",
    "~~":"<span class='preview-will-be-hidden'>~~</span><span class='crossed'>${content}</span><span class='preview-will-be-hidden'>~~</span>",
    "||":"<span class='preview-will-be-hidden'>||</span><span class='spoiler' onclick='showSpoiler(event)'>${content}</span><span class='preview-will-be-hidden'>||</span>",
    "link":"<a href='${props.link}' target='_blank'>${content}</a>",
    "color":"<span class='color' style='color: ${props.color}'>${content}</span>",
    "-#":"-# <span class='small'>${content}</span>",
    "endline":"\n",
    "newline":"${content}",
    ")":")",
    "'":"'",
    "(":"(",
    "/>":"/>",
    "]":"]",
    "/":"${content}/"
}

function MDToPreview(text){
    const engine = new Markdown()
    const tokens = engine.tokenize(text)
    console.log("text",text,"tokens",tokens)
    return engine.render(tokens, preview_equiv)
}

const render_equiv = {
    "#":"${props.level*'#'} ${content}",
    "text":"${content}",
    "start li":"<li>${content}</li>",
    "*":"<span class='preview-will-be-hidden'>*</span><span class='i'>${content}</span><span class='preview-will-be-hidden'>*</span>",
    "**":"<span class='preview-will-be-hidden'>**</span><span class='b'>${content}</span><span class='preview-will-be-hidden'>**</span>",
    ">":"<div class='answer'>${content}</div>",
    "'''":"<div class='code-wrapper'><code>${content}</code><div class='circle grey' onclick='copyCode(event)'></div></div>",
    "~~":"<div class='crossed'>${content}</div>",
    "||":"<div class='spoiler' onclick='showSpoiler(event)'>${content}</div>",
    "link":"<a href='${props.link}' target='_blank'>${content}</a>",
    "color":"<span class='color' style='color: ${props.color}'>${content}</span>",
    "-#":"<span class='small'>${content}</span>",
    "endline":"\n",
    "newline":"${content}",
    ")":")",
    "'":"'",
    "(":"(",
    "/>":"/>",
    "]":"]",
    "/":"${content}/"
}

function MDToRender(text){
    const engine = new Markdown()
    const tokens = engine.tokenize(text)
    console.log("text",text,"tokens",tokens)
    return engine.render(tokens, render_equiv)
}
