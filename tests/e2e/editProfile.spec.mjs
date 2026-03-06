import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';

const TEST_TIMEOUT = 30000;

/**
 * Opens the user settings menu by clicking the settings gear icon.
 */
async function openUserSettings(page) {
    await page.locator('div[onclick="openMenu(\'settings\')"]').click();
    // Wait for the settings panel to be visible
    await page.locator('#settings').waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Opens the profile settings tab inside the settings panel.
 */
async function openProfileSettings(page) {
    await page.locator('#profil-settings').click();
    // Wait for the profile settings form to be rendered
    await page.locator('#display-name-input').waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Opens the account settings tab inside the settings panel.
 */
async function openAccountSettings(page) {
    // "Mon compte" is the first item and is selected by default,
    // but we click it explicitly to ensure the content pane loads.
    await page.locator('#settings .item >> text=Mon compte').first().click();
    await page.locator('#username-input').waitFor({ state: 'attached', timeout: 5000 });
}

test.describe('Profile edition - E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('User can edit display name, pronouns and description', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, 'e2e_profile_' + suffix);

        expect(page.url()).toContain('/channels');
        await waitForAppReady(page);

        await openUserSettings(page)
        await openProfileSettings(page)

        // --- Modify inputs ---
        const newDisplayName = 'Test User ' + suffix;
        const newPronouns = 'they/them';
        const newDescription = 'This is a test description.';

        await page.fill('#display-name-input', newDisplayName);
        await page.fill('#pronouns-input', newPronouns);
        await page.fill('#description-input', newDescription);

        // --- Click Save ---
        // The save bar should appear after modifying inputs
        const saveButton = page.locator('#formUser .btn.green');
        await saveButton.waitFor({ state: 'visible', timeout: 5000 });
        await saveButton.click();

        // Wait for the save request to complete
        await page.waitForTimeout(1000);

        // --- Reload and verify persistence ---
        await page.reload();
        await page.waitForURL('**/channels**', { timeout: 10000 });
        await waitForAppReady(page);

        // Re-open settings → profile settings
        await openUserSettings(page);
        await openProfileSettings(page);

        // Verify the values persisted
        await expect(page.locator('#display-name-input')).toHaveValue(newDisplayName);
        await expect(page.locator('#pronouns-input')).toHaveValue(newPronouns);
        await expect(page.locator('#description-input')).toHaveValue(newDescription);
    });

    test('User can change username', async ({ page }) => {
        const suffix = Date.now();
        await loginUser(page, 'e2e_username_' + suffix);

        expect(page.url()).toContain('/channels');
        await waitForAppReady(page);

        // --- Open settings (account settings loads by default) ---
        await openUserSettings(page);

        // Click the "Edit" button next to the username field
        await page.locator('div[onclick="openMenu(\'change-username\')"]').click();

        // Wait for the change-username modal to be visible
        await page.locator('#change-username').waitFor({ state: 'visible', timeout: 5000 });

        // --- Fill in the new username ---
        const newUsername = `user_${suffix}`;
        await page.fill('#username-input', newUsername);

        // Click "Done" to save the username
        await page.locator('#change-username .btn.blue').click();

        // Wait for the modal to close (the closeMenu call hides it)
        await page.locator('#change-username').waitFor({ state: 'hidden', timeout: 5000 });

        // --- Reload and verify persistence ---
        await page.reload();
        await page.waitForURL('**/channels**', { timeout: 10000 });
        await waitForAppReady(page);

        // Verify username persisted via the global state
        const savedUsername = await page.evaluate(() => window.global?.user?.username);
        expect(savedUsername).toBe(newUsername);
    });
});
