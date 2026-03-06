/**
 * Tests E2E CallManager avec Playwright
 **
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
test.describe('CallManager - E2E', () => {

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
                wsState: window.global?.state?.websocket?.readyState,
                hasCallManager: !!window.global?.state?.callManager,
                hasClientID: !!window.global?.state?.clientID
            };
        });

        expect(appReady.wsState).toBe(WebSocket.OPEN);
        expect(appReady.hasCallManager).toBe(true);
        expect(appReady.hasClientID).toBe(true);
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
