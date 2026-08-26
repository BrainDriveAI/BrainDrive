import { defineConfig, devices } from "@playwright/test";

const isolatedE2e = process.env.BRAINDRIVE_E2E_ISOLATED === "1";
const browserAccessE2e = process.env.BRAINDRIVE_E2E_BROWSER_ACCESS === "1";
const webPort = process.env.BRAINDRIVE_E2E_WEB_PORT ?? "5073";
const baseURL = process.env.BRAINDRIVE_E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const artifactRoot = process.env.BRAINDRIVE_E2E_ARTIFACT_ROOT;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // The disposable contract seeds one synthetic local owner. Serialize isolated
  // runs so concurrent login/message traffic cannot race shared account state.
  workers: isolatedE2e ? 1 : process.env.CI ? 1 : undefined,
  reporter: artifactRoot
    ? [["html", { outputFolder: `${artifactRoot}/html`, open: "never" }]]
    : "html",
  outputDir: artifactRoot ? `${artifactRoot}/test-results` : "test-results",
  timeout: 30_000,

  use: {
    baseURL,
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

  webServer: browserAccessE2e
    ? undefined
    : {
        command: `npm run dev -- --host 127.0.0.1 --port ${webPort}`,
        url: baseURL,
        reuseExistingServer: !isolatedE2e && !process.env.CI,
        timeout: 15_000,
      },
});
