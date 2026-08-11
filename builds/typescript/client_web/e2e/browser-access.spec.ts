import { expect, test } from "@playwright/test";

import { loginAsLocalUser } from "./helpers";

test.describe("LAN browser access", () => {
  test.skip(
    process.env.BRAINDRIVE_E2E_BROWSER_ACCESS !== "1",
    "Run with the isolated browser-access harness."
  );

  test("refreshes an expired session and launches Resume Builder on non-loopback HTTP", async ({ context, page }) => {
    test.setTimeout(60_000);
    await loginAsLocalUser(page);

    const browserSecurity = await page.evaluate(() => ({
      hostname: window.location.hostname,
      isSecureContext: window.isSecureContext,
      randomUuid: typeof window.crypto.randomUUID,
      getRandomValues: typeof window.crypto.getRandomValues,
    }));
    expect(browserSecurity.hostname).not.toMatch(/^(localhost|127(?:\.\d+){3}|::1)$/);
    expect(browserSecurity).toMatchObject({
      isSecureContext: false,
      randomUuid: "undefined",
      getRandomValues: "function",
    });

    const refreshCookie = (await context.cookies()).find((cookie) => cookie.name === "paa_refresh_token");
    expect(refreshCookie).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "Strict",
    });

    await page.waitForTimeout(3_000);
    const refreshed = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/api/auth/refresh") && response.status() === 200
    );
    await page.getByRole("button", { name: "Career", exact: true }).click();
    await page.getByRole("button", { name: "Apps", exact: true }).click();
    await refreshed;

    const install = page.getByRole("button", { name: "Install Resume Builder" });
    await expect(install).toBeVisible({ timeout: 15_000 });
    await install.click();
    const launch = page.getByRole("button", { name: "Continue from Career" });
    await expect(launch).toBeVisible({ timeout: 15_000 });
    await launch.click();

    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 15_000 });
    const frame = page
      .frameLocator('iframe[title="Resume Builder sandbox proxy"]')
      .frameLocator('iframe[title="Resume Builder"]');
    await expect(frame.getByRole("heading", { name: "Start with what BrainDrive already knows" })).toBeVisible({ timeout: 15_000 });

    await page.setViewportSize({ width: 1600, height: 1000 });
    const wideLayout = await frame.locator("body").evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".shell")!.getBoundingClientRect();
      const steps = document.querySelector<HTMLElement>(".steps")!.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>(".panel")!.getBoundingClientRect();
      return { shellWidth: shell.width, stepsTop: steps.top, panelTop: panel.top, panelWidth: panel.width };
    });
    expect(wideLayout.shellWidth).toBeGreaterThan(1_100);
    expect(Math.abs(wideLayout.stepsTop - wideLayout.panelTop)).toBeLessThan(2);
    expect(wideLayout.panelWidth).toBeGreaterThan(800);

    await page.setViewportSize({ width: 760, height: 900 });
    await expect.poll(() => frame.locator("body").evaluate(() => {
      const steps = document.querySelector<HTMLElement>(".steps")!.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>(".panel")!.getBoundingClientRect();
      return panel.top >= steps.bottom;
    })).toBe(true);

    await page.setViewportSize({ width: 430, height: 900 });
    await expect.poll(() => frame.getByRole("button", { name: "Continue to interview" }).evaluate((button) => {
      const buttonWidth = button.getBoundingClientRect().width;
      const panelWidth = button.closest<HTMLElement>(".panel")!.getBoundingClientRect().width;
      return buttonWidth / panelWidth;
    })).toBeGreaterThan(0.85);

    await frame.getByRole("button", { name: "Continue to interview" }).click();
    const recoveryValue = "Exact browser recovery\nRésumé 東京 🚀";
    const answer = frame.getByLabel("Your answer");
    await answer.fill(recoveryValue);
    await expect(frame.getByRole("status").filter({ hasText: "Saved at" })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Reload app" }).click();
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 15_000 });
    const recoveredFrame = page
      .frameLocator('iframe[title="Resume Builder sandbox proxy"]')
      .frameLocator('iframe[title="Resume Builder"]');
    const recoveredAnswer = recoveredFrame.getByLabel("Your answer");
    await expect(recoveredAnswer).toHaveValue(recoveryValue, { timeout: 15_000 });
    await expect(recoveredAnswer).toBeFocused();
    await expect(recoveredFrame.getByRole("status").filter({ hasText: "Saved at" })).toBeVisible();
  });
});
