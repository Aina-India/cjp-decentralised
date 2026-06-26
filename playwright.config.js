// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  // Run each test file sequentially — these are structural checks, not parallel UX flows
  fullyParallel: false,
  // Fail fast in CI; retry once locally to rule out flakes
  retries: process.env.CI ? 0 : 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // Structural DOM checks don't need a real display
    headless: true,
  },
  // Chromium only — we're testing HTML structure, not browser-specific rendering
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Spin up `serve` against the pre-built dist/ before running tests.
  // CI runs `node scripts/build.js` in an earlier step; locally run it first too.
  webServer: {
    command: 'npx serve dist/ --listen 4173 --no-clipboard',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
