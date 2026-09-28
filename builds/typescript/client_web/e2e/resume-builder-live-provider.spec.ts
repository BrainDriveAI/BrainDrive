import { writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type FrameLocator, type Page } from "@playwright/test";

import { loginAsLocalUser } from "./helpers";

const LIVE_ENABLED = process.env.BRAINDRIVE_E2E_LIVE_PROVIDER === "1";
const STRATEGY_ONLY = process.env.BRAINDRIVE_E2E_LIVE_STRATEGY_ONLY === "1";
const MAX_INFERENCE_CALLS = 8;

function resumeBuilderFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Resume Builder sandbox proxy"]').frameLocator('iframe[title="Resume Builder"]');
}

async function answerTopic(frame: FrameLocator, answer: string, nextHeading: string): Promise<void> {
  await frame.getByLabel("Your answer").fill(answer);
  await frame.getByRole("button", { name: "Save answer" }).click();
  await expect(frame.getByRole("heading", { name: nextHeading })).toBeVisible({ timeout: 20_000 });
}

async function skipTopic(frame: FrameLocator, nextHeading: string): Promise<void> {
  await frame.getByRole("button", { name: "I’m not sure" }).click();
  await expect(frame.getByRole("heading", { name: nextHeading })).toBeVisible({ timeout: 20_000 });
}

test.describe("Resume Builder live-provider proposal journey", () => {
  test.skip(!LIVE_ENABLED, "Requires explicit live-provider authorization and an isolated read-only credential mount.");

  test("completes a fresh interview, persists a provider draft, reloads it, and keeps approval gates closed", async ({ page }) => {
    test.setTimeout(300_000);
    await loginAsLocalUser(page);

    const inferenceRows: Array<{ program_id: string; http_status: number; completion_mode: string | null; attempt_count: number | null; issue_count: number; issue_ids: string[] }> = [];
    let proposalWriteObservation: { http_status: number; error_code: string | null; issue_ids: string[] } | null = null;
    let strategyWriteObservation: { http_status: number; error_code: string | null; issue_ids: string[] } | null = null;
    await page.route("**/apps/resume-builder/data/call", async (route) => {
      const body = route.request().postDataJSON() as {
        capability?: string;
        input?: {
          inference_contract_version?: number;
          program?: { id?: unknown };
          kind?: string;
          definition_kind?: string;
          status?: string;
        };
      };
      if (body.capability === "app.inference.request" && body.input?.inference_contract_version === 2) {
        if (inferenceRows.length >= MAX_INFERENCE_CALLS) {
          await route.abort("blockedbyclient");
          throw new Error(`Live inference call ceiling exceeded: ${MAX_INFERENCE_CALLS}`);
        }
        const response = await route.fetch();
        const payload = await response.json() as {
          result?: { completion_mode?: unknown; attempt_count?: unknown; issue_ids?: unknown };
        };
        const issueIds = Array.isArray(payload.result?.issue_ids)
          ? payload.result.issue_ids.filter((issue): issue is string => typeof issue === "string" && /^[a-z][a-z0-9.-]+\/[a-z][a-z0-9-]*$/.test(issue)).slice(0, 20)
          : [];
        inferenceRows.push({
          program_id: String(body.input.program?.id ?? "unknown"),
          http_status: response.status(),
          completion_mode: typeof payload.result?.completion_mode === "string" ? payload.result.completion_mode : null,
          attempt_count: Number.isInteger(payload.result?.attempt_count) ? payload.result.attempt_count : null,
          issue_count: issueIds.length,
          issue_ids: issueIds,
        });
        await route.fulfill({ response });
        return;
      }
      if (body.capability === "resume.definitions.write" && body.input?.definition_kind === "general" && body.input?.status === "proposed") {
        const response = await route.fetch();
        const payload = await response.json() as { error?: string | { code?: unknown }; issue_ids?: unknown };
        proposalWriteObservation = {
          http_status: response.status(),
          error_code: typeof payload.error === "string"
            ? payload.error
            : typeof payload.error?.code === "string" ? payload.error.code : null,
          issue_ids: Array.isArray(payload.issue_ids)
            ? payload.issue_ids.filter((issue): issue is string => typeof issue === "string" && /^[a-z][a-z0-9.-]+\/[a-z][a-z0-9-]*$/.test(issue)).slice(0, 20)
            : [],
        };
        await route.fulfill({ response });
        return;
      }
      if (body.capability === "resume.definitions.write" && body.input?.kind === "resume_strategy") {
        const response = await route.fetch();
        const payload = await response.json() as { error?: string | { code?: unknown }; issue_ids?: unknown };
        strategyWriteObservation = {
          http_status: response.status(),
          error_code: typeof payload.error === "string"
            ? payload.error
            : typeof payload.error?.code === "string" ? payload.error.code : null,
          issue_ids: Array.isArray(payload.issue_ids)
            ? payload.issue_ids.filter((issue): issue is string => typeof issue === "string" && /^[a-z][a-z0-9.-]+\/[a-z][a-z0-9-]*$/.test(issue)).slice(0, 20)
            : [],
        };
        await route.fulfill({ response });
        return;
      }
      await route.fallback();
    });

    const career = page.getByRole("button", { name: "Career", exact: true });
    const navigation = page.getByRole("button", { name: "Open navigation menu" });
    await expect(career.or(navigation)).toBeVisible({ timeout: 20_000 });
    if (!await career.isVisible()) await navigation.click();
    await career.click();
    const apps = page.getByRole("button", { name: "Apps", exact: true });
    if (!await apps.isVisible()) await navigation.click();
    await apps.click();
    await expect(page.getByTestId("apps-page")).toBeVisible();

    const install = page.getByRole("button", { name: "Install Resume Builder" });
    const launch = page.getByRole("button", { name: "Continue from Career" });
    await expect(install.or(launch)).toBeVisible({ timeout: 20_000 });
    if (await install.isVisible()) await install.click();
    await expect(launch).toBeVisible({ timeout: 20_000 });
    await launch.click();
    let frame = resumeBuilderFrame(page);
    await expect(page.getByRole("button", { name: "Enter app" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Enter app" }).click();

    await frame.getByRole("button", { name: "Continue to interview" }).click();
    await answerTopic(frame, "Synthetic Live Owner | Dayton, Ohio | live.owner@example.test | 555-010-0199", "What you want next");
    await answerTopic(frame, "Customer support leadership roles", "Work experience");

    const fillSaved = async (label: string | RegExp, value: string): Promise<void> => {
      await frame.getByLabel(label).fill(value);
      await expect(frame.locator("#recovery-status")).toContainText(/Saved at/, { timeout: 20_000 });
    };
    await fillSaved("Job title", "Customer Service Lead");
    await fillSaved("Employer", "Synthetic Lakeside Market");
    await fillSaved(/Location/, "Dayton, Ohio");
    await fillSaved(/Started/, "March 2021");
    await fillSaved(/Ended/, "Present");
    await fillSaved("What did you do?", "Helped customers and trained new employees using a documented checkout checklist.");
    await frame.getByRole("button", { name: "Save this job" }).click();
    await expect(frame.getByRole("heading", { name: "Customer Service Lead at Synthetic Lakeside Market" })).toBeVisible({ timeout: 20_000 });

    await expect(frame.getByLabel("Your answer")).toBeVisible({ timeout: 30_000 });
    await frame.getByLabel("Your answer").fill("Created a checkout checklist that reduced avoidable handoff errors and helped train new employees.");
    await frame.getByRole("button", { name: /Review factual units for Customer Service Lead/ }).click();
    await expect(frame.getByRole("alert")).toBeHidden({ timeout: 20_000 });
    const jobCoverage = frame.getByLabel("Job evidence coverage");
    let priorCoverage = await jobCoverage.innerText();
    await frame.getByRole("button", { name: "I don’t know" }).click();
    await expect.poll(() => jobCoverage.innerText(), { timeout: 20_000 }).not.toBe(priorCoverage);
    priorCoverage = await jobCoverage.innerText();
    await frame.getByRole("button", { name: "Not applicable" }).click();
    await expect.poll(() => jobCoverage.innerText(), { timeout: 20_000 }).not.toBe(priorCoverage);
    await expect(frame.getByRole("button", { name: "Complete for now" })).toBeVisible({ timeout: 30_000 });
    await frame.getByRole("button", { name: "Complete for now" }).click();

    await expect(frame.getByRole("heading", { name: "Education and training" })).toBeVisible({ timeout: 20_000 });
    await answerTopic(frame, "Associate of Applied Science in Business Administration, Synthetic Community College, 2018", "Licenses and certifications");
    await skipTopic(frame, "Skills, tools, and languages");
    await answerTopic(frame, "Customer service, Microsoft Excel, appointment scheduling, and employee training", "Projects");
    await skipTopic(frame, "Leadership and volunteering");
    await skipTopic(frame, "Professional links");
    await skipTopic(frame, "Review your information");

    await frame.getByRole("button", { name: "Review resume plan" }).click();
    const planHeading = frame.getByRole("heading", { name: "Your resume plan" });
    const actionAlert = frame.getByRole("alert");
    await expect(planHeading.or(actionAlert)).toBeVisible({ timeout: 120_000 });
    if (await actionAlert.isVisible()) throw new Error(`Strategy stage failed: ${JSON.stringify(strategyWriteObservation)}`);
    if (STRATEGY_ONLY) {
      expect(strategyWriteObservation).toMatchObject({ http_status: 200, error_code: null, issue_ids: [] });
      expect(inferenceRows).toEqual([expect.objectContaining({
        program_id: "resume.strategy",
        http_status: 200,
        completion_mode: "provider",
        attempt_count: 1,
        issue_count: 0,
        issue_ids: [],
      })]);
      const reportPath = process.env.BRAINDRIVE_E2E_LIVE_REPORT_PATH?.trim();
      if (reportPath) {
        if (!path.isAbsolute(reportPath)) throw new Error("Live browser report path must be absolute");
        await writeFile(reportPath, `${JSON.stringify({
          evidence_contract_version: 1,
          fixture_scope: "synthetic_live_interview_to_strategy",
          status: "passed",
          inference_call_count: inferenceRows.length,
          inference_rows: inferenceRows,
          strategy_write: strategyWriteObservation,
          proposal_write_status: null,
          reload_readback: "not_run",
          preview_gate: "not_reached",
          history_gate: "not_reached",
          owner_content_retained: false,
          credentials_tokens_endpoints_private_paths_retained: false,
        }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      }
      return;
    }
    await frame.getByRole("button", { name: "Create general draft" }).click();
    const generalHeading = frame.getByRole("heading", { name: "General resume" });
    const generalAlert = frame.getByRole("alert");
    await expect(generalHeading.or(generalAlert)).toBeVisible({ timeout: 120_000 });
    if (await generalAlert.isVisible()) throw new Error(`General stage failed: ${JSON.stringify({ inference_rows: inferenceRows, proposal_write: proposalWriteObservation })}`);
    expect(proposalWriteObservation).toMatchObject({ http_status: 200, error_code: null, issue_ids: [] });
    const generalRow = inferenceRows.find((row) => row.program_id === "resume.general-draft");
    expect(generalRow).toMatchObject({ http_status: 200, completion_mode: "provider", attempt_count: 1, issue_count: 0 });
    expect(inferenceRows.length).toBeLessThanOrEqual(MAX_INFERENCE_CALLS);
    await expect(frame.locator("textarea[data-index]")).not.toHaveCount(0);

    await page.getByRole("button", { name: "Reload app" }).click();
    await expect(page.getByRole("status").filter({ hasText: "App ready" })).toBeVisible({ timeout: 30_000 });
    frame = resumeBuilderFrame(page);
    await expect(frame.getByRole("heading", { name: "General resume" })).toBeVisible({ timeout: 30_000 });
    await expect(frame.getByText(/Synthetic Live Owner/).first()).toBeVisible();
    const previewStep = frame.locator(".steps button", { hasText: "Preview & export" });
    await expect(previewStep).toBeDisabled();
    const historyStep = frame.locator(".steps button", { hasText: "History" });
    await expect(historyStep).toBeEnabled();
    await historyStep.click();
    await expect(frame.getByRole("heading", { name: "Resume history" })).toBeVisible();
    await expect(frame.getByText(/proposed/i).first()).toBeVisible();

    const reportPath = process.env.BRAINDRIVE_E2E_LIVE_REPORT_PATH?.trim();
    if (reportPath) {
      if (!path.isAbsolute(reportPath)) throw new Error("Live browser report path must be absolute");
      await writeFile(reportPath, `${JSON.stringify({
        evidence_contract_version: 1,
        fixture_scope: "synthetic_live_interview_to_proposal",
        status: "passed",
        inference_call_count: inferenceRows.length,
        inference_rows: inferenceRows,
        strategy_write: strategyWriteObservation,
        proposal_write: proposalWriteObservation,
        reload_readback: "proposed_visible",
        preview_gate: "approval_required",
        history_gate: "proposed_visible",
        owner_content_retained: false,
        credentials_tokens_endpoints_private_paths_retained: false,
      }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    }
  });
});
