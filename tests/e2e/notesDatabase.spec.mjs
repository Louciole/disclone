import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import { createServerViaUi, openServerFromSidebarById } from './helpers/serverHelpers.mjs';
import { reloadAndWaitForApp } from './helpers/messagingHelpers.mjs';
import {
    createNoteChannelViaUi,
    openNoteChannel,
    waitForNoteChannelLoaded,
    getFirstBlockOfType,
} from './helpers/workspaceHelpers.mjs';

const TEST_TIMEOUT = 120000;

// ─── Database block helpers ───────────────────────────────────────────────────

/**
 * Creates a database block in the currently active note channel by typing /database
 * in the first empty text block. Returns the blockUuid.
 * Same pattern as createSpreadsheetBlock() in workspaceHelpers.mjs.
 */
async function createDatabaseBlock(page, channelId) {
    await waitForNoteChannelLoaded(page, channelId);

    // Wait for the default text block to appear
    await page.waitForFunction(
        (id) => Object.values(window.global?.notes?.[id]?.blocks || {}).some((b) => b.type === 'text'),
        channelId, { timeout: 10000 },
    );

    const blockUuid = await getFirstBlockOfType(page, channelId, 'text');
    expect(blockUuid).toBeTruthy();

    const contentEl = page.locator(`[data-block-id="${blockUuid}"] .content.editable-block`);
    await contentEl.waitFor({ state: 'visible', timeout: 5000 });
    await contentEl.click();

    // Typing /database converts the block to a database block
    await page.keyboard.type('/database');

    await page.waitForFunction(
        ({ id, uuid }) => window.global?.notes?.[id]?.blocks?.[uuid]?.type === 'database',
        { id: channelId, uuid: blockUuid }, { timeout: 10000 },
    );

    // Wait for DatabaseView to be mounted and loaded
    await waitForDatabaseLoaded(page, blockUuid);

    return blockUuid;
}

/**
 * Waits until DatabaseView for blockUuid has loaded its database record.
 */
async function waitForDatabaseLoaded(page, blockUuid) {
    await page.waitForFunction(
        (uuid) => {
            const view = window.global?.state?.databaseViews?.[uuid];
            return view && view.database && view.database.id !== undefined;
        },
        blockUuid, { timeout: 15000 },
    );
    // The root container should be in the DOM
    await page.locator(`#db-${blockUuid}`).waitFor({ state: 'attached', timeout: 10000 });
}

/**
 * Calls view.load() synchronously from page context so the DatabaseView
 * re-fetches data and re-renders the table. Then waits for at least one
 * column header to be present.
 */
async function reloadDatabaseView(page, blockUuid) {
    await page.evaluate((uuid) => {
        const view = window.global?.state?.databaseViews?.[uuid];
        if (view) view.load();
    }, blockUuid);
    // After load(), the view is re-rendered synchronously; wait one tick for DOM
    await page.waitForTimeout(100);
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function saveDatabaseColumn(page, channelId, databaseId, { name, type = 'text', position = 1.0 }) {
    const column = JSON.stringify({ name, type, position });
    const colIdStr = await page.evaluate(async ({ channelId, databaseId, column }) => {
        const params = new URLSearchParams({ channel: channelId, database_id: databaseId, column, op: 'create' });
        const r = await fetch(`/save_database_column?${params}`, { method: 'POST', credentials: 'include' });
        if (!r.ok) throw new Error(`save_database_column ${r.status}: ${await r.text()}`);
        return r.text();
    }, { channelId, databaseId, column });
    return Number(colIdStr.replace(/"/g, '').trim());
}

async function saveDatabaseRow(page, channelId, databaseId, position = 1.0) {
    const row = JSON.stringify({ position });
    const rowIdStr = await page.evaluate(async ({ channelId, databaseId, row }) => {
        const params = new URLSearchParams({ channel: channelId, database_id: databaseId, row, op: 'create' });
        const r = await fetch(`/save_database_row?${params}`, { method: 'POST', credentials: 'include' });
        if (!r.ok) throw new Error(`save_database_row ${r.status}: ${await r.text()}`);
        return r.text();
    }, { channelId, databaseId, row });
    return Number(rowIdStr.replace(/"/g, '').trim());
}

async function saveDatabaseCell(page, channelId, databaseId, { rowId, columnId, value }) {
    const cell = JSON.stringify({ row_id: rowId, column_id: columnId, value });
    return page.evaluate(async ({ channelId, databaseId, cell }) => {
        const params = new URLSearchParams({ channel: channelId, database_id: databaseId, cell });
        const r = await fetch(`/save_database_cell?${params}`, { method: 'POST', credentials: 'include' });
        if (!r.ok) throw new Error(`save_database_cell ${r.status}: ${await r.text()}`);
        return r.json();
    }, { channelId, databaseId, cell });
}

async function getDatabaseContent(page, channelId, blockUuid) {
    return page.evaluate(async ({ channelId, blockUuid }) => {
        const params = new URLSearchParams({ channel: channelId, block_uuid: blockUuid });
        const r = await fetch(`/get_database_content?${params}`, { credentials: 'include' });
        if (!r.ok) throw new Error(`get_database_content ${r.status}: ${await r.text()}`);
        return r.json();
    }, { channelId, blockUuid });
}

async function editDatabase(page, channelId, databaseId, fields) {
    const database = JSON.stringify({ id: databaseId, ...fields });
    return page.evaluate(async ({ channelId, database }) => {
        const params = new URLSearchParams({ channel: channelId, database, op: 'edit' });
        const r = await fetch(`/save_database?${params}`, { method: 'POST', credentials: 'include' });
        if (!r.ok) throw new Error(`save_database edit ${r.status}: ${await r.text()}`);
        return r.text();
    }, { channelId, database });
}

async function deleteDatabaseRow(page, channelId, databaseId, rowId) {
    const row = JSON.stringify({ id: rowId });
    return page.evaluate(async ({ channelId, databaseId, row }) => {
        const params = new URLSearchParams({ channel: channelId, database_id: databaseId, row, op: 'delete' });
        const r = await fetch(`/save_database_row?${params}`, { method: 'POST', credentials: 'include' });
        if (!r.ok) throw new Error(`save_database_row delete ${r.status}: ${await r.text()}`);
        return r.text();
    }, { channelId, databaseId, row });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Notes database — E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('Database lifecycle: create via /database, add columns & rows, set cells, rename, delete row, DOM assertions', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, `e2e_db_${suffix}`);
        await waitForAppReady(page);

        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);

        // ── 1. Create a note channel and open it ──────────────────────────────
        const channelId = await createNoteChannelViaUi(page);
        await openNoteChannel(page, channelId);
        await waitForNoteChannelLoaded(page, channelId);

        // ── 2. Create a database block via /database slash command ────────────
        const blockUuid = await createDatabaseBlock(page, channelId);

        // Root element is in the DOM
        await expect(page.locator(`#db-${blockUuid}`)).toBeAttached({ timeout: 5000 });

        // Default DB name shown in the title input
        const titleInput = page.locator(`#db-${blockUuid} .db-title`);
        await titleInput.waitFor({ state: 'visible', timeout: 10000 });
        const defaultTitle = await titleInput.inputValue();
        expect(defaultTitle.length).toBeGreaterThan(0);

        // Read the database ID from the mounted view
        const dbId = await page.evaluate((uuid) => window.global?.state?.databaseViews?.[uuid]?.database?.id, blockUuid);
        expect(dbId).toBeTruthy();

        // The default column header is visible
        const initial = await getDatabaseContent(page, channelId, blockUuid);
        expect(initial.columns.length).toBeGreaterThanOrEqual(1);
        expect(initial.rows.length).toBeGreaterThanOrEqual(1);

        const defaultColId = initial.columns[0].id;
        const defaultRowId = initial.rows[0].id;

        // Default column header in DOM
        await expect(page.locator(`#db-${blockUuid} th[data-col-id="${defaultColId}"]`)).toBeVisible({ timeout: 5000 });

        // Default row in DOM
        await expect(page.locator(`#db-${blockUuid} tr[data-row-id="${defaultRowId}"]`)).toBeVisible({ timeout: 5000 });

        // ── 3. Add two columns via API, reload view, verify DOM headers ────────
        const textColId = await saveDatabaseColumn(page, channelId, dbId, { name: 'Title', type: 'text', position: 2.0 });
        const numColId = await saveDatabaseColumn(page, channelId, dbId, { name: 'Score', type: 'number', position: 3.0 });
        expect(textColId).toBeGreaterThan(0);
        expect(numColId).toBeGreaterThan(0);

        await reloadDatabaseView(page, blockUuid);

        await expect(page.locator(`#db-${blockUuid} th[data-col-id="${textColId}"]`)).toBeVisible({ timeout: 5000 });
        await expect(page.locator(`#db-${blockUuid} th[data-col-id="${numColId}"]`)).toBeVisible({ timeout: 5000 });

        const textColHeader = page.locator(`#db-${blockUuid} th[data-col-id="${textColId}"] .col-name`);
        await expect(textColHeader).toHaveValue('Title', { timeout: 5000 });

        // ── 4. Add two rows via API, reload view, verify DOM rows ─────────────
        const row2Id = await saveDatabaseRow(page, channelId, dbId, 2.0);
        const row3Id = await saveDatabaseRow(page, channelId, dbId, 3.0);
        expect(row2Id).toBeGreaterThan(0);
        expect(row3Id).toBeGreaterThan(0);

        await reloadDatabaseView(page, blockUuid);

        await expect(page.locator(`#db-${blockUuid} tr[data-row-id="${row2Id}"]`)).toBeVisible({ timeout: 5000 });
        await expect(page.locator(`#db-${blockUuid} tr[data-row-id="${row3Id}"]`)).toBeVisible({ timeout: 5000 });

        // ── 5. Set cell values via API, reload view, verify cell text in DOM ───
        await saveDatabaseCell(page, channelId, dbId, { rowId: defaultRowId, columnId: textColId, value: `Alice ${suffix}` });
        await saveDatabaseCell(page, channelId, dbId, { rowId: defaultRowId, columnId: numColId,  value: '42' });
        await saveDatabaseCell(page, channelId, dbId, { rowId: row2Id,       columnId: textColId, value: `Bob ${suffix}` });
        await saveDatabaseCell(page, channelId, dbId, { rowId: row2Id,       columnId: numColId,  value: '99' });

        await reloadDatabaseView(page, blockUuid);

        // Cells are rendered as <td> inside the row; the value is in an <input>
        const aliceCell = page.locator(`#db-${blockUuid} tr[data-row-id="${defaultRowId}"] td[data-col-id="${textColId}"] input`);
        await expect(aliceCell).toHaveValue(`Alice ${suffix}`, { timeout: 5000 });

        const bobCell = page.locator(`#db-${blockUuid} tr[data-row-id="${row2Id}"] td[data-col-id="${textColId}"] input`);
        await expect(bobCell).toHaveValue(`Bob ${suffix}`, { timeout: 5000 });

        // Verify via API too
        const content = await getDatabaseContent(page, channelId, blockUuid);
        expect(content.columns.length).toBe(initial.columns.length + 2);
        expect(content.rows.length).toBe(initial.rows.length + 2);
        expect(content.cells[String(defaultRowId)]?.[String(textColId)]).toBe(`Alice ${suffix}`);
        expect(content.cells[String(defaultRowId)]?.[String(numColId)]).toBe('42');

        // ── 6. Rename the database; DOM title input updates ───────────────────
        const renamedTitle = `Renamed DB ${suffix}`;
        await editDatabase(page, channelId, dbId, { name: renamedTitle });
        await reloadDatabaseView(page, blockUuid);

        await expect(titleInput).toHaveValue(renamedTitle, { timeout: 5000 });

        const afterRename = await getDatabaseContent(page, channelId, blockUuid);
        expect(afterRename.name).toBe(renamedTitle);

        // ── 7. Delete row3 via API, reload view, row disappears from DOM ───────
        await deleteDatabaseRow(page, channelId, dbId, row3Id);
        await reloadDatabaseView(page, blockUuid);

        await page.locator(`#db-${blockUuid} tr[data-row-id="${row3Id}"]`).waitFor({ state: 'detached', timeout: 5000 });

        // ── 8. Reload page — database persists with correct data ──────────────
        await reloadAndWaitForApp(page);
        await openServerFromSidebarById(page, serverId);
        await openNoteChannel(page, channelId);
        await waitForNoteChannelLoaded(page, channelId);
        await waitForDatabaseLoaded(page, blockUuid);

        // Title still reflects the rename
        const persistedTitle = page.locator(`#db-${blockUuid} .db-title`);
        await expect(persistedTitle).toHaveValue(renamedTitle, { timeout: 10000 });

        // Alice's row is still there
        await expect(page.locator(`#db-${blockUuid} tr[data-row-id="${defaultRowId}"]`)).toBeVisible({ timeout: 5000 });

        // Row3 is gone
        await expect(page.locator(`#db-${blockUuid} tr[data-row-id="${row3Id}"]`)).toHaveCount(0);

        // Cell content persists (value is in the input inside the td)
        const persistedAlice = page.locator(`#db-${blockUuid} tr[data-row-id="${defaultRowId}"] td[data-col-id="${textColId}"] input`);
        await expect(persistedAlice).toHaveValue(`Alice ${suffix}`, { timeout: 5000 });
    });
});
