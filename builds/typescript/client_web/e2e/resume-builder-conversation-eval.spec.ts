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
  await expect(composer).toBeEnabled({ timeout: 20_000 });
}

test("conversation-first journey reaches a fact-backed draft and deliberate review", async ({ page, isMobile }) => {
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

  await send(page, "[evaluation] simulate provider loss");
  await expect(conversation).toContainText("[evaluation] simulate provider loss");
  await expect(conversation).toContainText("Your message is still here");
  await expect(conversation).toContainText(/Welcome.+real conversation/i);
  await expect(rail).toContainText("Confirmed details will appear here");
  const retry = conversation.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();
  await expect(retry).toHaveClass(/border-bd-border/);
  await expect(page.getByRole("textbox", { name: "Reply in your own words..." })).toBeEnabled();

  await send(page, "Do you mean my most recent role or all my roles?");
  await expect(conversation).toContainText(/start with your most recent role/i);
  await send(page, "I am targeting startup operations roles.");
  await send(page, "I worked as Product Lead at Acme Labs from 2020 to 2024.");
  await expect(rail).toContainText("Confirmed details will appear here");
  await send(page, "At Acme Labs I grew annual revenue by 40 percent and led 12 employees.");
  await send(page, "Why are you asking for another role?");
  await expect(conversation).toContainText(/specific and traceable to your words/i);
  await send(page, "I worked as Analyst at Northwind Partners from 2017 to 2020.");
  await send(page, "At Northwind Partners I reduced reporting time by 30 percent.");
  await send(page, "I earned a BS in Economics from State University in 2017.");
  // The deterministic fixture answers far faster than a live provider. Let the
  // secure bridge's rolling window clear before the extraction + draft burst.
  await page.waitForTimeout(10_500);
  const composer = page.getByRole("textbox", { name: "Reply in your own words..." });
  await composer.fill("No, that's everything I think");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(conversation).toContainText(/reviewing our conversation|accepted.*creating.*fact-backed/i, { timeout: 30_000 });
  await expect(rail).toContainText(/Work experience/i, { timeout: 30_000 });
  await expect(conversation).toContainText("Your first fact-backed draft is ready", { timeout: 60_000 });
  await expect(composer).toBeEnabled();

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
});
