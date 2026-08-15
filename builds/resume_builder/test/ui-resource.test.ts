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

  it("presents native chat as the sole ordinary intake surface with intentional review", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    for (const text of [
      "Let’s build the story your resume can prove",
      "One useful question at a time",
      "Your evidence ledger",
      "Edit confirmed fact",
      "Fact-backed fallback ready",
      "If model output is unusable",
      "Readable first generated draft",
      "Correct draft wording directly",
      "Create first draft",
      "Reply in your own words",
      "resume_dialogue",
      "chat.turn.commit",
      "I couldn’t safely process that turn",
    ]) expect(html).toContain(text);
    expect(html).toContain('id="fact-snapshot"');
    expect(html).toContain('aria-label="Resume evidence ledger"');
    expect(html).toContain("renderSnapshot()");
    expect(html).toContain('class="coach-message"');
    expect(html).toContain('class="answer-composer"');
    expect(html).toContain('button.dataset.factId');
    expect(html).toContain('request("chat.sync",payload)');
    expect(html).toContain('message?.type==="host.chat.message"');
    expect(html).toContain('message?.type==="host.chat.action"');
    expect(html).toContain("durableConversationMessages()");
    expect(html).toContain("conversationReviewFacts()");
    expect(html).toContain("function isFreshConversation()");
    expect(html).toContain('if(isFreshConversation())return "interview"');
    expect(html).toContain('prompt_version==="resume-dialogue-1"');
    expect(html).toContain('stageLabel:state.facts.some');
    expect(html).toContain("interview_turns");
    expect(html).toContain('classList.add("native-chat-hosted")');
    expect(html).toContain('message?.type==="host.chat.correction"');
    expect(html).toContain('actionId.startsWith("edit_fact_")');
    expect(html).not.toContain("conversationEvidence()");
    const chatHandler = html.slice(html.indexOf("async function handleHostChatMessage"), html.indexOf("async function startOrResumeChat"));
    expect(chatHandler).toContain("runModelDialogue");
    expect(chatHandler).not.toContain("parseEmploymentIdentity");
    expect(chatHandler).not.toContain("naturalChatIntent");
    const actions = html.slice(html.indexOf("function conversationActions"), html.indexOf("function conversationState"));
    expect(actions).not.toContain('label:"Pause"');
    expect(actions).not.toContain('label:"I’m not sure"');
    expect(actions).not.toContain('label:"Skip for now"');
  });

  it("keeps privileged browser/network authority outside the package resource", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|window\.open)\s*\(/);
    expect(html).not.toMatch(/\b(?:https?:|file:|tauri:|javascript:)/i);
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toContain("active_provider_profile");
    expect(html).not.toMatch(/inference_contract_version:1[^}]*\b(?:provider|model|endpoint|credential|api_key):/);
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
      "Job coverage summary",
      "Why this may help:",
      "Ask another way",
      "Review factual units for",
      "Non-fact choices save coverage without opening a career-fact confirmation",
      "Exact numbers are optional",
    ]) expect(html).toContain(text);
    expect(html).toContain('aria-label="Current job"');
    expect(html).toContain('aria-label="Job progress"');
    expect(html).toContain('association:"job"');
    expect(html).toContain('association:"general"');
    expect(html).toContain('fact_kind:"job_evidence"');
    expect(html).toContain('infer("interview_assist"');
    expect(html).toContain('schema_id:"resume.job-evidence-summary.v2"');
    expect(html).toContain('selection_method:"deterministic_value"');
    expect(html).toContain('if(state.jobAssistStatus==="selecting")return');
    expect(html).toContain('action:"complete_for_now"');
    expect(html).toContain('action:"reopen"');
    expect(html).toContain('if(value)panel.querySelectorAll("button").forEach(button=>{button.disabled=true})');
    const reopen = html.slice(html.indexOf("async function reopenJobDimension"), html.indexOf("async function backJobDimension"));
    expect(reopen).toContain("candidates.find(candidate=>candidate.dimension===dimension)");
    expect(reopen).toContain('state.stage="interview"');
    const persistence = html.slice(html.indexOf("async function persistJobEvidence"), html.indexOf("async function reopenJobDimension"));
    const nonFactBranch = persistence.slice(persistence.indexOf('if(outcome!=="answered")'), persistence.indexOf("const units=factualUnits"));
    expect(nonFactBranch).not.toContain('career.facts.propose');
    expect(nonFactBranch).not.toContain('career.facts.confirm');
    expect(persistence.match(/capability\("career\.facts\.confirm",\{decisions\}/g)).toHaveLength(1);
    const postNonFactReload = nonFactBranch.slice(nonFactBranch.indexOf("if(next)await saveJobPosition"));
    expect(postNonFactReload).not.toContain('state.jobAssistStatus="idle"');
    expect(postNonFactReload).not.toContain("render()");
    const postAnsweredReload = persistence.slice(
      persistence.indexOf("await submitJobProgress(job,dimension,submission)"),
      persistence.indexOf("}catch(error){fail(error)}"),
    );
    expect(postAnsweredReload).not.toContain('state.jobAssistStatus="idle"');
    expect(postAnsweredReload).not.toContain("render()");
  });

  it("shows a correctable strategy before binding general generation", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain('capability("app.inference.request",request,request.operation_id)');
    for (const text of ["Your resume plan", "Correct information", "Refresh plan", "Review resume plan", "This plan guides presentation. It is not a career fact, score, or approval."]) {
      expect(html).toContain(text);
    }
    const prepare = html.slice(html.indexOf("async function persistGeneralStrategy"), html.indexOf("async function prepareGeneralStrategy"));
    expect(prepare).toContain('inferCompletion("resume_strategy"');
    expect(prepare).toContain('kind:"resume_strategy"');
    const create = html.slice(html.indexOf("async function completeBoundGeneral"), html.indexOf("function editor"));
    expect(create).toContain('record_revision_ids:[...strategy.coverage_revision_ids,strategy.metadata.revision_id]');
    expect(create).toContain("strategy_binding:binding");
    expect(create).toContain("generation_result:draft");
    expect(create).toContain("completion.provider_profile_id!==strategy.provider_profile_id");
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

  it("persists target fit before generation and renders an honest score-free no-change route", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    for (const text of [
      "Assess fit and create a useful variant",
      "Your general resume is the honest best fit",
      "No score was calculated and no targeted resume was created",
      "Use general resume",
      "Review evidence questions",
      "Try a different target",
    ]) expect(html).toContain(text);
    expect(html).toContain('inferCompletion("tailoring_plan"');
    expect(html).toContain('kind:"target_fit_analysis"');
    expect(html).toContain('saved.analysis.outcome==="no_meaningful_change"');
    expect(html).toContain('inferCompletion("targeted_resume_draft"');
    expect(html).toContain('draft.outcome==="no_meaningful_change"');
    expect(html).toContain('kind:"target_fit_no_change"');
    expect(html).toContain("result:draft");
    expect(html.indexOf('kind:"target_fit_analysis"')).toBeLessThan(html.indexOf('inferCompletion("targeted_resume_draft"'));
    expect(html).toContain("target_fit_analysis_revision_id:saved.analysis.metadata.revision_id");
    expect(html).not.toMatch(/fit score|ATS score|score:\s*\d/i);
  });

  it("requires product-craft evidence and keeps bounded repair separate from approval", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const start = html.indexOf("async function approveDefinition");
    const approval = html.slice(start, html.indexOf("function renderJob", start));
    const repair = html.slice(html.indexOf("async function applyBoundedRepair"), start);
    expect(approval).toContain('inferCompletion("resume_craft_evaluate"');
    expect(approval).toContain('kind:"craft_quality_report"');
    expect(repair).toContain('inferCompletion("resume_craft_repair"');
    expect(repair).toContain('kind:"craft_repair"');
    expect(approval).toContain("craft_report_revision_id:report.metadata.revision_id");
    expect(approval.indexOf('kind:"craft_quality_report"')).toBeLessThan(approval.indexOf('kind:"approve_definition"'));
    expect(approval).not.toContain('kind:"craft_repair"');
    expect(repair).toContain("One bounded repair created a new proposal");
    expect(approval).not.toMatch(/craft score|quality score|score:\s*\d/i);
  });

  it("renders domain-projected quality states, blocking-first findings, and distinct owner actions", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const review = html.slice(html.indexOf("function ownerReview"), html.indexOf("function evidenceRows"));
    for (const text of [
      "Product craft review passed",
      "Product craft review incomplete",
      "Needs correction",
      "More evidence could strengthen this resume",
      "Previously approved — corrected review not run",
      "Run product craft review",
      "Apply bounded repair",
      "Add supporting evidence",
      "Revise manually",
      "Approve this reviewed version",
      "Keep prior approved version",
      "Exit Resume Builder",
    ]) expect(review).toContain(text);
    expect(review).toContain("currentQualityReview(definition)");
    expect(review).toContain("Blocking findings");
    expect(review).toContain("Secondary guidance");
    expect(review.indexOf("Blocking findings")).toBeLessThan(review.indexOf("Secondary guidance"));
    expect(review).toContain('aria-live="polite"');
    expect(review).not.toMatch(/Independent review passed|quality score|craft score|score:\s*\d/i);
  });

  it("sends the host-produced Career return v2 and never reconstructs its quality state", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const start = html.indexOf("async function approveDefinition");
    const approval = html.slice(start, html.indexOf("function renderJob", start));
    expect(approval).toContain('request("career.return",{summary:result.career_return_summary}');
    expect(approval).not.toContain("summary_version:1");
    expect(approval).not.toContain('quality_state:report.verdict');
  });

  it("presents one score-free owner review with parity recovery and semantic friction diagnostics", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("Owner review");
    expect(html).toContain("What is strong");
    expect(html).toContain("What is intentionally omitted");
    expect(html).toContain("What remains uncertain");
    expect(html).toContain('target?.outcome==="targeted_variant"');
    expect(html).toContain("The targeted changes are materially supported by the saved job evidence.");
    expect(html).toContain("parity?.allowed_side_effects");
    expect(html).toContain("approved source remains unchanged");
    expect(html).toContain("confirmation_group_count");
    expect(html).toContain("redundant_confirmation_count");
    expect(html).toContain("RB7-OQ-2");
    const review = html.slice(html.indexOf("function ownerReview"), html.indexOf("function evidenceRows"));
    expect(review).not.toMatch(/match score|ATS score|quality score/i);
  });
});
