import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { loginAsLocalUser } from "./helpers";

async function confirmOwnerAction(page: Page, label: RegExp) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(label, { timeout: 20_000 });
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function openCareerApps(page: Page) {
  await page.getByRole("button", { name: "Career", exact: true }).click();
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await expect(page.getByTestId("apps-page")).toBeVisible();
}

async function installAndLaunchCareer(page: Page): Promise<FrameLocator> {
  const install = page.getByRole("button", { name: "Install Resume Builder" });
  await expect(install).toBeVisible({ timeout: 15_000 });
  await install.click();
  const launch = page.getByRole("button", { name: "Continue from Career" });
  await expect(launch).toBeVisible({ timeout: 15_000 });
  await launch.click();
  const frame = page.frameLocator('iframe[title="Resume Builder"]');
  await expect(frame.getByRole("heading", { name: "Start with what BrainDrive already knows" })).toBeVisible({ timeout: 15_000 });
  return frame;
}

test.describe("Resume Builder owner journey", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "The complete owner journey is exercised in desktop Chrome; responsive behavior has focused component and resource coverage.");
    await loginAsLocalUser(page);
  });

  test("completes Career entry, owner approvals, PDF export, history, and direct reopen", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await openCareerApps(page);
    const frame = await installAndLaunchCareer(page);
    await expect(frame.getByText("Continuing from your Career context")).toBeVisible();

    await frame.getByRole("button", { name: "Continue to interview" }).click();
    await frame.getByLabel("Your answer").fill("Delivered synthetic TypeScript systems for owners");
    await frame.getByRole("button", { name: "Review and confirm" }).click();
    await confirmOwnerAction(page, /Confirm career fact/);
    for (let remaining = 0; remaining < 4; remaining += 1) {
      await frame.getByRole("button", { name: "Skip for now" }).click();
    }

    await expect(frame.getByRole("heading", { name: "Review confirmed facts" })).toBeVisible();
    await frame.getByRole("button", { name: "Create general draft" }).click();
    await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Validate and approve" }).click();
    await confirmOwnerAction(page, /Approve resume version/);

    await expect(frame.getByRole("heading", { name: "Paste the target job description" })).toBeVisible({ timeout: 15_000 });
    await frame.getByLabel("Role label").fill("Synthetic TypeScript role");
    await frame.getByLabel("Job description").fill("Requires TypeScript delivery and respectful collaboration with product owners.");
    await frame.getByRole("button", { name: "Analyze evidence" }).click();
    await expect(frame.getByRole("heading", { name: "Requirement evidence" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Create tailored variant" }).click();
    await expect(frame.getByRole("heading", { name: "Tailored resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Validate and approve" }).click();
    await confirmOwnerAction(page, /Approve resume version/);

    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Create preview" }).click();
    await expect(frame.getByText("ATS parse-back passed")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("resume-builder-career-preview.png"), fullPage: true });
    const download = page.waitForEvent("download");
    await frame.getByRole("button", { name: "Export PDF" }).click();
    expect((await download).suggestedFilename()).toBe("resume.pdf");
    await expect(frame.getByRole("alert")).toContainText("Export ready: resume.pdf");

    await frame.locator("#history").click();
    await expect(frame.getByRole("heading", { name: "Resume history" })).toBeVisible();
    await expect(frame.getByText(/targeted · approved/)).toBeVisible();

    await page.getByRole("button", { name: "Close app" }).click();
    await page.getByRole("button", { name: "Your Agent", exact: true }).click();
    await page.getByRole("button", { name: "Apps", exact: true }).click();
    await page.getByRole("button", { name: "Launch", exact: true }).click();
    const reopened = page.frameLocator('iframe[title="Resume Builder"]');
    await expect(reopened.getByText("Direct resume workspace")).toBeVisible({ timeout: 15_000 });
    await expect(reopened.getByRole("heading", { name: "Preview approved resume" })).toBeVisible();
  });
});
