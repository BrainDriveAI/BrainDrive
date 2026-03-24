import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests require both the Vite dev server and the BrainDrive gateway.
 *
 *   Gateway: must be running on http://localhost:3000 before tests start.
 *            Start it manually (e.g. `cd ../gateway && npm run dev`).
 *
 *   Vite:    started automatically via the webServer config below.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 30_000,

  use: {
    baseURL: "http://localhost:5073",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5073",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
