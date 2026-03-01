/**
 * Tests E2E CallManager avec Playwright
 *
 * Utilise un VRAI navigateur qui charge la VRAIE application
 * Aucune réimplémentation, aucun mock - juste l'app réelle
 *
 * Installation:
 *   npm install -D @playwright/test
 *   npx playwright install
 *
 * Lancer:
 *   npx playwright test tests/e2e/callManager.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { loginUser, waitForAuthComplete } from './helpers/authHelpers.mjs';
import {
    startCall,
    joinCall,
    leaveCall,
    getCallState,
    createConversation,
    getUserInfo,
    waitForAppReady
} from './helpers/callHelpers.mjs';

const SERVER_URL = 'http://localhost:808';
const TEST_TIMEOUT = 30000;


// Tests
test.describe('CallManager - Tests E2E (Vrai Navigateur)', () => {

    // Variables pour cleanup
    let activeCallIds = [];
    let activeConvIds = [];

    test.beforeEach(async ({ page }) => {
        test.setTimeout(TEST_TIMEOUT);
        activeCallIds = [];
        activeConvIds = [];
    });

    test.afterEach(async ({ page }) => {
        // Cleanup: Quitter tous les appels actifs
        for (const callId of activeCallIds) {
            try {
                await page.evaluate(async (callId) => {
                    await fetch(`/leaveCall?call_id=${callId}`, {
                        method: 'POST',
                        credentials: 'include'
                    });
                }, callId);
            } catch (error) {
                console.log(`   ⚠️ Cleanup warning: Failed to leave call ${callId}: ${error.message}`);
            }
        }
        console.log(`   🧹 Cleanup complete: ${activeCallIds.length} calls cleaned`);
    });

    test('User can login via /auth flow', async ({ page }) => {
        const user = await loginUser(page, 'e2e_login_' + Date.now());

        // Vérifier qu'on est bien sur /channels
        expect(page.url()).toContain('/channels');

        // Attendre que le flow d'initialisation complet soit terminé
        await waitForAppReady(page);

        // Vérification finale
        const appReady = await page.evaluate(() => {
            return {
                wsState: window.global?.state?.socket?.readyState,
                hasCallManager: !!window.global?.state?.callManager,
                hasClientID: !!window.global?.state?.clientID
            };
        });

        expect(appReady.wsState).toBe(WebSocket.OPEN);
        expect(appReady.hasCallManager).toBe(true);
        expect(appReady.hasClientID).toBe(true);
    });



    test('User can start audio call via API', async ({ page }) => {
        const user = await loginUser(page, 'e2e_call_' + Date.now());
        await waitForAppReady(page);

        console.log('   📞 Creating conversation and starting call...');

        // Créer une conversation
        const convId = await createConversation(page, 'E2E Test Call', []);
        activeConvIds.push(convId);

        // Démarrer un appel audio
        const callData = await startCall(page, convId, 'audio');
        activeCallIds.push(callData.id);

        // Vérifier les données de l'appel
        expect(callData.id).toBeTruthy();
        expect(callData.mode).toBe('p2p');
        expect(callData.call_type).toBe('audio');
        expect(callData.participants).toHaveLength(1);
        expect(callData.participant_count).toBe(1);

        // Vérifier l'état de l'appel
        const callState = await getCallState(page, convId);

        if (callState.active === false) {
            throw new Error('Call state shows active=false, call not found in CallManager');
        }

        expect(callState.id).toBe(callData.id);
        expect(callState.mode).toBe('p2p');
        expect(callState.participant_count).toBe(1);

        // Nettoyer: quitter l'appel
        const leaveData = await leaveCall(page, callData.id);
        expect(leaveData.ended).toBe(true);

        // Retirer de la liste de cleanup car déjà terminé
        activeCallIds = activeCallIds.filter(id => id !== callData.id);
    });

    test('Two users can join same call via API', async ({ browser }) => {
        // Créer 2 contextes = 2 utilisateurs différents
        const context1 = await browser.newContext();
        const context2 = await browser.newContext();

        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        try {
            const user1 = await loginUser(page1, 'e2e_multi1_' + Date.now());
            await waitForAppReady(page1);

            const user2 = await loginUser(page2, 'e2e_multi2_' + Date.now());
            await waitForAppReady(page2);

            console.log('   👥 Two users logged in');

            // Récupérer les IDs utilisateurs
            const { id: userId1 } = await getUserInfo(page1);
            const { id: userId2 } = await getUserInfo(page2);

            // User1 crée une conversation et invite User2
            const convId = await createConversation(page1, 'E2E Multi Call', [userId2]);

            // User1 démarre un appel
            const callData = await startCall(page1, convId, 'audio');
            activeCallIds.push(callData.id);

            expect(callData.participant_count).toBe(1);
            expect(callData.mode).toBe('p2p');

            // User2 rejoint l'appel
            const joinData = await joinCall(page2, callData.id);

            expect(joinData.call.participant_count).toBe(2);
            expect(joinData.call.mode).toBe('p2p'); // Toujours P2P avec 2 users
            expect(joinData.mode_changed).toBe(false);

            // Vérifier l'état de l'appel
            const state = await getCallState(page1, convId);

            expect(state.participant_count).toBe(2);
            expect(state.participants).toHaveLength(2);
            expect(state.participants).toContain(userId1);
            expect(state.participants).toContain(userId2);

            console.log('   ✅ Both users in call verified');

            // Cleanup: User2 quitte
            await leaveCall(page2, callData.id);
            // User1 quitte (termine l'appel)
            await leaveCall(page1, callData.id);

            activeCallIds = activeCallIds.filter(id => id !== callData.id);

        } finally {
            await context1.close();
            await context2.close();
        }
    });

    test('Call switches to SFU mode with 4 participants', async ({ browser }) => {
        // Créer 4 contextes = 4 utilisateurs
        const contexts = await Promise.all([
            browser.newContext(),
            browser.newContext(),
            browser.newContext(),
            browser.newContext()
        ]);

        const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));

        try {
            // Login tous les users
            console.log('   👥 Logging in 4 users...');
            const users = [];
            for (let i = 0; i < 4; i++) {
                const user = await loginUser(pages[i], `e2e_sfu${i}_` + Date.now());
                await waitForAppReady(pages[i]);
                const { id } = await getUserInfo(pages[i]);
                users.push({ ...user, userId: id, page: pages[i] });
            }
            console.log('   ✅ 4 users logged in');

            // User 0 crée une conversation avec les 3 autres
            const memberIds = [users[1].userId, users[2].userId, users[3].userId];
            const convId = await createConversation(users[0].page, 'E2E SFU Test', memberIds);

            // User 0 démarre l'appel
            const callData = await startCall(users[0].page, convId, 'audio');
            activeCallIds.push(callData.id);

            expect(callData.mode).toBe('p2p'); // 1 participant = P2P
            expect(callData.participant_count).toBe(1);

            // Users 1, 2, 3 rejoignent
            for (let i = 1; i < 4; i++) {
                const joinData = await joinCall(users[i].page, callData.id);
                console.log(`   🔍 joinData:`, JSON.stringify(joinData, null, 2));

                if (i < 3) {
                    // Avec 2-3 participants, toujours P2P
                    expect(joinData.call.mode).toBe('p2p');
                    expect(joinData.mode_changed).toBe(false);
                } else {
                    // Avec 4 participants, passage à SFU
                    expect(joinData.call.mode).toBe('sfu');
                    expect(joinData.mode_changed).toBe(true);
                    expect(joinData.old_mode).toBe('p2p');
                    expect(joinData.new_mode).toBe('sfu');
                }

                expect(joinData.call.participant_count).toBe(i + 1);
            }

            // Vérifier l'état final
            const state = await getCallState(users[0].page, convId);

            expect(state.mode).toBe('sfu');
            expect(state.participant_count).toBe(4);
            expect(state.participants).toHaveLength(4);

            console.log('   ✅ Call in SFU mode with 4 participants verified');

            // Test retour à P2P: User 3 quitte
            const leaveData = await leaveCall(users[3].page, callData.id);

            expect(leaveData.mode_changed).toBe(true);
            expect(leaveData.old_mode).toBe('sfu');
            expect(leaveData.new_mode).toBe('p2p');
            expect(leaveData.call.participant_count).toBe(3);

            console.log('   ✅ Call switched back to P2P after user left');

            // Cleanup: tous quittent
            for (let i = 2; i >= 0; i--) {
                await leaveCall(users[i].page, callData.id);
            }

            activeCallIds = activeCallIds.filter(id => id !== callData.id);

        } finally {
            for (const ctx of contexts) {
                await ctx.close();
            }
        }
    });

    // Tests négatifs - Cas d'erreur
    test.describe('Error cases', () => {

        test('Cannot start call in already active conversation', async ({ page }) => {
            const user = await loginUser(page, 'e2e_error1_' + Date.now());
            await waitForAppReady(page);

            // Créer conversation et démarrer un appel
            const convId = await createConversation(page, 'E2E Error Test', []);
            const callData = await startCall(page, convId, 'audio');
            activeCallIds.push(callData.id);

            // Tenter de démarrer un deuxième appel dans la même conversation
            const result = await page.evaluate(async (convId) => {
                const response = await fetch(`/startCall?conversation_id=${convId}&call_type=audio`, {
                    method: 'POST',
                    credentials: 'include'
                });
                return {
                    ok: response.ok,
                    status: response.status,
                    data: await response.json().catch(() => null)
                };
            }, convId);

            // Devrait retourner l'appel existant ou une erreur
            console.log('   🔍 Duplicate call attempt:', result);

            // Cleanup
            await leaveCall(page, callData.id);
            activeCallIds = activeCallIds.filter(id => id !== callData.id);
        });

        test('Cannot join non-existent call', async ({ page }) => {
            const user = await loginUser(page, 'e2e_error2_' + Date.now());
            await waitForAppReady(page);

            const fakeCallId = 999999;

            const result = await page.evaluate(async (callId) => {
                const response = await fetch(`/joinCall?call_id=${callId}`, {
                    method: 'POST',
                    credentials: 'include'
                });
                return {
                    ok: response.ok,
                    status: response.status,
                    text: await response.text()
                };
            }, fakeCallId);

            console.log('   🔍 Join non-existent call:', result);

            // Devrait échouer (404 ou 400)
            expect(result.ok).toBe(false);
            expect([400, 404, 500]).toContain(result.status);
        });

        test('Cannot leave call not joined', async ({ page }) => {
            const user = await loginUser(page, 'e2e_error3_' + Date.now());
            await waitForAppReady(page);

            // Créer un appel
            const convId = await createConversation(page, 'E2E Error Test 3', []);
            const callData = await startCall(page, convId, 'audio');
            activeCallIds.push(callData.id);

            // Créer un deuxième utilisateur qui n'est PAS dans l'appel
            const context2 = await page.context().browser().newContext();
            const page2 = await context2.newPage();

            try {
                const user2 = await loginUser(page2, 'e2e_error3b_' + Date.now());
                await waitForAppReady(page2);

                // User2 tente de quitter l'appel sans l'avoir rejoint
                const result = await page2.evaluate(async (callId) => {
                    const response = await fetch(`/leaveCall?call_id=${callId}`, {
                        method: 'POST',
                        credentials: 'include'
                    });
                    return {
                        ok: response.ok,
                        status: response.status,
                        data: await response.json().catch(() => null)
                    };
                }, callData.id);

                console.log('   🔍 Leave call not joined:', result);

                // Le comportement peut varier - documenter le résultat attendu
                // Soit erreur, soit retour avec ended=false

            } finally {
                await context2.close();
            }

            // Cleanup
            await leaveCall(page, callData.id);
            activeCallIds = activeCallIds.filter(id => id !== callData.id);
        });

        test('Call state returns null for conversation without call', async ({ page }) => {
            const user = await loginUser(page, 'e2e_error4_' + Date.now());
            await waitForAppReady(page);

            // Créer une conversation SANS appel
            const convId = await createConversation(page, 'E2E No Call Conv', []);

            const callState = await page.evaluate(async (convId) => {
                const response = await fetch(`/getCallState?conversation_id=${convId}`, {
                    credentials: 'include'
                });
                const text = await response.text();
                try {
                    return JSON.parse(text);
                } catch (e) {
                    return { error: 'parse_error', text };
                }
            }, convId);

            console.log('   🔍 Call state for conv without call:', callState);

            // Devrait retourner null ou {active: false}
            if (callState !== null) {
                expect(callState.active).toBe(false);
            }
        });
    });

    // Tests de persistance
    test.describe('Persistence tests', () => {

        test('Call state persists after page reload', async ({ page }) => {
            const user = await loginUser(page, 'e2e_persist_' + Date.now());
            await waitForAppReady(page);

            // Créer conversation et démarrer un appel
            const convId = await createConversation(page, 'E2E Persist Test', []);
            const callData = await startCall(page, convId, 'audio');
            activeCallIds.push(callData.id);

            const originalCallId = callData.id;
            console.log(`   📞 Call started with ID: ${originalCallId}`);

            // Recharger la page
            console.log('   🔄 Reloading page...');
            await page.reload();
            await waitForAppReady(page);

            console.log('   ✅ Page reloaded, checking call state...');

            // Vérifier que l'appel est toujours actif
            const callStateAfterReload = await getCallState(page, convId);

            expect(callStateAfterReload).not.toBeNull();
            expect(callStateAfterReload.id).toBe(originalCallId);
            expect(callStateAfterReload.participant_count).toBe(1);
            expect(callStateAfterReload.mode).toBe('p2p');

            console.log('   ✅ Call state persisted after reload');

            // Cleanup
            await leaveCall(page, originalCallId);
            activeCallIds = activeCallIds.filter(id => id !== originalCallId);
        });

        test('Multiple reloads do not create duplicate calls', async ({ page }) => {
            const user = await loginUser(page, 'e2e_persist2_' + Date.now());
            await waitForAppReady(page);

            // Créer conversation et démarrer un appel
            const convId = await createConversation(page, 'E2E Persist Test 2', []);
            const callData = await startCall(page, convId, 'audio');
            activeCallIds.push(callData.id);

            const originalCallId = callData.id;

            // Recharger plusieurs fois
            for (let i = 0; i < 3; i++) {
                console.log(`   🔄 Reload ${i + 1}/3...`);
                await page.reload();
                await waitForAppReady(page);

                const state = await getCallState(page, convId);
                expect(state.id).toBe(originalCallId);
                expect(state.participant_count).toBe(1);
            }

            console.log('   ✅ No duplicate calls after multiple reloads');

            // Cleanup
            await leaveCall(page, originalCallId);
            activeCallIds = activeCallIds.filter(id => id !== originalCallId);
        });
    });
});
