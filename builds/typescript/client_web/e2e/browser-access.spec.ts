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
  });
});
