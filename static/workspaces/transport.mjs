const AUTO_REFRESH_MS = 60 * 1000
const DEFAULT_DATA = {
    operator: "stib",
    line: "",
    stop: ""
}

const blockIntervals = new Map()

function parseBlockContent(block) {
    if (!block?.content) {
        return {...DEFAULT_DATA}
    }
    try {
        const parsed = JSON.parse(block.content)
        return {...DEFAULT_DATA, ...parsed}
    } catch (error) {
        return {...DEFAULT_DATA}
    }
}

function saveBlockContent(editor, block, data) {
    block.content = JSON.stringify(data)
    editor.saveBlock(block.uuid)
}

function formatTimeLabel(arrival) {
    if (Number.isFinite(arrival?.minutes)) {
        return `dans ${arrival.minutes} min`
    }
    const value = arrival?.arrival_time
    if (!value) return ""

    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})
    }

    return String(value)
}

async function apiGet(path, params = {}) {
    const url = new URL(path, window.location.origin)
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, value)
        }
    })
    const response = await fetch(url.toString(), {credentials: "same-origin"})
    if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `Transport API error: ${response.status}`)
    }
    return response.json()
}

function setSelectOptions(select, items, placeholder, selectedValue) {
    select.innerHTML = ""
    const placeholderOption = document.createElement("option")
    placeholderOption.value = ""
    placeholderOption.textContent = placeholder
    select.appendChild(placeholderOption)

    items.forEach((item) => {
        const option = document.createElement("option")
        option.value = String(item.id)
        option.textContent = item.label || item.name || item.id
        select.appendChild(option)
    })

    select.value = selectedValue || ""
}

function setEmptyState(arrivalsEl, emptyEl, showEmpty, message = "") {
    if (emptyEl) {
        emptyEl.textContent = message || emptyEl.textContent
        emptyEl.style.display = showEmpty ? "block" : "none"
    }
    if (arrivalsEl) {
        arrivalsEl.style.display = showEmpty ? "none" : "flex"
    }
}

function updateStatus(statusEl, message) {
    if (!statusEl) return
    statusEl.textContent = message || ""
}

function clearArrivals(arrivalsEl) {
    if (arrivalsEl) arrivalsEl.innerHTML = ""
}

function renderArrivals(arrivalsEl, emptyEl, arrivals) {
    clearArrivals(arrivalsEl)

    if (!arrivals?.length) {
        setEmptyState(arrivalsEl, emptyEl, true, "Aucun passage trouve")
        return
    }

    setEmptyState(arrivalsEl, emptyEl, false)
    arrivals.forEach((arrival) => {
        const row = document.createElement("li")
        row.className = "note-transport-arrival"

        const line = document.createElement("span")
        line.className = "note-transport-arrival-line"
        line.textContent = arrival.line || arrival.line_id || ""

        const destination = document.createElement("span")
        destination.className = "note-transport-arrival-destination"
        destination.textContent = arrival.destination || arrival.headsign || ""

        const time = document.createElement("span")
        time.className = "note-transport-arrival-time"
        time.textContent = formatTimeLabel(arrival)

        row.appendChild(line)
        row.appendChild(destination)
        row.appendChild(time)
        arrivalsEl.appendChild(row)
    })
}

function scheduleAutoRefresh(blockUuid, refreshFn, enabled) {
    if (blockIntervals.has(blockUuid)) {
        clearInterval(blockIntervals.get(blockUuid))
    }
    if (!enabled) return
    const intervalId = setInterval(refreshFn, AUTO_REFRESH_MS)
    blockIntervals.set(blockUuid, intervalId)
}

export async function mountTransportBlock(blockUuid, containerEl) {
    const editor = global.state.noteEditor
    const block = editor?.blocks?.[blockUuid]
    if (!block || !containerEl) return

    const operatorSelect = containerEl.querySelector("[data-transport-operator]")
    const lineSelect = containerEl.querySelector("[data-transport-line]")
    const stopSelect = containerEl.querySelector("[data-transport-stop]")
    const refreshBtn = containerEl.querySelector("[data-transport-refresh]")
    const statusEl = containerEl.querySelector("[data-transport-status]")
    const arrivalsEl = containerEl.querySelector("[data-transport-arrivals]")
    const emptyEl = containerEl.querySelector("[data-transport-empty]")

    let data = parseBlockContent(block)

    const setDisabled = (select, disabled) => {
        if (!select) return
        select.disabled = disabled
    }

    const loadOperators = async () => {
        setDisabled(operatorSelect, true)
        updateStatus(statusEl, "Chargement des transporteurs...")
        try {
            const payload = await apiGet("/transport/operators")
            const items = payload?.operators || []
            setSelectOptions(operatorSelect, items, "Transporteur", data.operator)
            if (!operatorSelect.value && items.length > 0) {
                data.operator = String(items[0].id)
            } else {
                data.operator = operatorSelect.value
            }
            saveBlockContent(editor, block, data)
            updateStatus(statusEl, "")
        } catch (error) {
            updateStatus(statusEl, "Erreur chargement transporteurs")
            setSelectOptions(operatorSelect, [], "Transporteur", "")
        } finally {
            setDisabled(operatorSelect, false)
        }
    }

    const loadLines = async () => {
        if (!data.operator) return
        setDisabled(lineSelect, true)
        updateStatus(statusEl, "Chargement des lignes...")
        try {
            const payload = await apiGet("/transport/lines", {operator: data.operator})
            const items = payload?.lines || []
            setSelectOptions(lineSelect, items, "Ligne", data.line)
            if (data.line && !items.find(item => String(item.id) === String(data.line))) {
                data.line = ""
            }
            saveBlockContent(editor, block, data)
            updateStatus(statusEl, "")
        } catch (error) {
            updateStatus(statusEl, "Erreur chargement lignes")
            setSelectOptions(lineSelect, [], "Ligne", "")
        } finally {
            setDisabled(lineSelect, false)
        }
    }

    const loadStops = async () => {
        if (!data.operator || !data.line) return
        setDisabled(stopSelect, true)
        updateStatus(statusEl, "Chargement des arrets...")
        try {
            const payload = await apiGet("/transport/stops", {operator: data.operator, line: data.line})
            const items = payload?.stops || []
            setSelectOptions(stopSelect, items, "Arret", data.stop)
            if (data.stop && !items.find(item => String(item.id) === String(data.stop))) {
                data.stop = ""
            }
            saveBlockContent(editor, block, data)
            updateStatus(statusEl, "")
        } catch (error) {
            updateStatus(statusEl, "Erreur chargement arrets")
            setSelectOptions(stopSelect, [], "Arret", "")
        } finally {
            setDisabled(stopSelect, false)
        }
    }

    const refreshArrivals = async (manual = false) => {
        if (!data.operator || !data.stop) return
        if (manual) updateStatus(statusEl, "Mise a jour...")
        try {
            const payload = await apiGet("/transport/arrivals", {
                operator: data.operator,
                line: data.line,
                stop: data.stop
            })
            renderArrivals(arrivalsEl, emptyEl, payload?.arrivals || [])
            if (payload?.timestamp) {
                updateStatus(statusEl, `Maj ${payload.timestamp}`)
            } else if (manual) {
                updateStatus(statusEl, "Maj OK")
            }
        } catch (error) {
            updateStatus(statusEl, "Erreur chargement passages")
            setEmptyState(arrivalsEl, emptyEl, true, "Impossible de charger les passages")
        }
    }

    operatorSelect.onchange = async () => {
        data.operator = operatorSelect.value
        data.line = ""
        data.stop = ""
        saveBlockContent(editor, block, data)
        clearArrivals(arrivalsEl)
        await loadLines()
        setSelectOptions(stopSelect, [], "Arret", "")
        setEmptyState(arrivalsEl, emptyEl, true, "Choisissez une ligne et un arret.")
        scheduleAutoRefresh(blockUuid, () => refreshArrivals(false), false)
    }

    lineSelect.onchange = async () => {
        data.line = lineSelect.value
        data.stop = ""
        saveBlockContent(editor, block, data)
        clearArrivals(arrivalsEl)
        await loadStops()
        setEmptyState(arrivalsEl, emptyEl, true, "Choisissez un arret.")
        scheduleAutoRefresh(blockUuid, () => refreshArrivals(false), false)
    }

    stopSelect.onchange = async () => {
        data.stop = stopSelect.value
        saveBlockContent(editor, block, data)
        await refreshArrivals(true)
        scheduleAutoRefresh(blockUuid, () => refreshArrivals(false), Boolean(data.stop))
    }

    refreshBtn.onclick = () => refreshArrivals(true)

    setEmptyState(arrivalsEl, emptyEl, true, "Chargement...")
    await loadOperators()
    await loadLines()
    await loadStops()
    if (data.stop) {
        await refreshArrivals(false)
    } else {
        setEmptyState(arrivalsEl, emptyEl, true, "Choisissez une ligne et un arret.")
    }
    scheduleAutoRefresh(blockUuid, () => refreshArrivals(false), Boolean(data.stop))
}

