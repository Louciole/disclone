import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import { disconnectViaUi } from './helpers/messagingHelpers.mjs';
import {
    createServerViaUi,
    expectServerLoadedWithDefaultChannel,
    getServerIds,
    openServerFromSidebarById
} from './helpers/serverHelpers.mjs';

const TEST_TIMEOUT = 90000;

test.describe('Server creation - E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('User can create a server via UI and keep it after reload/relogin', async ({ page }) => {
        const suffix = Date.now();
        const account = `e2e_server_${suffix}`;

        // 1) Login with a fresh account
        await loginUser(page, account);
        expect(page.url()).toContain('/channels');
        await waitForAppReady(page);

        const beforeServerIds = await getServerIds(page);
        const beforeSidebarCount = await page.locator('#servers .item.serveur').count();

        // 2) Create server from the modal flow
        const createdServerId = await createServerViaUi(page);

        // 3) Validate immediate UI/state success
        const afterServerIds = await getServerIds(page);
        const afterSidebarCount = await page.locator('#servers .item.serveur').count();

        expect(afterServerIds.length).toBe(beforeServerIds.length + 1);
        expect(afterSidebarCount).toBe(beforeSidebarCount + 1);
        expect(afterServerIds).toContain(createdServerId);

        const createdServerName = await page.evaluate((id) => window.global?.servers?.[id]?.name, createdServerId);
        expect(createdServerName).toBe('New Server');

        // 4) Open the new server through the sidebar and verify default channel load
        await openServerFromSidebarById(page, createdServerId);
        await expectServerLoadedWithDefaultChannel(page, createdServerId);

        // 5) Reload and verify persistence
        await page.reload();
        await page.waitForURL('**/channels**', { timeout: 10000 });
        await waitForAppReady(page);

        const idsAfterReload = await getServerIds(page);
        expect(idsAfterReload).toContain(createdServerId);

        // 6) Logout/login and verify persistence again
        await disconnectViaUi(page);

        await loginUser(page, account);
        expect(page.url()).toContain('/channels');
        await waitForAppReady(page);

        const idsAfterRelogin = await getServerIds(page);
        expect(idsAfterRelogin).toContain(createdServerId);
    });
});

