class Editor {
    constructor() {

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

    editBlock(blockId, newContent) {

    }

    onInput(event) {

    }
}
window.NoteEditor = Editor;