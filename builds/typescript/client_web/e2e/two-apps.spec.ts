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

function appFrame(page: Page, name: "Resume Builder" | "Brief Builder"): FrameLocator {
  return page.frameLocator(`iframe[title="${name} sandbox proxy"]`).frameLocator(`iframe[title="${name}"]`);
}

async function installLaunchAndClose(page: Page, appKey: string, appName: "Resume Builder" | "Brief Builder") {
  const card = page.locator(`[data-app-key="${appKey}"]`);
  const install = card.getByRole("button", { name: `Install ${appName}` });
  const launch = card.getByRole("button", { name: "Launch", exact: true });
  if (await install.isVisible()) await install.click();
  await expect(launch).toBeVisible({ timeout: 20_000 });
  await launch.click();
  const proxy = page.locator(`iframe[title="${appName} sandbox proxy"]`);
  await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 20_000 });
  await expect(proxy).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
  const resourceSecurity = await appFrame(page, appName).locator("html").evaluate(() => ({
    origin: window.origin,
    storage: (() => { try { void window.localStorage.length; return "available"; } catch { return "blocked"; } })(),
    parentDom: (() => { try { void window.parent.document.body; return "available"; } catch { return "blocked"; } })(),
  }));
  expect(resourceSecurity).toEqual({ origin: "null", storage: "blocked", parentDom: "blocked" });
  await page.getByRole("button", { name: "Close app" }).click();
  await expect(page.getByTestId("apps-page")).toBeVisible();
  return card;
}

test.describe("two first-party apps coexistence", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "The complete two-app journey runs in desktop Chrome; mobile app-shell and Resume coverage remain in their focused suites.");
    await loginAsLocalUser(page);
  });

  test("installs both packages, keeps direct entry isolated, and preserves one app when the other is uninstalled", async ({ page }) => {
    test.setTimeout(150_000);
    await openApps(page);
    const catalog = page.getByTestId("app-catalog");
    await expect(catalog.locator('[data-app-key="resume-builder"]')).toContainText("ai.braindrive.resume-builder");
    await expect(catalog.locator('[data-app-key="brief-builder"]')).toContainText("ai.braindrive.brief-builder");

    const resumeCard = await installLaunchAndClose(page, "resume-builder", "Resume Builder");
    const briefCard = await installLaunchAndClose(page, "brief-builder", "Brief Builder");
    await expect(resumeCard.getByRole("button", { name: "Launch", exact: true })).toBeVisible();
    await expect(briefCard.getByRole("button", { name: "Launch", exact: true })).toBeVisible();

    await resumeCard.getByRole("button", { name: "Launch", exact: true }).click();
    await expect(appFrame(page, "Resume Builder").getByRole("heading", { name: "Resume Builder", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(appFrame(page, "Resume Builder").getByText("Turn your source into a concise")).toHaveCount(0);
    await page.getByRole("button", { name: "Close app" }).click();

    await briefCard.getByRole("button", { name: "Launch", exact: true }).click();
    const brief = appFrame(page, "Brief Builder");
    await expect(brief.getByRole("heading", { name: "Brief Builder" })).toBeVisible({ timeout: 20_000 });
    await expect(brief.getByRole("status")).toHaveText(/Ready for source text\.|Reopened your saved draft\./, { timeout: 20_000 });
    const ownerSource = brief.getByLabel("Owner source text");
    if (!await ownerSource.isVisible()) {
      const rejectExistingDraft = brief.getByRole("button", { name: "Reject draft", exact: true });
      await expect(rejectExistingDraft).toBeVisible();
      await rejectExistingDraft.click();
      await expect(brief.getByRole("status")).toHaveText("The draft was rejected. Your prior approved revision is unchanged.");
    }
    await expect(ownerSource).toBeVisible();
    await ownerSource.fill("The owner launched a pilot in Dayton. The pilot enrolled twelve participants.");
    await brief.getByRole("button", { name: "Generate brief", exact: true }).click();
    await expect(brief.getByRole("status")).toHaveText("Brief ready. Review the document and its supporting sources.", { timeout: 20_000 });
    await page.getByRole("button", { name: "Close app" }).click();

    const uninstall = resumeCard.getByRole("button", { name: "Remove app code for Resume Builder" });
    await uninstall.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("retain");
    await dialog.getByRole("button", { name: "Uninstall app code" }).click();
    await expect(resumeCard.getByRole("button", { name: "Install Resume Builder" })).toBeVisible({ timeout: 20_000 });
    await expect(briefCard.getByRole("button", { name: "Launch", exact: true })).toBeVisible();

    await briefCard.getByRole("button", { name: "Launch", exact: true }).click();
    await expect(brief.getByRole("heading", { name: "Brief Builder" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Close app" }).click();
  });
});
