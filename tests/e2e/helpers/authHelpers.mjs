/**
 * Helpers pour l'authentification dans les tests E2E
 */

const SERVER_URL = 'http://localhost:808';

/**
 * Créer et connecter un utilisateur (suit le vrai flow: /auth → /verif → /channels)
 * @param {Page} page - La page Playwright
 * @param {string} username - Nom d'utilisateur (sera utilisé comme préfixe d'email)
 * @returns {Promise<Object>} Les infos de l'utilisateur connecté
 */
export async function loginUser(page, username) {
    const email = `${username}@test.com`;
    const password = 'Test123!';

    // 1. Aller sur /auth
    await page.goto(`${SERVER_URL}/auth`);

    // 2. Remplir infos + click submit
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);

    // IMPORTANT: Attendre la navigation qui suit le submit
    // Le formulaire fait une requête XHR puis redirige dans le callback
    await Promise.all([
        page.waitForNavigation({ timeout: 10000 }), // Attendre la redirection
        page.click('button[type="submit"]')          // Cliquer sur submit
    ]);

    // 3.1 - Si nouveau compte, on est redirigé vers /verif
    const currentUrl = page.url();

    if (currentUrl.includes('/verif')) {
        console.log(`   📧 New account - verification needed for ${email}`);

        // 3.1.1 - Récupérer l'OTP via getDebugOTP endpoint
        const otpResponse = await page.request.post(`${SERVER_URL}/getDebugOTP?email=${encodeURIComponent(email)}`);
        if (!otpResponse.ok()) {
            throw new Error(`Failed to get OTP: ${otpResponse.status()}`);
        }
        const { code } = await otpResponse.json();
        console.log(`   🔑 OTP retrieved: ${code}`);

        // 3.1.2 - Remplir l'OTP
        await page.fill('input[name="code"]', code);

        // 3.1.3 - Submit et attendre la navigation vers /channels
        await Promise.all([
            page.waitForNavigation({ timeout: 10000 }),
            page.click('button[type="submit"]')
        ]);
    }

    // 3.2 - Vérifier qu'on est bien sur /channels
    const finalUrl = page.url();
    if (!finalUrl.includes('/channels')) {
        // Capturer les erreurs potentielles affichées
        const errorMessage = await page.locator('#messageframe').textContent().catch(() => '');
        throw new Error(`Navigation failed. Current URL: ${finalUrl}. Error: ${errorMessage || 'Unknown'}`);
    }

    console.log(`   ✅ User ${email} logged in and on /channels`);

    return { email, username };
}

/**
 * Connecte plusieurs utilisateurs en parallèle
 * @param {Array<{page: Page, username: string}>} users - Liste de pages et usernames
 * @returns {Promise<Array<Object>>} Les infos des utilisateurs connectés
 */
export async function loginMultipleUsers(users) {
    console.log(`   👥 Logging in ${users.length} users...`);

    const loggedInUsers = [];
    for (const { page, username } of users) {
        const userInfo = await loginUser(page, username);
        loggedInUsers.push(userInfo);
        // Petit délai pour éviter de surcharger le serveur
        if (users.length > 2) {
            await page.waitForTimeout(200);
        }
    }

    console.log(`   ✅ ${users.length} users logged in`);
    return loggedInUsers;
}

/**
 * Attend que l'utilisateur soit complètement authentifié et l'app prête
 * @param {Page} page - La page Playwright
 * @param {number} timeout - Timeout en ms (défaut: 10000)
 */
export async function waitForAuthComplete(page, timeout = 10000) {
    // Attendre que le WebSocket soit connecté ET que CallManager soit initialisé
    await page.waitForFunction(() => {
        return window.global?.state?.socket?.readyState === WebSocket.OPEN
            && window.global?.state?.callManager !== undefined
            && window.global?.state?.clientID !== undefined;
    }, { timeout });

    console.log('   ✅ Auth complete: WebSocket connected and app ready');
}
