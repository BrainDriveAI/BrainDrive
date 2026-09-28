import { writeFile } from "node:fs/promises";
import path from "node:path";

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

async function reviewAndApprove(
  frame: FrameLocator,
  options: { screenshotPage?: Page; screenshotPath?: string } = {},
) {
  await frame.getByRole("button", { name: "Run product craft review" }).click();
  await expect(frame.getByRole("heading", { name: "Owner review" })).toBeVisible({ timeout: 20_000 });
  await expect(frame.locator('section[aria-labelledby="owner-review-heading"] .status')).toHaveText("Product craft review passed", { timeout: 30_000 });
  await expect(frame.getByText(/Product craft review complete/)).toBeVisible();
  await expect(frame.getByText(/Independent review passed/i)).toHaveCount(0);
  if (options.screenshotPage && options.screenshotPath) {
    await options.screenshotPage.screenshot({ path: options.screenshotPath, fullPage: true });
  }
  await frame.getByRole("button", { name: "Approve this reviewed version" }).click();
  await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
}

async function answerInterviewTopic(frame: FrameLocator, answer: string, nextHeading: string, followUp?: string) {
  await frame.getByLabel("Your answer").fill(answer);
  await frame.getByRole("button", { name: "Save answer" }).click();
  if (followUp) {
    await expect(frame.getByRole("heading", { name: "A quick follow-up" })).toBeVisible();
    await frame.getByLabel("Additional detail").fill(followUp);
    await frame.getByRole("button", { name: "Add this detail" }).click();
  }
  await expect(frame.getByRole("heading", { name: nextHeading })).toBeVisible({ timeout: 15_000 });
}

async function answerEmployment(frame: FrameLocator, job = {
  title: "Customer Service Associate",
  employer: "Lakeside Market",
  location: "Dayton, Ohio",
  started: "March 2021",
  ended: "Present",
  responsibilities: "Help about 60 customers per shift and train new employees.",
}) {
  await expect(frame.getByRole("heading", { name: "One job at a time" })).toBeVisible();
  const fillAcknowledgedField = async (label: string | RegExp, value: string) => {
    await frame.getByLabel(label).fill(value);
    await expect(frame.locator("#recovery-status")).toContainText(/Saved at/, { timeout: 15_000 });
  };
  await fillAcknowledgedField("Job title", job.title);
  await fillAcknowledgedField("Employer", job.employer);
  await fillAcknowledgedField(/Location/, job.location);
  await fillAcknowledgedField(/Started/, job.started);
  await fillAcknowledgedField(/Ended/, job.ended);
  await fillAcknowledgedField("What did you do?", job.responsibilities);
  await frame.getByRole("button", { name: "Save this job" }).click();
  await expect(frame.getByRole("heading", { name: `${job.title} at ${job.employer}` })).toBeVisible({ timeout: 15_000 });
  await expect(frame.getByRole("heading", { name: "Known evidence for this job" })).toBeVisible();
  await expect(frame.getByLabel("Job progress")).toBeVisible();
}

async function completeJobEvidence(
  page: Page,
  frame: FrameLocator,
  nextHeading = "Education and training",
  jobLabel = "Customer Service Associate at Lakeside Market",
  evidenceAnswer = "Created a checkout checklist that reduced errors.",
) {
  await expect(frame.getByRole("heading", { name: "Job coverage summary" })).toBeVisible();
  await expect(frame.getByText(/Why this may help:/)).toBeVisible();
  await frame.getByRole("button", { name: "Ask another way" }).click();
  await expect(frame.getByRole("button", { name: "Ask another way" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog")).toBeHidden();
  await frame.getByLabel("Your answer").fill(evidenceAnswer);
  await frame.getByRole("button", { name: `Review factual units for ${jobLabel}` }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(frame.getByRole("alert")).toBeHidden({ timeout: 15_000 });
  const coverage = frame.getByLabel("Job evidence coverage");
  let priorCoverage = await coverage.innerText();
  await frame.getByRole("button", { name: "I don’t know" }).click();
  await expect.poll(() => coverage.innerText(), { timeout: 15_000 }).not.toBe(priorCoverage);
  await expect(page.getByRole("dialog")).toBeHidden();
  priorCoverage = await coverage.innerText();
  await frame.getByRole("button", { name: "Not applicable" }).click();
  await expect.poll(() => coverage.innerText(), { timeout: 15_000 }).not.toBe(priorCoverage);
  await expect(page.getByRole("dialog")).toBeHidden();
  await frame.getByRole("button", { name: "Complete for now" }).click();
  await expect(frame.getByRole("heading", { name: nextHeading })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog")).toBeHidden();
}

async function skipInterviewTopic(frame: FrameLocator, nextHeading: string) {
  await frame.getByRole("button", { name: "I’m not sure" }).click();
  await expect(frame.getByRole("heading", { name: nextHeading })).toBeVisible({ timeout: 15_000 });
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
  await expect(frame.getByRole("button", { name: "Create general draft" })).toBeVisible({ timeout: 20_000 });
  await frame.getByRole("button", { name: "Create general draft" }).click();
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
  await expect(page.getByRole("button", { name: "Enter app" })).toBeVisible({ timeout: 15_000 });
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
    await expect(frame.getByText("Continuing from your Career context")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Enter app" }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Resume Builder sandbox proxy");

    let forgedSideEffects = 0;
    page.on("request", (request) => { if (request.url().includes("/apps/resume-builder/apps-bridge")) forgedSideEffects += 1; });
    await proxy.evaluate((element) => (element as HTMLIFrameElement).contentWindow?.postMessage({ jsonrpc: "2.0", id: "forged", method: "tools/call", params: { name: "fixture.status" } }, "*"));
    await page.waitForTimeout(100);
    expect(forgedSideEffects).toBe(0);
    await frame.getByRole("button", { name: "Continue to interview" }).click();
    await answerInterviewTopic(frame, "Jordan Lee | Columbus, Ohio | jordan.lee@example.test | 614-555-0148", "What you want next");
    await answerInterviewTopic(frame, "Senior Customer Experience Operations Manager in B2B SaaS", "Work experience");
    await answerEmployment(frame, {
      title: "Customer Experience Operations Manager",
      employer: "Northstar Cloud",
      location: "Columbus, Ohio",
      started: "January 2022",
      ended: "Present",
      responsibilities: "Lead customer experience operations for an 18-person organization using Zendesk, Looker, Jira, Confluence, and Google Sheets.",
    });
    await completeJobEvidence(
      page,
      frame,
      "Education and training",
      "Customer Experience Operations Manager at Northstar Cloud",
      "Reduced response time from 11 hours to 2.5 hours and resolution time from 46 hours to 19 hours; improved CSAT from 86% to 94% while volume grew 35%; launched a knowledge base that deflected 22% of repeat tickets.",
    );
    await answerInterviewTopic(frame, "Bachelor of Arts in Communication, The Ohio State University, May 2018", "Licenses and certifications");
    await answerInterviewTopic(frame, "Zendesk Administrator and Lean Six Sigma certifications", "Skills, tools, and languages");
    await answerInterviewTopic(frame, "Customer experience operations, support analytics, SQL, Zendesk, Looker, Jira, Confluence, and Google Sheets", "Projects");
    await answerInterviewTopic(frame, "Led a six-month Zendesk workflow and reporting redesign across Support, Product, and Engineering", "Leadership and volunteering");
    await answerInterviewTopic(frame, "Mentor two early-career support professionals and facilitate a quarterly peer roundtable", "Professional links");
    await answerInterviewTopic(frame, "linkedin.com/in/jordan-lee-cx-ops", "Review your information");

    await expect(frame.getByRole("heading", { name: "Review your information" })).toBeVisible();
    await expect(frame.getByText(/Reduced response time from 11 hours/)).toBeVisible();
    await expect(frame.getByText(/Helped train new employees with the checklist/)).toHaveCount(0);
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
    await frame.getByLabel("Job title").fill("Senior Customer Support Specialist");
    await frame.getByLabel("Employer").fill("HarborPay");
    await frame.getByLabel(/Location/).fill("Columbus, Ohio");
    await frame.getByLabel(/Started/).fill("June 2019");
    await frame.getByLabel(/Ended/).fill("December 2021");
    await frame.getByLabel("What did you do?").fill("Managed 35 accounts processing approximately $12 million monthly and used SQL to investigate transaction issues.");
    await frame.getByRole("button", { name: "Save this job" }).click();
    await expect(frame.getByLabel("Current job")).toContainText("Senior Customer Support Specialist at HarborPay", { timeout: 15_000 });
    await completeJobEvidence(
      page,
      frame,
      "Review your information",
      "Senior Customer Support Specialist at HarborPay",
      "Created an escalation playbook and trained eight specialists, reducing repeat escalations by 30%.",
    );
    await expect(page.getByRole("dialog")).toBeHidden();
    const contactCard = frame.locator(".card").filter({ hasText: "jordan.lee@example.test" });
    await contactCard.getByRole("button", { name: "Edit" }).click();
    await frame.getByLabel("Information").fill("Jordan Lee | Columbus, Ohio | jordan.lee@example.test | 614-555-0148");
    await frame.getByRole("button", { name: "Save change" }).click();
    await expect(frame.getByText(/jordan\.lee@example\.test/)).toBeVisible();
    let appOwnedInferenceObservation: { requestBytes: number; httpStatus: number; inferenceStatus: string | null; errorCode: string | null; errorMessage: string | null; completionMode: string | null; attemptCount: number | null; issueIds: string[] } | null = null;
    const inferenceRows: Array<{ programId: string; httpStatus: number; completionMode: string | null; attemptCount: number | null; issueIds: string[] }> = [];
    let appOwnedPersistenceObservation: Record<string, unknown> | null = null;
    type DefinitionWriteInput = {
      inference_contract_version?: unknown;
      program?: { id?: unknown };
      definition_kind?: unknown;
      generation_result?: { statements?: unknown[] };
      statements?: Array<{ section_id?: unknown; display_role?: unknown; supporting_confirmed_fact_revision_ids?: unknown[] }>;
      section_order?: unknown;
      strategy_binding?: { used_must_use_fact_revision_ids?: unknown[]; omissions?: unknown[] };
    };
    await page.route("**/apps/resume-builder/data/call", async (route) => {
      const body = route.request().postDataJSON() as { capability?: string; input?: DefinitionWriteInput };
      if (body.input?.inference_contract_version !== 2) {
        if (body.capability === "resume.definitions.write" && body.input?.definition_kind === "general" && body.input?.generation_result) {
          const response = await route.fetch();
          const payload = await response.json() as { error?: { code?: string; message?: string } | string; message?: string };
          appOwnedPersistenceObservation = {
            httpStatus: response.status(),
            errorCode: typeof payload.error === "string" ? payload.error : payload.error?.code ?? null,
            errorMessage: typeof payload.error === "object" ? payload.error?.message ?? null : payload.message ?? null,
            statementCount: body.input.statements?.length ?? null,
            generationStatementCount: body.input.generation_result.statements?.length ?? null,
            sectionOrder: body.input.section_order ?? null,
            statementSections: [...new Set((body.input.statements ?? []).map((statement) => statement.section_id))],
            displayRoles: (body.input.statements ?? []).map((statement) => statement.display_role),
            usedSupportCount: new Set((body.input.statements ?? []).flatMap((statement) => statement.supporting_confirmed_fact_revision_ids ?? [])).size,
            usedMustCount: body.input.strategy_binding?.used_must_use_fact_revision_ids?.length ?? null,
            omissionCount: body.input.strategy_binding?.omissions?.length ?? null,
          };
          await route.fulfill({ response });
          return;
        }
        await route.fallback(); return;
      }
      const response = await route.fetch();
      const payload = await response.json() as { result?: { status?: string; completion_mode?: string; attempt_count?: number; issue_ids?: unknown }; error?: { code?: string; message?: string } | string; message?: string };
      appOwnedInferenceObservation = {
        requestBytes: Buffer.byteLength(route.request().postData() ?? "", "utf8"),
        httpStatus: response.status(),
        inferenceStatus: payload.result?.status ?? null,
        errorCode: typeof payload.error === "string" ? payload.error : payload.error?.code ?? null,
        errorMessage: typeof payload.error === "object" ? payload.error?.message ?? null : payload.message ?? null,
        completionMode: payload.result?.completion_mode ?? null,
        attemptCount: payload.result?.attempt_count ?? null,
        issueIds: Array.isArray(payload.result?.issue_ids) ? payload.result.issue_ids.filter((value): value is string => typeof value === "string") : [],
      };
      inferenceRows.push({
        programId: typeof body.input?.program?.id === "string" ? body.input.program.id : "unknown",
        httpStatus: response.status(),
        completionMode: appOwnedInferenceObservation.completionMode,
        attemptCount: appOwnedInferenceObservation.attemptCount,
        issueIds: appOwnedInferenceObservation.issueIds,
      });
      await route.fulfill({ response });
    });
    await reviewStrategyAndCreate(frame);
    await expect.poll(() => appOwnedPersistenceObservation, { timeout: 30_000 }).not.toBeNull();
    if (appOwnedPersistenceObservation?.httpStatus !== 200) throw new Error(`app-owned persistence diagnostic ${JSON.stringify(appOwnedPersistenceObservation)}`);
    expect(appOwnedPersistenceObservation).toMatchObject({ httpStatus: 200, errorCode: null, errorMessage: null });
    expect(appOwnedPersistenceObservation?.sectionOrder).toEqual(["contact", "summary", "experience", "education", "certifications", "skills", "projects", "leadership", "links"]);
    await expect.poll(() => appOwnedInferenceObservation, { timeout: 30_000 }).toMatchObject({ httpStatus: 200, inferenceStatus: "completed", errorCode: null, errorMessage: null, completionMode: "provider", attemptCount: 1, issueIds: [] });
    await expect(frame.locator("#alert")).toBeHidden({ timeout: 15_000 });
    expect(appOwnedInferenceObservation).toEqual({ requestBytes: appOwnedInferenceObservation?.requestBytes, httpStatus: 200, inferenceStatus: "completed", errorCode: null, errorMessage: null, completionMode: "provider", attemptCount: 1, issueIds: [] });
    expect(appOwnedInferenceObservation!.requestBytes).toBeLessThan(65_536);
    await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByRole("status").filter({ hasText: "recovered a basic fact-backed draft" })).toHaveCount(0);

    await page.getByRole("button", { name: "Reload app" }).click();
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 15_000 });
    frame = resumeBuilderFrame(page);
    await expect(frame.getByText("Continuing from your Career context")).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByText(/Jordan Lee/).first()).toBeVisible();
    const generalDraft = (await frame.locator("textarea[data-index]").evaluateAll((elements) =>
      elements.map((element) => (element as HTMLTextAreaElement).value).join("\n"),
    ));
    expect(generalDraft).toContain("jordan.lee@example.test");
    expect(generalDraft).toContain("Customer Experience Operations Manager");
    expect(generalDraft).toContain("The Ohio State University");
    expect(generalDraft).toContain("Zendesk Administrator");
    expect(generalDraft).toContain("linkedin.com/in/jordan-lee-cx-ops");
    const unsupportedCanary = "Increased retention by 99 percent";
    const statementIndex = await frame.locator("textarea[data-index]").evaluateAll((elements) =>
      elements.findIndex((element) => (element as HTMLTextAreaElement).value.includes("Reduced response time")),
    );
    expect(statementIndex).toBeGreaterThanOrEqual(0);
    let statementEditor = frame.locator("textarea[data-index]").nth(statementIndex);
    const supportedText = await statementEditor.inputValue();
    await statementEditor.fill(`${supportedText} ${unsupportedCanary}.`);
    await statementEditor.locator("xpath=..").getByRole("button", { name: "Save edit" }).click();
    await expect(frame.getByRole("alert")).toContainText("This edit includes details that are not present in your confirmed evidence.");
    await expect(frame.getByRole("alert")).toContainText("Remove the unsupported details or return to the interview to add evidence.");
    await page.screenshot({ path: testInfo.outputPath("resume-builder-unsupported-edit.png"), fullPage: true });
    statementEditor = frame.locator("textarea[data-index]").nth(statementIndex);
    await statementEditor.fill(supportedText);
    await statementEditor.locator("xpath=..").getByRole("button", { name: "Save edit" }).click();
    await expect(frame.locator("textarea[data-index]").nth(statementIndex)).toHaveValue(supportedText, { timeout: 15_000 });
    await reviewAndApprove(frame, {
      screenshotPage: page,
      screenshotPath: testInfo.outputPath("resume-builder-owner-review.png"),
    });

    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Revise in your own words" }).click();
    await expect(frame.getByRole("heading", { name: "Revise this resume in your own words" })).toBeFocused();
    await frame.getByLabel("What should change?").fill("Shorten the summary without changing facts.");
    await frame.getByRole("button", { name: "Save request and review route" }).click();
    const revisionReviewHeading = frame.getByRole("heading", { name: "Review revision proposal" });
    try {
      await expect.poll(async () => await revisionReviewHeading.isVisible(), { timeout: 60_000 }).toBe(true);
    } catch {
      const alert = await frame.getByRole("alert").textContent().catch(() => null);
      const panelText = await frame.locator("#panel").innerText().catch(() => null);
      throw new Error(`Revision proposal did not become ready: ${JSON.stringify({ alert, panelText, inferenceRows })}`);
    }
    await expect(revisionReviewHeading).toBeFocused();
    await expect(frame.getByText(/presentation request.*resume scope/i)).toBeVisible();
    await frame.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByRole("alert")).toContainText("Validate and approve this resume version separately");
    await reviewAndApprove(frame);

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
    await expect(frame.getByRole("heading", { name: "Review revision proposal" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });

    await frame.locator('[data-stage="job"]').click();
    await expect(frame.getByRole("heading", { name: "Paste the target job description" })).toBeVisible({ timeout: 15_000 });
    await frame.getByLabel("Role label").fill("Synthetic TypeScript role");
    await frame.getByLabel("Job description").fill("Requires TypeScript delivery and respectful collaboration with product owners.");
    await frame.getByRole("button", { name: "Analyze evidence" }).click();
    await expect(frame.getByRole("heading", { name: "Requirement evidence" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Assess fit and create a useful variant" }).click();
    const tailoredHeading = frame.locator("#panel h2").filter({ hasText: "Tailored resume" });
    try {
      await expect(tailoredHeading).toBeAttached({ timeout: 30_000 });
    } catch {
      const alert = await frame.getByRole("alert").textContent().catch(() => null);
      const panelText = await frame.locator("#panel").innerText().catch(() => null);
      throw new Error(`Tailored resume did not become ready: ${JSON.stringify({ alert, panelText, inferenceRows })}`);
    }
    await tailoredHeading.scrollIntoViewIfNeeded();
    await expect(tailoredHeading).toBeVisible();
    await reviewAndApprove(frame);

    await expect(frame.getByRole("heading", { name: "Preview approved resume" })).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: "Create preview" }).click();
    await expect(frame.getByText("Local extraction passed")).toBeVisible();
    const resumePreview = frame.getByLabel("Resume preview");
    const cleanText = frame.getByLabel(/Clean resume text/);
    await expect(resumePreview).toContainText("Jordan Lee");
    await expect(resumePreview).toContainText("jordan.lee@example.test");
    await expect(resumePreview).toContainText("Experience");
    await expect(resumePreview).toContainText("Education");
    await expect(resumePreview).toContainText("Skills");
    await expect(resumePreview).not.toContainText("Resume goal:");
    await expect(resumePreview).toContainText("linkedin.com/in/jordan-lee-cx-ops");
    await expect(resumePreview).not.toContainText("Professional link:");
    await expect(resumePreview).not.toContainText(unsupportedCanary);
    await expect(cleanText).toContainText("Jordan Lee");
    await expect(cleanText).toContainText("jordan.lee@example.test");
    await expect(cleanText).not.toContainText(unsupportedCanary);
    await page.screenshot({ path: testInfo.outputPath("resume-builder-career-preview.png"), fullPage: true });

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await frame.getByRole("button", { name: "Copy clean text" }).click();
    const copyDialog = page.getByRole("dialog");
    const copyConfirm = copyDialog.getByRole("button", { name: "Confirm", exact: true });
    const copyCancel = copyDialog.getByRole("button", { name: "Cancel", exact: true });
    await expect(copyConfirm).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(copyCancel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(copyConfirm).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(copyDialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Resume Builder sandbox proxy");
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
    const approvedGeneralCards = frame.locator(".history-option").filter({ hasText: /general.*approved/i });
    expect(await approvedGeneralCards.count()).toBeGreaterThanOrEqual(2);
    await approvedGeneralCards.first().getByRole("checkbox").check();
    await approvedGeneralCards.last().getByRole("checkbox").check();
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
          bridge_generation: 2,
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
    expect(inferenceRows.find((row) => row.programId === "resume.craft-evaluate")).toMatchObject({
      httpStatus: 200,
      completionMode: "provider",
      attemptCount: 1,
      issueIds: [],
    });
    const reportPath = process.env.BRAINDRIVE_E2E_ACCEPTANCE_REPORT_PATH?.trim();
    if (reportPath) {
      if (!path.isAbsolute(reportPath)) throw new Error("Resume acceptance report path must be absolute");
      await writeFile(reportPath, `${JSON.stringify({
        evidence_contract_version: 1,
        fixture_scope: "synthetic_serious_profile_full_owner_journey",
        status: "passed",
        interview_reload: "facts_and_proposal_visible",
        coverage: "all_applicable_dimensions_disposed",
        general_nine_section_topology: "provider_attempt_1",
        unsupported_edit: "rejected_with_actionable_guidance",
        craft_review: "product_craft_passed",
        approval: "host_confirmed_after_craft_pass",
        preview_export: "clean_text_pdf_and_text_completed",
        revision_lineage: "approved_successor_and_history_comparison_visible",
        unsupported_content_approved: false,
        inference_rows: inferenceRows,
        screenshots: [
          "resume-builder-unsupported-edit.png",
          "resume-builder-owner-review.png",
          "resume-builder-career-preview.png",
          "resume-builder-version-comparison.png",
        ],
        owner_content_retained: false,
        credentials_tokens_endpoints_private_paths_retained: false,
      }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
  });
});

test.describe("Resume Builder responsive job interview", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, "Responsive job identity and controls run in the mobile projects.");
    await loginAsLocalUser(page);
  });

  test("keeps current-job identity, progress, and optional controls usable without horizontal overflow", async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openCareerApps(page);
    const frame = await installAndLaunchCareer(page);
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Enter app" }).click();
    await expect(frame.getByRole("heading", { name: "Resume Builder", exact: true })).toBeVisible({ timeout: 20_000 });
    const continueInterview = frame.getByRole("button", { name: "Continue to interview" });
    const currentJob = frame.getByLabel("Current job");
    const historyStep = frame.locator('[data-stage="history"]');
    expect(await frame.getByRole("button").first().evaluate((button) => getComputedStyle(button).transitionDuration)).toBe("0s");
    await expect.poll(async () => {
      if (await continueInterview.isVisible() || await currentJob.isVisible() || await historyStep.isEnabled()) return "ready";
      const connection = await frame.locator("#connection").textContent().catch(() => "connection unavailable");
      const heading = await frame.locator("#panel h2").first().textContent().catch(() => "panel unavailable");
      return `${connection}: ${heading}`;
    }, { timeout: 15_000 }).toBe("ready");
    if (await continueInterview.isVisible()) {
      await continueInterview.click();
      await answerInterviewTopic(frame, "Mobile Owner | Dayton, Ohio | mobile@example.test | 555-010-0101", "What you want next");
      await answerInterviewTopic(frame, "Customer support roles", "Work experience");
      await answerEmployment(frame);
    }
    if (await currentJob.isVisible()) {
      await expect(currentJob).toContainText("Customer Service Associate at Lakeside Market");
      for (const name of ["Back", "Skip for now", "I don’t know", "Not applicable", "Save and pause", "Complete for now"]) {
        await expect(frame.getByRole("button", { name })).toBeVisible();
      }
      expect(await frame.locator("html").evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

      await completeJobEvidence(page, frame);
      await skipInterviewTopic(frame, "Licenses and certifications");
      await skipInterviewTopic(frame, "Skills, tools, and languages");
      await skipInterviewTopic(frame, "Projects");
      await skipInterviewTopic(frame, "Leadership and volunteering");
      await skipInterviewTopic(frame, "Professional links");
      await skipInterviewTopic(frame, "Review your information");
      await reviewStrategyAndCreate(frame);
      await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 15_000 });
      const firstStatement = frame.locator("textarea[data-index]").first();
      const originalStatement = await firstStatement.inputValue();
      const editedStatement = originalStatement.endsWith(".") ? originalStatement.slice(0, -1) : `${originalStatement}.`;
      await firstStatement.fill(editedStatement);
      await frame.getByRole("button", { name: "Save edit" }).first().click();
      await expect(frame.locator("textarea[data-index]").first()).toHaveValue(editedStatement, { timeout: 15_000 });
      await frame.getByRole("button", { name: "Run product craft review" }).click();
      const ownerReview = frame.locator('section[aria-labelledby="owner-review-heading"]');
      await expect(ownerReview.locator(".status")).toHaveText("More evidence could strengthen this resume", { timeout: 20_000 });
      await expect(ownerReview.locator("button[data-owner-action]").first()).toBeVisible();
      await expect(ownerReview.getByRole("button", { name: "Approve this reviewed version" })).toHaveCount(0);
      await expect(ownerReview).not.toContainText(/score|independent review passed/i);
      expect(await frame.locator("html").evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    }
    await expect(historyStep).toBeEnabled();
    await historyStep.click();
    let versions = frame.getByRole("checkbox", { name: /Select .* general version/i });
    if (await versions.count() < 2) {
      await page.getByRole("button", { name: "Reload app" }).click();
      await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 15_000 });
      await expect(historyStep).toBeEnabled({ timeout: 15_000 });
      await historyStep.click();
      versions = frame.getByRole("checkbox", { name: /Select .* general version/i });
    }
    expect(await versions.count()).toBeGreaterThanOrEqual(2);
    await versions.nth(0).check();
    await versions.last().check();
    await frame.getByRole("button", { name: "Compare selected versions" }).click();
    await expect(frame.getByRole("heading", { name: "Compare resume versions" })).toBeFocused();
    await expect(frame.getByText(/No observable changes|Added statement|Removed statement|Changed statement|Moved statement|Evidence references changed/).first()).toBeVisible();
    const unchanged = frame.getByRole("button", { name: /Unchanged statements/ });
    await expect(unchanged).toHaveAttribute("aria-expanded", "false");
    await frame.locator("html").evaluate((element) => { (element as HTMLElement).style.zoom = "2"; });
    expect(await frame.locator("html").evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
});
