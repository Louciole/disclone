import { expect } from '@playwright/test';
import { waitForAppReady } from './callHelpers.mjs';
import { openServerFromSidebarById } from './serverHelpers.mjs';

// ─── Channel management ───────────────────────────────────────────────────────

/**
 * Opens the "create channel" dialog for the currently active server.
 * The logged-in user must have admin rights.
 */
export async function openCreateChannelMenu(page) {
    await page.locator('#server-infos').click();
    await page.locator('#server-settings').waitFor({ state: 'visible', timeout: 5000 });

    const createItem = page.locator('#server-settings .item[onclick*="create-channel"]');
    if (await createItem.isVisible().catch(() => false)) {
        await createItem.click();
    } else {
        await page.evaluate(() => window.openMenu('create-channel'));
    }

    await page.locator('#create-channel').waitFor({ state: 'visible', timeout: 5000 });
    console.log('📋 Create-channel menu opened');
}

/**
 * Returns the sorted list of note channel IDs from the current server's global state.
 */
export async function getNoteChannelIds(page) {
    return page.evaluate(() => {
        const notes = window.global?.state?.currentServer?.dirs?.notes || [];
        return notes
            .map((n) => Number(n.id))
            .filter((id) => Number.isFinite(id))
            .sort((a, b) => a - b);
    });
}

/**
 * Creates a note channel in the currently active server via UI.
 * Returns the new channel's numeric ID.
 */
export async function createNoteChannelViaUi(page) {
    const beforeIds = await getNoteChannelIds(page);

    await openCreateChannelMenu(page);
    await page.locator('#create-channel .category[onclick*="note"]').click();

    await page.waitForFunction(
        (prevIds) => {
            const notes = window.global?.state?.currentServer?.dirs?.notes || [];
            const ids = notes.map((n) => Number(n.id)).filter((id) => Number.isFinite(id));
            return ids.some((id) => !prevIds.includes(id));
        },
        beforeIds,
        { timeout: 10000 }
    );

    const afterIds = await getNoteChannelIds(page);
    const newId = afterIds.find((id) => !beforeIds.includes(id));
    expect(newId).toBeTruthy();
    console.log(`✅ Note channel created: id=${newId}`);
    return newId;
}

/**
 * Opens a note channel by ID and waits until it becomes the active channel.
 */
export async function openNoteChannel(page, channelId) {
    await page.locator(`#channel-note-${channelId}`).waitFor({ state: 'visible', timeout: 5000 });
    await page.locator(`#channel-note-${channelId}`).click();

    await page.waitForFunction(
        (id) => {
            const state = window.global?.state;
            return (
                Number(state?.activeChan?.id) === Number(id) &&
                state?.activeChan?.type === 'note'
            );
        },
        channelId,
        { timeout: 10000 }
    );
    console.log(`✅ Opened note channel: id=${channelId}`);
}

/**
 * Waits until the note channel's blocks dict is available in global state.
 * This indicates the note content has been loaded from the server.
 */
export async function waitForNoteChannelLoaded(page, channelId) {
    await page.waitForFunction(
        (id) => window.global?.notes?.[id]?.blocks !== undefined,
        channelId,
        { timeout: 10000 }
    );
}

/**
 * Returns the UUID of the first block with the given type in a note channel,
 * or null if none found.
 */
export async function getFirstBlockOfType(page, channelId, type) {
    return page.evaluate(
        ({ id, blockType }) => {
            const blocks = window.global?.notes?.[id]?.blocks || {};
            const match = Object.values(blocks).find((b) => b.type === blockType);
            return match?.uuid || null;
        },
        { id: channelId, blockType: type }
    );
}

// ─── Spreadsheet blocks ───────────────────────────────────────────────────────

/**
 * Creates a spreadsheet block in the currently active note channel by clicking the
 * first empty text block and typing `/sheet`. Returns the block UUID.
 *
 * Waits for the block type to flip and the SpreadsheetView to fully load before
 * returning, so callers can immediately interact with cells.
 */
export async function createSpreadsheetBlock(page, channelId) {
    await waitForNoteChannelLoaded(page, channelId);

    const blockUuid = await getFirstBlockOfType(page, channelId, 'text');
    expect(blockUuid).toBeTruthy();

    const contentEl = page.locator(`[data-block-id="${blockUuid}"] .content.editable-block`);
    await contentEl.waitFor({ state: 'visible', timeout: 5000 });
    await contentEl.click();

    // Typing each character fires oninput; parser recognises "/sheet" on the last character
    await page.keyboard.type('/sheet');

    await page.waitForFunction(
        ({ id, uuid }) => window.global?.notes?.[id]?.blocks?.[uuid]?.type === 'spreadsheet',
        { id: channelId, uuid: blockUuid },
        { timeout: 10000 }
    );

    await waitForSpreadsheetLoaded(page, blockUuid);
    console.log(`✅ Spreadsheet block created: uuid=${blockUuid}`);
    return blockUuid;
}

/**
 * Waits until the SpreadsheetView for `blockUuid` is registered in global state
 * (i.e., the async XHR load has completed) AND the table element is visible.
 */
export async function waitForSpreadsheetLoaded(page, blockUuid) {
    await page.waitForFunction(
        (uuid) => {
            const view = window.global?.state?.spreadsheetViews?.[uuid];
            return view && view.id !== undefined && view.id !== null;
        },
        blockUuid,
        { timeout: 15000 }
    );
    await page.locator(`#sheet-${blockUuid} .sheet-table`).waitFor({ state: 'visible', timeout: 10000 });
}

/**
 * Clicks a spreadsheet cell to open the inline editor, fills it with `value`,
 * then presses Enter to commit. Waits for the input to disappear.
 */
export async function editSpreadsheetCell(page, blockUuid, ref, value) {
    const cellSel = `#sheet-${blockUuid} .sheet-cell[data-ref="${ref}"]`;
    await page.locator(cellSel).waitFor({ state: 'visible', timeout: 5000 });
    await page.locator(cellSel).click();

    const inputSel = `#sheet-input-${blockUuid}`;
    await page.locator(inputSel).waitFor({ state: 'visible', timeout: 5000 });
    await page.locator(inputSel).fill(value);
    await page.keyboard.press('Enter');
    await page.locator(inputSel).waitFor({ state: 'hidden', timeout: 5000 });
    console.log(`✅ Set cell ${ref} = "${value}"`);
}

/**
 * Presses Escape while the cell editor is open to discard the edit.
 * Waits for the input to disappear.
 */
export async function cancelSpreadsheetCellEdit(page, blockUuid) {
    const inputSel = `#sheet-input-${blockUuid}`;
    await page.locator(inputSel).waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.locator(inputSel).waitFor({ state: 'hidden', timeout: 5000 });
    console.log(`✅ Cancelled cell edit in sheet ${blockUuid}`);
}

/**
 * Returns the text shown inside a cell's content div (the evaluated / display value).
 */
export async function getSpreadsheetCellDisplayValue(page, blockUuid, ref) {
    const sel = `#sheet-${blockUuid} .sheet-cell[data-ref="${ref}"] .sheet-cell-content`;
    await page.locator(sel).waitFor({ state: 'visible', timeout: 5000 });
    return page.locator(sel).textContent();
}

/**
 * Returns the raw value (formula string or plain text) for a cell from global state.
 * Returns null if not set.
 */
export async function getSpreadsheetCellRawValue(page, blockUuid, ref) {
    return page.evaluate(
        ({ uuid, cellRef }) =>
            window.global?.state?.spreadsheetViews?.[uuid]?.cells?.[cellRef] ?? null,
        { uuid: blockUuid, cellRef: ref }
    );
}

/**
 * Returns the evaluated result for a cell from global state.
 * Returns null if not set.
 */
export async function getSpreadsheetCellEvaluatedValue(page, blockUuid, ref) {
    return page.evaluate(
        ({ uuid, cellRef }) =>
            window.global?.state?.spreadsheetViews?.[uuid]?.evaluatedCells?.[cellRef] ?? null,
        { uuid: blockUuid, cellRef: ref }
    );
}

/**
 * Polls until a cell's evaluated value (converted to string) equals `expectedValue`.
 */
export async function waitForSpreadsheetCellValue(page, blockUuid, ref, expectedValue) {
    await page.waitForFunction(
        ({ uuid, cellRef, expected }) => {
            const view = window.global?.state?.spreadsheetViews?.[uuid];
            if (!view) return false;
            const val = view.evaluatedCells?.[cellRef];
            return val !== undefined && String(val) === String(expected);
        },
        { uuid: blockUuid, cellRef: ref, expected: expectedValue },
        { timeout: 10000 }
    );
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

/**
 * Reloads the page, waits for the app to reconnect, then navigates back to a specific
 * note channel and waits for the spreadsheet block to finish loading.
 *
 * Useful for persistence tests where you need to verify data survives a full reload.
 */
export async function reloadAndNavigateToNoteChannel(page, serverId, channelId, blockUuid) {
    await page.reload();
    await page.waitForURL('**/channels', { timeout: 10000 });
    await waitForAppReady(page);

    await openServerFromSidebarById(page, serverId);
    await openNoteChannel(page, channelId);
    await waitForNoteChannelLoaded(page, channelId);
    await waitForSpreadsheetLoaded(page, blockUuid);
    console.log(`✅ Reloaded and navigated back to note channel ${channelId}`);
}
