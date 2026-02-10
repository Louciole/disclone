import {Markdown} from "../markdown/markdown.mjs";

class Editor {
    constructor() {
        this.blocks = {}
        this.blocks[0]={"id":0, "type":"text", "content": "", position:0.1}
        this.draggedBlockId = null
    }

    createNote(title) {
        // this.createBlock("heading", "# " + title);
        this.createBlock("text", "put your content here...");
    }

    getSortedBlocks() {
        // Returns blocks sorted by position (primary) and id (secondary)
        return Object.values(this.blocks).sort((a, b) => {
            if (a.position === b.position) {
                return a.id - b.id
            }
            return a.position - b.position
        })
    }

    createBlock({type = "text", content = "", position = null, afterBlockId = null}) {
        this.DOMElement = document.getElementById("note-editor");
        const newBlockId = Object.keys(this.blocks).length // TODO should be given by backend or UUID

        // Calculate position
        if (position !== null && afterBlockId === null) {
            // Position was explicitly provided (from add button click)
            // Find the next block after this position
            const sortedBlocks = this.getSortedBlocks()
            const currentBlockIndex = sortedBlocks.findIndex(b => b.position === position)

            if (currentBlockIndex !== -1 && currentBlockIndex < sortedBlocks.length - 1) {
                // Insert between current and next
                const nextBlock = sortedBlocks[currentBlockIndex + 1]
                position = (position + nextBlock.position) / 2
            } else {
                // Add at the end
                position = position + 0.1
            }
        } else if (position === null) {
            // No position provided, add at the end
            const sortedBlocks = this.getSortedBlocks()
            if (sortedBlocks.length === 0) {
                position = 0.1
            } else {
                position = sortedBlocks[sortedBlocks.length - 1].position + 0.1
            }
        }

        this.blocks[newBlockId] = {"id":newBlockId, "type":type, "content": content, position: position};
        this.DOMElement.insertAdjacentHTML("beforeend", fillWith('note-block', [this.blocks[newBlockId]]));
        this.reorderDOM()
        this.checkAndNormalizePositions()
    }

    moveBlock(blockId, newPosition) {
        const block = this.blocks[blockId]
        if (!block) return

        block.position = newPosition
        this.reorderDOM()
        this.checkAndNormalizePositions()

        // TODO: sync to backend
        console.log("Block moved:", blockId, "new position:", newPosition)
    }

    reorderDOM() {
        // Reorder DOM elements based on sorted blocks
        const sortedBlocks = this.getSortedBlocks()
        const container = document.getElementById("note-editor")

        sortedBlocks.forEach(block => {
            const blockElement = container.querySelector(`[data-block-id="${block.id}"]`)
            if (blockElement) {
                container.appendChild(blockElement)
            }
        })
    }

    checkAndNormalizePositions() {
        // Check if positions are getting too close (< 0.0001 apart)
        const sortedBlocks = this.getSortedBlocks()
        let needsNormalization = false

        for (let i = 1; i < sortedBlocks.length; i++) {
            const diff = sortedBlocks[i].position - sortedBlocks[i-1].position
            if (diff < 0.0001 && diff > 0) {
                needsNormalization = true
                break
            }
        }

        if (needsNormalization) {
            this.normalizePositions()
        }
    }

    normalizePositions() {
        // Reset all positions to clean intervals
        const sortedBlocks = this.getSortedBlocks()
        sortedBlocks.forEach((block, index) => {
            block.position = (index + 1) * 0.1
        })
        console.log("Positions normalized")
    }

    deleteBlock(blockId) {

    }

    editBlock(block, newContent) {

    }

    // Drag and drop handlers
    onDragStart(blockId, event) {
        this.draggedBlockId = blockId
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", blockId)

        // Add dragging class
        const blockElement = event.currentTarget.closest('.block')
        blockElement.classList.add('dragging')
    }

    onDragEnd(blockId, event) {
        this.draggedBlockId = null
        this.cleanupDragState()
    }

    cleanupDragState() {
        // Remove all drag classes and drop indicators
        document.querySelectorAll('.block').forEach(block => {
            block.classList.remove('dragging')
        })
        document.querySelectorAll('.drop-indicator').forEach(el => el.remove())
    }

    onDragOver(blockId, event) {
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"

        if (this.draggedBlockId === null || this.draggedBlockId === blockId) return

        // Remove all existing drop indicators
        document.querySelectorAll('.drop-indicator').forEach(el => el.remove())

        // Calculate if we're above or below the target
        const blockElement = event.currentTarget.closest('.block')
        const rect = blockElement.getBoundingClientRect()
        const midpoint = rect.top + rect.height / 2
        const isAbove = event.clientY < midpoint

        // Check if this drop would result in no movement
        const sortedBlocks = this.getSortedBlocks()
        const draggedIndex = sortedBlocks.findIndex(b => b.id === this.draggedBlockId)
        const targetIndex = sortedBlocks.findIndex(b => b.id === blockId)

        // Don't show indicator if drop would result in same position
        if (isAbove) {
            // Dropping above target: would be pointless if target is immediately after dragged
            if (targetIndex === draggedIndex + 1) {
                return // No movement would occur
            }
        } else {
            // Dropping below target: would be pointless if target is immediately before dragged
            if (targetIndex === draggedIndex - 1) {
                return // No movement would occur
            }
        }

        // Create and position the drop indicator
        const indicator = document.createElement('div')
        indicator.className = 'drop-indicator'

        if (isAbove) {
            blockElement.parentNode.insertBefore(indicator, blockElement)
        } else {
            if (blockElement.nextSibling) {
                blockElement.parentNode.insertBefore(indicator, blockElement.nextSibling)
            } else {
                blockElement.parentNode.appendChild(indicator)
            }
        }
    }

    onDrop(blockId, event) {
        event.preventDefault()

        if (this.draggedBlockId === null || this.draggedBlockId === blockId) return

        const draggedBlock = this.blocks[this.draggedBlockId]
        const targetBlock = this.blocks[blockId]

        if (!draggedBlock || !targetBlock) return

        // Calculate new position based on drop location
        const sortedBlocks = this.getSortedBlocks()
        const draggedIndex = sortedBlocks.findIndex(b => b.id === this.draggedBlockId)
        const targetIndex = sortedBlocks.findIndex(b => b.id === blockId)

        // Determine if we're dropping above or below
        const blockElement = event.currentTarget.closest('.block')
        const rect = blockElement.getBoundingClientRect()
        const midpoint = rect.top + rect.height / 2
        const isAbove = event.clientY < midpoint

        // Validate that this drop would actually result in a position change
        if (isAbove && targetIndex === draggedIndex + 1) {
            // Dropping above the block immediately after = no change
            this.cleanupDragState()
            return
        }
        if (!isAbove && targetIndex === draggedIndex - 1) {
            // Dropping below the block immediately before = no change
            this.cleanupDragState()
            return
        }

        let newPosition
        if (isAbove) {
            // Insert above target
            if (targetIndex === 0) {
                newPosition = targetBlock.position / 2
            } else {
                const prevBlock = sortedBlocks[targetIndex - 1]
                newPosition = (prevBlock.position + targetBlock.position) / 2
            }
        } else {
            // Insert below target
            if (targetIndex === sortedBlocks.length - 1) {
                newPosition = targetBlock.position + 0.1
            } else {
                const nextBlock = sortedBlocks[targetIndex + 1]
                newPosition = (targetBlock.position + nextBlock.position) / 2
            }
        }

        this.moveBlock(this.draggedBlockId, newPosition)

        // Remove drag classes and drop indicators
        document.querySelectorAll('.block').forEach(block => {
            block.classList.remove('dragging')
        })
        document.querySelectorAll('.drop-indicator').forEach(el => el.remove())
    }

    onInput(blockId, event) {
        const block = this.blocks[blockId];
        if (block.type === "text") {
            const parser = new InitiatorParser(event.currentTarget.innerText)
            const parsedInitiator = parser.parse()
            if (parsedInitiator.initiator) {
                block.type = parsedInitiator.initiator.type
                block.content = parsedInitiator.content
                event.currentTarget.setAttribute("data-placeholder", blockTypes[block.type].placeholder)
                event.currentTarget.classList.add("note-"+block.type)
                event.currentTarget.innerText = block.content
                this.putCursorToEnd(event.currentTarget)
            }else{
                const cursorPosition = this.saveCursorPosition(event.currentTarget);
                block.content = event.currentTarget.innerText
                event.currentTarget.innerHTML = MDToPreview(event.currentTarget.innerText)
                this.restoreCursorPosition(event.currentTarget, cursorPosition);
            }
        }else{
            const cursorPosition = this.saveCursorPosition(event.currentTarget);
            block.content = event.currentTarget.innerText
            event.currentTarget.innerHTML = MDToPreview(event.currentTarget.innerText)
            this.restoreCursorPosition(event.currentTarget, cursorPosition);
        }

        if (block.content === "\n" || block.content.trim() === "") {
            block.content = ""
            event.currentTarget.innerText = ""
        }
        console.log("Input event:",this.blocks[blockId], event.currentTarget.innerText);
    }

    onKeyDown(blockId, event) {
        const block = this.blocks[blockId];

        if (block.type === "text") {
            return
        }

        if(event.key === "Backspace" && block.content === ""){
            block.content = blockTypes[block.type].initiator
            event.currentTarget.classList.remove("note-"+block.type)
            event.currentTarget.innerText = block.content

            this.putCursorToEnd(event.currentTarget)

            event.currentTarget.focus();

            block.type = "text"
            event.currentTarget.setAttribute("data-placeholder", blockTypes[block.type].placeholder)
            event.preventDefault();
        }else if(event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();

            // create a new block with the content after the cursor
            const cursorPosition = this.saveCursorPosition(event.currentTarget);
            const contentBeforeCursor = block.content.slice(0, cursorPosition);
            const contentAfterCursor = block.content.slice(cursorPosition);

            block.content = contentBeforeCursor
            event.currentTarget.innerText = block.content

            this.createBlock({type: "text", content: contentAfterCursor, afterBlockId: blockId})
            // put cursor to end of new block
            const newBlockElement = document.querySelector(`[data-block-id="${Object.keys(this.blocks).length - 1}"] .content`)
            this.putCursorToEnd(newBlockElement)
            newBlockElement.focus();

        }
    }

    onBlur(blockId, event) {
        // switching from editor preview to rendered view
        const block = this.blocks[blockId];
        event.currentTarget.innerHTML = MDToRender(block.content)
    }

    onFocus(blockId, event) {
        // switching from rendered view to editor preview
        const block = this.blocks[blockId];
        event.currentTarget.innerHTML = MDToPreview(block.content)
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
        // this.content = content.trimEnd()
        this.possibleInitiators = initiators
    }

    parse(){
        console.log("Parsing initiator for content:'"+ this.content+"'")
        for(let i = 0; i < this.content.length; i+=1) {

            const char = this.content[i]
            let newPossibleInitiators = []
            for (let j = 0; j < this.possibleInitiators.length; j += 1) {
                const initiator = this.possibleInitiators[j]
                if (char === initiator.initiator[i]) {
                    newPossibleInitiators.push(initiator)
                }
            }

            console.log("char", char, "possible initiators", newPossibleInitiators)
            if (newPossibleInitiators.length === 0) {
                // if no initiator check exact match with latests possible initiators
                if (this.possibleInitiators.length > 0 && i === this.possibleInitiators[0].initiator.length) {
                    return {initiator: this.possibleInitiators[0], content: this.stripContent(this.content.slice(i))}
                }
                return {initiator: null, content: ""}
            }else if (newPossibleInitiators.length === 1){
                // Check if any of the possible initiators is fully matched
                    const initiator = newPossibleInitiators[0]
                    if (this.content.startsWith(initiator.initiator)) {
                        return {initiator: newPossibleInitiators[0], content: this.stripContent(this.content.slice(initiator.initiator.length))}
                    }
            }
            this.possibleInitiators = newPossibleInitiators
        }

        return {initiator: null, content: ""}
    }

    stripContent(content){
        if (content.startsWith(' ') || content.startsWith(' ')) {
            content = content.slice(1)
        }
        if (content.endsWith(' ') || content.endsWith(' ')) {
            content = content.slice(0, -1)
        }
        return content
    }
}

const preview_equiv = {
    "#":"${'#'.repeat(props.level)}${content}",
    "text":"${content}",
    "start li":"-${content}",
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
    "#":"${props.level*'#'}${content}",
    "text":"${content}",
    "start li":"<li>${content}</li>",
    "*":"<i>${content}</i>",
    "**":"<b>${content}</b>",
    ">":"<div class='answer'>${content}</div>",
    "'''":"<div class='code-wrapper'><code>${content}</code><div class='circle grey' onclick='copyCode(event)'></div></div>",
    "~~":"<span class='crossed'>${content}</span>",
    "||":"<span class='spoiler' onclick='showSpoiler(event)'>${content}</span>",
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
