import { expect, test, type Page } from "@playwright/test";

import { loginAsLocalUser } from "./helpers";

const liveEnabled = process.env.BRAINDRIVE_RESUME_EVAL_LIVE_BROWSER === "1";

async function send(page: Page, message: string) {
  const composer = page.getByRole("textbox", { name: "Reply in your own words..." });
  await expect(composer).toBeEnabled({ timeout: 180_000 });
  await composer.fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(composer).toBeEnabled({ timeout: 180_000 });
}

test("live provider owns interview judgment and saves a reviewable resume version", async ({ page, isMobile }) => {
  test.skip(!liveEnabled, "Set BRAINDRIVE_RESUME_EVAL_LIVE_BROWSER=1 for an authorized live-provider run.");
  test.skip(isMobile, "The compact desktop review rail is the evaluated handoff surface.");
  test.setTimeout(600_000);
  const observedActionKinds: string[] = [];
  const hostFailures: Array<{ status: number; code: unknown }> = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/apps/resume-builder/data/call")) return;
    try {
      const body = request.postDataJSON() as { input?: { kind?: unknown; actions?: unknown[] } };
      if (body.input?.kind === "model_turn") {
        for (const raw of body.input.actions ?? []) {
          const action = raw as Record<string, unknown>;
          if (typeof action.action === "string") observedActionKinds.push(action.action);
        }
      }
    } catch {
      // Ignore unrelated non-JSON requests.
    }
  });
  page.on("response", async (response) => {
    if (!response.url().endsWith("/apps/resume-builder/data/call") || response.status() < 400) return;
    try {
      const body = await response.json() as { code?: unknown };
      hostFailures.push({ status: response.status(), code: body.code });
    } catch {
      // Ignore unreadable diagnostics.
    }
  });

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
  await expect(conversation).toContainText(/help you build|welcome|most recent role|resume/i, { timeout: 60_000 });
  await expect(page.getByRole("textbox", { name: "Reply in your own words..." })).toBeEnabled();

  await send(page, "Do you mean my most recent role or every role I have had?");
  await expect(conversation).toContainText(/most recent|start with|add.*later|all.*roles/i);
  await send(page, "I am targeting startup operations leadership roles.");
  await send(page, "My most recent role was Product Lead at Harbor Systems from 2020 to 2024.");
  await send(page, "At Harbor Systems I grew annual revenue by 40 percent and led a team of 12.");
  await send(page, "Before that, I was an Analyst at Northwind Partners from 2017 to 2020.");
  await send(page, "At Northwind Partners I reduced reporting time by 30 percent.");
  await send(page, "Why does the employer association matter?");
  await send(page, "I earned a BS in Economics from State University in 2017.");
  const composer = page.getByRole("textbox", { name: "Reply in your own words..." });
  await composer.fill("That is everything. Please create my general resume draft now.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(rail).toContainText(/Work experience/i, { timeout: 60_000 });
  await expect(conversation).toContainText(/draft|resume version|contact information|what .+\?/i, { timeout: 90_000 });
  await expect(composer).toBeEnabled({ timeout: 180_000 });
  expect(hostFailures).toEqual([]);
  expect(observedActionKinds).toContain("save_resume_version");

  const frame = page.frameLocator('iframe[title="Resume Builder sandbox proxy"]').frameLocator('iframe[title="Resume Builder"]');
  await rail.getByRole("button", { name: "Open full review" }).click();
  await expect(frame.getByRole("button", { name: "General resume" })).toBeVisible({ timeout: 180_000 });
  await frame.getByRole("button", { name: "General resume" }).click();
  await expect(frame.locator("#panel")).toContainText(/Harbor Systems/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Close drawer" }).click();
  await page.getByRole("button", { name: "Review what I’ve shared" }).click();
  await expect(rail).toBeVisible();

  await rail.getByRole("button", { name: "Edit" }).first().click();
  await expect(page.getByRole("button", { name: "Close drawer" })).toBeVisible();
  const genericEditor = frame.locator("#fact-edit");
  if (await genericEditor.isVisible()) {
    await genericEditor.fill(`${await genericEditor.inputValue()} (verified)`);
  } else {
    const titleEditor = frame.locator("#job-title");
    await titleEditor.fill(`${await titleEditor.inputValue()} (verified)`);
  }
  await frame.getByRole("button", { name: "Save change" }).click();
  const correctionConfirmation = page.getByRole("region", { name: "Confirm shared information" });
  await expect(correctionConfirmation).toBeVisible();
  await correctionConfirmation.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(correctionConfirmation).toBeHidden();
  await page.getByRole("button", { name: "Close drawer" }).click();
  await page.getByRole("button", { name: "Review what I’ve shared" }).click();
  await expect(rail).toBeVisible();
  await expect(rail).toContainText("(verified)", { timeout: 30_000 });

  await rail.getByRole("button", { name: "Open full review" }).click();
  await frame.getByRole("button", { name: "General resume" }).click();
  await expect(frame.locator("#panel")).toContainText(/Harbor Systems/, { timeout: 30_000 });
  await expect(frame.locator("#panel")).toContainText(/Northwind Partners/);
  await expect(frame.locator("#panel")).toContainText(/40%|40 percent/i);
  await expect(frame.locator("#panel")).toContainText(/30%|30 percent/i);
  await expect(frame.locator("#panel")).toContainText(/State University/i);

  await page.reload();
  await expect(page.getByRole("button", { name: "Apps", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByRole("button", { name: "Launch", exact: true }).click();
  await expect(page.getByRole("region", { name: "Resume Builder conversation" })).toContainText("That is everything. Please create my general resume draft now.", { timeout: 60_000 });
  await expect(page.getByRole("complementary", { name: "Resume review summary" })).toContainText("(verified)");
  console.log(`[resume-live-evidence] ${JSON.stringify({ observedActionKinds, hostFailures, persistedAfterReload: true })}`);
});
