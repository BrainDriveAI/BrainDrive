import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests require both the Vite dev server and the BrainDrive gateway.
 *
 *   Runtime: MCP services and the gateway must already be running at Vite's
 *            default proxy target on port 8787. From builds/typescript, use
 *            `npm run dev:server`; a reproducible isolated E2E auth fixture is
 *            still required before this suite can be cited as clean evidence.
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
