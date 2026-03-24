import {xhr} from "../framework/templating.mjs";
import {
    evaluateFormula,
    colIndexToLetter,
    colLetterToIndex,
} from "./formulaEngine.mjs";

if (!global.state.spreadsheetViews) global.state.spreadsheetViews = {}

export class SpreadsheetView {
    constructor(blockUuid, channelId, containerEl) {
        this.blockUuid = blockUuid
        this.channelId = channelId
        this.containerEl = containerEl

        this.rows = 3
        this.cols = 2
        this.cells = {} // { "A1": "value", "B2": "=SUM(A1:A2)" }
        this.evaluatedCells = {} // { "A1": "computed_value" }

        this.editingCell = null // e.g., "A1"
        this.evaluating = new Set() // for cycle detection

        this.load()
    }

    load() {
        const request = xhr(
            "get_spreadsheet_content?channel=" + this.channelId + "&block_uuid=" + this.blockUuid,
            () => {}, "GET", false
        )

        if (request.status !== 200) {
            this.containerEl.innerHTML = '<div class="sheet-error">Failed to load spreadsheet</div>'
            return
        }

        const data = JSON.parse(request.responseText)
        this.id = data.id
        this.rows = data.rows || 10
        this.cols = data.cols || 5
        this.cells = data.cells || {}

        this.evaluateAll()
        const container = this.containerEl.querySelector('.spreadsheet-view') || this.containerEl
        container.innerHTML = this.render()
    }

    // ─── Evaluation ───────────────────────────────────────────────────

    _resolveCell(ref, dbName) {
        if (dbName) {
            // Future extension: resolving cross-block DB references inside a spreadsheet
            return ""
        }

        if (this.evaluating.has(ref)) {
            return "#CYCLE!"
        }

        if (this.evaluatedCells[ref] !== undefined) {
            return this.evaluatedCells[ref]
        }

        const raw = this.cells[ref]
        if (raw === undefined || raw === null) return ""

        // If it looks like a formula (starts with =) or brace syntax, evaluate it
        if (String(raw).startsWith('=') || String(raw).startsWith('{{')) {
            this.evaluating.add(ref)
            try {
                const result = evaluateFormula(String(raw), (r, db) => this._resolveCell(r, db))
                this.evaluatedCells[ref] = result
                this.evaluating.delete(ref)
                return result
            } catch (e) {
                this.evaluating.delete(ref)
                return "#ERROR"
            }
        }

        // Just text or number
        const num = parseFloat(raw)
        return isNaN(num) ? raw : num
    }

    evaluateAll() {
        this.evaluatedCells = {}
        this.evaluating.clear()

        for (const ref in this.cells) {
            if (this.evaluatedCells[ref] === undefined) {
                this._resolveCell(ref)
            }
        }
    }

    // ─── Rendering ────────────────────────────────────────────────────

    render() {
        let html = '<div class="spreadsheet-wrapper"><table class="sheet-table">'

        // Header row (A, B, C...)
        html += '<thead><tr><th class="sheet-corner"></th>'
        for (let c = 0; c < this.cols; c++) {
            html += '<th>' + colIndexToLetter(c) + '</th>'
        }
        html += '<th class="sheet-add-col" onclick="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].addCol()">+</th>'
        html += '</tr></thead>'

        html += '<tbody>'
        for (let r = 1; r <= this.rows; r++) {
            html += '<tr>'
            html += '<td class="sheet-row-header">' + r + '</td>'
            for (let c = 0; c < this.cols; c++) {
                const ref = colIndexToLetter(c) + r
                html += '<td class="sheet-cell ' + (this.editingCell === ref ? 'editing' : '') + '" '
                html += 'onclick="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].startEdit(\'' + ref + '\')">'
                
                if (this.editingCell === ref) {
                    html += '<input id="sheet-input-' + this.blockUuid + '" type="text" value="' + this._esc(this.cells[ref] || '') + '" '
                    html += 'onblur="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].saveEdit(\'' + ref + '\', this.value)" '
                    html += 'onkeydown="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].handleKeyDown(event, \'' + ref + '\')" />'
                } else {
                    const val = this.evaluatedCells[ref] !== undefined ? this.evaluatedCells[ref] : (this.cells[ref] || '')
                    html += '<div class="sheet-cell-content" title="' + this._esc(this.cells[ref] || '') + '">' + this._esc(val) + '</div>'
                }
                
                html += '</td>'
            }
            html += '<td></td></tr>'
        }
        
        html += '<tr><td class="sheet-add-row" colspan="' + (this.cols + 2) + '" '
        html += 'onclick="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].addRow()">+ Add Row</td></tr>'

        html += '</tbody></table></div>'

        return html
    }

    _esc(str) {
        if (str === null || str === undefined) return ''
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    // ─── Interaction ──────────────────────────────────────────────────

    startEdit(ref) {
        if (this.editingCell === ref) return
        this.editingCell = ref
        // trigger render update through the framework or manually update DOM if needed
        // since we are within a data-content attribute, re-rendering might need to trigger the parent
        const container = document.querySelector(`[data-block-id="${this.blockUuid}"] .spreadsheet-view`)
        if (container) {
            container.innerHTML = this.render()
            const input = document.getElementById('sheet-input-' + this.blockUuid)
            if (input) {
                input.focus()
                // Move cursor to end
                input.selectionStart = input.selectionEnd = input.value.length
            }
        }
    }

    saveEdit(ref, value) {
        if (this.cells[ref] === value) {
            this.editingCell = null
            const container = document.querySelector(`[data-block-id="${this.blockUuid}"] .spreadsheet-view`)
            if(container) container.innerHTML = this.render()
            return
        }

        const persistedValue = value.trim() === '' ? '' : value

        if (persistedValue === '') {
            delete this.cells[ref]
        } else {
            this.cells[ref] = persistedValue
        }

        this.editingCell = null
        this.evaluateAll()
        const container = document.querySelector(`[data-block-id="${this.blockUuid}"] .spreadsheet-view`)
        if(container) container.innerHTML = this.render()

        // Persist
        xhr("/save_spreadsheet_cell?channel=" + this.channelId
            + "&spreadsheet_id=" + this.id
            + "&cell_id=" + encodeURIComponent(ref)
            + "&value=" + encodeURIComponent(persistedValue), () => {}, "POST")
    }

    handleKeyDown(event, ref) {
        if (event.key === 'Enter') {
            event.preventDefault()
            const match = ref.match(/^([A-Z]+)(\d+)$/)
            if (match) {
                const r = parseInt(match[2])
                if (r < this.rows) {
                    const nextRef = match[1] + (r + 1)
                    this.saveEdit(ref, event.target.value)
                    this.startEdit(nextRef)
                } else {
                    this.saveEdit(ref, event.target.value)
                }
            }
        } else if (event.key === 'Tab') {
            event.preventDefault()
            const match = ref.match(/^([A-Z]+)(\d+)$/)
            if (match) {
                let c = colLetterToIndex(match[1])
                if (event.shiftKey) {
                    if (c > 0) {
                        const nextRef = colIndexToLetter(c - 1) + match[2]
                        this.saveEdit(ref, event.target.value)
                        this.startEdit(nextRef)
                    }
                } else {
                    if (c < this.cols - 1) {
                        const nextRef = colIndexToLetter(c + 1) + match[2]
                        this.saveEdit(ref, event.target.value)
                        this.startEdit(nextRef)
                    }
                }
            }
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
             // Only navigate if we are at the end/beginning of the input to avoid breaking text navigation
             const isAtEnd = event.target.selectionStart === event.target.value.length
             const isAtStart = event.target.selectionStart === 0

             if ((event.key === 'ArrowDown' && isAtEnd) || (event.key === 'ArrowUp' && isAtStart)) {
                 event.preventDefault()
                 const match = ref.match(/^([A-Z]+)(\d+)$/)
                 if (match) {
                     const r = parseInt(match[2])
                     if (event.key === 'ArrowDown' && r < this.rows) {
                         this.saveEdit(ref, event.target.value)
                         this.startEdit(match[1] + (r + 1))
                     } else if (event.key === 'ArrowUp' && r > 1) {
                         this.saveEdit(ref, event.target.value)
                         this.startEdit(match[1] + (r - 1))
                     }
                 }
             }
        }
    }

    addRow() {
        this.rows += 1
        const container = document.querySelector(`[data-block-id="${this.blockUuid}"] .spreadsheet-view`)
        if(container) container.innerHTML = this.render()
        this._saveDimensions()
    }

    addCol() {
        this.cols += 1
        const container = document.querySelector(`[data-block-id="${this.blockUuid}"] .spreadsheet-view`)
        if(container) container.innerHTML = this.render()
        this._saveDimensions()
    }

    _saveDimensions() {
        xhr("/save_spreadsheet?channel=" + this.channelId
            + "&spreadsheet_id=" + this.id
            + "&data=" + encodeURIComponent(JSON.stringify({rows: this.rows, cols: this.cols})),
            () => {}, "POST")
    }
}

export function mountSpreadsheet(blockUuid, channelId, containerEl) {
    const view = new SpreadsheetView(blockUuid, channelId, containerEl)
    global.state.spreadsheetViews[blockUuid] = view
    return view
}