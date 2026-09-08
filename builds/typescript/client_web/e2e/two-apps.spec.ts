import { expect, test, type Page } from "@playwright/test";

import { appLaunchButton, closeAppWorkspace, expectAppWorkspaceReady, loginAsLocalUser } from "./helpers";

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

async function installLaunchAndClose(page: Page, appKey: string, appName: "Resume Builder" | "Brief Builder") {
  const card = page.locator(`[data-app-key="${appKey}"]`);
  const install = card.getByRole("button", { name: `Install ${appName}` });
  const launch = appLaunchButton(card, appName);
  if (await install.isVisible()) await install.click();
  await expect(launch).toBeVisible({ timeout: 20_000 });
  await launch.click();
  const readiness = await expectAppWorkspaceReady(page, appName);
  if (readiness.kind === "sandbox") {
    const resourceSecurity = await readiness.frame.locator("html").evaluate(() => ({
      origin: window.origin,
      storage: (() => { try { void window.localStorage.length; return "available"; } catch { return "blocked"; } })(),
      parentDom: (() => { try { void window.parent.document.body; return "available"; } catch { return "blocked"; } })(),
    }));
    expect(resourceSecurity).toEqual({ origin: "null", storage: "blocked", parentDom: "blocked" });
  } else if (appName === "Resume Builder") {
    await expect(page.getByRole("button", { name: "Your Resume Profile" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Your Resume", exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Brief Draft" })).toBeVisible();
  }
  await closeAppWorkspace(page, readiness);
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
    await expect(appLaunchButton(resumeCard, "Resume Builder")).toBeVisible();
    await expect(appLaunchButton(briefCard, "Brief Builder")).toBeVisible();

    await appLaunchButton(resumeCard, "Resume Builder").click();
    const resumeReadiness = await expectAppWorkspaceReady(page, "Resume Builder");
    if (resumeReadiness.kind === "chat_workspace") {
      await expect(page.getByRole("button", { name: "Your Resume Profile" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Your Resume", exact: true })).toBeVisible();
      await expect(page.getByText("Turn your source into a concise")).toHaveCount(0);
    } else {
      await expect(resumeReadiness.frame.getByRole("heading", { name: "Resume Builder", exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(resumeReadiness.frame.getByText("Turn your source into a concise")).toHaveCount(0);
    }
    await closeAppWorkspace(page, resumeReadiness);

    await appLaunchButton(briefCard, "Brief Builder").click();
    const briefReadiness = await expectAppWorkspaceReady(page, "Brief Builder");
    if (briefReadiness.kind === "chat_workspace") {
      await expect(page.getByRole("heading", { name: "Brief Draft" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Your Resume Profile")).toHaveCount(0);
    } else {
      const brief = briefReadiness.frame;
      await expect(brief.getByRole("heading", { name: "Brief Builder" })).toBeVisible({ timeout: 20_000 });
      await expect(brief.getByRole("status")).toHaveText(/Ready for source text\.|Reopened your saved draft\./, { timeout: 20_000 });
      await expect(brief.getByText("Your Resume Profile")).toHaveCount(0);
    }
    await closeAppWorkspace(page, briefReadiness);

    const uninstall = resumeCard.getByRole("button", { name: "Remove app code for Resume Builder" });
    await uninstall.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("retain");
    await dialog.getByRole("button", { name: "Uninstall app code" }).click();
    await expect(resumeCard.getByRole("button", { name: "Install Resume Builder" })).toBeVisible({ timeout: 20_000 });
    await expect(appLaunchButton(briefCard, "Brief Builder")).toBeVisible();

    await appLaunchButton(briefCard, "Brief Builder").click();
    const finalBriefReadiness = await expectAppWorkspaceReady(page, "Brief Builder");
    if (finalBriefReadiness.kind === "chat_workspace") {
      await expect(page.getByRole("heading", { name: "Brief Draft" })).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(finalBriefReadiness.frame.getByRole("heading", { name: "Brief Builder" })).toBeVisible({ timeout: 20_000 });
    }
    await closeAppWorkspace(page, finalBriefReadiness);
  });
});
