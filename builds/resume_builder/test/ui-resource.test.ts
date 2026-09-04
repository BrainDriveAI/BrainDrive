import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

type OwnerErrorResult = {
  code: string;
  message: string;
  safeMessage: string | null;
  retryable: boolean;
  recovery: string;
  operationReference: string | null;
  summary: string | null;
  findings: string[];
  appIssueId: string | null;
  appIssueIds: string[];
  guidance: string[];
  attemptCount: number | null;
  completionMode: string | null;
  ownerState: Record<string, unknown> | null;
  recoveryContract?: unknown;
};

function parseOwnerError(html: string): (error: unknown) => OwnerErrorResult {
  const start = html.indexOf("function safeEnvelopeText");
  const end = html.indexOf("function careerReturnOperationId", start);
  if (start < 0 || end < 0) throw new Error("ownerError source boundary is unavailable");
  return new Function(`${html.slice(start, end)}\nreturn ownerError;`)() as (error: unknown) => OwnerErrorResult;
}

function parseInlineFunction<T extends (...args: never[]) => unknown>(
  html: string,
  name: string,
  nextName: string,
  dependencies: Record<string, unknown>,
): T {
  const start = html.indexOf(`async function ${name}`);
  const end = html.indexOf(`async function ${nextName}`, start + `async function ${name}`.length);
  if (start < 0 || end < 0) throw new Error(`${name} source boundary is unavailable`);
  const names = Object.keys(dependencies);
  return new Function(...names, `${html.slice(start, end)}\nreturn ${name};`)(...names.map((key) => dependencies[key])) as T;
}

function parseSyncFunction<T extends (...args: never[]) => unknown>(
  html: string,
  name: string,
  nextName: string,
  dependencies: Record<string, unknown>,
): T {
  const start = html.indexOf(`function ${name}`);
  const end = html.indexOf(`async function ${nextName}`, start);
  if (start < 0 || end < 0) throw new Error(`${name} source boundary is unavailable`);
  const names = Object.keys(dependencies);
  return new Function(...names, `${html.slice(start, end)}\nreturn ${name};`)(...names.map((key) => dependencies[key])) as T;
}

describe("sandboxed Resume Builder owner resource", () => {
  it("contains syntactically valid inline application code", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it("includes a newly persisted revision request before workspace reload", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const sourceRevisionId = "10000000-0000-4000-8000-000000000051";
    const requestRevisionId = "10000000-0000-4000-8000-000000000052";
    const source = { record_type: "resume_definition", metadata: { revision_id: sourceRevisionId } };
    const request = { record_type: "resume_revision_request", metadata: { revision_id: requestRevisionId } };
    const appOwnedInferenceInput = parseSyncFunction<(purpose: string, factIds: string[], extra: Record<string, unknown>) => { data_blocks: Array<{ category: string; data: unknown }> }>(
      html,
      "appOwnedInferenceInput",
      "inferCompletion",
      {
        state: { facts: [] },
        inferenceWorkspaceRecords: () => [source],
        appInferenceBlock: (category: string, _schemaId: string, data: unknown) => ({ category, data }),
        INFERENCE_RECORD_BLOCK: {
          resume_definition: ["general_resume_definition", "resume.definition.v1"],
          resume_revision_request: ["revision_instruction", "resume.revision-request.v1"],
        },
      },
    );

    const result = appOwnedInferenceInput("resume_revision_classify", [], {
      record_revision_ids: [sourceRevisionId, requestRevisionId],
      inference_records: [request],
    });

    expect(result.data_blocks.map((block) => block.category)).toEqual([
      "confirmed_fact_snapshot",
      "general_resume_definition",
      "revision_instruction",
    ]);
  });

  it("binds tailoring inference to the app-owned target-fit policy", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const start = html.indexOf("async function createTargeted");
    const end = html.indexOf("function renderTargeted", start);
    const source = html.slice(start, end);

    expect(html).toContain("braindrive.resume-builder.target-fit.provisional-rb7-oq3");
    expect(source).toContain('category:"target_fit_policy"');
    expect(source).toContain('schema_id:"resume.target-fit-policy.v1"');
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
    expect(html).not.toContain("active_provider_profile");
    expect(html).not.toContain("inference_contract_version:1");
    expect(html).toContain("inference_contract_version:2");
    for (const programId of [
      "resume.interview-assist", "resume.general-draft", "resume.job-description-analyze",
      "resume.requirement-evidence-match", "resume.tailoring-plan", "resume.targeted-draft",
      "resume.revision-classify", "resume.revision-draft", "resume.guidance", "resume.strategy",
      "resume.craft-evaluate", "resume.craft-repair",
    ]) expect(html).toContain(`\"${programId}\"`);
    expect(html).not.toContain("api_key");
  });

  it("reports the signed package patch version to the host", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain('appInfo:{name:"Resume Builder",version:"4.2.17"');
  });

  it("binds host fact confirmation to the exact proposed revision", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("fact_revision_id:proposed.fact.metadata.revision_id");
  });

  it("implements acknowledged exact-slot recovery without browser storage", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("RECOVERY_SETTLE_MS=1500");
    expect(html).toContain("RECOVERY_ACK_TIMEOUT_MS=500");
    expect(html).toContain("RECOVERY_POLL_ELAPSED_MS=[625,750,1000,1500,2500,4500,8500]");
    expect(html).toContain("RECOVERY_MAX_POLL_MS=5000");
    expect(html).toContain("RECOVERY_FINAL_READ_MS=120000");
    expect(html).toContain('kind:"interview_recovery_save"');
    expect(html).toContain('kind:"interview_recovery_discard"');
    expect(html).toContain('kind:"interview_progress_submit"');
    expect(html).toContain("request_operation_id");
    expect(html).toContain('queried_operation_id:binding.operationId,reconciliation:"resume_recovery_v1"');
    expect(html).toContain("verifyRestoredRecoveryOperation");
    expect(html).toContain("reloadDurableWorkspace");
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain("Still saving…");
    expect(html).toContain("Saved at");
    expect(html).toContain("Not saved. Your typed value is still here");
    expect(html).toContain("Use my unsaved value");
    expect(html).toContain("Use the saved value");
    expect(html).toContain("could not verify that the saved draft belongs to this exact save");
    expect(html).not.toContain("This draft changed elsewhere");
    expect(html).toContain("Discard draft");
    expect(html).toContain("focus({preventScroll:true})");
    expect(html).toContain('message.method==="ui/resource-teardown"');
    expect(html).toContain("cancelRecoveryTimer()");
    expect(html).toContain("cancelRecoveryPolls()");
    expect(html).toContain("state.resourceGeneration+=1");
    expect(html).toContain("generation!==state.resourceGeneration");
    expect(html).toContain("guard.superseded=true");
    expect(html).toContain("trimRecoveryIdentities");
    expect(html).not.toContain("trimRecoveryIdentities(state.recoveryGuards)");
    expect(html).toContain('generation:${binding.editGeneration}');
    expect(html).not.toContain('guard.editGeneration!==state.recovery.editGeneration');
    expect(html).toContain("if(!guard.executed){guard.superseded=true");
    expect(html).toContain('state.recovery.status="saving";state.recovery.serverDraft=null');
    expect(html).not.toContain('ackValueDigest===state.recovery.valueDigest?"saved"');
    for (const intent of ["submit", "save_answer", "complete_for_now", "pause", "back"]) {
      expect(html).toContain(`"${intent}`);
    }
    expect(html).toContain("`stage:${button.dataset.stage}`");
    expect(html).toContain("persistAnswerAfterRecovery");
    expect(html).toContain("persistJobEvidenceAfterRecovery");
    expect(html).toContain("preserveRecoveryOnce");
    expect(html).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/);
  });

  it("does not let workspace-only equality authorize Saved and never turns denied reads into long pending", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const state = { resourceGeneration: 1, recovery: { status: "reconciling", operationId: "op" } };
    const binding = { operationId: "op" };
    const update = vi.fn();
    const conflict = vi.fn(async () => ({ state: "conflict" }));
    const base = {
      state,
      nextRecoveryPollElapsed: vi.fn(() => 120_000),
      waitRecovery: vi.fn(async () => true),
      currentRecoveryMatches: vi.fn(() => true),
      updateRecoveryStatus: update,
      recoveryErrorCode: (error: { error?: string }) => String(error?.error ?? ""),
      projectionResult: vi.fn(() => null),
      applyRecoverySaved: vi.fn(),
      markRecoveryConflict: conflict,
      RECOVERY_FINAL_READ_MS: 120_000,
      recoveryWorkspaceReadback: vi.fn(async () => ({ state: "matching_commit", record: { exact: true } })),
      focusRecoveryChoice: vi.fn(),
    };
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(119_999).mockReturnValueOnce(120_000);
    const reconcile = parseInlineFunction<(binding: unknown, startedAt: number, generation: number) => Promise<{ state: string }>>(
      html,
      "reconcileRecovery",
      "executeRecoveryAttempt",
      { ...base, capability: vi.fn(async () => ({ recovery_reconciliation: { host_operation_settled: true, operation: { state: "failed" } } })) },
    );
    await expect(reconcile(binding, 0, 1)).resolves.toEqual({ state: "conflict" });
    expect(conflict).toHaveBeenCalledWith(binding, 1);
    now.mockRestore();

    const deniedCapability = vi.fn(async () => { throw { error: "denied" }; });
    const denied = parseInlineFunction<(binding: unknown, startedAt: number, generation: number) => Promise<unknown>>(
      html,
      "reconcileRecovery",
      "executeRecoveryAttempt",
      { ...base, nextRecoveryPollElapsed: vi.fn(() => 625), capability: deniedCapability },
    );
    await expect(denied(binding, Date.now(), 1)).rejects.toEqual({ error: "denied" });
    expect(deniedCapability).toHaveBeenCalledTimes(1);
  });

  it("keeps one scoped not-found pending, then accepts the later exact committed projection", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const state = { resourceGeneration: 1, recovery: { status: "reconciling" } };
    const committed = { progress: {}, acknowledgement: {} };
    let read = 0;
    const capability = vi.fn(async () => {
      read += 1;
      if (read === 1) throw { error: "not_found_within_scope" };
      return { recovery_reconciliation: { host_operation_settled: true, operation: { state: "committed" } } };
    });
    let poll = 0;
    const reconcile = parseInlineFunction<(binding: unknown, startedAt: number, generation: number) => Promise<{ state: string }>>(
      html,
      "reconcileRecovery",
      "executeRecoveryAttempt",
      {
        state,
        nextRecoveryPollElapsed: vi.fn(() => [625, 750][poll++] ?? null),
        waitRecovery: vi.fn(async () => true),
        currentRecoveryMatches: vi.fn(() => true),
        updateRecoveryStatus: vi.fn(),
        capability,
        recoveryErrorCode: (error: { error?: string }) => String(error?.error ?? ""),
        projectionResult: vi.fn((query: unknown) => read === 2 ? committed : null),
        applyRecoverySaved: vi.fn(() => true),
        markRecoveryConflict: vi.fn(),
        RECOVERY_FINAL_READ_MS: 120_000,
        recoveryWorkspaceReadback: vi.fn(),
        focusRecoveryChoice: vi.fn(),
      },
    );
    await expect(reconcile({ operationId: "op" }, Date.now(), 1)).resolves.toEqual({ state: "saved" });
    expect(capability).toHaveBeenCalledTimes(2);
  });

  it("surfaces typed write/read failures without long-polling, rejecting, or releasing a guard", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const binding = { operationId: "op", editGeneration: 1 };
    const makeDependencies = (capability: ReturnType<typeof vi.fn>) => {
      const state = { resourceGeneration: 1, recovery: { status: "saving", operationId: "op" }, error: null as unknown };
      const updateRecoveryStatus = vi.fn();
      const focusRecoveryChoice = vi.fn();
      const surfaceRecoveryVerificationError = vi.fn((error: unknown) => {
        state.recovery.status = "verification_failed";
        state.recovery.operationId = null;
        state.error = error;
        return { state: "cancelled" };
      });
      return {
        state,
        capability,
        RECOVERY_ACK_TIMEOUT_MS: 500,
        applyRecoverySaved: vi.fn(),
        markRecoveryConflict: vi.fn(),
        currentRecoveryMatches: vi.fn(() => true),
        ambiguousRecoveryError: (error: { ambiguous?: boolean; error?: string }) => Boolean(error?.ambiguous) || error?.error === "deadline_exceeded",
        recoveryErrorCode: (error: { error?: string }) => String(error?.error ?? ""),
        ownerError: vi.fn((error: unknown) => error),
        updateRecoveryStatus,
        focusRecoveryChoice,
        reconcileRecovery: vi.fn(),
        surfaceRecoveryVerificationError,
      };
    };

    const deniedWrite = makeDependencies(vi.fn(async () => { throw { error: "denied" }; }));
    const executeDenied = parseInlineFunction<(binding: unknown, input: unknown, generation: number) => Promise<{ state: string }>>(
      html,
      "executeRecoveryAttempt",
      "flushRecovery",
      deniedWrite,
    );
    await expect(executeDenied(binding, {}, 1)).resolves.toEqual({ state: "not_saved" });
    expect(deniedWrite.capability).toHaveBeenCalledTimes(1);
    expect(deniedWrite.state.recovery.status).toBe("not_saved");
    expect(deniedWrite.reconcileRecovery).not.toHaveBeenCalled();

    const deniedRead = makeDependencies(vi.fn(async () => { throw { error: "deadline_exceeded", ambiguous: true }; }));
    deniedRead.reconcileRecovery.mockRejectedValueOnce({ error: "denied" });
    const executeAmbiguous = parseInlineFunction<(binding: unknown, input: unknown, generation: number) => Promise<{ state: string }>>(
      html,
      "executeRecoveryAttempt",
      "flushRecovery",
      deniedRead,
    );
    await expect(executeAmbiguous(binding, {}, 1)).resolves.toEqual({ state: "cancelled" });
    expect(deniedRead.reconcileRecovery).toHaveBeenCalledTimes(1);
    expect(deniedRead.surfaceRecoveryVerificationError).toHaveBeenCalledWith({ error: "denied" }, binding, 1);
    expect(deniedRead.state.recovery.status).toBe("verification_failed");
  });

  it("orders rapid multi-field activations before creating an immediate guarded submit", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain('field.addEventListener("input",()=>void enqueueRecoveryFieldActivation(slot,field.value))');
    expect(html).toContain("recoveryFieldQueue:Promise.resolve()");
    expect(html).toContain("state.recoveryFieldQueue=Promise.resolve()");
    const state = { resourceGeneration: 4, recoveryFieldQueue: Promise.resolve() };
    let releaseFirst!: () => void;
    const firstActivation = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let latestActivation: [unknown, string] | null = null;
    const activateRecoveryField = vi.fn()
      .mockImplementationOnce(async (slot: unknown, value: string) => {
        await firstActivation;
        latestActivation = [slot, value];
      })
      .mockImplementationOnce(async (slot: unknown, value: string) => {
        latestActivation = [slot, value];
      });
    const surfaceRecoveryVerificationError = vi.fn();
    const enqueue = parseInlineFunction<(slot: unknown, value: string) => Promise<boolean>>(
      html,
      "enqueueRecoveryFieldActivation",
      "guardedRecoveryTransition",
      { state, activateRecoveryField, surfaceRecoveryVerificationError },
    );
    const latestAtGuardCreation: Array<[unknown, string] | null> = [];
    const afterFields = vi.fn(async () => {
      latestAtGuardCreation.push(latestActivation);
      return true;
    });
    const guarded = parseInlineFunction<(intent: string, label: string, transition: () => void) => Promise<boolean>>(
      html,
      "guardedRecoveryTransition",
      "guardedRecoveryTransitionAfterFields",
      { state, guardedRecoveryTransitionAfterFields: afterFields },
    );

    const titleSlot = { field_id: "job-title" };
    const employerSlot = { field_id: "employer" };
    const title = enqueue(titleSlot, "Support Lead");
    const employer = enqueue(employerSlot, "Northwind");
    const transition = vi.fn();
    const submit = guarded("submit", "saving this job", transition);
    await Promise.resolve();
    expect(activateRecoveryField).toHaveBeenCalledTimes(1);
    expect(afterFields).not.toHaveBeenCalled();

    releaseFirst();
    await expect(Promise.all([title, employer, submit])).resolves.toEqual([true, true, true]);
    expect(activateRecoveryField.mock.calls).toEqual([
      [titleSlot, "Support Lead"],
      [employerSlot, "Northwind"],
    ]);
    expect(afterFields).toHaveBeenCalledTimes(1);
    expect(afterFields).toHaveBeenCalledWith("submit", "saving this job", transition);
    expect(latestAtGuardCreation).toEqual([[employerSlot, "Northwind"]]);
  });

  it("renders conflict values and deterministic terminal-choice focus without a destructive default", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain('aria-label="Draft conflict values"');
    expect(html).toContain("Your typed value");
    expect(html).toContain("Saved value");
    expect(html).toContain("focusRecoveryChoice()");
    expect(html).toContain('tabindex="-1"');
    const conflict = html.slice(html.indexOf('recovery.status==="conflict"?`<div class="row"'));
    expect(conflict.indexOf('id="recovery-local"')).toBeLessThan(conflict.indexOf('id="recovery-discard"'));
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
    expect(create).toContain("section_order:strategy.section_order");
    expect(create).toContain("evidence_priorities:strategy.evidence_priorities");
    expect(create).toContain("summary_decision:strategy.summary_decision");
    expect(create).toContain("omissions:strategy.omissions");
    expect(create).toContain("appGeneralPersistenceInputDigest(strategy,preferences,additionalFacts)");
    expect(create).toContain("persistence_input_digest:persistenceInputDigest");
    expect(create).toContain("completion.result.persistence_input_digest");
    expect(create).toContain("completion.result.persistence_output_digest");
    expect(create).toContain("appResult=completion.result,draft=appResult.draft");
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
    expect(html).toContain("completeBoundGeneral(strategy,[changedFact])");
    expect(html).toContain("appGeneralPersistenceBlocks(strategy,preferences,additionalFacts=[])");
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

  it("executes the complete Spec 09 legacy error-to-action mapping without diagnostics", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const ownerError = parseOwnerError(html);
    const expected = {
      invalid_request: "none",
      denied: "open_model_settings",
      model_incompatible: "open_model_settings",
      provider_unavailable: "retry",
      quota_exceeded: "review_provider_account",
      rate_limited: "retry",
      deadline_exceeded: "retry",
      cancelled: "retry",
      schema_validation_failed: "retry",
      validation_failed: "none",
      recoverable_internal_failure: "retry",
      malformed_structured_output: "retry",
      incomplete_output: "retry",
      evidence_validation_failed: "none",
      provider_schema_unsupported: "open_model_settings",
      provider_authentication_failed: "open_model_settings",
      provider_authorization_failed: "open_model_settings",
      content_filtered: "none",
      provider_refused: "none",
      unexpected_tool_call: "open_model_settings",
      internal_failure: "retry",
    } as const;
    for (const [code, recovery] of Object.entries(expected)) {
      const projected = ownerError({ error: { code } });
      expect(projected).toMatchObject({ code, recovery, operationReference: null, summary: null, findings: [] });
      expect(projected.message).toContain("Your saved work and last approved resume are unchanged.");
    }
    expect(ownerError({ error: { code: "protocol_incompatible" } }).recovery).toBe("open_model_settings");
    expect(ownerError({ code: "validation_failed", app_issue_id: "resume.general-draft/persistence-canonicalization-failed" })).toMatchObject({
      appIssueId: "resume.general-draft/persistence-canonicalization-failed",
    });
    expect(ownerError({ code: "validation_failed", app_issue_id: "owner@example.test" }).appIssueId).toBeNull();
  });

  it("consumes the generic safe terminal envelope and maps Resume issue IDs to app-owned guidance", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const ownerError = parseOwnerError(html);
    const operationId = "10000000-0000-4000-8000-000000000041";
    const projected = ownerError({
      error: {
        code: "candidate_invalid",
        safe_message: "The app could not accept the structured result.",
        retryable: false,
        operation_id: operationId,
        correlation_id: "10000000-0000-4000-8000-000000000042",
        attempt_count: 2,
        completion_mode: "safe_failure",
        app_issue_ids: [
          "resume.craft-evaluate/schema-criterion-set-mismatch",
          "resume.job-analyze/schema-source-span-invalid",
          "resume.targeted-draft/statement-evidence-binding-invalid",
          "resume.craft-evaluate/schema-criterion-set-mismatch",
          "owner@example.test",
          "brief.generate/schema-result-invalid",
        ],
      },
      owner_state: {
        state_version: 1,
        state: "review_needed",
        safe_message: "Review is required before continuing.",
        retryable: false,
        refresh_required: false,
        current_revision: null,
        proposal_preserved: true,
      },
    });

    expect(projected).toMatchObject({
      code: "candidate_invalid",
      safeMessage: "The app could not accept the structured result.",
      retryable: false,
      recovery: "none",
      operationReference: operationId,
      appIssueId: "resume.craft-evaluate/schema-criterion-set-mismatch",
      appIssueIds: [
        "resume.craft-evaluate/schema-criterion-set-mismatch",
        "resume.job-analyze/schema-source-span-invalid",
        "resume.targeted-draft/statement-evidence-binding-invalid",
      ],
      attemptCount: 2,
      completionMode: "safe_failure",
      ownerState: { state_version: 1, state: "review_needed", proposal_preserved: true },
    });
    expect(projected.message).toContain("The app could not accept the structured result.");
    expect(projected.message).toContain("Your saved work and last approved resume are unchanged.");
    expect(projected.summary).toContain("2 attempt(s)");
    expect(projected.summary).toContain("safe failure");
    expect(projected.guidance).toEqual([
      "The craft review could not verify one quality criterion. Retry review or revise the proposal; approval remains unavailable.",
      "A job requirement did not match an exact span in the saved job description.",
      "This edit includes details that are not present in your confirmed evidence.",
      "Remove the unsupported details or return to the interview to add evidence.",
    ]);
    expect(JSON.stringify(projected)).not.toContain("owner@example.test");
    expect(JSON.stringify(projected)).not.toContain("brief.generate");
  });

  it("maps unsupported resume edits to safe corrective guidance without echoing hidden content", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const ownerError = parseOwnerError(html);
    const hiddenProviderText = "<PRIVATE_PROVIDER_RESUME_TEXT>";
    const projected = ownerError({
      code: "validation_failed",
      safe_message: hiddenProviderText,
      operation_id: "10000000-0000-4000-8000-000000000046",
      app_issue_ids: [
        "resume.general-draft/statement-factual-wording-unsupported",
        "resume.general-draft/statement-protected-value-unsupported",
      ],
      validation: { finding_codes: ["unsupported_claim"] },
    });

    expect(projected.guidance).toEqual([
      "This edit includes details that are not present in your confirmed evidence.",
      "Remove the unsupported details or return to the interview to add evidence.",
    ]);
    expect(projected.findings).toEqual([
      "This edit includes details that are not present in your confirmed evidence. Remove the unsupported details or return to the interview to add evidence.",
    ]);
    expect(JSON.stringify(projected)).not.toContain(hiddenProviderText);
  });

  it("distinguishes structural, provider interruption, revision conflict, and craft-quality guidance", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const ownerError = parseOwnerError(html);
    expect(ownerError({ code: "validation_failed", app_issue_ids: ["resume.general-draft/schema-slot-texts-invalid"] }).guidance)
      .toEqual(["The resume result did not match the required structure. Retry the action; your saved evidence is unchanged."]);
    expect(ownerError({ code: "deadline_exceeded" })).toMatchObject({
      recovery: "retry",
      message: expect.stringContaining("timed out before validation finished"),
    });
    expect(ownerError({ code: "cancelled" })).toMatchObject({
      recovery: "retry",
      message: expect.stringContaining("was cancelled before validation finished"),
    });
    expect(ownerError({ code: "conflict" })).toMatchObject({
      recovery: "none",
      message: expect.stringContaining("saved version changed elsewhere"),
    });
    expect(ownerError({ code: "validation_failed", app_issue_ids: ["resume.craft-evaluate/criterion-evidence-coherence-invalid"] }).guidance)
      .toEqual(["The craft review could not verify one quality criterion. Retry review or revise the proposal; approval remains unavailable."]);
  });

  it("renders corrective guidance before the secondary support reference", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const render = html.slice(html.indexOf("function render()"), html.indexOf("function stageAvailable"));
    expect(render.indexOf("What Resume Builder checked:")).toBeGreaterThan(-1);
    expect(render.indexOf('label.textContent="Support reference"')).toBeGreaterThan(render.indexOf("What Resume Builder checked:"));
  });

  it("uses a safe correlation reference and rejects malformed generic-envelope fields without weakening legacy handling", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const ownerError = parseOwnerError(html);
    const correlationId = "10000000-0000-4000-8000-000000000043";
    const projected = ownerError({
      code: "validation_failed",
      safe_message: "owner@example.test /private/resume.txt",
      retryable: "yes",
      correlation_id: correlationId,
      attempt_count: 99,
      completion_mode: "raw_provider_body",
      app_issue_ids: ["not-a-safe-id"],
      app_issue_id: "resume.general-draft/persistence-canonicalization-failed",
      owner_state: { state_version: 1, state: "owner@example.test", proposal_preserved: true },
    });

    expect(projected).toMatchObject({
      code: "validation_failed",
      safeMessage: null,
      retryable: false,
      recovery: "none",
      operationReference: correlationId,
      appIssueId: "resume.general-draft/persistence-canonicalization-failed",
      appIssueIds: ["resume.general-draft/persistence-canonicalization-failed"],
      attemptCount: null,
      completionMode: null,
      ownerState: null,
    });
    expect(projected.message).not.toContain("owner@example.test");
    expect(projected.message).not.toContain("/private/resume.txt");
    expect(projected.guidance).toEqual([
      "Resume Builder could not verify the exact saved input used for this result.",
    ]);
  });

  it("renders every validated issue reference and only app-authored recovery guidance", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("state.error.appIssueIds");
    expect(html).toContain("state.error.guidance");
    expect(html).toContain("What Resume Builder checked:");
    expect(html).toContain('issue.textContent=appIssueId');
    expect(html).not.toContain('issue.textContent=state.error.safeMessage');
  });

  it("preserves the safe terminal envelope when an inference operation fails", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const operationId = "10000000-0000-4000-8000-000000000044";
    const correlationId = "10000000-0000-4000-8000-000000000045";
    const issueIds = ["resume.craft-evaluate/schema-criterion-verdicts-invalid"];
    const ownerState = {
      state_version: 1,
      state: "review_needed",
      safe_message: "Review is required before continuing.",
      retryable: false,
      refresh_required: false,
      current_revision: null,
      proposal_preserved: true,
    };
    const capability = vi.fn(async () => ({
      status: "failed",
      operation_id: operationId,
      correlation_id: correlationId,
      attempt_count: 2,
      completion_mode: "safe_failure",
      app_issue_ids: issueIds,
      owner_state: ownerState,
      error: { code: "candidate_invalid", safe_message: "The app could not accept the structured result.", retryable: false },
    }));
    const inferCompletion = parseInlineFunction<(purpose: string, extra?: Record<string, unknown>) => Promise<unknown>>(
      html,
      "inferCompletion",
      "infer",
      {
        state: { facts: [], inferenceNotice: null, busy: true },
        uuid: vi.fn(() => operationId),
        capability,
        appOwnedInferenceInput: vi.fn(() => ({ prompt_policy_id: "resume.synthetic", prompt_policy_version: "1" })),
        INFERENCE_PROGRAMS: { resume_craft_evaluate: { id: "resume.craft-evaluate", version: 1 } },
        ownerError: vi.fn(() => ({ recovery: "none" })),
        inferenceRetryDecision: vi.fn(),
        render: vi.fn(),
        RECOVERED_GENERAL_NOTICE: "recovered",
      },
    );

    await expect(inferCompletion("resume_craft_evaluate")).rejects.toMatchObject({
      code: "candidate_invalid",
      safe_message: "The app could not accept the structured result.",
      retryable: false,
      operation_id: operationId,
      correlation_id: correlationId,
      attempt_count: 2,
      completion_mode: "safe_failure",
      app_issue_ids: issueIds,
      owner_state: ownerState,
    });
    expect(capability).toHaveBeenCalledTimes(1);
  });

  it("renders exactly three safe evidence-failure choices with truthful Retry disclosure", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const evidenceActions = html.slice(html.indexOf('state.error.recovery==="evidence_failure"'), html.indexOf('if(state.error.recovery==="continue"'));
    expect(evidenceActions).toContain('addAction("Try again"');
    expect(evidenceActions).toContain('addAction("Review confirmed evidence"');
    expect(evidenceActions).toContain('addAction("Not now"');
    expect(evidenceActions.match(/addAction\(/g)).toHaveLength(3);
    expect(evidenceActions).toContain("Try again uses your currently selected provider and may consume credits.");
    expect(evidenceActions).not.toMatch(/price|credential|api key|settings/i);
    expect(evidenceActions).toContain('aria-live","polite"');
    expect(evidenceActions).toContain('repeated_equivalent_failure');
    expect(html).toContain('review_confirmed_evidence:Review confirmed evidence');
    expect(html).toContain('try_again:Try again');
    expect(html).toContain('state.stage="fact_review"');
    expect(html).toContain("focusPanel()");

    const ownerError = parseOwnerError(html);
    const contract = {
      recovery_contract_version: 1,
      kind: "evidence_failure",
      actions: [
        { id: "try_again", label: "Try again" },
        { id: "review_confirmed_evidence", label: "Review confirmed evidence" },
        { id: "not_now", label: "Not now" },
      ],
      retry_disclosure: "Try again uses your currently selected provider and may consume credits.",
      semantic_input_digest: `sha256:${"a".repeat(64)}`,
      strategy_revision_id: "10000000-0000-4000-8000-000000000010",
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
      repeated_equivalent_failure: false,
      emphasized_action: "try_again",
    };
    expect(ownerError({ code: "evidence_validation_failed", recovery_contract: contract })).toMatchObject({
      recovery: "evidence_failure",
      recoveryContract: contract,
    });
    for (const malformed of [
      { ...contract, actions: [...contract.actions].reverse() },
      { ...contract, retry_disclosure: "Free retry" },
      { ...contract, semantic_input_digest: "owner content" },
      { ...contract, emphasized_action: "review_confirmed_evidence" },
    ]) expect(ownerError({ code: "evidence_validation_failed", recovery_contract: malformed }).recovery).toBe("none");
  });

  it("keeps app-owned Retry explicit, fresh, duplicate-suppressed, and on the same v2 program input", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const inference = html.slice(html.indexOf("function inferenceRetryDecision"), html.indexOf("function normalizeDraftStatements"));
    expect(inference).toContain("inference_contract_version:2");
    expect(inference).toContain("program:INFERENCE_PROGRAMS[purpose]");
    expect(inference).toContain("input:programInput");
    expect(inference).not.toContain("retry_lineage");
    expect(inference).not.toContain("semantic_binding");
    expect(inference).toContain("if(!pending||pending.resolved)return");
    expect(inference).toContain("pending.resolved=true");
    expect(inference).toContain("operationId=uuid()");
    expect(inference).toContain('if(choice!=="retry")throw {handled:true}');
  });

  it("makes Review and Not now zero-operation choices and suppresses duplicate Retry clicks", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const protectedState = { facts: [{ revision: 1 }], strategy: { revision: 1 }, proposals: [{ revision: 1 }], approval: { revision: 1 }, provider: "owner-profile" };
    const make = () => {
      const resolve = vi.fn();
      const state = {
        stage: "general_review",
        inferenceRetry: { resolve, resolved: false },
        error: { code: "evidence_validation_failed" },
        protectedState: structuredClone(protectedState),
      };
      const render = vi.fn();
      const focusPanel = vi.fn();
      const choose = parseSyncFunction<(choice: string) => void>(html, "resolveInferenceRetry", "inferCompletion", { state, render, focusPanel });
      return { state, resolve, render, focusPanel, choose };
    };
    const retry = make();
    retry.choose("retry");
    retry.choose("retry");
    expect(retry.resolve).toHaveBeenCalledTimes(1);
    expect(retry.resolve).toHaveBeenCalledWith("retry");
    expect(retry.state.protectedState).toEqual(protectedState);

    const review = make();
    review.choose("review");
    expect(review.resolve).toHaveBeenCalledTimes(1);
    expect(review.state.stage).toBe("fact_review");
    expect(review.state.protectedState).toEqual(protectedState);
    expect(review.focusPanel).toHaveBeenCalledTimes(1);

    const notNow = make();
    notNow.choose("not_now");
    expect(notNow.resolve).toHaveBeenCalledTimes(1);
    expect(notNow.state.stage).toBe("general_review");
    expect(notNow.state.protectedState).toEqual(protectedState);
  });

  it("starts no fresh operation before explicit Retry, then uses one UUID and unchanged semantic bindings", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const firstOperationId = "10000000-0000-4000-8000-000000000020";
    const secondOperationId = "10000000-0000-4000-8000-000000000021";
    const strategyRevisionId = "10000000-0000-4000-8000-000000000010";
    const contract = {
      recovery_contract_version: 1,
      kind: "evidence_failure",
      actions: [
        { id: "try_again", label: "Try again" },
        { id: "review_confirmed_evidence", label: "Review confirmed evidence" },
        { id: "not_now", label: "Not now" },
      ],
      retry_disclosure: "Try again uses your currently selected provider and may consume credits.",
      semantic_input_digest: `sha256:${"a".repeat(64)}`,
      strategy_revision_id: strategyRevisionId,
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
      repeated_equivalent_failure: false,
      emphasized_action: "try_again",
    };
    const capability = vi.fn()
      .mockResolvedValueOnce({
        status: "failed",
        operation_id: firstOperationId,
        purpose: "general_resume_draft",
        attempt_count: 2,
        error: { code: "evidence_validation_failed", recovery_contract: contract },
        diagnostic: { operation_id: firstOperationId },
        validation: { finding_codes: ["unsupported_claim"] },
      })
      .mockResolvedValueOnce({
        status: "completed",
        operation_id: secondOperationId,
        purpose: "general_resume_draft",
        attempt_count: 2,
        provider_profile_id: "owner-profile",
        model_id: "owner-model",
        result: { title: "Synthetic" },
        recovery_notice: null,
      });
    let choose: ((choice: string) => void) | null = null;
    const inferenceRetryDecision = vi.fn(() => new Promise<string>((resolve) => { choose = resolve; }));
    const state = { facts: [], inferenceNotice: null, busy: true };
    const inferCompletion = parseInlineFunction<(purpose: string, extra: Record<string, unknown>) => Promise<unknown>>(
      html,
      "inferCompletion",
      "infer",
      {
        state,
        uuid: vi.fn(() => secondOperationId),
        capability,
        appOwnedInferenceInput: vi.fn(),
        INFERENCE_PROGRAMS: { general_resume_draft: { id: "resume.general-draft", version: 1 } },
        ownerError: (error: { recovery_contract?: unknown }) => ({ recovery: "evidence_failure", recoveryContract: error.recovery_contract }),
        inferenceRetryDecision,
        render: vi.fn(),
        RECOVERED_GENERAL_NOTICE: "recovered",
      },
    );
    const extra = {
      operation_id: firstOperationId,
      fact_revision_ids: ["10000000-0000-4000-8000-000000000030"],
      record_revision_ids: [strategyRevisionId],
      presentation_preferences: { locale: "en-US" },
      semantic_binding: {
        semantic_binding_version: 1,
        strategy_revision_id: strategyRevisionId,
        provider_profile_id: "owner-profile",
        model_id: "owner-model",
      },
      app_program: {
        facts: [], strategy: { fact_revision_ids: [] }, persistence_input_digest: `sha256:${"b".repeat(64)}`,
        prompt_policy_id: "braindrive.resume-builder.fixed", prompt_policy_version: "12",
      },
    };
    const pending = inferCompletion("general_resume_draft", extra);
    await vi.waitFor(() => expect(inferenceRetryDecision).toHaveBeenCalledTimes(1));
    expect(capability).toHaveBeenCalledTimes(1);
    choose?.("retry");
    await expect(pending).resolves.toMatchObject({ status: "completed", operation_id: secondOperationId });
    expect(capability).toHaveBeenCalledTimes(2);
    const firstRequest = capability.mock.calls[0]![1];
    const retryRequest = capability.mock.calls[1]![1];
    expect(retryRequest.operation_id).toBe(secondOperationId);
    expect(retryRequest.operation_id).not.toBe(firstRequest.operation_id);
    expect(retryRequest).toMatchObject({ inference_contract_version: 2, program: firstRequest.program, input: firstRequest.input });
    expect(retryRequest).not.toHaveProperty("retry_lineage");
  });

  it("fails closed for malformed or unknown legacy error payloads", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const ownerError = parseOwnerError(html);
    for (const payload of [null, {}, { error: null }, "malformed", { code: "future_unknown", recovery: "retry" }]) {
      const projected = ownerError(payload);
      expect(projected.recovery).toBe("none");
      expect(projected.operationReference).toBeNull();
      expect(projected.summary).toBeNull();
      expect(projected.findings).toEqual([]);
      expect(projected.message).toContain("Your saved work and last approved resume are unchanged.");
    }
  });

  it("renders accessible Spec 09 actions and safe support references", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain('setAttribute("aria-label","Recovery actions")');
    expect(html).toContain("Copy support reference");
    expect(html).toContain('action:"copy_to_clipboard",value:state.error.operationReference');
    expect(html).toContain("Copy unavailable. Select the support reference and copy it manually.");
    expect(html).toContain('className="operation-reference"');
    expect(html).toContain('tabindex="-1" hidden');
  });

  it("retries the same semantic inference input with a fresh logical operation", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    const inference = html.slice(html.indexOf("function inferenceRetryDecision"), html.indexOf("function generalPreferences"));
    expect(inference).toContain("semanticRequest=");
    expect(inference).toContain("operationId=uuid()");
    expect(inference).toContain('["retry","evidence_failure"].includes(recovery.recovery)');
    expect(html).toContain('resolveInferenceRetry("retry")');
    expect(html).toContain('resolveInferenceRetry("not_now")');
    expect(inference).toContain("inference_contract_version:2");
    expect(inference).toContain("input:programInput");
    expect(html).toContain('resolveInferenceRetry("not_now");for(const pending of state.pending.values())');
  });

  it("shows only the exact General Resume deterministic recovery note", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("BrainDrive recovered a basic fact-backed draft. Review it before approval.");
    expect(html).toContain('id="inference-notice"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('purpose==="general_resume_draft"&&result.completion_mode==="deterministic_fallback"');
    expect(html).toContain('general_resume_draft:{id:"resume.general-draft",version:1}');
  });
});
