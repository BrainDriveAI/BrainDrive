import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { loginAsLocalUser } from "./helpers";

async function openApps(page: Page) {
  const apps = page.getByRole("button", { name: "Apps", exact: true });
  await expect(apps).toBeVisible({ timeout: 15_000 });
  await apps.click();
  await expect(page.getByTestId("apps-page")).toBeVisible();
}

async function installAndLaunch(page: Page): Promise<FrameLocator> {
  const install = page.getByRole("button", { name: "Install Resume Builder" });
  const launch = page.getByRole("button", { name: "Launch", exact: true });
  await expect(install.or(launch)).toBeVisible({ timeout: 15_000 });
  if (await install.isVisible()) await install.click();
  await expect(launch).toBeVisible({ timeout: 15_000 });
  await launch.click();
  await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 15_000 });
  return page.frameLocator('iframe[title="Resume Builder sandbox proxy"]').frameLocator('iframe[title="Resume Builder"]');
}

async function send(page: Page, message: string) {
  const composer = page.getByRole("textbox", { name: "Reply in your own words..." });
  await expect(composer).toBeEnabled({ timeout: 20_000 });
  await composer.fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
  try {
    await expect(composer).toBeEnabled({ timeout: 20_000 });
  } catch (error) {
    console.error(`[resume-eval] conversation after ${JSON.stringify(message)}:\n${await page.getByRole("region", { name: "Resume Builder conversation" }).innerText()}`);
    throw error;
  }
}

test("model-led journey reaches an editable draft without a host checklist", async ({ page, isMobile }) => {
  test.skip(isMobile, "The compact desktop review rail is the evaluated handoff surface.");
  test.setTimeout(180_000);
  await loginAsLocalUser(page);
  await openApps(page);
  const frame = await installAndLaunch(page);

  const conversation = page.getByRole("region", { name: "Resume Builder conversation" });
  await expect(conversation).toBeVisible();
  await expect(conversation).toContainText(/Welcome.+real conversation/i, { timeout: 20_000 });
  const rail = page.getByRole("complementary", { name: "Resume review summary" });
  await expect(rail).toBeVisible();
  await expect(rail).toContainText("Confirmed details will appear here");
  await expect(conversation.getByRole("button", { name: /Pause|I’m not sure/ })).toHaveCount(0);

  await send(page, "Do you mean my most recent role or all my roles?");
  await expect(conversation).toContainText(/start with your most recent role/i);
  await send(page, "I am targeting startup operations roles.");
  await send(page, "I worked as Product Lead at Acme Labs from 2020 to 2024.");
  await expect(rail).toContainText(/Work experience|Confirmed details will appear here/);
  await send(page, "At Acme Labs I grew annual revenue by 40 percent and led 12 employees.");
  await send(page, "Why are you asking for another role?");
  await expect(conversation).toContainText(/specific and traceable to your words/i);
  await send(page, "I worked as Analyst at Northwind Partners from 2017 to 2020.");
  await send(page, "At Northwind Partners I reduced reporting time by 30 percent.");
  await send(page, "I earned a BS in Economics from State University in 2017.");
  // The deterministic fixture answers far faster than a live provider. Let the
  // secure bridge's rolling window clear before the draft action.
  await page.waitForTimeout(10_500);
  const composer = page.getByRole("textbox", { name: "Reply in your own words..." });
  await composer.fill("That is everything. Please create my general resume draft now.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(conversation).toContainText(/prepared.*resume version|prepared.*draft/i, { timeout: 30_000 });
  await expect(rail).toContainText(/Work experience/i, { timeout: 30_000 });
  await expect(composer).toBeEnabled();

  await send(page, "[evaluation] simulate provider loss");
  await expect(conversation).toContainText("[evaluation] simulate provider loss");
  await expect(conversation).toContainText("Your message is still here");
  const retry = conversation.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();
  await expect(retry).toHaveClass(/border-bd-border/);
  await expect(composer).toBeEnabled();
  await send(page, "Let's continue with the resume already prepared.");

  // The fixture completes a human-length interview in seconds. Let the secure bridge's
  // ten-second rate window roll before exercising the deliberate correction workflow.
  await page.waitForTimeout(2_000);
  await rail.getByRole("button", { name: "Edit" }).first().click({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Close drawer" })).toBeVisible();
  await expect(frame.getByRole("heading", { name: /Edit / })).toBeVisible({ timeout: 15_000 });
  const genericEditor = frame.locator("#fact-edit");
  if (await genericEditor.isVisible()) {
    const currentValue = await genericEditor.inputValue();
    await genericEditor.fill(`${currentValue} (corrected)`);
  } else {
    const titleEditor = frame.locator("#job-title");
    const currentTitle = await titleEditor.inputValue();
    await titleEditor.fill(`${currentTitle} (corrected)`);
  }
  await frame.getByRole("button", { name: "Save change" }).click();
  const correctionConfirmation = page.getByRole("region", { name: "Confirm shared information" });
  await expect(correctionConfirmation).toBeVisible();
  await correctionConfirmation.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(correctionConfirmation).toBeHidden();
  await page.getByRole("button", { name: "Close drawer" }).click();
  await page.getByRole("button", { name: "Review what I’ve shared" }).click();
  await expect(rail).toContainText("(corrected)", { timeout: 20_000 });

  await rail.getByRole("button", { name: "Open full review" }).click();
  await frame.getByRole("button", { name: "General resume" }).click();
  await expect(frame.getByRole("heading", { name: /General resume|First draft|Review/ })).toBeVisible({ timeout: 20_000 });
  await expect(frame.locator("#panel")).toContainText(/Acme Labs|Northwind Partners/);

  await page.reload();
  await expect(page.getByRole("button", { name: "Apps", exact: true })).toBeVisible({ timeout: 30_000 });
  await openApps(page);
  const reopened = await installAndLaunch(page);
  await expect(page.getByRole("region", { name: "Resume Builder conversation" })).toContainText("That is everything. Please create my general resume draft now.", { timeout: 20_000 });
  await expect(page.getByRole("complementary", { name: "Resume review summary" })).toContainText("(corrected)");
  await page.getByRole("complementary", { name: "Resume review summary" }).getByRole("button", { name: "Open full review" }).click();
  await reopened.getByRole("button", { name: "General resume" }).click();
  await expect(reopened.locator("#panel")).toContainText(/Acme Labs|Northwind Partners/);

});
