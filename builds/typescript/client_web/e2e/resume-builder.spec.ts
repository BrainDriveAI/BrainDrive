import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { loginAsLocalUser } from "./helpers";

async function confirmOwnerAction(page: Page, label: RegExp) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(label, { timeout: 20_000 });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
  const confirm = dialog.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(dialog).toBeHidden();
}

async function confirmResumeFact(page: Page) {
  const confirmation = page.getByRole("region", { name: "Confirm shared information" });
  await expect(confirmation).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("dialog")).toBeHidden();
  await confirmation.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(confirmation).toBeHidden();
}

async function sendResumeChat(page: Page, message: string) {
  const composer = page.getByRole("textbox", { name: "Reply in your own words..." });
  await expect(composer).toBeEnabled({ timeout: 20_000 });
  await composer.fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
}

async function reviewAndApprove(
  page: Page,
  frame: FrameLocator,
  options: { exerciseKeyboardRecovery?: boolean; screenshotPath?: string } = {},
) {
  await frame.getByRole("button", { name: "Run product craft review" }).click();
  await expect(frame.getByRole("heading", { name: "Owner review" })).toBeVisible({ timeout: 20_000 });
  await expect(frame.locator('section[aria-labelledby="owner-review-heading"] .status')).toHaveText("Product craft review passed");
  await expect(frame.getByText(/Product craft review complete/)).toBeVisible();
  await expect(frame.getByText(/Independent review passed/i)).toHaveCount(0);
  if (options.screenshotPath) await page.screenshot({ path: options.screenshotPath, fullPage: true });
  await frame.getByRole("button", { name: "Approve this reviewed version" }).click();
  if (options.exerciseKeyboardRecovery) {
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Confirm", exact: true });
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Resume Builder sandbox proxy");
    await frame.getByRole("button", { name: "Approve this reviewed version" }).click();
  }
  await confirmOwnerAction(page, /Approve resume version/);
}

async function answerInterviewTopic(page: Page, frame: FrameLocator, answer: string, nextHeading: string, followUp?: string) {
  void frame;
  void nextHeading;
  await sendResumeChat(page, answer);
  if (followUp) {
    await sendResumeChat(page, followUp);
  }
  await confirmResumeFact(page);
  await expect(page.getByRole("textbox", { name: "Reply in your own words..." })).toBeEnabled({ timeout: 20_000 });
}

async function answerEmployment(page: Page, frame: FrameLocator) {
  void frame;
  await sendResumeChat(page, "Customer Service Associate at Lakeside Market");
  await expect(page.getByText(/What else should I add about that job/)).toBeVisible({ timeout: 20_000 });
  await sendResumeChat(page, "In Dayton from March 2021 to the present, helping about 60 customers per shift and training new employees.");
  await confirmResumeFact(page);
  await expect(page.getByRole("textbox", { name: "Reply in your own words..." })).toBeEnabled({ timeout: 20_000 });
}

async function completeJobEvidence(
  page: Page,
  frame: FrameLocator,
  nextHeading = "Education and training",
  jobLabel = "Customer Service Associate at Lakeside Market",
  evidenceAnswer = "Created a checkout checklist that reduced errors.\nHelped train new employees with the checklist.",
) {
  void frame;
  void nextHeading;
  void jobLabel;
  await sendResumeChat(page, evidenceAnswer);
  await confirmResumeFact(page);
  await sendResumeChat(page, "I don’t know.");
  await sendResumeChat(page, "Not applicable.");
  await sendResumeChat(page, "That’s all for this job.");
  await expect(page.getByRole("dialog")).toBeHidden();
}

async function skipInterviewTopic(page: Page, nextHeading: string) {
  void nextHeading;
  await sendResumeChat(page, "I’m not sure; let’s come back to that.");
}

async function reviewStrategyAndCreate(frame: FrameLocator) {
  const planCard = frame.locator("#strategy-review");
  if (await planCard.count() === 0) {
    await frame.getByRole("button", { name: "Review resume plan" }).click();
  }
  await expect(planCard).toBeAttached({ timeout: 30_000 });
  await planCard.scrollIntoViewIfNeeded();
  await expect(planCard.getByRole("heading", { name: "Your resume plan" })).toBeVisible();
  await expect(frame.getByText("This plan guides presentation. It is not a career fact, score, or approval.")).toBeVisible();
  await expect(frame.getByRole("button", { name: "Correct information" })).toBeVisible();
  await expect(frame.getByRole("button", { name: "Refresh plan" })).toBeVisible();
  await expect(frame.getByRole("button", { name: "Create first draft" })).toBeVisible({ timeout: 20_000 });
  await frame.getByRole("button", { name: "Create first draft" }).click();
}

async function openCareerApps(page: Page) {
  const career = page.getByRole("button", { name: "Career", exact: true });
  const navigationMenu = page.getByRole("button", { name: "Open navigation menu" });
  await expect(career.or(navigationMenu)).toBeVisible({ timeout: 15_000 });
  if (!await career.isVisible()) await navigationMenu.click();
  await expect(career).toBeVisible();
  await career.click();
  const apps = page.getByRole("button", { name: "Apps", exact: true });
  if (!await apps.isVisible()) await navigationMenu.click();
  await expect(apps).toBeVisible();
  await apps.click();
  await expect(page.getByTestId("apps-page")).toBeVisible();
}

async function installAndLaunchCareer(page: Page): Promise<FrameLocator> {
  const install = page.getByRole("button", { name: "Install Resume Builder" });
  const launch = page.getByRole("button", { name: "Continue from Career" });
  await expect(install.or(launch)).toBeVisible({ timeout: 15_000 });
  if (await install.isVisible()) await install.click();
  await expect(launch).toBeVisible({ timeout: 15_000 });
  await launch.click();
  const frame = resumeBuilderFrame(page);
  await expect(page.getByRole("region", { name: "Resume Builder conversation" })).toBeVisible({ timeout: 15_000 });
  return frame;
}

function resumeBuilderFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Resume Builder sandbox proxy"]').frameLocator('iframe[title="Resume Builder"]');
}

test.describe("Resume Builder owner journey", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "The complete owner journey is exercised in desktop Chrome; responsive behavior has focused component and resource coverage.");
    await loginAsLocalUser(page);
  });

  test("completes Career entry, owner approvals, PDF export, history, and direct reopen", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await openCareerApps(page);
    let frame = await installAndLaunchCareer(page);
    const proxy = page.locator('iframe[title="Resume Builder sandbox proxy"]');
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 15_000 });
    await expect(proxy).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");
    await expect(proxy).not.toHaveAttribute("srcdoc", /.+/);
    const proxySource = await proxy.getAttribute("src");
    expect(proxySource).toMatch(/^data:text\/html/);
    expect(proxySource).not.toContain("bridge_token_id");
    const innerSecurity = await frame.locator("html").evaluate(() => {
      let storage = "available";
      let parentDom = "available";
      let cookie = "available";
      try { void window.localStorage.length; } catch { storage = "blocked"; }
      try { void window.parent.document.body; } catch { parentDom = "blocked"; }
      try { cookie = document.cookie; } catch { cookie = "blocked"; }
      return {
        origin: window.origin,
        storage,
        parentDom,
        cookie,
        tauri: typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
        csp: Array.from(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).map((item) => item.getAttribute("content")),
      };
    });
    expect(innerSecurity).toMatchObject({ origin: "null", storage: "blocked", parentDom: "blocked", cookie: "blocked", tauri: "undefined" });
    expect(innerSecurity.csp.join("; ")).toContain("connect-src 'none'");
    const conversation = page.getByRole("region", { name: "Resume Builder conversation" });
    await expect(conversation).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Resume evidence tray" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "I’m not sure" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Close drawer" })).toBeHidden();
    await page.getByRole("button", { name: "Review what I’ve shared" }).click();
    const reviewSummary = page.getByRole("complementary", { name: "Resume review summary" });
    await expect(reviewSummary).toBeVisible();
    await expect(reviewSummary).not.toContainText(/needs attention|to discuss/i);
    await reviewSummary.getByRole("button", { name: "Open full review" }).click();
    await expect(page.getByRole("button", { name: "Close drawer" })).toBeVisible();
    await expect(frame.getByText("Continuing from your Career context")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Close drawer" }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Resume Builder sandbox proxy");

    let forgedSideEffects = 0;
    page.on("request", (request) => { if (request.url().includes("/apps/resume-builder/apps-bridge")) forgedSideEffects += 1; });
    await proxy.evaluate((element) => (element as HTMLIFrameElement).contentWindow?.postMessage({ jsonrpc: "2.0", id: "forged", method: "tools/call", params: { name: "fixture.status" } }, "*"));
    await page.waitForTimeout(100);
    expect(forgedSideEffects).toBe(0);
    await page.getByRole("button", { name: "Start conversation" }).click();
    await answerInterviewTopic(page, frame, "Synthetic Owner | Dayton, Ohio | owner@example.test | 555-010-0142", "What you want next");
    await answerInterviewTopic(page, frame, "Customer support supervisor roles", "Work experience");
    await answerEmployment(page, frame);
    await completeJobEvidence(page, frame);
    await answerInterviewTopic(page, frame, "Associate of Applied Science in Business Administration, Sinclair Community College, 2018", "Licenses and certifications");
    await skipInterviewTopic(page, "Skills, tools, and languages");
    await answerInterviewTopic(page, frame, "Customer service, Microsoft Excel, appointment scheduling, and employee training", "Projects");
    await skipInterviewTopic(page, "Leadership and volunteering");
    await skipInterviewTopic(page, "Professional links");
    await answerInterviewTopic(page, frame, "linkedin.com/in/synthetic-owner", "Review your information");

    await page.getByRole("button", { name: "Review what I’ve shared" }).click();
    await page.getByRole("complementary", { name: "Resume review summary" }).getByRole("button", { name: "Open full review" }).click();
    await expect(frame.getByRole("heading", { name: "Review your information" })).toBeVisible();
    await expect(frame.locator("#panel").getByText(/Created a checkout checklist/)).toBeVisible();
    await expect(frame.locator("#panel").getByText(/Helped train new employees with the checklist/)).toHaveCount(0);
    await expect(frame.getByRole("button", { name: "Reopen interview" })).toBeVisible();
    await frame.getByRole("button", { name: "Reopen interview" }).click();
    await expect(frame.getByRole("heading", { name: "Job coverage summary" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByText(/deferred/i).first()).toBeVisible();
    const reopenedCoverage = frame.getByLabel("Job evidence coverage");
    const priorReopenedCoverage = await reopenedCoverage.innerText();
    await frame.getByRole("button", { name: "Reopen", exact: true }).first().click();
    await expect.poll(() => reopenedCoverage.innerText(), { timeout: 15_000 }).not.toBe(priorReopenedCoverage);
    await expect(frame.getByRole("heading", { name: "Job coverage summary" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByRole("button", { name: "Complete for now" })).toBeVisible();
    await frame.getByRole("button", { name: "Complete for now" }).click();
    await expect(frame.getByRole("heading", { name: "Review your information" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Add another job" }).click();
    await frame.getByLabel("Your role").fill("Front Desk Associate");
    await frame.getByLabel("Where you worked").fill("Riverside Clinic");
    await frame.getByLabel(/Where \(optional\)/).fill("Dayton, Ohio");
    await frame.getByLabel(/When you started/).fill("June 2018");
    await frame.getByLabel(/When it ended/).fill("February 2021");
    await frame.getByLabel("What did you spend most of your time doing?").fill("Scheduled appointments and maintained accurate customer records.");
    await frame.getByRole("button", { name: "Use this experience" }).click();
    await confirmResumeFact(page);
    await expect(frame.getByLabel("Current job")).toContainText("Front Desk Associate at Riverside Clinic", { timeout: 15_000 });
    await completeJobEvidence(
      page,
      frame,
      "Review your information",
      "Front Desk Associate at Riverside Clinic",
      "Organized appointment requests into a consistent daily queue.\nMaintained clear handoff notes for the next shift.",
    );
    await expect(page.getByRole("dialog")).toBeHidden();
    const contactCard = frame.locator(".card").filter({ hasText: "owner@example.test" });
    await contactCard.getByRole("button", { name: "Edit" }).click();
    await frame.getByLabel("Information").fill("Synthetic Owner | Dayton, Ohio | synthetic.owner@example.test | 555-010-0142");
    await frame.getByRole("button", { name: "Save change" }).click();
    await confirmResumeFact(page);
    await expect(frame.locator("#panel").getByText(/synthetic\.owner@example\.test/)).toBeVisible();
    const linkCard = frame.locator(".card").filter({ hasText: "Professional link:" });
    await linkCard.getByRole("button", { name: "Remove" }).click();
    await confirmResumeFact(page);
    await expect(frame.getByText(/removed items? (?:is|are) preserved in history/)).toBeVisible();
    await reviewStrategyAndCreate(frame);
    await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 15_000 });
    const generalDraft = (await frame.locator("textarea[data-index]").evaluateAll((elements) =>
      elements.map((element) => (element as HTMLTextAreaElement).value).join("\n"),
    ));
    expect(generalDraft).toContain("synthetic.owner@example.test");
    expect(generalDraft).toContain("Customer Service Associate");
    expect(generalDraft).toContain("Sinclair Community College");
    expect(generalDraft).toContain("Microsoft Excel");
    await reviewAndApprove(page, frame, {
      exerciseKeyboardRecovery: true,
      screenshotPath: testInfo.outputPath("resume-builder-owner-review.png"),
    });

    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Revise in your own words" }).click();
    await expect(frame.getByRole("heading", { name: "Revise this resume in your own words" })).toBeFocused();
    await frame.getByLabel("What should change?").fill("Shorten the summary without changing facts.");
    await frame.getByRole("button", { name: "Save request and review route" }).click();
    await expect(frame.getByRole("heading", { name: "Review revision proposal" })).toBeFocused({ timeout: 15_000 });
    await expect(frame.getByText(/presentation request.*resume scope/i)).toBeVisible();
    await frame.getByRole("button", { name: "Accept", exact: true }).click();
    await confirmOwnerAction(page, /Accept revision proposal/);
    await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByRole("alert")).toContainText("Validate and approve this resume version separately");
    await reviewAndApprove(page, frame);

    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Revise in your own words" }).click();
    await frame.getByLabel("What should change?").fill("Make it better.");
    await frame.getByRole("button", { name: "Save request and review route" }).click();
    await expect(frame.getByRole("heading", { name: "One clarification is needed" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByText("No proposal or factual change was created.")).toBeVisible();
    await frame.getByRole("button", { name: "Return to approved resume" }).click();

    await frame.getByRole("button", { name: "Revise in your own words" }).click();
    await frame.getByLabel("What should change?").fill("Change my title to manager.");
    await frame.getByRole("button", { name: "Save request and review route" }).click();
    await expect(frame.getByRole("heading", { name: "Confirm factual meaning before generation" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Confirm and generate proposal" }).click();
    await confirmOwnerAction(page, /Confirm factual resume revision/);
    await expect(frame.getByRole("heading", { name: "Review revision proposal" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Reject", exact: true }).click();
    await confirmOwnerAction(page, /Reject revision proposal/);
    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });

    await frame.locator('[data-stage="job"]').click();
    await expect(frame.getByRole("heading", { name: "Paste the target job description" })).toBeVisible({ timeout: 15_000 });
    await frame.getByLabel("Role label").fill("Synthetic TypeScript role");
    await frame.getByLabel("Job description").fill("Requires TypeScript delivery and respectful collaboration with product owners.");
    await frame.getByRole("button", { name: "Analyze evidence" }).click();
    await expect(frame.getByRole("heading", { name: "Requirement evidence" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Assess fit and create a useful variant" }).click();
    const tailoredHeading = frame.locator("#panel h2").filter({ hasText: "Tailored resume" });
    await expect(tailoredHeading).toBeAttached({ timeout: 30_000 });
    await tailoredHeading.scrollIntoViewIfNeeded();
    await expect(tailoredHeading).toBeVisible();
    await reviewAndApprove(page, frame);

    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    const rememberedDetail = "Built a reusable customer handoff checklist for weekly team reviews.";
    await frame.getByRole("button", { name: "Add remembered detail" }).click();
    await expect(frame.getByRole("heading", { name: "Add remembered detail" })).toBeVisible();
    await frame.getByRole("button", { name: "Use general career context" }).click();
    await frame.getByLabel("Information type").selectOption("accomplishment");
    await frame.getByLabel("What did you remember?").fill(rememberedDetail);
    await frame.getByRole("button", { name: "Review and confirm" }).click();
    await confirmResumeFact(page);
    await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByRole("heading", { name: "What this proposal changes" })).toBeVisible();
    await expect(frame.getByText(rememberedDetail).first()).toBeVisible();
    await expect(frame.getByText(/based on older evidence/)).toBeVisible();
    await reviewAndApprove(page, frame);

    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Add remembered detail" }).click();
    await frame.getByRole("button", { name: "Use general career context" }).click();
    await frame.getByLabel("Information type").selectOption("accomplishment");
    await frame.getByLabel("What did you remember?").fill(rememberedDetail);
    await frame.getByRole("button", { name: "Review and confirm" }).click();
    await expect(frame.getByRole("heading", { name: "This information is already confirmed" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("dialog")).toBeHidden();
    await frame.getByRole("button", { name: "Return to approved resume" }).click();

    await frame.getByRole("button", { name: "Create preview" }).click();
    await expect(frame.getByText("Local extraction passed")).toBeVisible();
    const resumePreview = frame.getByLabel("Resume preview");
    const cleanText = frame.getByLabel(/Clean resume text/);
    await expect(resumePreview).toContainText("Synthetic Owner");
    await expect(resumePreview).toContainText("synthetic.owner@example.test");
    await expect(resumePreview).toContainText("Experience");
    await expect(resumePreview).toContainText("Education");
    await expect(resumePreview).toContainText("Skills");
    await expect(resumePreview).not.toContainText("Resume goal:");
    await expect(resumePreview).not.toContainText("Professional link:");
    await expect(cleanText).toContainText("Synthetic Owner");
    await expect(cleanText).toContainText("synthetic.owner@example.test");
    await page.screenshot({ path: testInfo.outputPath("resume-builder-career-preview.png"), fullPage: true });

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await frame.getByRole("button", { name: "Copy clean text" }).click();
    await confirmOwnerAction(page, /Copy app content/);
    await expect(frame.getByRole("alert")).toContainText("Clean text copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await cleanText.inputValue());

    const textDownload = page.waitForEvent("download");
    await frame.getByRole("button", { name: "Export .txt" }).click();
    await confirmOwnerAction(page, /Export clean resume text/);
    expect((await textDownload).suggestedFilename()).toBe("resume.txt");
    await expect(frame.getByRole("alert")).toContainText("Text export ready: resume.txt");

    const download = page.waitForEvent("download");
    await frame.getByRole("button", { name: "Export PDF" }).click();
    await confirmOwnerAction(page, /Export resume PDF/);
    expect((await download).suggestedFilename()).toBe("resume.pdf");
    await expect(frame.getByRole("alert")).toContainText("Export ready: resume.pdf");

    await frame.getByRole("button", { name: "Review strengths and gaps" }).click();
    await expect(frame.getByRole("heading", { name: "Strengths and evidence gaps" })).toBeVisible();
    await expect(frame.getByRole("heading", { name: "Strong evidence" })).toBeVisible();
    await expect(frame.getByText(/does not score or predict outcomes/i)).toBeVisible();

    await frame.locator("#history").click();
    await expect(frame.getByRole("heading", { name: "Resume history" })).toBeVisible();
    await expect(frame.getByText(/targeted.*approved/)).toBeVisible();
    const historyVersions = frame.getByRole("checkbox", { name: /Select .* general version/i });
    expect(await historyVersions.count()).toBeGreaterThanOrEqual(4);
    await historyVersions.first().check();
    await historyVersions.last().check();
    await expect(frame.getByRole("status").filter({ hasText: "2 versions selected" })).toBeVisible();
    await frame.getByRole("button", { name: "Compare selected versions" }).click();
    await expect(frame.getByRole("heading", { name: "Compare resume versions" })).toBeFocused();
    await expect(frame.getByText(/Added statement|Removed statement|Changed statement|Moved statement|Evidence references changed/).first()).toBeVisible();
    const unchanged = frame.getByRole("button", { name: /Unchanged statements/ });
    await expect(unchanged).toHaveAttribute("aria-expanded", "false");
    await unchanged.click();
    await expect(unchanged).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: testInfo.outputPath("resume-builder-version-comparison.png"), fullPage: true });
    await frame.getByRole("button", { name: "Back to history" }).click();

    const reconnectEvents: Array<{ kind: "launch" | "close"; body?: unknown }> = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/apps/resume-builder/launch") && request.method() === "POST") {
        reconnectEvents.push({ kind: "launch", body: request.postDataJSON() });
      } else if (/\/sessions\/[^/]+$/.test(pathname)) {
        reconnectEvents.push({ kind: "close" });
      }
    });
    await page.getByRole("button", { name: "Reload app" }).click();
    await expect.poll(async () => await proxy.getAttribute("src")).not.toBe(proxySource);
    frame = resumeBuilderFrame(page);
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByText("Continuing from your Career context")).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    expect(reconnectEvents[0]).toMatchObject({
      kind: "launch",
      body: {
        entry_point: "career",
        resume: {
          session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          view_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          bridge_generation: 1,
        },
      },
    });

    await page.getByRole("button", { name: "Close app" }).click();
    await page.getByRole("button", { name: "Your Agent", exact: true }).click();
    await page.getByRole("button", { name: "Apps", exact: true }).click();
    await page.locator('[data-app-key="resume-builder"]').getByRole("button", { name: "Launch", exact: true }).click();
    const reopened = resumeBuilderFrame(page);
    await expect(reopened.getByText("Direct resume workspace")).toBeVisible({ timeout: 15_000 });
    await expect(reopened.getByRole("heading", { name: "Preview approved resume" })).toBeVisible();
  });
});

test.describe("Resume Builder responsive job interview", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, "Responsive job identity and controls run in the mobile projects.");
    await loginAsLocalUser(page);
  });

  test("keeps native resume chat and the intentional review drawer usable without horizontal overflow", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openCareerApps(page);
    const frame = await installAndLaunchCareer(page);
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 20_000 });
    const conversation = page.getByRole("region", { name: "Resume Builder conversation" });
    await expect(conversation).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "I’m not sure" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Resume evidence tray" })).toHaveCount(0);
    expect(await page.locator("html").evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await page.getByRole("button", { name: "Review what I’ve shared" }).click();
    await page.getByRole("complementary", { name: "Resume review summary" }).getByRole("button", { name: "Open full review" }).click();
    await expect(page.getByRole("button", { name: "Close drawer" })).toBeVisible();
    await expect(frame.getByRole("heading", { name: "Resume Builder", exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await frame.getByRole("button").first().evaluate((button) => getComputedStyle(button).transitionDuration)).toBe("0s");
    expect(await frame.locator("html").evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Close drawer" }).click();
    await expect(conversation).toBeVisible();
  });
});
