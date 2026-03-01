import {Markdown} from "../markdown/markdown.mjs";
import {xhr} from "../framework/templating.mjs";
import {} from "./synapse.mjs";
import {normalizeIfNeeded} from "../drag.mjs";
import {
    registerFunction,
    evaluateText
} from "./formulaEngine.mjs";
import {mountDatabase} from "./database.mjs";

class Editor {
    constructor() {
        if (Object.keys(global.notes[global.state.activeChan.id].blocks).length !== 0) {
            this.blocks = global.notes[global.state.activeChan.id].blocks
        }else{
            this.blocks = {}
            this.createBlock({},false)
        }
        this.draggedBlockId = null

        // After DOM is rendered, re-mount interactive blocks (database, synapse, etc.)
        requestAnimationFrame(() => this._mountInteractiveBlocks())
    }

    _mountInteractiveBlocks() {
        for (const blockId in this.blocks) {
            const block = this.blocks[blockId]
            if (blockTypes[block.type] && blockTypes[block.type].template) {
                const blockEl = document.querySelector(`[data-block-id="${block.uuid}"] .content`)
                if (blockEl) {
                    this.convertBlock(blockEl, blockId)
                }
            }
        }
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

    createBlock({type = "text", content = "", position = null, afterBlockId = null}, addDom = true) {
        this.DOMElement = document.getElementById("note-editor");
        // generate uuid for block id
        const newBlockId = crypto.randomUUID()

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

        this.blocks[newBlockId] = {"uuid":newBlockId, "type":type, "content": content, position: position};

        if (addDom){
            this.DOMElement.insertAdjacentHTML("beforeend", fillWith('note-block', [this.blocks[newBlockId]]));
            this.reorderDOM()
        }

        this.checkAndNormalizePositions()

        const onload = function () {

        }
        xhr("/saveBlock?channel="+global.state.activeChan.id+"&block="+encodeURIComponent(JSON.stringify(this.blocks[newBlockId]))+"&op=create", onload)
    }

    moveBlock(blockId, newPosition) {
        const block = this.blocks[blockId]
        if (!block) return

        block.position = newPosition
        this.reorderDOM()
        this.checkAndNormalizePositions()

        this.saveBlock(block.uuid)

        console.log("Block moved:", blockId, "new position:", newPosition)
    }

    reorderDOM() {
        // Reorder DOM elements based on sorted blocks
        const sortedBlocks = this.getSortedBlocks()
        const container = document.getElementById("note-editor")

        sortedBlocks.forEach(block => {
            const blockElement = container.querySelector(`[data-block-id="${block.uuid}"]`)
            if (blockElement) {
                container.appendChild(blockElement)
            }
        })
    }

    checkAndNormalizePositions() {
        const blocks = Object.values(this.blocks)
        normalizeIfNeeded(blocks, 'position', (item) => {
            this.saveBlock(item.uuid)
        })
    }

    deleteBlock(blockId) {
        delete this.blocks[blockId]
        delete global.notes[global.state.activeChan.id].blocks[blockId]
        const blockElement = document.querySelector(`[data-block-id="${blockId}"]`)
        if (blockElement) {
            blockElement.remove()
        }

        const onload = function () {

        }
        xhr("/saveBlock?channel="+global.state.activeChan.id+"&block="+ JSON.stringify({uuid:blockId})+"&op=delete", onload)

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
        const draggedIndex = sortedBlocks.findIndex(b => b.uuid === this.draggedBlockId)
        const targetIndex = sortedBlocks.findIndex(b => b.uuid === blockId)

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
        const draggedIndex = sortedBlocks.findIndex(b => b.uuid === this.draggedBlockId)
        const targetIndex = sortedBlocks.findIndex(b => b.uuid === blockId)

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
                if (blockTypes[block.type].template) {
                    this.convertBlock(event.currentTarget, blockId)
                    return // block is now interactive, don't touch its DOM further
                }
                if (blockTypes[block.type].placeholder) {
                    event.currentTarget.setAttribute("data-placeholder", blockTypes[block.type].placeholder)
                }
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

    convertBlock(target, blockId, newType = "interactiveElement") {
        const block = this.blocks[blockId]
        if(newType === "interactiveElement"){
            target.oninput = ""
            target.onkeydown = ""
            target.onblur = ""
            target.onfocus = ""
            target.contenteditable = "false"

            // Persist the block type change synchronously so server-side
            // resources (e.g. note_database) are created before we try to load them
            xhr("/saveBlock?channel="+global.state.activeChan.id+"&block="+encodeURIComponent(JSON.stringify(block))+"&op=edit", ()=>{}, "GET", false)

            target.innerHTML = blockTypes[block.type].template(block)

            // Mount database components
            if (block.type === "database") {
                const channelId = global.state.activeChan.id
                const containerEl = target.querySelector('.note-database')
                if (containerEl) {
                    mountDatabase(block.uuid, channelId, containerEl)
                }
            }
        }
    }

    onKeyDown(blockId, event) {
        const block = this.blocks[blockId];

        if (block.type === "text") {
            if (event.key === "Backspace" && block.content === "" ) {
                this.deleteBlock(blockId)
            }
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
        this.saveBlock(blockId)
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

    saveBlock(blockId){
        const block = this.blocks[blockId];

        const onSaved = function () {

        }

        xhr("/saveBlock?channel="+global.state.activeChan.id+"&block="+encodeURIComponent(JSON.stringify(block))+"&op=edit", onSaved)
    }

}
window.NoteEditor = Editor;

const blockTypes = {
    "text": {placeholder: "Press '/' for commands"},
    "heading1": {placeholder: "Heading 1", initiator: "#"},
    "heading2": {placeholder: "Heading 2", initiator: "##"},
    "heading3": {placeholder: "Heading 3", initiator: "###"},
    "small": {placeholder: "small text", initiator: "-#"},
    "showcase": {placeholder: "insert metric", initiator: "/showcase"},
    "synapse": {template: (block)=>{return getTemplate("synapse-root")}, initiator: "/synapse"},
    "database": {template: (block)=>{return fillWith("database-root", [block])}, initiator: "/database", placeholder: "database"},
}

const initiators = [
    {"type":"heading1", "initiator":"#"},
    {"type":"heading2", "initiator":"##"},
    {"type":"heading3", "initiator":"###"},
    {"type":"small", "initiator":"-#"},
    {"type":"showcase", "initiator":"/showcase"},
    {"type":"synapse", "initiator":"/synapse"},
    {"type":"database", "initiator":"/database"},
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
    "start li":"-${content}\n",
    "*":"<span class='preview-will-be-hidden'>*</span><i class='i'>${content}</i><span class='preview-will-be-hidden'>*</span>",
    "**":"<span class='preview-will-be-hidden'>**</span><b>${content}</b><span class='preview-will-be-hidden'>**</span>",
    ">":"<span class='answer'>${content}</span>",
    "'''":"<div class='code-wrapper'><code>${content}</code><div class='circle grey' onclick='copyCode(event)'></div></div>",
    "~~":"<span class='preview-will-be-hidden'>~~</span><span class='crossed'>${content}</span><span class='preview-will-be-hidden'>~~</span>",
    "||":"<span class='preview-will-be-hidden'>||</span><span class='spoiler' onclick='showSpoiler(event)'>${content}</span><span class='preview-will-be-hidden'>||</span>",
    "link":"<a href='${props.link}' target='_blank'>${content}</a>",
    "color":"<span class='color' style='color: ${props.color}'>${content}</span>",
    "-#":"-# <span class='small'>${content}</span>",
    "mention_user":"${content}",
    "mention_role":"${content}",
    "mention_channel":"${content}",
    "mention_everyone":"<span class='mention mention-everyone'>@everyone</span>",
    "mention_here":"<span class='mention mention-here'>@here</span>",
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
    "mention_user":"${content}",
    "mention_role":"${content}",
    "mention_channel":"${content}",
    "mention_everyone":"<span class='mention mention-everyone'>@everyone</span>",
    "mention_here":"<span class='mention mention-here'>@here</span>",
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


    //rendering MD
    const engine = new Markdown()
    const tokens = engine.tokenize(text)
    console.log("text",text,"tokens",tokens)
    const rendered = engine.render(tokens, render_equiv)

    //evaluating functions
    return evaluateText(rendered)
}
window.MDToRender = MDToRender

function func_dashboard(dashboardName){
    const onload = function(){
    }

    const request = xhr("getDashboard?server="+global.state.currentServer.id+"&service_id="+dashboardName, onload, "GET", false)

    if (request.status !== 200) {
        return "ERROR loading dashboard: "+request.status
    }

    const json = JSON.parse(request.responseText)
    return json.users.count
}

function func_progress(data, goal, type="linear"){
    if (type === "linear") {
        return fillWith("block-progress-line", [{data: data, goal: goal}])
    }else if (type === "circular") {
        return fillWith("block-progress-circle", [{data: data, goal: goal}])
    }

    return "Unknown progress type '"+type+"'"
}

// Register app-specific functions into the shared formula engine
registerFunction('DASHBOARD', func_dashboard)
registerFunction('PROGRESS', func_progress)
