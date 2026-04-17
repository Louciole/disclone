import {xhr} from "../framework/templating.mjs";
import {
    evaluateFormula,
    colIndexToLetter,
    colLetterToIndex,
    expandRange,
} from "./formulaEngine.mjs";

if (!global.state.spreadsheetViews) global.state.spreadsheetViews = {}
if (!global.state.spreadsheetSnapshots) global.state.spreadsheetSnapshots = {}
if (!global.state.activeSpreadsheetFormulaEditor) global.state.activeSpreadsheetFormulaEditor = null
if (!global.state.spreadsheetSnapshotTtlMs) global.state.spreadsheetSnapshotTtlMs = 10000
if (!global.state.spreadsheetGlobalMouseCaptureBound) global.state.spreadsheetGlobalMouseCaptureBound = false

function _eventTargetElement(target) {
    if (!target) return null
    if (target.nodeType === 1) return target
    return target.parentElement || null
}

function _findActiveFormulaEditorView() {
    const active = global.state.activeSpreadsheetFormulaEditor
    if (active && active.blockUuid) {
        const source = global.state.spreadsheetViews?.[active.blockUuid]
        if (source && source.editingCell && source._isFormulaEditing()) return source
    }

    const views = global.state.spreadsheetViews || {}
    for (const blockUuid in views) {
        const view = views[blockUuid]
        if (view && view.editingCell && view._isFormulaEditing()) {
            global.state.activeSpreadsheetFormulaEditor = {
                blockUuid: view.blockUuid,
                cellRef: view.editingCell,
            }
            return view
        }
    }

    return null
}

function bindGlobalSpreadsheetMouseCapture() {
    if (global.state.spreadsheetGlobalMouseCaptureBound) return
    if (typeof document === 'undefined') return

    const captureRefPick = (event) => {
        const sourceView = _findActiveFormulaEditorView()
        if (!sourceView) return

        const targetEl = _eventTargetElement(event.target)
        if (!targetEl) return
        const cellEl = targetEl.closest('.sheet-cell[data-ref]')
        if (!cellEl) return

        const blockEl = cellEl.closest('[data-block-id]')
        const targetBlockUuid = blockEl ? blockEl.getAttribute('data-block-id') : null
        const targetRef = cellEl.getAttribute('data-ref')
        if (!targetBlockUuid || !targetRef) return

        if (targetBlockUuid === sourceView.blockUuid && targetRef === sourceView.editingCell) return

        sourceView.suppressBlurSave = true
        event.preventDefault()
        event.stopPropagation()
        sourceView.handleFormulaCellPick(targetRef, targetBlockUuid)
        setTimeout(() => {
            sourceView.suppressBlurSave = false
        }, 0)
    }

    document.addEventListener('pointerdown', captureRefPick, true)
    document.addEventListener('mousedown', captureRefPick, true)

    global.state.spreadsheetGlobalMouseCaptureBound = true
}

bindGlobalSpreadsheetMouseCapture()

export function computeResizedWidth(startWidth, deltaX, minWidth = 80, maxWidth = 800) {
    const width = Math.round(Number(startWidth || 0) + Number(deltaX || 0))
    return Math.max(minWidth, Math.min(maxWidth, width))
}

export function shiftColumnWidthsMap(widths, insertCol, deleteCol, nextCols, defaultWidth = 120) {
    const oldWidths = widths || {}
    const next = {}

    for (const key in oldWidths) {
        const parsed = parseInt(key, 10)
        if (isNaN(parsed)) continue

        let idx = parsed
        if (insertCol !== null && idx >= insertCol) idx += 1
        if (deleteCol !== null) {
            if (idx === deleteCol) continue
            if (idx > deleteCol) idx -= 1
        }

        if (idx >= 0 && idx < nextCols) {
            next[idx] = oldWidths[key]
        }
    }

    if (insertCol !== null && insertCol >= 0 && insertCol < nextCols) {
        const source = oldWidths[insertCol] ?? oldWidths[insertCol - 1] ?? defaultWidth
        next[insertCol] = source
    }

    return next
}

export function insertReferenceAtSelection(text, ref, selectionStart, selectionEnd) {
    const current = String(text ?? '')
    const start = Math.max(0, Math.min(current.length, selectionStart ?? current.length))
    const end = Math.max(start, Math.min(current.length, selectionEnd ?? start))
    return {
        value: current.slice(0, start) + ref + current.slice(end),
        caret: start + ref.length
    }
}

export function canInsertReferenceAtSelection(text, selectionStart, selectionEnd) {
    const current = String(text ?? '')
    const start = Math.max(0, Math.min(current.length, selectionStart ?? current.length))
    const end = Math.max(start, Math.min(current.length, selectionEnd ?? start))

    const trimmed = current.trimStart()
    if (!trimmed.startsWith('=')) return false

    // Replacing an explicit selection is always valid.
    if (start !== end) return true

    const left = current.slice(0, start).replace(/\s+$/, '')
    const right = current.slice(end).replace(/^\s+/, '')

    // Formula start and function args contexts.
    if (left === '=' || left.endsWith('(')) return true

    // Allow insertion after operators/separators, including ':' and comparisons.
    if (!/[+\-*/^,:&<>=!]$/.test(left)) return false

    // Block invalid concatenations like "=A2+1C3".
    if (right !== '' && !/^[+\-*/^),:%&<>=!]/.test(right)) return false

    return true
}

export function parseFormulaReferences(formula, currentBlockUuid = null) {
    const refs = { local: new Set(), external: {} }
    if (!formula || typeof formula !== 'string') return refs

    const trimmed = formula.trim()
    if (!trimmed.startsWith('=')) return refs

    const expression = trimmed.slice(1)
        .replace(/"(?:\\.|[^"\\])*"/g, (match) => {
            // Keep the string if it looks like a TABLE/DB argument, otherwise remove
            return match
        })
        .replace(/'(?:\\.|[^'\\])*'/g, '')

    // Match qualified refs like TABLE("uuid").A1 or TABLE("uuid").A1:B2
    const qualifiedRegex = /(?:TABLE|DB)\(\s*(["'])([^"']+)\1\s*\)\s*\.\s*([A-Z]+\d+(?::[A-Z]+\d+)?)/gi
    let match
    while ((match = qualifiedRegex.exec(expression)) !== null) {
        const targetUuid = match[2]
        const rangeOrCell = match[3]
        
        if (targetUuid === currentBlockUuid) {
            if (rangeOrCell.includes(':')) {
                for (const r of expandRange(rangeOrCell)) refs.local.add(r)
            } else {
                refs.local.add(rangeOrCell)
            }
        } else {
            if (!refs.external[targetUuid]) refs.external[targetUuid] = new Set()
            if (rangeOrCell.includes(':')) {
                for (const r of expandRange(rangeOrCell)) refs.external[targetUuid].add(r)
            } else {
                refs.external[targetUuid].add(rangeOrCell)
            }
        }
    }

    // Remove qualified refs so we can find the local ones safely
    const localOnlyExpression = expression.replace(
        /(?:TABLE|DB)\(\s*["'][^"']+["']\s*\)\s*\.\s*[A-Z]+\d+(?::[A-Z]+\d+)?/gi,
        ''
    )

    const ranges = localOnlyExpression.match(/[A-Z]+\d+:[A-Z]+\d+/g) || []
    for (const range of ranges) {
        for (const ref of expandRange(range)) refs.local.add(ref)
    }

    const singles = localOnlyExpression.match(/\b[A-Z]+\d+\b/g) || []
    for (const ref of singles) refs.local.add(ref)

    return refs
}

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
        this.suppressBlurSave = false
        this.liveEditValue = ''
        this.blurIgnoreRef = null
        this.contextMenuEl = null
        this._closeContextMenuHandler = null
        this.longPressTimer = null
        this.suppressNextClick = false
        this.defaultColWidth = 120
        this.minColWidth = 80
        this.maxColWidth = 800
        this.colWidths = {}
        this.isResizingCol = false
        this.resizingColIndex = null
        this.resizeStartX = 0
        this.resizeStartWidth = this.defaultColWidth
        this.externalEvalCache = {}
        this._viewEl = null

        this.load()
    }

    load() {
        const container = this.containerEl.querySelector('.spreadsheet-view') || this.containerEl
        container.innerHTML = '<div class="sheet-loading">Loading…</div>'
        xhr(
            "get_spreadsheet_content?channel=" + this.channelId + "&block_uuid=" + this.blockUuid,
            (event) => {
                const req = event.target
                if (req.status !== 200) {
                    container.innerHTML = '<div class="sheet-error">Failed to load spreadsheet</div>'
                    return
                }
                const data = JSON.parse(req.responseText)
                this.id = data.id
                this.rows = data.rows || 3
                this.cols = data.cols || 2
                this.cells = data.cells || {}
                this.colWidths = data.col_widths || {}
                this._normalizeColumnWidths()
                this._updateOwnSnapshotCache()
                this.evaluateAll()
                container.innerHTML = this.render()
                this._viewEl = container
                // Let sibling sheets that cross-reference this one refresh now that we're loaded.
                this._notifyDependentViews()
            },
            "GET"
        )
    }

    _normalizeRef(ref) {
        return String(ref || '').trim().toUpperCase()
    }

    _isFormulaLike(value) {
        const v = String(value || '')
        return v.startsWith('=') || v.startsWith('{{')
    }

    _toPrimitive(value) {
        const num = parseFloat(value)
        return isNaN(num) ? value : num
    }

    _readMountedSnapshot(sheetBlockUuid) {
        const view = global.state.spreadsheetViews?.[sheetBlockUuid]
        // Guard: view must be fully loaded (id is set by load() callback).
        // An in-progress view would return stale empty cells and poison the snapshot cache.
        if (!view || view.id === undefined) return null
        return {
            block_uuid: view.blockUuid,
            cells: view.cells || {},
            rows: view.rows || 0,
            cols: view.cols || 0,
            cached_at: Date.now(),
        }
    }

    _loadSnapshotFromServer(sheetBlockUuid) {
        const req = xhr(
            '/get_spreadsheet_snapshot?channel=' + this.channelId + '&block_uuid=' + encodeURIComponent(sheetBlockUuid),
            () => {},
            'GET',
            false
        )

        if (req.status !== 200) return null
        try {
            const data = JSON.parse(req.responseText || '{}')
            if (!data || typeof data !== 'object') return null
            return {
                block_uuid: data.block_uuid,
                cells: data.cells || {},
                rows: data.rows || 0,
                cols: data.cols || 0,
                cached_at: Date.now(),
            }
        } catch (_) {
            return null
        }
    }

    _getSnapshot(sheetBlockUuid) {
        const mounted = this._readMountedSnapshot(sheetBlockUuid)
        if (mounted) {
            global.state.spreadsheetSnapshots[sheetBlockUuid] = mounted
            return mounted
        }

        const cached = global.state.spreadsheetSnapshots[sheetBlockUuid]
        if (cached) {
            const age = Date.now() - Number(cached.cached_at || 0)
            if (age <= Number(global.state.spreadsheetSnapshotTtlMs || 10000)) {
                return cached
            }
        }

        const fetched = this._loadSnapshotFromServer(sheetBlockUuid)
        if (fetched) {
            global.state.spreadsheetSnapshots[sheetBlockUuid] = fetched
            return fetched
        }

        return null
    }

    _updateOwnSnapshotCache() {
        global.state.spreadsheetSnapshots[this.blockUuid] = {
            block_uuid: this.blockUuid,
            cells: this.cells || {},
            rows: this.rows || 0,
            cols: this.cols || 0,
            cached_at: Date.now(),
        }
    }

    // ─── Evaluation ───────────────────────────────────────────────────

    _resolveCell(ref, sheetBlockUuid = null, evalState = null) {
        const targetSheet = sheetBlockUuid || this.blockUuid
        const normalizedRef = this._normalizeRef(ref)
        if (!normalizedRef) return ''

        const state = evalState || { trail: new Set(), memo: {} }
        const key = targetSheet + ':' + normalizedRef
        if (state.trail.has(key)) return '#CYCLE!'
        if (Object.prototype.hasOwnProperty.call(state.memo, key)) return state.memo[key]

        state.trail.add(key)
        let result = ''
        try {
            if (targetSheet === this.blockUuid) {
                result = this._resolveLocalCell(normalizedRef, state)
            } else {
                // Only use a live view if it has fully loaded (id set by load() callback).
                // A half-initialized view has empty cells and would give worse results than
                // the snapshot/server fallback. When B finishes loading it calls
                // _notifyDependentViews() so this sheet will re-evaluate with live data.
                const mounted = global.state.spreadsheetViews?.[targetSheet]
                if (mounted && mounted.id !== undefined) {
                    result = mounted._resolveLocalCell(normalizedRef, state)
                } else {
                    result = this._resolveSnapshotCell(targetSheet, normalizedRef, state)
                }
            }
        } finally {
            state.trail.delete(key)
        }

        state.memo[key] = result
        return result
    }

    _resolveLocalCell(ref, evalState) {
        // Keep direct lookups fast when called outside a full evaluation state.
        if (!evalState && this.evaluatedCells[ref] !== undefined) {
            return this.evaluatedCells[ref]
        }

        const raw = this.cells[ref]
        if (raw === undefined || raw === null) return ''

        if (this._isFormulaLike(raw)) {
            try {
                const result = evaluateFormula(String(raw), (r, tableId) => this._resolveCell(r, tableId || this.blockUuid, evalState))
                return result
            } catch (_) {
                return '#ERROR'
            }
        }

        return this._toPrimitive(raw)
    }

    _resolveSnapshotCell(sheetBlockUuid, ref, evalState) {
        const cacheKey = sheetBlockUuid + ':' + ref
        if (this.externalEvalCache[cacheKey] !== undefined) {
            return this.externalEvalCache[cacheKey]
        }

        const snapshot = this._getSnapshot(sheetBlockUuid)
        if (!snapshot || !snapshot.cells) {
            // Do NOT cache this: the target sheet may simply not be loaded yet.
            // The next evaluateAll() (triggered by _notifyDependentViews) will retry.
            return '#REF!'
        }

        const raw = snapshot.cells[ref]
        if (raw === undefined || raw === null) return ''

        if (this._isFormulaLike(raw)) {
            try {
                const computed = evaluateFormula(String(raw), (r, tableId) => this._resolveCell(r, tableId || sheetBlockUuid, evalState))
                this.externalEvalCache[cacheKey] = computed
                return computed
            } catch (_) {
                this.externalEvalCache[cacheKey] = '#ERROR'
                return '#ERROR'
            }
        }

        const primitive = this._toPrimitive(raw)
        this.externalEvalCache[cacheKey] = primitive
        return primitive
    }

    /**
     * Re-evaluate this view if it holds any reference to `changedUuid`.
     * Called by `_notifyDependentViews` whenever another sheet's data changes.
     */
    _reevaluateIfReferencing(changedUuid) {
        // Fast path: we already evaluated at least one cell from that sheet.
        const hasCachedRef = Object.keys(this.externalEvalCache)
            .some(k => k.startsWith(changedUuid + ':'))
        if (!hasCachedRef) {
            // Slower path: scan formula strings for the UUID token.
            const hasFormulaRef = Object.values(this.cells)
                .some(cell => typeof cell === 'string' && cell.includes(changedUuid))
            if (!hasFormulaRef) return
        }
        this.evaluateAll()
        if (this._viewEl && !this.editingCell) this._viewEl.innerHTML = this.render()
    }

    /**
     * Notify all other mounted spreadsheet views that this sheet's data changed.
     * Any view that references this sheet's UUID will re-evaluate and re-render.
     */
    _notifyDependentViews() {
        const views = global.state.spreadsheetViews || {}
        for (const uuid in views) {
            if (uuid === this.blockUuid) continue
            const view = views[uuid]
            // Only notify fully-loaded views (id is set after load() completes).
            if (view && view.id !== undefined) view._reevaluateIfReferencing(this.blockUuid)
        }
    }

    evaluateAll() {
        this.evaluatedCells = {}
        this.externalEvalCache = {}

        const evalState = {
            trail: new Set(),
            memo: {}
        }

        for (const ref in this.cells) {
            this.evaluatedCells[ref] = this._resolveCell(ref, this.blockUuid, evalState)
        }
    }

    // ─── Rendering ────────────────────────────────────────────────────

    render() {
        const activeView = this._getActiveFormulaEditorView()
        const parsedRefs = activeView ? parseFormulaReferences(activeView.liveEditValue, activeView.blockUuid) : null
        const highlighted = this._highlightedRefsFor(activeView, parsedRefs)

        let html = '<div class="spreadsheet-wrapper"><table class="sheet-table">'
        html += '<colgroup>'
        html += '<col style="width:40px; min-width:40px;" />'
        for (let c = 0; c < this.cols; c++) {
            const width = this._getColWidth(c)
            html += '<col data-col-index="' + c + '" style="width:' + width + 'px; min-width:' + width + 'px;" />'
        }
        html += '</colgroup>'

        // Header row (A, B, C...)
        html += '<thead><tr><th class="sheet-corner"></th>'
        for (let c = 0; c < this.cols; c++) {
            html += '<th>' + colIndexToLetter(c)
            html += '<div class="sheet-col-resizer" '
            html += 'onmousedown="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].startColResize(event, ' + c + ')"></div>'
            html += '</th>'
        }
        html += '</tr></thead>'

        html += '<tbody>'
        for (let r = 1; r <= this.rows; r++) {
            html += '<tr>'
            html += '<td class="sheet-row-header">' + r + '</td>'
            for (let c = 0; c < this.cols; c++) {
                const ref = colIndexToLetter(c) + r
                const isHighlighted = !!(highlighted && highlighted.has(ref))
                const classes = 'sheet-cell' + (this.editingCell === ref ? ' editing' : '') + (isHighlighted ? ' sheet-ref-highlight' : '')
                html += '<td class="' + classes + '" data-ref="' + ref + '" '
                html += 'onmousedown="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].onCellMouseDown(event, \'' + ref + '\')" '
                html += 'oncontextmenu="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].onCellContextMenu(event, \'' + ref + '\')" '
                html += 'ontouchstart="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].onCellTouchStart(event, \'' + ref + '\')" '
                html += 'ontouchend="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].onCellTouchEnd()" '
                html += 'ontouchmove="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].onCellTouchMove()" '
                html += 'onclick="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].onCellClick(event, \'' + ref + '\')">'
                
                if (this.editingCell === ref) {
                    html += '<input id="sheet-input-' + this.blockUuid + '" type="text" value="' + this._esc(this.cells[ref] || '') + '" '
                    html += 'oninput="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].handleInput(event)" '
                    html += 'onblur="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].handleInputBlur(\'' + ref + '\', this.value)" '
                    html += 'onkeydown="global.state.spreadsheetViews[\'' + this.blockUuid + '\'].handleKeyDown(event, \'' + ref + '\')" />'
                } else {
                    const val = this.evaluatedCells[ref] !== undefined ? this.evaluatedCells[ref] : (this.cells[ref] || '')
                    html += '<div class="sheet-cell-content" title="' + this._esc(this.cells[ref] || '') + '">' + this._esc(val) + '</div>'
                }
                
                html += '</td>'
            }
            html += '</tr>'
        }

        html += '</tbody></table></div>'

        return html
    }

    _esc(str) {
        if (str === null || str === undefined) return ''
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }

    _persistColumnWidth(colIdx) {
        const width = this._getColWidth(colIdx)
        xhr(
            "/save_spreadsheet_col_width?channel=" + this.channelId
            + "&spreadsheet_id=" + this.id
            + "&col_idx=" + encodeURIComponent(String(colIdx))
            + "&width=" + encodeURIComponent(String(width)),
            () => {},
            "POST"
        )
    }

    _normalizeColumnWidths() {
        const normalized = {}
        for (let c = 0; c < this.cols; c++) {
            const w = Number(this.colWidths[c])
            if (!isNaN(w)) {
                normalized[c] = computeResizedWidth(w, 0, this.minColWidth, this.maxColWidth)
            }
        }
        this.colWidths = normalized
    }

    _getColWidth(colIdx) {
        const width = Number(this.colWidths[colIdx])
        if (isNaN(width)) return this.defaultColWidth
        return computeResizedWidth(width, 0, this.minColWidth, this.maxColWidth)
    }

    _setColWidth(colIdx, width) {
        this.colWidths[colIdx] = computeResizedWidth(width, 0, this.minColWidth, this.maxColWidth)
    }

    _applyColWidthToDom(colIdx, width) {
        const container = this._viewEl
        if (!container) return
        const col = container.querySelector(`.sheet-table col[data-col-index="${colIdx}"]`)
        if (!col) return
        const px = computeResizedWidth(width, 0, this.minColWidth, this.maxColWidth) + 'px'
        col.style.width = px
        col.style.minWidth = px
    }

    startColResize(event, colIdx) {
        event.preventDefault()
        event.stopPropagation()
        this.closeContextMenu()

        this.isResizingCol = true
        this.resizingColIndex = colIdx
        this.resizeStartX = event.clientX
        this.resizeStartWidth = this._getColWidth(colIdx)

        if (!this._onColResizeMoveBound) {
            this._onColResizeMoveBound = (e) => this._onColResizeMove(e)
            this._onColResizeEndBound = () => this._onColResizeEnd()
        }

        document.addEventListener('mousemove', this._onColResizeMoveBound)
        document.addEventListener('mouseup', this._onColResizeEndBound)
        document.body.classList.add('sheet-col-resizing')
    }

    _onColResizeMove(event) {
        if (!this.isResizingCol) return
        const nextWidth = computeResizedWidth(
            this.resizeStartWidth,
            event.clientX - this.resizeStartX,
            this.minColWidth,
            this.maxColWidth
        )
        this._setColWidth(this.resizingColIndex, nextWidth)
        this._applyColWidthToDom(this.resizingColIndex, nextWidth)
    }

    _onColResizeEnd() {
        if (!this.isResizingCol) return
        const resizedCol = this.resizingColIndex
        this.isResizingCol = false
        this.resizingColIndex = null
        document.removeEventListener('mousemove', this._onColResizeMoveBound)
        document.removeEventListener('mouseup', this._onColResizeEndBound)
        document.body.classList.remove('sheet-col-resizing')
        if (resizedCol !== null) this._persistColumnWidth(resizedCol)
    }

    // ─── Interaction ──────────────────────────────────────────────────

    _getInput() {
        return document.getElementById('sheet-input-' + this.blockUuid)
    }

    _isFormulaEditing() {
        if (!this.editingCell) return false
        const input = this._getInput()
        return !!(input && String(input.value || '').trim().startsWith('='))
    }

    _clearFormulaEditorIfOwned() {
        const current = global.state.activeSpreadsheetFormulaEditor
        if (current && current.blockUuid === this.blockUuid) {
            global.state.activeSpreadsheetFormulaEditor = null
        }
    }

    _syncGlobalFormulaEditorState(value) {
        const formulaValue = String(value ?? this.liveEditValue ?? '')
        const active = this.editingCell && formulaValue.trim().startsWith('=')
        if (active) {
            global.state.activeSpreadsheetFormulaEditor = {
                blockUuid: this.blockUuid,
                cellRef: this.editingCell,
            }
        } else {
            this._clearFormulaEditorIfOwned()
        }
    }

    _getActiveFormulaEditorView() {
        const current = global.state.activeSpreadsheetFormulaEditor
        if (current && current.blockUuid) {
            const view = global.state.spreadsheetViews?.[current.blockUuid]
            if (view && view.editingCell && view._isFormulaEditing()) {
                return view
            }
        }

        // Recovery path when global pointer is stale: scan mounted sheets.
        const views = global.state.spreadsheetViews || {}
        for (const blockUuid in views) {
            const view = views[blockUuid]
            if (view && view.editingCell && view._isFormulaEditing()) {
                global.state.activeSpreadsheetFormulaEditor = {
                    blockUuid: view.blockUuid,
                    cellRef: view.editingCell,
                }
                return view
            }
        }

        if (current && current.blockUuid === this.blockUuid) this._clearFormulaEditorIfOwned()
        return null
    }

    _highlightedRefsFor(activeView, refs) {
        if (!activeView || !refs) return null
        if (activeView.blockUuid === this.blockUuid) return refs.local
        return refs.external[this.blockUuid] || null
    }

    updateReferenceHighlights() {
        const views = global.state.spreadsheetViews || {}
        const activeView = this._getActiveFormulaEditorView()
        const refs = activeView ? parseFormulaReferences(activeView.liveEditValue, activeView.blockUuid) : null

        for (const blockUuid in views) {
            const view = views[blockUuid]
            const container = view._viewEl
            if (!container) continue

            const highlighted = view._highlightedRefsFor(activeView, refs)
            container.querySelectorAll('.sheet-cell[data-ref]').forEach(cell => {
                cell.classList.toggle('sheet-ref-highlight', !!(highlighted && highlighted.has(cell.dataset.ref)))
            })
        }
    }

    handleInput(event) {
        this.liveEditValue = String(event?.target?.value || '')
        this._syncGlobalFormulaEditorState(this.liveEditValue)
        this.updateReferenceHighlights()
    }

    onCellMouseDown(event, ref) {
        if (event.defaultPrevented) return
        const activeEditor = this._getActiveFormulaEditorView()
        if (activeEditor && (activeEditor.blockUuid !== this.blockUuid || activeEditor.editingCell !== ref)) {
            event.preventDefault()
            event.stopPropagation()

            // Prevent blur-commit while selecting refs from another sheet.
            activeEditor.suppressBlurSave = true
            activeEditor.handleFormulaCellPick(ref, this.blockUuid)
            setTimeout(() => {
                activeEditor.suppressBlurSave = false
            }, 0)
            return
        }

        // When switching cells while editing, blur may re-render before click fires.
        // Commit on mousedown so the clicked cell becomes the next active editor.
        if (this.editingCell && ref !== this.editingCell && !this._isFormulaEditing()) {
            const input = this._getInput()
            if (input) {
                event.preventDefault()
                event.stopPropagation()
                this.suppressNextClick = true
                this._commitEdit(this.editingCell, input.value, ref)
                return
            }
        }

        if (!this._isFormulaEditing() || ref === this.editingCell) return
        this.suppressBlurSave = true
        event.preventDefault()
        event.stopPropagation()
        this.handleFormulaCellPick(ref)
        setTimeout(() => {
            this.suppressBlurSave = false
        }, 0)
    }

    onCellClick(event, ref) {
        const activeEditor = this._getActiveFormulaEditorView()
        if (activeEditor && activeEditor.blockUuid !== this.blockUuid) {
            event.preventDefault()
            event.stopPropagation()
            return
        }

        if (this.suppressNextClick) {
            this.suppressNextClick = false
            event.preventDefault()
            event.stopPropagation()
            return
        }
        if (this._isFormulaEditing() && ref !== this.editingCell) {
            event.preventDefault()
            event.stopPropagation()
            return
        }
        this.startEdit(ref)
    }

    onCellContextMenu(event, ref) {
        event.preventDefault()
        event.stopPropagation()
        this.openCellContextMenu(ref, event.clientX, event.clientY)
    }

    onCellTouchStart(event, ref) {
        if (!event.touches || event.touches.length !== 1) return
        const touch = event.touches[0]
        const x = touch.clientX
        const y = touch.clientY
        clearTimeout(this.longPressTimer)
        this.longPressTimer = setTimeout(() => {
            this.suppressNextClick = true
            this.openCellContextMenu(ref, x, y)
        }, 500)
    }

    onCellTouchMove() {
        clearTimeout(this.longPressTimer)
    }

    onCellTouchEnd() {
        clearTimeout(this.longPressTimer)
    }

    closeContextMenu() {
        if (this.contextMenuEl) {
            this.contextMenuEl.remove()
            this.contextMenuEl = null
        }
        if (this._closeContextMenuHandler) {
            document.removeEventListener('click', this._closeContextMenuHandler)
            document.removeEventListener('contextmenu', this._closeContextMenuHandler)
            this._closeContextMenuHandler = null
        }
    }

    openCellContextMenu(ref, x, y) {
        this.closeContextMenu()

        const menu = document.createElement('div')
        menu.className = 'sheet-context-menu'

        const actions = [
            {label: 'Add column left', op: 'add-col-left'},
            {label: 'Add column right', op: 'add-col-right'},
            {label: 'Add row above', op: 'add-row-top'},
            {label: 'Add row below', op: 'add-row-bottom'},
            {label: 'Delete column', op: 'delete-col', danger: true, disabled: this.cols <= 1},
            {label: 'Delete row', op: 'delete-row', danger: true, disabled: this.rows <= 1},
        ]

        actions.forEach(action => {
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'sheet-context-item' + (action.danger ? ' danger' : '')
            if (action.disabled) {
                btn.disabled = true
            }
            btn.textContent = action.label
            btn.onclick = (e) => {
                e.preventDefault()
                e.stopPropagation()
                this.closeContextMenu()
                this.applyStructureOperation(action.op, ref)
            }
            menu.appendChild(btn)
        })

        menu.style.position = 'fixed'
        menu.style.left = x + 'px'
        menu.style.top = y + 'px'
        document.body.appendChild(menu)

        const rect = menu.getBoundingClientRect()
        if (rect.right > window.innerWidth) {
            menu.style.left = Math.max(8, window.innerWidth - rect.width - 8) + 'px'
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = Math.max(8, window.innerHeight - rect.height - 8) + 'px'
        }

        this.contextMenuEl = menu
        this._closeContextMenuHandler = (e) => {
            if (!menu.contains(e.target)) this.closeContextMenu()
        }
        setTimeout(() => {
            document.addEventListener('click', this._closeContextMenuHandler)
            document.addEventListener('contextmenu', this._closeContextMenuHandler)
        }, 0)
    }

    _parseRef(ref) {
        const m = String(ref || '').match(/^([A-Z]+)(\d+)$/)
        if (!m) return null
        return { col: colLetterToIndex(m[1]), row: parseInt(m[2], 10) }
    }

    _toRef(colIdx, rowNum) {
        return colIndexToLetter(colIdx) + rowNum
    }

    _applyStructureOperationLocal(op, ref) {
        const parsed = this._parseRef(ref)
        if (!parsed) return false

        let nextRows = this.rows
        let nextCols = this.cols
        let insertCol = null
        let insertRow = null
        let deleteCol = null
        let deleteRow = null

        if (op === 'add-col-left') {
            insertCol = parsed.col
            nextCols += 1
        } else if (op === 'add-col-right') {
            insertCol = parsed.col + 1
            nextCols += 1
        } else if (op === 'add-row-top') {
            insertRow = parsed.row
            nextRows += 1
        } else if (op === 'add-row-bottom') {
            insertRow = parsed.row + 1
            nextRows += 1
        } else if (op === 'delete-col') {
            if (this.cols <= 1) return false
            deleteCol = parsed.col
            nextCols -= 1
        } else if (op === 'delete-row') {
            if (this.rows <= 1) return false
            deleteRow = parsed.row
            nextRows -= 1
        } else {
            return false
        }

        const nextCells = {}
        for (const oldRef in this.cells) {
            const pos = this._parseRef(oldRef)
            if (!pos) continue
            let c = pos.col
            let r = pos.row

            if (insertCol !== null && c >= insertCol) c += 1
            if (insertRow !== null && r >= insertRow) r += 1

            if (deleteCol !== null) {
                if (c === deleteCol) continue
                if (c > deleteCol) c -= 1
            }
            if (deleteRow !== null) {
                if (r === deleteRow) continue
                if (r > deleteRow) r -= 1
            }

            const value = this.cells[oldRef]
            if (value === undefined || value === null || String(value) === '') continue
            nextCells[this._toRef(c, r)] = value
        }

        this.rows = nextRows
        this.cols = nextCols
        this.colWidths = shiftColumnWidthsMap(this.colWidths, insertCol, deleteCol, nextCols, this.defaultColWidth)
        this._normalizeColumnWidths()
        this.cells = nextCells
        this.editingCell = null
        this.liveEditValue = ''
        this._clearFormulaEditorIfOwned()
        this._updateOwnSnapshotCache()
        this.evaluateAll()

        if (this._viewEl) this._viewEl.innerHTML = this.render()
        this._notifyDependentViews()
        return true
    }

    applyStructureOperation(op, ref) {
        const applied = this._applyStructureOperationLocal(op, ref)
        if (!applied) return

        xhr(
            "/save_spreadsheet_structure?channel=" + this.channelId
            + "&spreadsheet_id=" + this.id
            + "&op=" + encodeURIComponent(op)
            + "&ref=" + encodeURIComponent(ref),
            (event) => {
                const req = event.target
                if (req.status !== 200) {
                    this.load()
                    return
                }
                try {
                    const payload = JSON.parse(req.responseText || '{}')
                    if (payload.col_widths && typeof payload.col_widths === 'object') {
                        this.colWidths = payload.col_widths
                        this._normalizeColumnWidths()
                        if (this._viewEl) this._viewEl.innerHTML = this.render()
                    }
                } catch (_) {}
            },
            "POST"
        )
    }

    insertCellReference(ref, sourceBlockUuid = this.blockUuid) {
        const input = this._getInput()
        if (!input) return

        const normalizedRef = String(ref || '').trim().toUpperCase()
        const sameSheet = String(sourceBlockUuid || '') === String(this.blockUuid)
        const token = sameSheet ? normalizedRef : 'TABLE("' + sourceBlockUuid + '").' + normalizedRef

        const next = insertReferenceAtSelection(
            input.value,
            token,
            input.selectionStart,
            input.selectionEnd
        )

        input.value = next.value
        this.liveEditValue = next.value
        this._syncGlobalFormulaEditorState(next.value)
        input.focus()
        input.selectionStart = input.selectionEnd = next.caret
        this.updateReferenceHighlights()
    }

    handleFormulaCellPick(ref, sourceBlockUuid = this.blockUuid) {
        const input = this._getInput()
        if (!input || !this.editingCell) return

        const shouldInsert = canInsertReferenceAtSelection(
            input.value,
            input.selectionStart,
            input.selectionEnd
        )

        if (shouldInsert) {
            this.insertCellReference(ref, sourceBlockUuid)
            return
        }

        // Invalid formula context: commit current edit and focus clicked cell.
        const fromRef = this.editingCell
        const currentValue = input.value
        this._commitEdit(fromRef, currentValue)

        const targetView = global.state.spreadsheetViews?.[sourceBlockUuid]
        if (targetView) {
            targetView.suppressNextClick = true
            targetView.startEdit(ref)
        }
    }

    handleInputBlur(ref, value) {
        if (this.suppressBlurSave) {
            const input = this._getInput()
            if (input) input.focus()
            return
        }

        // Ignore blur from a committed editor instance we intentionally replaced.
        if (this.blurIgnoreRef === ref) {
            this.blurIgnoreRef = null
            return
        }

        // Ignore stale blur events from inputs that are no longer the active editor.
        if (this.editingCell && this.editingCell !== ref) {
            return
        }

        this.saveEdit(ref, value)
    }

    _commitEdit(ref, value, nextRef = null) {
        this.blurIgnoreRef = ref
        this.saveEdit(ref, value)
        if (nextRef) this.startEdit(nextRef)
    }

    startEdit(ref) {
        this.closeContextMenu()
        if (this.editingCell === ref) return
        this.editingCell = ref
        this.liveEditValue = String(this.cells[ref] || '')
        this._syncGlobalFormulaEditorState(this.liveEditValue)
        if (this._viewEl) {
            this._viewEl.innerHTML = this.render()
            const input = document.getElementById('sheet-input-' + this.blockUuid)
            if (input) {
                input.focus()
                input.selectionStart = input.selectionEnd = input.value.length
            }
            this.updateReferenceHighlights()
        }
    }

    saveEdit(ref, value) {
        if (this.cells[ref] === value) {
            this.editingCell = null
            this.liveEditValue = ''
            this._clearFormulaEditorIfOwned()
            if (this._viewEl) this._viewEl.innerHTML = this.render()
            return
        }

        const persistedValue = value.trim() === '' ? '' : value

        if (persistedValue === '') {
            delete this.cells[ref]
        } else {
            this.cells[ref] = persistedValue
        }

        this.editingCell = null
        this.liveEditValue = ''
        this._clearFormulaEditorIfOwned()
        this._updateOwnSnapshotCache()
        this.evaluateAll()
        if (this._viewEl) this._viewEl.innerHTML = this.render()
        this._notifyDependentViews()

        // Persist
        xhr("/save_spreadsheet_cell?channel=" + this.channelId
            + "&spreadsheet_id=" + this.id
            + "&cell_id=" + encodeURIComponent(ref)
            + "&value=" + encodeURIComponent(persistedValue), () => {}, "POST")
    }

    handleKeyDown(event, ref) {
        if (event.key === 'Escape') {
            event.preventDefault()
            this.editingCell = null
            this.liveEditValue = ''
            this._clearFormulaEditorIfOwned()
            this.updateReferenceHighlights()
            if (this._viewEl) this._viewEl.innerHTML = this.render()
            return
        }
        if (event.key === 'Enter') {
            event.preventDefault()
            const match = ref.match(/^([A-Z]+)(\d+)$/)
            if (match) {
                const r = parseInt(match[2])
                if (r < this.rows) {
                    const nextRef = match[1] + (r + 1)
                    this._commitEdit(ref, event.target.value, nextRef)
                } else {
                    this._commitEdit(ref, event.target.value)
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
                        this._commitEdit(ref, event.target.value, nextRef)
                    }
                } else {
                    if (c < this.cols - 1) {
                        const nextRef = colIndexToLetter(c + 1) + match[2]
                        this._commitEdit(ref, event.target.value, nextRef)
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
                         this._commitEdit(ref, event.target.value, match[1] + (r + 1))
                     } else if (event.key === 'ArrowUp' && r > 1) {
                         this._commitEdit(ref, event.target.value, match[1] + (r - 1))
                     }
                 }
             }
        }
    }

}

export function mountSpreadsheet(blockUuid, channelId, containerEl) {
    const view = new SpreadsheetView(blockUuid, channelId, containerEl)
    global.state.spreadsheetViews[blockUuid] = view
    return view
}