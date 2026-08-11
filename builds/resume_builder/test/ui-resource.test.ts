import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("sandboxed Resume Builder owner resource", () => {
  it("contains syntactically valid inline application code", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it("contains the complete bounded journey and required text states", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    for (const text of [
      "Start with what BrainDrive already knows",
      "One topic at a time",
      "One job at a time",
      "Which job was this for?",
      "job_fact_revision_id",
      "Review your information",
      "What kind of work would you like this resume to support?",
      "Add another job",
      "Reopen interview",
      "Edit",
      "Remove",
      "I’m not sure",
      "General resume",
      "Requirement evidence",
      "Baseline comparison",
      "Tailored resume",
      "Local extraction passed",
      "Resume history",
      "Factual warnings",
      "Document warnings",
      "Role evidence gaps",
    ]) expect(html).toContain(text);
    expect(html).toContain("@media(max-width:820px)");
    expect(html).toContain("@media(max-width:520px)");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('decision:"edit_and_accept"');
    expect(html).toContain('decision:"reject"');
    expect(html).toContain("confirmedDuplicate(topic,value)");
    expect(html).toContain('prompt_version:"resume-interview-4.0.0"');
    expect(html).toContain("interview_turn:turn");
    expect(html).toContain('kind:"interview_turn"');
    expect(html).toContain('interviewTurn(topic,question,null,null,"skipped")');
    expect(html).toContain('stage="preview"');
    expect(html).toContain('stage==="history"');
    expect(html).toContain("normalizeDraftStatements");
    expect(html).toContain('state.stage="general_review";render();focusPanel()');
    expect(html).toContain('state.stage="tailored_review";render();focusPanel()');
  });

  it("keeps privileged browser/network authority outside the package resource", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|window\.open)\s*\(/);
    expect(html).not.toMatch(/\b(?:https?:|file:|tauri:|javascript:)/i);
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toContain("provider_profile");
    expect(html).not.toContain("api_key");
  });

  it("binds host fact confirmation to the exact proposed revision", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("fact_revision_id:proposed.fact.metadata.revision_id");
  });

  it("implements acknowledged exact-slot recovery without browser storage", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("RECOVERY_SETTLE_MS=1500");
    expect(html).toContain("RECOVERY_ACK_TIMEOUT_MS=500");
    expect(html).toContain('kind:"interview_recovery_save"');
    expect(html).toContain('kind:"interview_recovery_discard"');
    expect(html).toContain('kind:"interview_progress_submit"');
    expect(html).toContain("request_operation_id");
    expect(html).toContain('queried_operation_id:operationId');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("Saved at");
    expect(html).toContain("Not safely saved");
    expect(html).toContain("Use my unsaved value");
    expect(html).toContain("Use the saved value");
    expect(html).toContain("Discard draft");
    expect(html).toContain("focus({preventScroll:true})");
    expect(html).toContain('message.method==="ui/resource-teardown"');
    expect(html).toContain("cancelRecoveryTimer()");
    expect(html).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/);
  });

  it("keeps recovery drafts out of inference and submitted provenance until submit", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("recovery_draft");
    expect(html).toContain("last_submitted_turn_revision_id");
    expect(html).not.toContain("recovery_draft:extra.derived_blocks");
    expect(html).not.toContain("draft_value:extra.derived_blocks");
  });

  it("exposes the optional one-job evidence loop with accessible identity and navigation", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    for (const text of [
      "Known evidence for this job",
      "Job progress",
      "Back",
      "Skip for now",
      "I don’t know",
      "Not applicable",
      "Save and pause",
      "Complete for now",
      "Review job evidence",
      "Reopen interview",
      "Exact numbers are optional",
    ]) expect(html).toContain(text);
    expect(html).toContain('aria-label="Current job"');
    expect(html).toContain('aria-label="Job progress"');
    expect(html).toContain('association:"job"');
    expect(html).toContain('association:"general"');
    expect(html).toContain('fact_kind:"job_evidence"');
    expect(html).toContain('infer("interview_assist"');
  });

  it("exposes remembered-detail disambiguation, duplicate reuse, successor generation, and impact notice", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    for (const text of [
      "Add remembered detail",
      "Which job was this detail for?",
      "Use general career context",
      "Add another job",
      "This information is already confirmed",
      "What this proposal changes",
      "based on older evidence",
      "Rebuild explicitly",
    ]) expect(html).toContain(text);
    expect(html).toContain('kind:"remembered_information"');
    expect(html).toContain('kind:"impact_analysis"');
    expect(html).toContain('source_definition_revision_id:source.metadata.revision_id');
    expect(html).toContain('parent_definition_revision_id:source.metadata.revision_id');
    expect(html).toContain('status:"proposed"');
  });

  it("renders a complete accessible two-version comparison without model or mutation authority", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    for (const text of [
      "Compare selected versions",
      "Compare resume versions",
      "Added statement",
      "Removed statement",
      "Changed statement",
      "Moved statement",
      "Evidence references changed",
      "Unchanged statements",
      "No observable changes",
      "These versions cannot be compared",
    ]) expect(html).toContain(text);
    expect(html).toContain('kind:"compare_definitions"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('aria-expanded="${expanded}"');
    expect(html).toContain('id="comparison-heading"');
    expect(html).toContain('focus({preventScroll:true})');
    expect(html).toContain("definition_history");
    expect(html).not.toContain('infer("compare_definitions"');
  });

  it("persists, classifies, confirms, reviews, and resolves scoped natural-language revisions", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    for (const text of [
      "Revise in your own words",
      "Revision scope",
      "Save request and review route",
      "One clarification is needed",
      "Confirm factual meaning before generation",
      "Review revision proposal",
      "Accept",
      "Edit",
      "Reject",
      "Regenerate",
      "Accepting does not approve the resume",
    ]) expect(html).toContain(text);
    expect(html).toContain('kind:"revision_request"');
    expect(html).toContain('infer("resume_revision_classify"');
    expect(html).toContain('infer("resume_revision_draft"');
    expect(html).toContain('kind:"revision_proposal"');
    expect(html).toContain('kind:"revision_outcome"');
    expect(html).toContain("request_text:requestText");
    expect(html.indexOf('kind:"revision_request"')).toBeLessThan(html.indexOf('infer("resume_revision_classify"'));
    expect(html).not.toContain('status:"approved",title:draft.title');
  });

  it("keeps exact clean text selectable through PDF, copy, and text-export failure and shows score-free guidance", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    for (const text of [
      "Clean resume text",
      "PDF unavailable — clean text ready",
      "Copy clean text",
      "Export .txt",
      "select the text above and copy it manually",
      "Strengths and evidence gaps",
      "Strong evidence",
      "Useful missing detail",
      "Unresolved conflict",
      "Unsupported requirement",
      "Intentional omission",
      "Optional next questions",
    ]) expect(html).toContain(text);
    expect(html).toContain('readonly aria-describedby="clean-text-help"');
    expect(html).toContain('action:"copy_to_clipboard"');
    expect(html).toContain('format:"text"');
    expect(html).toContain('infer("resume_guidance"');
    expect(html).not.toMatch(/ATS score|employability score|interview guarantee/i);
  });
});
