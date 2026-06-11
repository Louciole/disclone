import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import { createServerViaUi, openServerFromSidebarById } from './helpers/serverHelpers.mjs';
import { reloadAndWaitForApp } from './helpers/messagingHelpers.mjs';

const TEST_TIMEOUT = 90000;

// ─── UI helpers ───────────────────────────────────────────────────────────────

/**
 * Opens the "create poll" modal from the chat composer plus-menu.
 */
async function openPollCreationModal(page) {
    // Open the + flying-menu in the composer
    await page.locator('.chat-input .icon-wrapper[onclick*="chat-plus-menu"]').click();
    await page.locator('#chat-plus-menu').waitFor({ state: 'visible', timeout: 5000 });

    // Click the poll item
    await page.locator('#chat-plus-menu .item[onclick*="create-poll"]').click();
    await page.locator('#create-poll').waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Adds one option to the poll creation form.
 * Uses evaluate+dispatchEvent so the full text is committed in a single input event,
 * matching the oninput="addPollCreationOption(event)" handler exactly.
 */
async function addPollCreationOption(page, text) {
    await page.evaluate((value) => {
        const input = document.querySelector('.poll-add-option-trigger');
        if (!input) throw new Error('.poll-add-option-trigger not found');
        input.value = value;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    }, text);

    // Wait for the option to land in global state
    await page.waitForFunction((expected) => {
        return (window.global?.state?.pollOptions || []).includes(expected);
    }, text, { timeout: 5000 });
}

/**
 * Creates a poll through the UI modal and waits for the poll message to appear.
 * Returns { pollId, messageId } read from the DOM once the message is rendered.
 */
async function createPollViaUi(page, { question, options, multipleChoice = false, allowUserOptions = false }) {
    await openPollCreationModal(page);

    // Fill the question
    await page.fill('#poll-question', question);

    // Add each option
    for (const opt of options) {
        await addPollCreationOption(page, opt);
    }

    // Set toggles if needed
    if (multipleChoice) await page.locator('#poll-multiple-choice').check();
    if (allowUserOptions) await page.locator('#poll-allow-user-options').check();

    // Submit
    await page.locator('#create-poll .btn.blue[onclick="createPoll()"]').click();
    await page.locator('#create-poll').waitFor({ state: 'hidden', timeout: 10000 });

    // Wait for the poll message to render in the chat
    const pollMessage = page.locator('.poll-message').last();
    await pollMessage.waitFor({ state: 'visible', timeout: 10000 });
    await expect(pollMessage.locator('h3')).toContainText(question, { timeout: 5000 });

    // Read pollId from the DOM attribute
    const pollId = Number(await pollMessage.getAttribute('data-poll-id'));

    // Walk up to the parent message element to get its id
    const messageId = await page.evaluate((pid) => {
        const pollEl = document.querySelector(`.poll-message[data-poll-id="${pid}"]`);
        if (!pollEl) return null;
        let el = pollEl.parentElement;
        while (el && !el.id?.startsWith('message-')) el = el.parentElement;
        return el ? el.id.replace('message-', '') : null;
    }, pollId);

    expect(pollId).toBeGreaterThan(0);
    expect(messageId).toBeTruthy();

    return { pollId, messageId: Number(messageId) };
}

/**
 * Votes on a poll by clicking the first (or nth) option and then the Vote button.
 * Returns the text shown in .poll-vote-count after voting.
 */
async function voteOnPoll(page, messageId, optionIndex = 0) {
    const pollContainer = page.locator(`#message-${messageId} .poll-message`);

    // Click the option div (onclick="const cb=this.querySelector('input');cb.checked=...")
    await pollContainer.locator('.poll-option').nth(optionIndex).click();

    // Click "Vote"
    await pollContainer.locator('.btn.small.blue').click();

    // Wait for vote count to update
    await page.waitForFunction((msgId) => {
        const el = document.querySelector(`#message-${msgId} .poll-vote-count`);
        return el && !el.textContent.startsWith('0 ');
    }, messageId, { timeout: 10000 });

    return page.locator(`#message-${messageId} .poll-vote-count`).textContent();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Polls — E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('Create poll via UI, vote, add user option, verify count, reload persistence', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, `e2e_poll_${suffix}`);
        await waitForAppReady(page);

        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);

        // Grab the active channel ID (set when server opens on the default channel)
        const channelId = await page.evaluate(() => window.global?.state?.activeConv);
        expect(channelId).toBeTruthy();

        // ── 1. Create a single-choice poll via the UI ─────────────────────────
        const question = `Best colour? ${suffix}`;
        const { pollId, messageId } = await createPollViaUi(page, {
            question,
            options: ['Red', 'Green', 'Blue'],
        });

        // Poll options are rendered in the message
        const pollContainer = page.locator(`#message-${messageId} .poll-message`);
        await expect(pollContainer.locator('.poll-option')).toHaveCount(3, { timeout: 5000 });
        await expect(pollContainer.locator('.poll-vote-count')).toContainText('0 ', { timeout: 5000 });

        // ── 2. Vote on the first option ───────────────────────────────────────
        const voteCountText = await voteOnPoll(page, messageId, 0);
        expect(voteCountText).toContain('1 ');

        // ── 3. Switch vote to second option (re-vote) ─────────────────────────
        await pollContainer.locator('.poll-option').nth(1).click();
        await pollContainer.locator('.btn.small.blue').click();

        await page.waitForFunction((msgId) => {
            const el = document.querySelector(`#message-${msgId} .poll-vote-count`);
            return el && el.textContent.startsWith('1 ');
        }, messageId, { timeout: 10000 });

        // ── 4. Create a second poll with user options enabled ─────────────────
        const question2 = `Favourite season? ${suffix}`;
        const { pollId: pollId2, messageId: messageId2 } = await createPollViaUi(page, {
            question: question2,
            options: ['Summer', 'Winter'],
            allowUserOptions: true,
        });

        const pollContainer2 = page.locator(`#message-${messageId2} .poll-message`);
        await expect(pollContainer2.locator('.poll-option')).toHaveCount(2, { timeout: 5000 });

        // Add a user-created option via the add-option input (Enter key commits it)
        const userOption = `Spring ${suffix}`;
        const addOptionInput = pollContainer2.locator('.poll-add-option-input');
        await addOptionInput.fill(userOption);
        await addOptionInput.press('Enter');

        // Wait for the new option div to appear in the DOM
        await page.waitForFunction(({ msgId, text }) => {
            const container = document.querySelector(`#message-${msgId} .poll-message`);
            if (!container) return false;
            return Array.from(container.querySelectorAll('.poll-option span')).some(s => s.textContent.trim() === text);
        }, { msgId: messageId2, text: userOption }, { timeout: 10000 });

        await expect(pollContainer2.locator('.poll-option')).toHaveCount(3, { timeout: 5000 });

        // ── 5. Reload and verify polls persist ────────────────────────────────
        await reloadAndWaitForApp(page);

        // Navigate back to the server and channel
        await openServerFromSidebarById(page, serverId);
        await page.locator(`#channel-conv-${channelId}`).click();
        await page.waitForFunction((id) => window.global?.state?.activeConv === id, channelId, { timeout: 10000 });

        // Both poll messages should still be present
        await expect(page.locator(`.poll-message[data-poll-id="${pollId}"]`)).toBeVisible({ timeout: 10000 });
        await expect(page.locator(`.poll-message[data-poll-id="${pollId2}"]`)).toBeVisible({ timeout: 10000 });

        // Vote count should still reflect our vote
        await expect(page.locator(`[data-poll-id="${pollId}"] .poll-vote-count`)).toContainText('1 ', { timeout: 5000 });
    });

    test('Multiple-choice poll allows checking several options at once', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, `e2e_poll_mc_${suffix}`);
        await waitForAppReady(page);

        const serverId = await createServerViaUi(page);
        await openServerFromSidebarById(page, serverId);

        const { messageId } = await createPollViaUi(page, {
            question: `Pick all you like ${suffix}`,
            options: ['A', 'B', 'C'],
            multipleChoice: true,
        });

        const pollContainer = page.locator(`#message-${messageId} .poll-message`);

        // Check options A and C
        await pollContainer.locator('.poll-option').nth(0).click();
        await pollContainer.locator('.poll-option').nth(2).click();

        // Both checkboxes should be checked
        await expect(pollContainer.locator('.poll-option').nth(0).locator('input')).toBeChecked();
        await expect(pollContainer.locator('.poll-option').nth(2).locator('input')).toBeChecked();

        // Vote — count should become 1
        await pollContainer.locator('.btn.small.blue').click();
        await page.waitForFunction((msgId) => {
            const el = document.querySelector(`#message-${msgId} .poll-vote-count`);
            return el && !el.textContent.startsWith('0 ');
        }, messageId, { timeout: 10000 });

        await expect(pollContainer.locator('.poll-vote-count')).toContainText('1 ', { timeout: 5000 });
    });
});
