import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/authHelpers.mjs';
import { waitForAppReady } from './helpers/callHelpers.mjs';
import { disconnectViaUi } from './helpers/messagingHelpers.mjs';
import {
    changeServerIcon,
    changeServerName,
    createServerViaUi,
    enableCommunityServer,
    expectDiscoverCardForMember,
    expectServerLoadedWithDefaultChannel,
    expectServerSettingsPersisted,
    openDiscoverServersMenu,
    openServerFromSidebarById,
    openServerSettings,
    searchDiscoverServer,
    setCommunityMetadata
} from './helpers/serverHelpers.mjs';

const TEST_TIMEOUT = 120000;

test.describe('Server edit and discoverability - E2E', () => {
    test.setTimeout(TEST_TIMEOUT);

    test('User can edit server, persist settings, and verify discover card membership lock', async ({ page }) => {
        const suffix = Date.now();
        const account = `e2e_server_edit_${suffix}`;
        const newServerName = `E2E community ${suffix}`;
        const communityDescription = `Community server ${suffix} for discover checks`;
        const communityTag = `e2e${suffix}`;
        const communityLanguage = 'en';

        // 1) Login and create a dedicated server through the UI
        await loginUser(page, account);
        expect(page.url()).toContain('/channels');
        await waitForAppReady(page);

        const createdServerId = await createServerViaUi(page);
        await openServerFromSidebarById(page, createdServerId);
        await expectServerLoadedWithDefaultChannel(page, createdServerId);

        // 2) Edit server main settings: name + icon
        await openServerSettings(page);
        await changeServerName(page, newServerName);
        const uploadedIcon = await changeServerIcon(page);

        // 3) Make it a community server and set discover metadata
        await enableCommunityServer(page);
        await setCommunityMetadata(page, {
            description: communityDescription,
            languageCode: communityLanguage,
            tag: communityTag
        });

        // 4) Verify persistence after page reload
        await page.reload();
        await page.waitForURL('**/channels**', { timeout: 10000 });
        await waitForAppReady(page);
        await expectServerSettingsPersisted(page, createdServerId, {
            name: newServerName,
            pfp: uploadedIcon,
            isCommunity: true,
            description: communityDescription,
            languageCode: communityLanguage,
            tag: communityTag
        });

        // 5) Verify persistence after relogin
        await disconnectViaUi(page);
        await loginUser(page, account);
        expect(page.url()).toContain('/channels');
        await waitForAppReady(page);
        await expectServerSettingsPersisted(page, createdServerId, {
            name: newServerName,
            pfp: uploadedIcon,
            isCommunity: true,
            description: communityDescription,
            languageCode: communityLanguage,
            tag: communityTag
        });

        // 6) Check discover menu card details and "already a member" lock
        await openDiscoverServersMenu(page);
        await searchDiscoverServer(page, newServerName);
        await expectDiscoverCardForMember(page, {
            serverId: createdServerId,
            serverName: newServerName,
            description: communityDescription,
            tag: communityTag,
            languageCode: communityLanguage
        });
    });
});

