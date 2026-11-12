import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run e2e:prepare && NODE_ENV=development DATABASE_URL=file:/private/tmp/covendro-playwright.db API_PORT=4101 COVENDRO_FORCE_MOCKS=true node apps/api/dist/server.js",
      url: "http://127.0.0.1:4101/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "NEXT_PUBLIC_API_URL=http://127.0.0.1:4101 npm --workspace @covendro/web run dev -- --port 3101",
      url: "http://127.0.0.1:3101",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
