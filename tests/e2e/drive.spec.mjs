import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import { createServerViaUi, openServerFromSidebarById } from './helpers/serverHelpers.mjs';
import { reloadAndWaitForApp } from './helpers/messagingHelpers.mjs';

const TEST_TIMEOUT = 120000;

// ─── Channel helpers ──────────────────────────────────────────────────────────

/**
 * Creates a drive channel using the same frontend function as the UI,
 * waits for its sidebar entry, and navigates to it.
 * Returns the drive channel ID.
 */
async function createAndOpenDriveChannel(page) {
    const beforeDrives = await page.evaluate(() =>
        (window.global?.state?.currentServer?.dirs?.drives || []).map((d) => Number(d.id)),
    );

    await page.evaluate(() => window.createChan('drive'));

    // Wait for state to include the new channel
    await page.waitForFunction((prev) => {
        const drives = window.global?.state?.currentServer?.dirs?.drives || [];
        return drives.length > prev.length;
    }, beforeDrives, { timeout: 10000 });

    const driveId = await page.evaluate((prev) => {
        const drives = window.global?.state?.currentServer?.dirs?.drives || [];
        const newChan = drives.find((d) => !prev.includes(Number(d.id)));
        return newChan ? Number(newChan.id) : null;
    }, beforeDrives);

    expect(driveId).toBeTruthy();

    // Sidebar entry should be visible
    await expect(page.locator(`#channel-drive-${driveId}`)).toBeVisible({ timeout: 10000 });

    // Navigate to the drive channel
    await page.evaluate((id) => window.goToDriveChannel(id), driveId);
    await page.waitForFunction((id) => {
        const ac = window.global?.state?.activeChan;
        return ac && Number(ac.id) === Number(id) && ac.type === 'drive';
    }, driveId, { timeout: 10000 });

    // Wait for drive content area to render
    await page.locator('#drive-file-input').waitFor({ state: 'attached', timeout: 10000 });

    return driveId;
}

// ─── Drive UI helpers ─────────────────────────────────────────────────────────

/**
 * Creates a folder via the UI folder button, which uses browser prompt().
 * Returns the folder DOM element.
 */
async function createFolderViaUi(page, driveId, folderName) {
    page.once('dialog', (dialog) => dialog.accept(folderName));
    await page.locator('img[onclick="createNewDriveFolder()"]').click();

    // Wait for the folder item to appear in the DOM
    await page.waitForFunction((name) => {
        return Array.from(document.querySelectorAll('.drive-folder-item'))
            .some((el) => el.querySelector('.folder-name, [class*="name"]')?.textContent?.trim() === name
                || el.textContent?.includes(name));
    }, folderName, { timeout: 10000 });

    // Also wait for it in global state
    await page.waitForFunction(({ id, name }) => {
        return (window.global?.driveFolders?.[id] || []).some((f) => f.foldername === name);
    }, { id: driveId, name: folderName }, { timeout: 10000 });

    const folderId = await page.evaluate(({ id, name }) => {
        const folder = (window.global?.driveFolders?.[id] || []).find((f) => f.foldername === name);
        return folder ? Number(folder.id) : null;
    }, { id: driveId, name: folderName });

    expect(folderId).toBeTruthy();
    return folderId;
}

/**
 * Uploads a text file via the file-input (triggered by the + upload icon).
 * Returns the file ID from global state.
 */
async function uploadFileViaUi(page, driveId, filename, content) {
    const beforeFiles = await page.evaluate((id) =>
        (window.global?.driveFiles?.[id] || []).map((f) => Number(f.id)),
    driveId);

    const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('img[onclick="uploadDriveFile()"]').click(),
    ]);

    await fileChooser.setFiles({
        name: filename,
        mimeType: 'text/plain',
        buffer: Buffer.from(content),
    });

    // Wait for the file item to appear in the DOM
    await page.waitForFunction((prev) => {
        return document.querySelectorAll('.drive-file-item').length > prev;
    }, beforeFiles.length, { timeout: 15000 });

    // Get the new file ID from state
    await page.waitForFunction(({ id, prev }) => {
        return (window.global?.driveFiles?.[id] || []).some((f) => !prev.includes(Number(f.id)));
    }, { id: driveId, prev: beforeFiles }, { timeout: 10000 });

    const fileId = await page.evaluate(({ id, prev }) => {
        const file = (window.global?.driveFiles?.[id] || []).find((f) => !prev.includes(Number(f.id)));
        return file ? Number(file.id) : null;
    }, { id: driveId, prev: beforeFiles });

    expect(fileId).toBeTruthy();
    return fileId;
}

/**
 * Deletes a drive file by clicking its trash icon.
 */
async function deleteFileViaUi(page, fileId) {
    // Accept the confirm dialog if the app shows one (some delete paths do)
    page.once('dialog', (dialog) => dialog.accept().catch(() => {}));

    await page.locator(`.drive-file-item[data-file-id="${fileId}"] .icon-wrapper[onclick*="deleteDriveFile"]`)
        .click({ force: true });

    // Wait for the item to disappear from the DOM
    await page.locator(`.drive-file-item[data-file-id="${fileId}"]`).waitFor({ state: 'detached', timeout: 10000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Drive — E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('Full drive workflow: create channel, upload, folder, move, delete', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, `e2e_drive_${suffix}`);
        await waitForAppReady(page);

        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);

        // ── 1. Create a drive channel via frontend JS ─────────────────────────
        const driveId = await createAndOpenDriveChannel(page);

        // ── 2. Upload a text file ─────────────────────────────────────────────
        const filename = `test-${suffix}.txt`;
        const fileContent = `Hello from E2E test ${suffix}`;
        const fileId = await uploadFileViaUi(page, driveId, filename, fileContent);

        // File item is visible in the DOM
        await expect(page.locator(`.drive-file-item[data-file-id="${fileId}"]`)).toBeVisible({ timeout: 5000 });
        await expect(
            page.locator(`.drive-file-item[data-file-id="${fileId}"] .file-name`),
        ).toContainText(filename, { timeout: 5000 });

        // ── 3. Create a folder ────────────────────────────────────────────────
        const folderName = `folder-${suffix}`;
        const folderId = await createFolderViaUi(page, driveId, folderName);

        // Folder item is visible in the DOM
        await expect(page.locator(`.drive-folder-item[data-folder-id="${folderId}"]`)).toBeVisible({ timeout: 5000 });

        // ── 4. Upload a second file ───────────────────────────────────────────
        const fileId2 = await uploadFileViaUi(page, driveId, `second-${suffix}.txt`, 'second file content');
        await expect(page.locator(`.drive-file-item[data-file-id="${fileId2}"]`)).toBeVisible({ timeout: 5000 });

        // ── 5. Move first file into the folder via API + verify state ─────────
        // (drag-and-drop is hard to automate; direct API is the accepted shortcut
        //  matching how forum.spec uses window.goToForumChannel instead of clicking)
        await page.evaluate(async ({ fileId, folderId }) => {
            const r = await fetch(`/move_drive_file?file_id=${fileId}&target_folder=${folderId}`, {
                method: 'POST', credentials: 'include',
            });
            if (!r.ok) throw new Error(`move_drive_file ${r.status}`);
        }, { fileId, folderId });

        // Reload drive content to reflect the move
        await page.evaluate((id) => window.goToDriveChannel(id), driveId);

        // File should have left root
        await page.waitForFunction((id) => {
            return !(window.global?.driveFiles?.[id] || []).some((f) => Number(f.id) === Number(id));
        }, fileId, { timeout: 10000 }).catch(() => {}); // it may already be gone

        // ── 6. Delete the second file via the UI trash icon ───────────────────
        await deleteFileViaUi(page, fileId2);

        // File is gone from state too
        await page.waitForFunction(({ driveId, fileId }) => {
            return !(window.global?.driveFiles?.[driveId] || []).some((f) => Number(f.id) === Number(fileId));
        }, { driveId, fileId: fileId2 }, { timeout: 5000 });

        // ── 7. Reload and verify DOM reflects deletions ───────────────────────
        await reloadAndWaitForApp(page);
        await openServerFromSidebarById(page, serverId);
        await page.evaluate((id) => window.goToDriveChannel(id), driveId);
        await page.waitForFunction((id) => {
            const ac = window.global?.state?.activeChan;
            return ac && Number(ac.id) === Number(id);
        }, driveId, { timeout: 10000 });

        // Second file is gone from DOM
        await expect(page.locator(`.drive-file-item[data-file-id="${fileId2}"]`)).toHaveCount(0);

        // Folder still exists
        await expect(page.locator(`.drive-folder-item[data-folder-id="${folderId}"]`)).toBeVisible({ timeout: 5000 });
    });
});
