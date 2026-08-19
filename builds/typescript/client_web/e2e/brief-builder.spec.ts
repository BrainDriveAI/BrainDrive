import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { loginAsLocalUser } from "./helpers";

async function openApps(page: Page) {
  const yourAgent = page.getByRole("button", { name: "Your Agent", exact: true });
  const navigationMenu = page.getByRole("button", { name: "Open navigation menu" });
  await expect(yourAgent.or(navigationMenu)).toBeVisible({ timeout: 15_000 });
  if (!await yourAgent.isVisible()) await navigationMenu.click();
  await yourAgent.click();
  const apps = page.getByRole("button", { name: "Apps", exact: true });
  if (!await apps.isVisible()) await navigationMenu.click();
  await apps.click();
  await expect(page.getByTestId("apps-page")).toBeVisible();
}

function briefFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Brief Builder sandbox proxy"]').frameLocator('iframe[title="Brief Builder"]');
}

test.describe("Brief Builder focused owner journey", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "The complete Brief journey runs in desktop Chrome; responsive resource behavior has focused package tests.");
    await loginAsLocalUser(page);
  });

  test("installs the distinct app, generates a grounded draft, and requires host approval", async ({ page }) => {
    test.setTimeout(120_000);
    await openApps(page);
    const card = page.locator('[data-app-key="brief-builder"]');
    await expect(card.getByRole("heading", { name: "Brief Builder" })).toBeVisible();
    await expect(card).toContainText("ai.braindrive.brief-builder");
    await card.getByRole("button", { name: "Install Brief Builder" }).click();
    await expect(card.getByRole("button", { name: "Launch", exact: true })).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: "Launch", exact: true }).click();

    const proxy = page.locator('iframe[title="Brief Builder sandbox proxy"]');
    const frame = briefFrame(page);
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 20_000 });
    await expect(proxy).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    await expect(frame.getByRole("heading", { name: "Brief Builder" })).toBeVisible();
    await expect(frame.getByRole("status")).toHaveText("Ready for source text.", { timeout: 20_000 });
    await frame.getByLabel("Owner source text").fill("The owner launched a pilot in Dayton. The pilot enrolled twelve participants.");
    await frame.getByRole("button", { name: "Generate brief", exact: true }).click();
    await expect(frame.getByRole("status")).toHaveText("Brief ready. Review the document and its supporting sources.", { timeout: 20_000 });
    await expect(frame.getByRole("article", { name: "Brief preview" })).toContainText("The owner launched a pilot in Dayton.");

    await frame.getByRole("button", { name: "Review and approve", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toContainText("Approve this brief?", { timeout: 20_000 });
    await expect(confirmation).toContainText("sandboxed app content");
    await expect(confirmation.getByRole("button", { name: "Approve brief" })).toBeFocused();
    await confirmation.getByRole("button", { name: "Approve brief" }).click();
    await expect(confirmation).toBeHidden();
    await expect(frame.getByText(/Approved revision [0-9a-f-]{36}\./)).toBeVisible({ timeout: 20_000 });
  });
});
