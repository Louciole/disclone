import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Un test à la fois pour éviter conflits DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Un seul worker pour tests séquentiels
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:808',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // On peut ajouter Firefox, Safari, etc.
  ],

  // Serveur de dev (optionnel si déjà lancé)
  // webServer: {
  //   command: 'wsl source venv/bin/activate && python server.py',
  //   url: 'http://localhost:808',
  //   reuseExistingServer: true,
  // },
});
