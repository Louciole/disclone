import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import {
    createServerViaUi,
    openServerFromSidebarById,
    expectServerLoadedWithDefaultChannel
} from './helpers/serverHelpers.mjs';
import { sendMessageInActiveConversation } from './helpers/messagingHelpers.mjs';

const TEST_TIMEOUT = 120000;

/**
 * Register the service worker explicitly and wait until it controls the page.
 *
 * The app skips SW registration on localhost (so it never disrupts the dev
 * edit-reload loop), so the test registers it manually to exercise the real
 * offline path.
 */
async function registerServiceWorker(page) {
    await page.evaluate(async () => {
        await navigator.serviceWorker.register('/sw', { scope: '/' });
        await navigator.serviceWorker.ready;
    });
}

test.describe('Offline mode - E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('App boots offline from the snapshot and shows cached data', async ({ page, context }) => {
        const suffix = Date.now();

        // 1) Log in and register the service worker, then reload ONCE while online
        //    so the page becomes SW-controlled and the shell is cached.
        await loginUser(page, `e2e_offline_${suffix}`);
        await waitForAppReady(page);

        await registerServiceWorker(page);
        await page.reload();
        await page.waitForURL('**/channels**', { timeout: 15000 });
        await waitForAppReady(page);

        // Confirm the SW is now controlling the page (otherwise offline can't work).
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });

        // 2) Build some navigable state: a server with a message in its default channel.
        //    Done online and after SW control, so every template/module it needs is cached.
        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);
        await expectServerLoadedWithDefaultChannel(page, serverId);

        const messageText = `offline-msg-${suffix}`;
        await sendMessageInActiveConversation(page, messageText);

        // 3) Force a snapshot of global now that it holds the server + message.
        await page.evaluate(() => window.saveSnapshot());
        // Let the IndexedDB write settle.
        await page.waitForTimeout(500);

        // 4) GO OFFLINE and cold-reload.
        await context.setOffline(true);
        await page.reload();
        await page.waitForURL('**/channels**', { timeout: 15000 });

        // 5) The app must become ready WITHOUT a websocket (offline boot path).
        await page.waitForFunction(() => window.global?.state?._ready === true, null, { timeout: 15000 });

        // Loading screen is gone.
        await expect(page.locator('#loading-screen')).toBeHidden();

        // Offline UI signals.
        await expect(page.locator('body')).toHaveClass(/offline/);
        await expect(page.locator('#offline-banner')).toBeVisible();

        // 6) Snapshot rehydrated: the created server is present in global state.
        const serverPresent = await page.evaluate((id) => {
            return Object.values(window.global?.servers || {})
                .some((s) => Number(s?.id) === Number(id));
        }, serverId);
        expect(serverPresent).toBe(true);

        // The server icon is rendered in the sidebar from cached state.
        await expect(page.locator(`#servers .item.serveur`).first()).toBeVisible();

        // 7) Snapshot rehydrated: the message we sent survived in global.convs.
        const messagePersisted = await page.evaluate((text) => {
            const convs = window.global?.convs || {};
            for (const conv of Object.values(convs)) {
                const messages = conv?.messages || {};
                if (Object.values(messages).some((m) => m?.body === text)) return true;
            }
            return false;
        }, messageText);
        expect(messagePersisted).toBe(true);

        // Restore connectivity for any teardown.
        await context.setOffline(false);
    });

    test('Logout clears the offline snapshot', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, `e2e_offline_clr_${suffix}`);
        await waitForAppReady(page);

        // Write a snapshot, confirm it exists.
        await page.evaluate(() => window.saveSnapshot());
        await page.waitForTimeout(300);

        const existsBefore = await page.evaluate(async () => {
            const dbs = (await indexedDB.databases?.()) || [];
            return dbs.some((d) => d.name === 'mycelium');
        });
        expect(existsBefore).toBe(true);

        // Clear (what logout does) and confirm it's gone — no private data left behind.
        await page.evaluate(() => window.clearSnapshot());
        await page.waitForTimeout(300);

        const existsAfter = await page.evaluate(async () => {
            const dbs = (await indexedDB.databases?.()) || [];
            return dbs.some((d) => d.name === 'mycelium');
        });
        expect(existsAfter).toBe(false);
    });
});
