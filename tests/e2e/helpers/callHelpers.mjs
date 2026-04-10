/**
 * Helpers for CallManager E2E tests.
 * Avoids code duplication and improves maintainability.
 */

/**
 * Starts a call in a conversation.
 * @param {Page} page - The Playwright page
 * @param {number} convId - Conversation ID
 * @param {string} callType - Call type ('audio' or 'video')
 * @returns {Promise<Object>} The created call data
 */
export async function startCall(page, convId, callType = 'audio') {
    const callData = await page.evaluate(async ({ convId, callType }) => {
        const response = await fetch(`/startCall?conversation_id=${convId}&call_type=${callType}`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to start call: ${response.status} - ${errorText}`);
        }
        return response.json();
    }, { convId, callType });

    console.log(`   ✅ Call started: ID=${callData.id}, mode=${callData.mode}, type=${callType}`);
    return callData;
}

/**
 * Joins an existing call.
 * @param {Page} page - The Playwright page
 * @param {number} callId - Call ID
 * @returns {Promise<Object>} Call data after joining
 */
export async function joinCall(page, callId) {
    const joinData = await page.evaluate(async (callId) => {
        const response = await fetch(`/joinCall?call_id=${callId}`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to join call: ${response.status} - ${errorText}`);
        }
        return response.json();
    }, callId);

    console.log(`   ✅ Joined call: ${joinData.call.participant_count} participants, mode=${joinData.call.mode}`);
    return joinData;
}

/**
 * Leaves a call.
 * @param {Page} page - The Playwright page
 * @param {number} callId - Call ID
 * @returns {Promise<Object>} Data after leaving
 */
export async function leaveCall(page, callId) {
    const leaveData = await page.evaluate(async (callId) => {
        const response = await fetch(`/leaveCall?call_id=${callId}`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to leave call: ${response.status} - ${errorText}`);
        }
        return response.json();
    }, callId);

    console.log(`   ✅ Left call: ended=${leaveData.ended}, mode_changed=${leaveData.mode_changed}`);
    return leaveData;
}

/**
 * Gets the current state of a call.
 * @param {Page} page - The Playwright page
 * @param {number} convId - Conversation ID
 * @returns {Promise<Object|null>} The call state, or null if inactive
 */
export async function getCallState(page, convId) {
    const callState = await page.evaluate(async (convId) => {
        const response = await fetch(`/getCallState?conversation_id=${convId}`, {
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error(`Failed to get call state: ${response.status}`);
        }
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error(`Failed to parse JSON: ${text.substring(0, 200)}`);
        }
    }, convId);

    console.log(`   🔍 Call state: ${callState?.active === false ? 'inactive' : `active, ${callState.participant_count} participants`}`);
    return callState;
}

/**
 * Creates a conversation.
 * @param {Page} page - The Playwright page
 * @param {string} name - Conversation name
 * @param {Array<number>} memberIds - IDs of members to invite
 * @returns {Promise<number>} The created conversation ID
 */
export async function createConversation(page, name, memberIds = []) {
    const convId = await page.evaluate(async ({ name, memberIds }) => {
        const response = await fetch(
            `/createConv?name=${encodeURIComponent(name)}&members=${JSON.stringify(memberIds)}&private=true`,
            {
                method: 'POST',
                credentials: 'include'
            }
        );
        if (!response.ok) {
            throw new Error(`Failed to create conversation: ${response.status}`);
        }
        const text = await response.text();
        return parseInt(text.replace(/"/g, ''));
    }, { name, memberIds });

    console.log(`   ✅ Conversation created: ID=${convId}, members=${memberIds.length + 1}`);
    return convId;
}

/**
 * Gets the current user's information.
 * @param {Page} page - The Playwright page
 * @returns {Promise<Object>} User info
 */
export async function getUserInfo(page) {
    const userInfo = await page.evaluate(async () => {
        const response = await fetch('/getUserInfo', {
            method: 'POST',
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error(`Failed to get user info: ${response.status}`);
        }
        return response.json();
    });

    return userInfo;
}

/**
 * Waits until the application is fully initialized.
 * @param {Page} page - The Playwright page
 * @param {number} timeout - Timeout in ms (default: 10000)
 */
export async function waitForAppReady(page, timeout = 10000) {
    await page.waitForFunction(() => {
        return window.global?.state?.websocket?.readyState === WebSocket.OPEN
            && window.global?.state?.callManager !== undefined
            && window.global?.state?.clientID !== undefined;
    }, { timeout });

    console.log('   ✅ App ready: WebSocket connected and CallManager initialized');
}

/**
 * Waits until multiple users are ready.
 * @param {Array<Page>} pages - Playwright pages
 * @param {number} timeout - Timeout in ms (default: 10000)
 */
export async function waitForMultipleUsersReady(pages, timeout = 10000) {
    await Promise.all(pages.map(page => waitForAppReady(page, timeout)));
    console.log(`   ✅ ${pages.length} users ready`);
}
