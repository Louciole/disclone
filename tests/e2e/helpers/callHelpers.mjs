/**
 * Helpers pour les tests E2E du CallManager
 * Évite la duplication de code et améliore la maintenabilité
 */

/**
 * Démarre un appel dans une conversation
 * @param {Page} page - La page Playwright
 * @param {number} convId - ID de la conversation
 * @param {string} callType - Type d'appel ('audio' ou 'video')
 * @returns {Promise<Object>} Les données de l'appel créé
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
 * Rejoint un appel existant
 * @param {Page} page - La page Playwright
 * @param {number} callId - ID de l'appel
 * @returns {Promise<Object>} Les données de l'appel après join
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
 * Quitte un appel
 * @param {Page} page - La page Playwright
 * @param {number} callId - ID de l'appel
 * @returns {Promise<Object>} Les données après avoir quitté
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
 * Récupère l'état actuel d'un appel
 * @param {Page} page - La page Playwright
 * @param {number} convId - ID de la conversation
 * @returns {Promise<Object|null>} L'état de l'appel ou null si pas actif
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
 * Crée une conversation
 * @param {Page} page - La page Playwright
 * @param {string} name - Nom de la conversation
 * @param {Array<number>} memberIds - IDs des membres à inviter
 * @returns {Promise<number>} L'ID de la conversation créée
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
 * Récupère les informations de l'utilisateur courant
 * @param {Page} page - La page Playwright
 * @returns {Promise<Object>} Les infos utilisateur
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
 * Attend que l'application soit complètement initialisée
 * @param {Page} page - La page Playwright
 * @param {number} timeout - Timeout en ms (défaut: 10000)
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
 * Attend que plusieurs utilisateurs soient prêts
 * @param {Array<Page>} pages - Les pages Playwright
 * @param {number} timeout - Timeout en ms (défaut: 10000)
 */
export async function waitForMultipleUsersReady(pages, timeout = 10000) {
    await Promise.all(pages.map(page => waitForAppReady(page, timeout)));
    console.log(`   ✅ ${pages.length} users ready`);
}
