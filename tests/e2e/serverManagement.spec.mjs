import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import { createServerViaUi, openServerFromSidebarById } from './helpers/serverHelpers.mjs';
import { reloadAndWaitForApp } from './helpers/messagingHelpers.mjs';

const TEST_TIMEOUT = 120000;

// ─── Thin API helpers (used only for ops that have no accessible UI path) ─────

async function apiPost(page, path) {
    return page.evaluate(async (path) => {
        const r = await fetch(path, { method: 'POST', credentials: 'include' });
        if (!r.ok) { const t = await r.text(); throw new Error(`POST ${path} → ${r.status}: ${t}`); }
        return r.json();
    }, path);
}

async function apiGet(page, path) {
    return page.evaluate(async (path) => {
        const r = await fetch(path, { credentials: 'include' });
        if (!r.ok) { const t = await r.text(); throw new Error(`GET ${path} → ${r.status}: ${t}`); }
        return r.json();
    }, path);
}

// ─── Channel helpers — creation via window.createChan (same as forum.spec) ────

/**
 * Creates a textual channel via the frontend helper, then waits for the
 * sidebar entry `#channel-conv-{id}` to appear. Returns the channel ID.
 */
async function createTextualChannelViaUi(page) {
    const before = await page.evaluate(() =>
        (window.global?.state?.currentServer?.dirs?.channels || []).map((c) => Number(c.id)),
    );

    await page.evaluate(() => window.createChan('textual'));

    await page.waitForFunction((prev) => {
        const channels = window.global?.state?.currentServer?.dirs?.channels || [];
        return channels.length > prev.length;
    }, before, { timeout: 10000 });

    const channelId = await page.evaluate((prev) => {
        const ch = (window.global?.state?.currentServer?.dirs?.channels || [])
            .find((c) => !prev.includes(Number(c.id)));
        return ch ? Number(ch.id) : null;
    }, before);

    expect(channelId).toBeTruthy();

    // Sidebar entry must be visible right away
    await expect(page.locator(`#channel-conv-${channelId}`)).toBeVisible({ timeout: 10000 });

    return channelId;
}

// ─── Category helpers (no direct UI button — API calls only) ──────────────────

async function createCategory(page, serverId) {
    return apiPost(page, `/edit_server_category?server_id=${serverId}&action=create`);
}

async function renameCategory(page, serverId, catId, name) {
    return apiPost(page, `/edit_server_category?server_id=${serverId}&action=edit&field=name&value=${encodeURIComponent(name)}&targetId=${catId}`);
}

async function deleteCategory(page, serverId, catId) {
    return apiPost(page, `/edit_server_category?server_id=${serverId}&action=delete&targetId=${catId}`);
}

// ─── Channel permission helpers ───────────────────────────────────────────────

async function toggleChannelPrivacy(page, channelId, channelType) {
    return apiPost(page, `/edit_channel_permissions?channelId=${channelId}&channelType=${channelType}&action=togglePrivacy`);
}

async function addRoleToChannel(page, channelId, channelType, roleId) {
    return apiPost(page, `/edit_channel_permissions?channelId=${channelId}&channelType=${channelType}&action=addRole&roleId=${roleId}`);
}

async function getChannelPermissions(page, channelId, channelType) {
    return apiGet(page, `/get_channel_permissions?channelId=${channelId}&channelType=${channelType}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Server management — E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('Textual channel lifecycle: create via UI, sidebar appears, rename, delete → sidebar gone', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, `e2e_smgmt_ch_${suffix}`);
        await waitForAppReady(page);

        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);

        // ── 1. Create channel via frontend function ────────────────────────────
        const channelId = await createTextualChannelViaUi(page);
        const sidebarEntry = page.locator(`#channel-conv-${channelId}`);
        await expect(sidebarEntry).toBeVisible();

        // ── 2. Rename via API, then check the sidebar label updates ───────────
        const newName = `secret-room-${suffix}`;
        const renameResult = await apiPost(
            page,
            `/edit_server_channel?server_id=${serverId}&action=edit&field=name&value=${encodeURIComponent(newName)}&targetId=${channelId}&channel_type=textual`,
        );
        expect(renameResult).toMatchObject({ status: 'ok' });

        // Force the frontend to refresh the server structure
        await page.evaluate((id) => {
            if (typeof window.loadServer === 'function') window.loadServer(id);
        }, serverId);

        // Sidebar entry text should eventually contain the new name
        await expect(sidebarEntry).toContainText(newName, { timeout: 10000 });

        // ── 3. Toggle privacy on/off ──────────────────────────────────────────
        const p1 = await toggleChannelPrivacy(page, channelId, 'textual');
        expect(p1.is_private).toBe(true);

        const p2 = await toggleChannelPrivacy(page, channelId, 'textual');
        expect(p2.is_private).toBe(false);

        // ── 4. Delete channel — sidebar entry must disappear ──────────────────
        const delResult = await apiPost(
            page,
            `/edit_server_channel?server_id=${serverId}&action=delete&targetId=${channelId}&channel_type=textual`,
        );
        expect(delResult).toMatchObject({ status: 'ok' });

        // Frontend should remove the entry after delete (either via WS push or reload)
        await page.evaluate((id) => {
            if (typeof window.loadServer === 'function') window.loadServer(id);
        }, serverId);
        await sidebarEntry.waitFor({ state: 'detached', timeout: 10000 });

        // ── 5. Reload and confirm channel is gone from state ──────────────────
        await reloadAndWaitForApp(page);
        await openServerFromSidebarById(page, serverId);

        const stillExists = await page.evaluate(({ srvId, chId }) => {
            const server = window.global?.state?.currentServer;
            if (!server || Number(server.id) !== Number(srvId)) return false;
            return (server.dirs?.channels || []).some((c) => Number(c.id) === Number(chId));
        }, { srvId: serverId, chId: channelId });

        expect(stillExists).toBe(false);
    });

    test('Category lifecycle: create, rename, assign channel, verify sidebar, delete', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, `e2e_smgmt_cat_${suffix}`);
        await waitForAppReady(page);

        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);

        // ── 1. Create a category via API ──────────────────────────────────────
        const cat = await createCategory(page, serverId);
        expect(cat.id).toBeTruthy();
        expect(cat.name).toBe('New Category');

        // ── 2. Rename it ──────────────────────────────────────────────────────
        const catName = `My Category ${suffix}`;
        await renameCategory(page, serverId, cat.id, catName);

        // ── 3. Create a textual channel via the frontend function ──────────────
        const channelId = await createTextualChannelViaUi(page);
        await expect(page.locator(`#channel-conv-${channelId}`)).toBeVisible();

        // Assign channel to the category
        await apiPost(
            page,
            `/edit_server_channel?server_id=${serverId}&action=edit&field=category&value=${cat.id}&targetId=${channelId}&channel_type=textual`,
        );

        // ── 4. Reload and verify channel is under the category in state ────────
        await reloadAndWaitForApp(page);
        await openServerFromSidebarById(page, serverId);

        const catChannels = await page.evaluate(({ srvId, catId }) => {
            const server = window.global?.state?.currentServer;
            if (!server || Number(server.id) !== Number(srvId)) return [];
            return (server.dirs?.channels || []).filter((ch) => Number(ch.category) === Number(catId));
        }, { srvId: serverId, catId: cat.id });

        expect(catChannels.length).toBeGreaterThanOrEqual(1);
        expect(Number(catChannels[0].id)).toBe(channelId);

        // Channel sidebar entry still visible after reload
        await expect(page.locator(`#channel-conv-${channelId}`)).toBeVisible({ timeout: 10000 });

        // ── 5. Cleanup: delete channel then category ──────────────────────────
        await apiPost(page, `/edit_server_channel?server_id=${serverId}&action=delete&targetId=${channelId}&channel_type=textual`);
        await deleteCategory(page, serverId, cat.id);
    });

    test('Role lifecycle: create, assign to private channel, permissions visible, delete', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, `e2e_smgmt_role_${suffix}`);
        await waitForAppReady(page);

        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);

        // Create a role
        const { id: roleId } = await apiPost(page, `/edit_server_role?server_id=${serverId}&action=create`);
        expect(roleId).toBeTruthy();

        // Create a textual channel via UI
        const channelId = await createTextualChannelViaUi(page);
        await expect(page.locator(`#channel-conv-${channelId}`)).toBeVisible();

        // Make it private and add the role
        const privacyResult = await toggleChannelPrivacy(page, channelId, 'textual');
        expect(privacyResult.is_private).toBe(true);

        await addRoleToChannel(page, channelId, 'textual', roleId);

        // get_channel_permissions shows the role entry
        const perms = await getChannelPermissions(page, channelId, 'textual');
        expect(Array.isArray(perms)).toBe(true);
        const roleEntry = perms.find((p) => Number(p.role) === Number(roleId));
        expect(roleEntry).toBeDefined();

        // Cleanup
        await apiPost(page, `/edit_server_channel?server_id=${serverId}&action=delete&targetId=${channelId}&channel_type=textual`);
        await apiPost(page, `/edit_server_role?server_id=${serverId}&action=delete&targetId=${roleId}`);
    });

    test('Non-textual channel types (vocal, drive) created via UI appear in sidebar', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, `e2e_smgmt_types_${suffix}`);
        await waitForAppReady(page);

        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);

        // ── vocal channel ─────────────────────────────────────────────────────
        const beforeVocal = await page.evaluate(() =>
            (window.global?.state?.currentServer?.dirs?.vocals || []).map((c) => Number(c.id)),
        );
        await page.evaluate(() => window.createChan('vocal'));
        await page.waitForFunction((prev) => {
            return (window.global?.state?.currentServer?.dirs?.vocals || []).length > prev.length;
        }, beforeVocal, { timeout: 10000 });

        const vocalId = await page.evaluate((prev) => {
            const ch = (window.global?.state?.currentServer?.dirs?.vocals || [])
                .find((c) => !prev.includes(Number(c.id)));
            return ch ? Number(ch.id) : null;
        }, beforeVocal);
        expect(vocalId).toBeTruthy();
        await expect(page.locator(`#channel-vocal-${vocalId}`)).toBeVisible({ timeout: 10000 });

        // ── drive channel ─────────────────────────────────────────────────────
        const beforeDrive = await page.evaluate(() =>
            (window.global?.state?.currentServer?.dirs?.drives || []).map((c) => Number(c.id)),
        );
        await page.evaluate(() => window.createChan('drive'));
        await page.waitForFunction((prev) => {
            return (window.global?.state?.currentServer?.dirs?.drives || []).length > prev.length;
        }, beforeDrive, { timeout: 10000 });

        const driveId = await page.evaluate((prev) => {
            const ch = (window.global?.state?.currentServer?.dirs?.drives || [])
                .find((c) => !prev.includes(Number(c.id)));
            return ch ? Number(ch.id) : null;
        }, beforeDrive);
        expect(driveId).toBeTruthy();
        await expect(page.locator(`#channel-drive-${driveId}`)).toBeVisible({ timeout: 10000 });

        // ── Delete both via API and verify they leave the sidebar ─────────────
        await apiPost(page, `/edit_server_channel?server_id=${serverId}&action=delete&targetId=${vocalId}&channel_type=vocal`);
        await apiPost(page, `/edit_server_channel?server_id=${serverId}&action=delete&targetId=${driveId}&channel_type=drive`);

        await page.evaluate((id) => { if (typeof window.loadServer === 'function') window.loadServer(id); }, serverId);

        await page.locator(`#channel-vocal-${vocalId}`).waitFor({ state: 'detached', timeout: 10000 });
        await page.locator(`#channel-drive-${driveId}`).waitFor({ state: 'detached', timeout: 10000 });
    });
});
