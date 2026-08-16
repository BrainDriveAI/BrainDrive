import { expect, test, type Page } from "@playwright/test";

import { loginAsLocalUser } from "./helpers";

const liveEnabled = process.env.BRAINDRIVE_RESUME_EVAL_LIVE_BROWSER === "1";

async function send(page: Page, message: string) {
  const composer = page.getByRole("textbox", { name: "Reply in your own words..." });
  await expect(composer).toBeEnabled({ timeout: 60_000 });
  await composer.fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(composer).toBeEnabled({ timeout: 60_000 });
}

test("live provider completes a model-led interview and creates a reviewable draft", async ({ page, isMobile }) => {
  test.skip(!liveEnabled, "Set BRAINDRIVE_RESUME_EVAL_LIVE_BROWSER=1 for an authorized live-provider run.");
  test.skip(isMobile, "The compact desktop review rail is the evaluated handoff surface.");
  test.setTimeout(600_000);

  await loginAsLocalUser(page);
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  const install = page.getByRole("button", { name: "Install Resume Builder" });
  const launch = page.getByRole("button", { name: "Launch", exact: true });
  await expect(install.or(launch)).toBeVisible({ timeout: 30_000 });
  if (await install.isVisible()) await install.click();
  await expect(launch).toBeVisible({ timeout: 30_000 });
  await launch.click();
  await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 30_000 });

  const conversation = page.getByRole("region", { name: "Resume Builder conversation" });
  const rail = page.getByRole("complementary", { name: "Resume review summary" });
  await expect(conversation).toContainText(/help you build|welcome|most recent role/i, { timeout: 60_000 });
  await expect(rail).toContainText("Confirmed details will appear here");

  await send(page, "Do you mean my most recent role or every role I have had?");
  await send(page, "I am targeting startup operations leadership roles.");
  await send(page, "My most recent role was Product Lead at Acme Labs from 2020 to 2024.");
  await expect(rail).toContainText(/Product Lead.+Acme Labs/i, { timeout: 60_000 });
  await send(page, "At Acme Labs I grew annual revenue by 40 percent and led a team of 12.");
  await expect(rail).toContainText(/40 percent|40%/i, { timeout: 60_000 });
  await send(page, "Before that, I was an Analyst at Northwind Partners from 2017 to 2020.");
  await expect(rail).toContainText(/Analyst.+Northwind Partners/i, { timeout: 60_000 });
  await send(page, "At Northwind Partners I reduced reporting time by 30 percent.");
  await send(page, "Why does the employer association matter?");
  await send(page, "I earned a BS in Economics from State University in 2017.");
  const composer = page.getByRole("textbox", { name: "Reply in your own words..." });
  await composer.fill("That is everything. Please create my general resume draft now.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(conversation).toContainText("BrainDrive accepted your request and is creating a fact-backed general draft now", { timeout: 60_000 });
  await expect(conversation).toContainText("Your first fact-backed draft is ready", { timeout: 180_000 });
  await expect(composer).toBeEnabled();
  await expect(conversation).not.toContainText("I couldn’t safely process that turn");

  await rail.getByRole("button", { name: "Open full review" }).click();
  const frame = page.frameLocator('iframe[title="Resume Builder sandbox proxy"]').frameLocator('iframe[title="Resume Builder"]');
  await frame.getByRole("button", { name: "General resume" }).click();
  await expect(frame.locator("#panel")).toContainText(/Acme Labs/, { timeout: 30_000 });
  await expect(frame.locator("#panel")).toContainText(/Northwind Partners/);
  await expect(frame.locator("#panel")).toContainText(/40%|40 percent/i);
  await expect(frame.locator("#panel")).toContainText(/30%|30 percent/i);
});
