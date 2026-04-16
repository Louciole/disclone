import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import { createServerViaUi, openServerFromSidebarById } from './helpers/serverHelpers.mjs';
import {
    createNoteChannelViaUi,
    createSpreadsheetBlock,
    cancelSpreadsheetCellEdit,
    editSpreadsheetCell,
    getSpreadsheetCellDisplayValue,
    getSpreadsheetCellEvaluatedValue,
    getSpreadsheetCellRawValue,
    openNoteChannel,
    reloadAndNavigateToNoteChannel,
    waitForNoteChannelLoaded,
    waitForSpreadsheetCellValue,
    waitForSpreadsheetLoaded,
} from './helpers/workspaceHelpers.mjs';

const TEST_TIMEOUT = 180000;

test.describe('Spreadsheet - E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('Full spreadsheet workflow: create, edit, formulas, persistence, live update', async ({ browser }) => {
        const suffix = Date.now();
        const username = `e2esheet_${suffix}`;

        // Shared state between phases
        let serverId;
        let channelId;
        let blockUuid;

        // ─── Phase 1: Setup — account, server, note channel, /sheet block ─────────

        const contextA = await browser.newContext();
        const pageA = await contextA.newPage();

        // 1) Create account and wait for WS connection
        await loginUser(pageA, username);
        expect(pageA.url()).toContain('/channels');
        await waitForAppReady(pageA);

        // 2) Create a server
        serverId = await createServerViaUi(pageA);
        expect(serverId).toBeTruthy();
        await openServerFromSidebarById(pageA, serverId);

        // 3) Create a note channel
        channelId = await createNoteChannelViaUi(pageA);
        expect(channelId).toBeTruthy();

        // 4) Open the note channel
        await openNoteChannel(pageA, channelId);
        await waitForNoteChannelLoaded(pageA, channelId);

        // 5) Create the spreadsheet block by typing /sheet
        blockUuid = await createSpreadsheetBlock(pageA, channelId);
        expect(blockUuid).toBeTruthy();

        // ─── Phase 2: Cell editing and formula evaluation ─────────────────────────

        // 6) Edit plain-text and numeric cells
        await editSpreadsheetCell(pageA, blockUuid, 'A1', '10');
        await editSpreadsheetCell(pageA, blockUuid, 'B1', '5');

        // Verify display values
        const a1Display = await getSpreadsheetCellDisplayValue(pageA, blockUuid, 'A1');
        const b1Display = await getSpreadsheetCellDisplayValue(pageA, blockUuid, 'B1');
        expect(String(a1Display).trim()).toBe('10');
        expect(String(b1Display).trim()).toBe('5');

        // 7) Enter formulas and verify evaluation
        await editSpreadsheetCell(pageA, blockUuid, 'A2', '=A1+B1');
        await waitForSpreadsheetCellValue(pageA, blockUuid, 'A2', 15);
        const a2Evaluated = await getSpreadsheetCellEvaluatedValue(pageA, blockUuid, 'A2');
        expect(Number(a2Evaluated)).toBe(15);

        await editSpreadsheetCell(pageA, blockUuid, 'B2', '=A1*B1');
        await waitForSpreadsheetCellValue(pageA, blockUuid, 'B2', 50);
        const b2Evaluated = await getSpreadsheetCellEvaluatedValue(pageA, blockUuid, 'B2');
        expect(Number(b2Evaluated)).toBe(50);

        // Verify the raw formulas are stored correctly
        const a2Raw = await getSpreadsheetCellRawValue(pageA, blockUuid, 'A2');
        const b2Raw = await getSpreadsheetCellRawValue(pageA, blockUuid, 'B2');
        expect(a2Raw).toBe('=A1+B1');
        expect(b2Raw).toBe('=A1*B1');

        // 8) Test Escape cancels an edit without saving
        const cellSel = `#sheet-${blockUuid} .sheet-cell[data-ref="C1"]`;
        await pageA.locator(cellSel).click();
        await pageA.locator(`#sheet-input-${blockUuid}`).waitFor({ state: 'visible', timeout: 5000 });
        await pageA.locator(`#sheet-input-${blockUuid}`).fill('SHOULD NOT SAVE');
        await cancelSpreadsheetCellEdit(pageA, blockUuid);

        const c1Raw = await getSpreadsheetCellRawValue(pageA, blockUuid, 'C1');
        expect(c1Raw).toBeNull(); // Escape should have discarded the value

        // ─── Phase 3: Persistence after full page reload ──────────────────────────

        // 9) Reload and navigate back; verify all saved values survive
        await reloadAndNavigateToNoteChannel(pageA, serverId, channelId, blockUuid);

        await waitForSpreadsheetCellValue(pageA, blockUuid, 'A1', 10);
        await waitForSpreadsheetCellValue(pageA, blockUuid, 'B1', 5);
        await waitForSpreadsheetCellValue(pageA, blockUuid, 'A2', 15);
        await waitForSpreadsheetCellValue(pageA, blockUuid, 'B2', 50);

        // Formula source must still be the raw formula, not the computed value
        const a2RawAfterReload = await getSpreadsheetCellRawValue(pageA, blockUuid, 'A2');
        expect(a2RawAfterReload).toBe('=A1+B1');

        // Escaped value must still be absent
        const c1RawAfterReload = await getSpreadsheetCellRawValue(pageA, blockUuid, 'C1');
        expect(c1RawAfterReload).toBeNull();

        // ─── Phase 4: Live-update — second context sees data and new edits ─────────

        // 10) Open a second browser context with the same account
        const contextB = await browser.newContext();
        const pageB = await contextB.newPage();

        await loginUser(pageB, username);
        expect(pageB.url()).toContain('/channels');
        await waitForAppReady(pageB);

        // Navigate to the same server and note channel
        await openServerFromSidebarById(pageB, serverId);
        await openNoteChannel(pageB, channelId);
        await waitForNoteChannelLoaded(pageB, channelId);
        await waitForSpreadsheetLoaded(pageB, blockUuid);

        // 11) Context B should see the data saved by context A
        await waitForSpreadsheetCellValue(pageB, blockUuid, 'A1', 10);
        await waitForSpreadsheetCellValue(pageB, blockUuid, 'A2', 15);

        const a2DisplayOnB = await getSpreadsheetCellDisplayValue(pageB, blockUuid, 'A2');
        expect(String(a2DisplayOnB).trim()).toBe('15');

        // 12) Context A edits a new cell; context B reloads and must see the change
        await editSpreadsheetCell(pageA, blockUuid, 'C1', 'LIVE');

        // Context B reloads; after navigation the new value should be present
        await reloadAndNavigateToNoteChannel(pageB, serverId, channelId, blockUuid);
        await waitForSpreadsheetCellValue(pageB, blockUuid, 'C1', 'LIVE');

        const c1DisplayOnB = await getSpreadsheetCellDisplayValue(pageB, blockUuid, 'C1');
        expect(String(c1DisplayOnB).trim()).toBe('LIVE');

        // ─── Cleanup ──────────────────────────────────────────────────────────────
        await contextA.close();
        await contextB.close();
    });
});
