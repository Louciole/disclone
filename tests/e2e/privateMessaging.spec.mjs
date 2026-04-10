import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import {
    addReactionToMessageById,
    acceptFriendRequestFromUsername,
    deleteMessageById,
    disconnectViaUi,
    editMessageById,
    expectReactionVisibleForMessage,
    expectMessageNotVisible,
    expectMessageVisible,
    getMessageIdByBody,
    getPrivateConversationIdWithUsername,
    openFriendsArea,
    openPrivateConversation,
    reloadAndRestoreConversation,
    reloadAndWaitForApp,
    replyToMessage,
    sendFriendRequestToUsername,
    sendMessageInActiveConversation
} from './helpers/messagingHelpers.mjs';

const TEST_TIMEOUT = 120000;

test.describe('Private messaging - E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('Friend request flow and private messaging lifecycle works via UI', async ({ page }) => {
        const suffix = Date.now();
        const account1 = `e2emsg_a_${suffix}`;
        const account2 = `e2emsg_b_${suffix}`;
        let account1Username;
        let account2Username;

        // 1) Create first account then disconnect
        await loginUser(page, account1);
        expect(page.url()).toContain('/channels');
        await waitForAppReady(page);
        account1Username = await page.evaluate(() => window.global?.user?.username);
        expect(account1Username).toBeTruthy();
        await disconnectViaUi(page);

        // 2) Create second account and send friend request to account1
        await loginUser(page, account2);
        expect(page.url()).toContain('/channels');
        await waitForAppReady(page);
        account2Username = await page.evaluate(() => window.global?.user?.username);
        expect(account2Username).toBeTruthy();

        await openFriendsArea(page);
        await sendFriendRequestToUsername(page, account1Username);
        await disconnectViaUi(page);

        // 3) Login as account1, accept invitation and open created private conversation
        await loginUser(page, account1);
        expect(page.url()).toContain('/channels');
        await waitForAppReady(page);

        await openFriendsArea(page);
        await acceptFriendRequestFromUsername(page, account2Username);

        // Le flux d'acceptation met surtout a jour l'etat local, on recharge pour sync la nouvelle conv
        await reloadAndWaitForApp(page);
        const privateConvId = await getPrivateConversationIdWithUsername(page, account2Username);
        expect(privateConvId).toBeGreaterThan(0);

        await openPrivateConversation(page, privateConvId);

        // 4) Send original message + verify success
        const originalMessage = `original message ${suffix}`;
        await sendMessageInActiveConversation(page, originalMessage);
        const originalMessageId = await getMessageIdByBody(page, originalMessage);
        expect(originalMessageId).not.toBeNull();
        expect(originalMessageId).toBeGreaterThanOrEqual(0);

        // 5) Check message persistence after reload
        await reloadAndRestoreConversation(page, privateConvId);
        await expectMessageVisible(page, originalMessage);
        const persistedOriginalMessageId = await getMessageIdByBody(page, originalMessage);
        expect(persistedOriginalMessageId).not.toBeNull();
        expect(persistedOriginalMessageId).toBeGreaterThanOrEqual(0);

        // 5.1) Add a reaction to the original message and verify UI update
        const selectedReaction = await addReactionToMessageById(page, persistedOriginalMessageId);
        await expectReactionVisibleForMessage(page, persistedOriginalMessageId, selectedReaction);

        // 6) Reply to original message
        const replyMessage = `reply message ${suffix}`;
        await replyToMessage(page, persistedOriginalMessageId, replyMessage);
        const optimisticReplyMessageId = await getMessageIdByBody(page, replyMessage);
        expect(optimisticReplyMessageId).not.toBeNull();
        expect(optimisticReplyMessageId).toBeGreaterThanOrEqual(0);

        // Recharge pour recuperer les IDs persistes cote serveur
        await reloadAndRestoreConversation(page, privateConvId);
        const persistedOriginalForFinalOps = await getMessageIdByBody(page, originalMessage);
        const persistedReplyMessageId = await getMessageIdByBody(page, replyMessage);
        expect(persistedOriginalForFinalOps).not.toBeNull();
        expect(persistedReplyMessageId).not.toBeNull();

        // 7) Delete the reply message
        await deleteMessageById(page, persistedReplyMessageId);

        // 8) Edit the original message
        const editedOriginalMessage = `edited original message ${suffix}`;
        await editMessageById(page, persistedOriginalForFinalOps, editedOriginalMessage);

        // 9) Reload and verify final persisted state
        await reloadAndRestoreConversation(page, privateConvId);
        await expectMessageVisible(page, editedOriginalMessage);
        await expectMessageNotVisible(page, replyMessage);

        const finalOriginalMessageId = await getMessageIdByBody(page, editedOriginalMessage);
        expect(finalOriginalMessageId).not.toBeNull();
        await expectReactionVisibleForMessage(page, finalOriginalMessageId, selectedReaction);
    });
});






