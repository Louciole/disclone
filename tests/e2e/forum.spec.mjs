import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import {
    createServerViaUi,
    openServerFromSidebarById,
} from './helpers/serverHelpers.mjs';
import { sendMessageInActiveConversation } from './helpers/messagingHelpers.mjs';

const TEST_TIMEOUT = 90000;

test.describe('Forum channels - E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('Create forum, add a post, reply, and toggle layout', async ({ page }) => {
        const suffix = Date.now();
        const account = `e2e_forum_${suffix}`;

        // 1) Login + create/open a server
        await loginUser(page, account);
        await waitForAppReady(page);

        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);

        // 2) Create a forum channel (via the same handler the channel picker calls)
        await page.evaluate(() => window.createChan('forum'));
        await page.waitForFunction(
            () => (window.global?.state?.currentServer?.dirs?.forums || []).length > 0,
            undefined,
            { timeout: 10000 },
        );
        const forumId = await page.evaluate(
            () => Number(window.global.state.currentServer.dirs.forums[0].id),
        );
        expect(forumId).toBeTruthy();

        // Sidebar entry exists
        await expect(page.locator(`#channel-forum-${forumId}`)).toBeVisible({ timeout: 10000 });

        // 3) Open the forum -> post browser renders
        await page.evaluate((id) => window.goToForumChannel(id), forumId);
        await page.locator('.forum-new-post-btn').waitFor({ state: 'visible', timeout: 10000 });
        await expect(page.locator('.forum-empty')).toBeVisible();

        // 4) Create a post through the modal
        await page.locator('.forum-new-post-btn').click();
        await page.locator('#create-forum-post').waitFor({ state: 'visible', timeout: 5000 });

        const title = `First topic ${suffix}`;
        const starter = `Starter message ${suffix}`;
        await page.fill('#create-forum-post [data-post-title]', title);
        await page.fill('#create-forum-post [data-post-content]', starter);
        await page.locator('#create-forum-post .btn.blue').click();

        // 5) Lands in the open post view with the starter message
        await page.waitForFunction(
            () => Boolean(window.global?.state?.activeConv) &&
                  window.global?.convs?.[window.global.state.activeConv]?.forum,
            undefined,
            { timeout: 10000 },
        );
        await expect(page.locator('.forum-open-title')).toContainText(title);
        await expect(page.locator('.message .mdBlock').filter({ hasText: starter })).toBeVisible({ timeout: 10000 });

        // 6) Reply in the post thread (reuses the standard composer + backend message path)
        const reply = `A reply ${suffix}`;
        await sendMessageInActiveConversation(page, reply);
        await expect(page.locator('.message .mdBlock').filter({ hasText: reply })).toBeVisible({ timeout: 10000 });

        // 7) Back to the forum: the post now shows in the list with a reply count
        await page.evaluate(() => window.backToForum());
        await page.locator('.forum-post-card').first().waitFor({ state: 'visible', timeout: 10000 });
        await expect(page.locator('.forum-post-title').filter({ hasText: title })).toBeVisible();

        // 8) Layout toggle switches the container class
        await page.locator('.forum-layout-btn').nth(1).click(); // gallery
        await expect(page.locator('.forum-gallery')).toBeVisible({ timeout: 5000 });
        await page.locator('.forum-layout-btn').nth(0).click(); // list
        await expect(page.locator('.forum-list')).toBeVisible({ timeout: 5000 });
    });
});
