import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "./test-helpers.js";
import { assertRevisionTransition } from "./revision-requests.js";
import { RESUME_QUALITY_POLICY_IDENTITY, RESUME_QUALITY_STANDARD_DIGEST, RESUME_QUALITY_STANDARD_ID, RESUME_QUALITY_STANDARD_VERSION } from "../resume-inference/strategy.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "../resume-inference/policy.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-service-")); roots.push(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  await store.initialize(testGrant().owner_id);
  return { store, service: new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z")) };
}

async function confirmedFact(service: ResumeDomainService) {
  const proposed = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
  const confirmationAuthority = authority("career.facts.confirm");
  return service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
}

function recoverySaveInput(value: string, overrides: Record<string, unknown> = {}) {
  const sessionId = "11000000-0000-4000-8000-000000000001";
  return {
    expected_revision: null,
    session_id: sessionId,
    current_topic: "contact",
    completed_topics: [],
    skipped_topics: [],
    slot: {
      session_id: sessionId,
      job_fact_revision_id: null,
      question_id: "contact-question",
      field_id: "answer",
    },
    value,
    value_digest: canonicalInputDigest(value),
    ...overrides,
  };
}

function submittedTurn(sessionId: string, answer: string) {
  return {
    transcript_version: 1 as const,
    turn_id: crypto.randomUUID(),
    session_id: sessionId,
    prompt_version: "resume-interview-4.0.0",
    topic: "contact",
    question: "Which contact details should appear on this resume?",
    answer,
    follow_up: null,
    action: "answered" as const,
    occurred_at: "2026-08-07T12:00:00.000Z",
  };
}

describe("Resume domain invariants", () => {
  it("persists an exact strategy binding and blocks approval after the confirmed snapshot changes", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    const factId = confirmed.fact.metadata.revision_id;
    const facts = [{ revision_id: factId, fact_kind: confirmed.fact.fact_kind, value: confirmed.fact.value, source_revision_ids: confirmed.fact.source_revision_ids }];
    const block = (category: "confirmed_fact_snapshot" | "evidence_annotations" | "quality_policy" | "resume_strategy", schema_id: string, data: unknown) => ({ category, content_digest: canonicalInputDigest(data), schema_id, schema_version: 1, data });
    const strategyResult = {
      strategy_version: 1 as const,
      history_shape: "early_career" as const,
      history_reason_code: "thin_history" as const,
      role_emphasis: [],
      section_order: ["experience"],
      evidence_priorities: [{ fact_revision_id: factId, priority: "must_use" as const }],
      summary_decision: "omit" as const,
      summary_reason_code: "insufficient_distinct_value" as const,
      skills_context: [], omissions: [], unresolved_gap_ids: [],
      owner_rationale: "Use the one distinct confirmed accomplishment without padding.",
    };
    const strategyInputDigest = canonicalInputDigest({
      app_program: "resume.strategy",
      authorized_fact_revision_ids: [factId],
    });
    const persisted = await service.writeResumeStrategy({
      kind: "resume_strategy", fact_revision_ids: [factId], coverage_revision_ids: [], target_revision_id: null, presentation_preferences: {}, strategy: strategyResult,
      inference_binding: { prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, input_digest: strategyInputDigest, output_digest: canonicalInputDigest(strategyResult), provider_profile_id: "owner-active", model_id: "synthetic-model" },
    }, authority("resume.definitions.write"));
    expect(persisted.strategy).toMatchObject({ record_type: "resume_strategy", fact_revision_ids: [factId], quality_standard_version: "3", provider_profile_id: "owner-active" });
    expect(persisted.strategy).toMatchObject({ input_digest: strategyInputDigest });

    const strategy = persisted.strategy;
    if (strategy.record_type !== "resume_strategy") throw new Error("strategy fixture failed");
    const generationResult = { title: "General Resume", statements: [{ statement_id: crypto.randomUUID(), section_id: "experience", kind: "factual" as const, text: confirmed.fact.value, supporting_confirmed_fact_revision_ids: [factId] }], section_order: ["experience"], omissions: [] };
    const generationInputDigest = canonicalInputDigest([
      block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }),
      block("resume_strategy", "resume.strategy-record.v1", strategy),
      block("quality_policy", "resume.quality-policy-identity.v1", RESUME_QUALITY_POLICY_IDENTITY),
    ]);
    const binding = {
      binding_version: 1 as const, strategy_revision_id: strategy.metadata.revision_id, fact_snapshot_digest: strategy.fact_snapshot_digest,
      fact_revision_ids: [factId], coverage_revision_ids: [], strategy_input_digest: strategy.input_digest, strategy_output_digest: strategy.output_digest,
      generation_input_digest: generationInputDigest, generation_output_digest: canonicalInputDigest(generationResult), prompt_policy_id: RESUME_PROMPT_POLICY_ID, prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
      quality_standard_id: RESUME_QUALITY_STANDARD_ID, quality_standard_version: RESUME_QUALITY_STANDARD_VERSION, quality_standard_digest: RESUME_QUALITY_STANDARD_DIGEST,
      provider_profile_id: strategy.provider_profile_id, model_id: strategy.model_id, used_must_use_fact_revision_ids: [factId], omissions: [],
    };
    const proposal = await service.writeDefinition({ ...definitionInput(factId), status: "proposed", prompt_policy_version: RESUME_PROMPT_POLICY_VERSION, strategy_binding: binding, generation_result: generationResult, title: generationResult.title, statements: generationResult.statements }, authority("resume.definitions.write"));
    expect(proposal.definition).toMatchObject({ status: "proposed", strategy_binding: { strategy_revision_id: strategy.metadata.revision_id } });

    const correctionAuthority = authority("career.facts.confirm");
    await service.confirmFact({ fact_record_id: confirmed.fact.metadata.record_id, fact_revision_id: factId, expected_revision: confirmed.fact.metadata.revision, decision: "edit_and_accept", edited_value: "Corrected synthetic supported statement", review_note: null }, correctionAuthority, ownerDecision(correctionAuthority, factId, "edit_and_accept"));
    await expect(service.approveDefinition({ kind: "approve_definition", definition_record_id: proposal.definition.metadata.record_id, expected_revision: proposal.definition.metadata.revision }, authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("persists a scoped revision before inference and atomically links a validated immutable proposal", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const statementId = crypto.randomUUID();
    const source = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      statements: [{
        statement_id: statementId,
        section_id: "experience",
        kind: "factual",
        text: "Synthetic supported statement",
        supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id],
      }],
    }), authority("resume.definitions.write"), true);

    const submitted = await service.submitRevisionRequest({
      kind: "revision_request",
      source_definition_revision_id: source.definition.metadata.revision_id,
      target: { scope: "statement", target_id: statementId },
      request_text: "Reorder this sentence without changing what it says.",
    }, authority("resume.definitions.write"));
    expect(submitted.request).toMatchObject({
      record_type: "resume_revision_request",
      source_definition_revision_id: source.definition.metadata.revision_id,
      target: { scope: "statement", target_id: statementId },
      state: "submitted",
      classification: null,
    });
    expect(JSON.stringify(await store.catalog())).not.toContain("Reorder this sentence");

    const classified = await service.recordRevisionOutcome({
      kind: "revision_outcome",
      request_record_id: submitted.request.metadata.record_id,
      expected_revision: 1,
      classification: "presentation",
      state: "generating",
      clarification: null,
      resulting_definition_revision_id: null,
      owner_outcome: null,
    }, authority("resume.definitions.write"));
    const generationBefore = (await store.catalog()).generation;
    const proposed = await service.createRevisionProposal({
      kind: "revision_proposal",
      request_record_id: classified.request.metadata.record_id,
      expected_revision: classified.request.metadata.revision,
      draft: {
        source_definition_revision_id: source.definition.metadata.revision_id,
        revision_request_revision_id: classified.request.metadata.revision_id,
        title: "General Resume",
        statements: [{
          statement_id: statementId,
          section_id: "experience",
          kind: "factual",
          text: "Statement: Synthetic supported",
          supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id],
        }],
        changed_statement_ids: [statementId],
        section_order: ["experience"],
      },
    }, authority("resume.definitions.write"));

    expect((await store.catalog()).generation).toBe(generationBefore + 1);
    expect(proposed.definition).toMatchObject({
      status: "proposed",
      parent_definition_revision_id: source.definition.metadata.revision_id,
      successor_context: {
        kind: "natural_language_revision",
        source_definition_revision_id: source.definition.metadata.revision_id,
        revision_request_revision_id: classified.request.metadata.revision_id,
      },
    });
    expect(proposed.request).toMatchObject({
      state: "proposed",
      resulting_definition_revision_id: proposed.definition.metadata.revision_id,
    });
    expect(await store.readRevision(source.definition.metadata.revision_id)).toEqual(source.definition);

    const accepted = await service.recordRevisionOutcome({
      kind: "revision_outcome",
      request_record_id: submitted.request.metadata.record_id,
      expected_revision: proposed.request.metadata.revision,
      classification: "presentation",
      state: "accepted",
      clarification: null,
      resulting_definition_revision_id: proposed.definition.metadata.revision_id,
      owner_outcome: "accept",
    }, authority("resume.definitions.write"), true);
    expect(accepted.request.state).toBe("accepted");
    expect(proposed.definition.status).toBe("proposed");
  });

  it("enforces revision classification routes, scope, confirmation, and bounded regeneration", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    const source = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);

    await expect(service.submitRevisionRequest({
      kind: "revision_request",
      source_definition_revision_id: source.definition.metadata.revision_id,
      target: { scope: "statement", target_id: crypto.randomUUID() },
      request_text: "Change a missing statement.",
    }, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "validation_failed" });

    const factual = await service.submitRevisionRequest({
      kind: "revision_request",
      source_definition_revision_id: source.definition.metadata.revision_id,
      target: { scope: "resume", target_id: null },
      request_text: "Make me the manager.",
    }, authority("resume.definitions.write"));
    const awaiting = await service.recordRevisionOutcome({
      kind: "revision_outcome",
      request_record_id: factual.request.metadata.record_id,
      expected_revision: 1,
      classification: "factual",
      state: "awaiting_confirmation",
      clarification: null,
      resulting_definition_revision_id: null,
      owner_outcome: null,
    }, authority("resume.definitions.write"));
    await expect(service.recordRevisionOutcome({
      kind: "revision_outcome",
      request_record_id: factual.request.metadata.record_id,
      expected_revision: 2,
      classification: "factual",
      state: "generating",
      clarification: null,
      resulting_definition_revision_id: null,
      owner_outcome: null,
    }, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "denied" });
    await expect(service.recordRevisionOutcome({
      kind: "revision_outcome",
      request_record_id: factual.request.metadata.record_id,
      expected_revision: 2,
      classification: "factual",
      state: "generating",
      clarification: null,
      resulting_definition_revision_id: null,
      owner_outcome: null,
    }, authority("resume.definitions.write"), true)).resolves.toMatchObject({ request: { state: "generating", attempt: 1 } });

    const ambiguous = await service.submitRevisionRequest({
      kind: "revision_request",
      source_definition_revision_id: source.definition.metadata.revision_id,
      target: { scope: "resume", target_id: null },
      request_text: "Make it better.",
    }, authority("resume.definitions.write"));
    await expect(service.recordRevisionOutcome({
      kind: "revision_outcome",
      request_record_id: ambiguous.request.metadata.record_id,
      expected_revision: 1,
      classification: "ambiguous",
      state: "clarification_needed",
      clarification: "Which section or statement should change, and how?",
      resulting_definition_revision_id: null,
      owner_outcome: null,
    }, authority("resume.definitions.write"))).resolves.toMatchObject({ request: { state: "clarification_needed" } });
    expect(awaiting.request.state).toBe("awaiting_confirmation");
    expect(() => assertRevisionTransition({ current: "generating", next: "failed", classification: "factual", hostOwnerConfirmed: false, attempt: 1 })).not.toThrow();
    expect(() => assertRevisionTransition({ current: "failed", next: "generating", classification: "factual", hostOwnerConfirmed: false, attempt: 1 })).not.toThrow();
    expect(() => assertRevisionTransition({ current: "proposed", next: "regenerate", classification: "presentation", hostOwnerConfirmed: true, attempt: 2 })).toThrow("revision_attempts_exhausted");
  });
  it("matches remembered jobs by explicit revision or exact owner-visible label without writing on ambiguity", async () => {
    const { store, service } = await setup();
    const addJob = async (title: string, employer: string, startDate: string) => {
      const value = JSON.stringify({ format: "resume_job_v1", title, employer, start_date: startDate, end_date: "Present", location: "", responsibilities: "" });
      const proposed = await service.proposeFact({
        ...proposalInput(value),
        fact: { ...proposalInput(value).fact, fact_kind: "employment", value },
      }, authority("career.facts.propose"));
      const confirmationAuthority = authority("career.facts.confirm");
      const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
      return confirmed.fact;
    };
    const northwindOne = await addJob("Support Lead", "Northwind", "2021");
    const northwindTwo = await addJob("Support Lead", "Northwind", "2023");
    const contoso = await addJob("Analyst", "Contoso", "2020");
    const before = (await store.allRevisions()).length;

    await expect(service.matchRememberedJob({ explicit_job_fact_revision_id: contoso.metadata.revision_id, description: "ignored" }, authority("resume.definitions.read"))).resolves.toMatchObject({
      method: "explicit_revision",
      result_class: "matched",
      matches: [{ fact_revision_id: contoso.metadata.revision_id, safe_label: "Analyst at Contoso" }],
    });
    await expect(service.matchRememberedJob({ explicit_job_fact_revision_id: null, description: " support lead AT northwind " }, authority("resume.definitions.read"))).resolves.toMatchObject({
      method: "exact_label",
      result_class: "ambiguous",
      matches: expect.arrayContaining([
        expect.objectContaining({ fact_revision_id: northwindOne.metadata.revision_id }),
        expect.objectContaining({ fact_revision_id: northwindTwo.metadata.revision_id }),
      ]),
    });
    await expect(service.matchRememberedJob({ explicit_job_fact_revision_id: null, description: "Northwind" }, authority("resume.definitions.read"))).resolves.toMatchObject({ method: "none", result_class: "none", matches: [] });
    expect((await store.allRevisions()).length).toBe(before);
  });

  it("retains the exact owner-visible interview turn as durable fact provenance", async () => {
    const { store, service } = await setup();
    const turn = {
      transcript_version: 1 as const,
      turn_id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      prompt_version: "resume-interview-3.2.2",
      topic: "accomplishments",
      question: "What became better because of your work?",
      answer: "I trained four new employees and reduced checkout errors.",
      follow_up: {
        question: "Do you remember how many people you trained?",
        answer: "Four new employees.",
        outcome: "answered" as const,
      },
      action: "answered" as const,
      occurred_at: "2026-08-07T12:00:00.000Z",
    };
    const proposed = await service.proposeFact({
      ...proposalInput(turn.answer),
      source: { ...proposalInput().source, interview_turn: turn },
    }, authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));

    expect(proposed.source.extensions.interview_turn).toEqual(turn);
    expect(confirmed.fact.source_revision_ids).toEqual([proposed.source.metadata.revision_id]);

    const reopened = new ResumeDataStore(store.memoryRoot, undefined, {}, false);
    await reopened.initialize(testGrant().owner_id);
    const retained = await reopened.readRevision(proposed.source.metadata.revision_id);
    expect(retained).toMatchObject({ record_type: "source", extensions: { interview_turn: turn } });
  });

  it("retains skipped and duplicate-answer turns without creating false career facts", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const sessionId = crypto.randomUUID();
    const skipped = await service.recordInterviewTurn({
      turn: {
        transcript_version: 1,
        turn_id: crypto.randomUUID(),
        session_id: sessionId,
        prompt_version: "resume-interview-3.2.2",
        topic: "education",
        question: "What education or training would you like to include?",
        answer: null,
        follow_up: null,
        action: "skipped",
        occurred_at: "2026-08-07T12:00:00.000Z",
      },
      sensitivity: "standard",
      linked_confirmed_fact_revision_id: null,
    }, authority("resume.definitions.write"));
    const duplicate = await service.recordInterviewTurn({
      turn: {
        transcript_version: 1,
        turn_id: crypto.randomUUID(),
        session_id: sessionId,
        prompt_version: "resume-interview-3.2.2",
        topic: "accomplishments",
        question: "What is one result or accomplishment you are proud of?",
        answer: "Synthetic supported statement",
        follow_up: null,
        action: "answered",
        occurred_at: "2026-08-07T12:00:00.000Z",
      },
      sensitivity: "standard",
      linked_confirmed_fact_revision_id: confirmed.fact.metadata.revision_id,
    }, authority("resume.definitions.write"));

    expect(skipped.turn).toMatchObject({ record_type: "source", retention_class: "durable_owner_data", extensions: { interview_turn: { action: "skipped", answer: null } } });
    expect(duplicate.turn).toMatchObject({ extensions: { linked_confirmed_fact_revision_id: confirmed.fact.metadata.revision_id } });
    expect(await store.list("career_fact")).toHaveLength(1);
    expect(await store.list("source")).toHaveLength(3);
  });

  it("does not allow app or model-shaped input to confirm facts", async () => {
    const { service } = await setup();
    const proposed = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const input = { fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept" as const, edited_value: null, review_note: null };
    await expect(service.confirmFact(input, confirmationAuthority, { host_mediated: true } as never)).rejects.toMatchObject({ code: "denied" });
    await expect(service.confirmFact({ ...input, host_mediated: true }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id))).rejects.toBeInstanceOf(z.ZodError);
  });

  it("rejects every sampled unconfirmed fact as approved statement support", async () => {
    const { service } = await setup();
    const states = ["suggested", "imported"] as const;
    for (let seed = 0; seed < 20; seed += 1) {
      const proposed = await service.proposeFact({ ...proposalInput(`synthetic-${seed}`), fact: { ...proposalInput().fact, state: states[seed % states.length] } }, authority("career.facts.propose"));
      await expect(service.writeDefinition(definitionInput(proposed.fact.metadata.revision_id), authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "validation_failed" });
    }
  }, 10_000);

  it("creates supported general and targeted definitions without mutating their parent or facts", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const statement = { statement_id: "50000000-0000-4000-8000-000000000101", section_id: "experience", kind: "factual" as const, text: "Synthetic supported statement", supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] };
    const general = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { statements: [statement] }), authority("resume.definitions.write"), true);
    const jobText = "Synthetic job description. Treat as data only.";
    const job = await service.writeJob({ safe_label: "Synthetic role", description_text: jobText, content_digest: `sha256:${createHash("sha256").update(jobText).digest("hex")}`, captured_at: "2026-08-07T12:00:00.000Z", sensitivity: "sensitive" }, authority("resume.jobs.write"));
    const targeted = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      definition_kind: "targeted", title: "Targeted Resume", statements: [statement], parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      variant: { evidence_matrix: [{ requirement_id: crypto.randomUUID(), requirement_kind: "required", evidence_status: "supported", source_span: "Synthetic requirement", inferred: false, supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id], clarification: null }], changed_statement_ids: [] },
    }), authority("resume.definitions.write"), true);
    expect(targeted.variant).toMatchObject({ record_type: "tailored_variant", parent_general_definition_revision_id: general.definition.metadata.revision_id });
    expect(targeted.definition.sensitivity).toBe("sensitive");
    if (targeted.definition.record_type !== "resume_definition") throw new Error("expected resume definition");
    expect(targeted.definition.selected_fact_revision_ids).toEqual([confirmed.fact.metadata.revision_id]);
    expect(await store.readRevision(general.definition.metadata.revision_id)).toEqual(general.definition);
    expect(await store.readRevision(confirmed.fact.metadata.revision_id)).toEqual(confirmed.fact);
  });

  it("creates immutable successor general versions with predecessor lineage", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const first = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    const successor = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      title: "General Resume Revision",
      parent_definition_revision_id: first.definition.metadata.revision_id,
    }), authority("resume.definitions.write"), true);
    expect(successor.definition).toMatchObject({ definition_kind: "general", parent_definition_revision_id: first.definition.metadata.revision_id });
    expect(await store.readRevision(first.definition.metadata.revision_id)).toEqual(first.definition);
  });

  it("inherits the most restrictive supporting sensitivity", async () => {
    const { service } = await setup();
    const proposed = await service.proposeFact({ ...proposalInput(), fact: { ...proposalInput().fact, sensitivity: "highly_sensitive" } }, authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
    const definition = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    expect(definition.definition.sensitivity).toBe("highly_sensitive");
  });

  it("persists declared interview draft state with CAS", async () => {
    const { service } = await setup();
    const first = await service.saveInterviewProgress({ expected_revision: null, status: "in_progress", current_topic: "experience", completed_topics: [], skipped_topics: [], draft_state: "declared_draft" }, authority("resume.definitions.write"));
    const second = await service.saveInterviewProgress({ record_id: first.progress.metadata.record_id, expected_revision: 1, status: "paused", current_topic: "education", completed_topics: ["experience"], skipped_topics: [], draft_state: "declared_draft" }, authority("resume.definitions.write"));
    expect(second.progress).toMatchObject({ record_type: "interview_progress", status: "paused", draft_state: "declared_draft", metadata: { revision: 2 } });
    await expect(service.saveInterviewProgress({ record_id: first.progress.metadata.record_id, expected_revision: 1, status: "completed", current_topic: null, completed_topics: [], skipped_topics: [], draft_state: "complete" }, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "conflict" });
  });

  it("persists empty, multiline, and Unicode recovery values with server-owned acknowledgements", async () => {
    const { store, service } = await setup();
    const empty = await service.saveInterviewRecovery(recoverySaveInput(""), authority("resume.definitions.write"));
    expect(empty).toMatchObject({
      reused: false,
      acknowledgement: {
        revision_id: empty.progress.metadata.revision_id,
        revision: 1,
        saved_at: "2026-08-07T12:00:00.000Z",
        value_digest: canonicalInputDigest(""),
      },
      progress: {
        record_type: "interview_progress",
        current_topic: "contact",
        current_question_id: "contact-question",
        current_field_id: "answer",
        recovery_draft: { value: "", acknowledged_revision: 1 },
      },
    });

    const unicodeValue = "First line\nRésumé owner: 東京 🚀";
    const unicode = await service.saveInterviewRecovery(recoverySaveInput(unicodeValue, {
      record_id: empty.progress.metadata.record_id,
      expected_revision: 1,
    }), authority("resume.definitions.write"));
    expect(unicode.progress).toMatchObject({ metadata: { revision: 2 }, recovery_draft: { value: unicodeValue, value_digest: canonicalInputDigest(unicodeValue), acknowledged_revision: 2 } });

    const reopened = new ResumeDataStore(store.memoryRoot, undefined, {}, false);
    await reopened.initialize(testGrant().owner_id);
    expect(await reopened.readHead(unicode.progress.metadata.record_id)).toMatchObject({ recovery_draft: { value: unicodeValue }, current_question_id: "contact-question", current_field_id: "answer" });
    expect(await reopened.list("source")).toHaveLength(0);
    expect(await reopened.list("career_fact")).toHaveLength(0);
    expect(await reopened.list("resume_definition")).toHaveLength(0);

    await expect(service.saveInterviewRecovery(recoverySaveInput("x".repeat(16_385), {
      record_id: unicode.progress.metadata.record_id,
      expected_revision: 2,
      value_digest: canonicalInputDigest("x".repeat(16_385)),
    }), authority("resume.definitions.write"))).rejects.toBeInstanceOf(z.ZodError);
    await expect(service.saveInterviewRecovery(recoverySaveInput("changed", {
      record_id: unicode.progress.metadata.record_id,
      expected_revision: 2,
      value_digest: `sha256:${"0".repeat(64)}`,
    }), authority("resume.definitions.write"))).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("reuses equivalent recovery writes and rejects stale or mismatched concurrent writes", async () => {
    const { store, service } = await setup();
    const firstOperation = crypto.randomUUID();
    const firstAuthority = authority("resume.definitions.write", firstOperation);
    const firstInput = recoverySaveInput("window one");
    const first = await service.saveInterviewRecovery(firstInput, firstAuthority);
    const replay = await service.saveInterviewRecovery(firstInput, firstAuthority);
    expect(replay).toMatchObject({ reused: true, progress: { metadata: { revision_id: first.progress.metadata.revision_id } } });
    expect((await store.catalog()).generation).toBe(1);

    await expect(service.saveInterviewRecovery(recoverySaveInput("different input", {
      record_id: first.progress.metadata.record_id,
      expected_revision: 1,
    }), firstAuthority)).rejects.toMatchObject({ code: "idempotency_conflict" });

    const winner = await service.saveInterviewRecovery(recoverySaveInput("window two wins", {
      record_id: first.progress.metadata.record_id,
      expected_revision: 1,
    }), authority("resume.definitions.write"));
    await expect(service.saveInterviewRecovery(recoverySaveInput("stale window", {
      record_id: first.progress.metadata.record_id,
      expected_revision: 1,
    }), authority("resume.definitions.write"))).rejects.toMatchObject({ code: "conflict", details: { currentRevision: 2 } });
    expect(await store.readHead(first.progress.metadata.record_id)).toMatchObject({ metadata: { revision_id: winner.progress.metadata.revision_id }, recovery_draft: { value: "window two wins" } });
  });

  it("discards only recovery content and leaves submitted facts and history unchanged", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const saved = await service.saveInterviewRecovery(recoverySaveInput("private draft"), authority("resume.definitions.write"));
    const factRevisionsBefore = await service.factHistory(confirmed.fact.metadata.record_id, authority("career.facts.read"));
    const sourcesBefore = await store.list("source");
    const discarded = await service.discardInterviewRecovery({
      record_id: saved.progress.metadata.record_id,
      expected_revision: 1,
    }, authority("resume.definitions.write"));

    expect(discarded.progress).toMatchObject({
      metadata: { revision: 2 },
      recovery_draft: null,
      current_topic: "contact",
      current_question_id: "contact-question",
      current_field_id: "answer",
    });
    expect(await service.factHistory(confirmed.fact.metadata.record_id, authority("career.facts.read"))).toEqual(factRevisionsBefore);
    expect(await store.list("source")).toEqual(sourcesBefore);
    expect(await store.list("resume_definition")).toHaveLength(0);
  });

  it("atomically clears a draft and links one submitted turn for an equivalent confirmed fact", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const answer = "Synthetic supported statement";
    const saved = await service.saveInterviewRecovery(recoverySaveInput(answer), authority("resume.definitions.write"));
    const turn = submittedTurn(saved.progress.recovery_draft!.slot.session_id, answer);
    const operationId = crypto.randomUUID();
    const submitAuthority = authority("resume.definitions.write", operationId);
    const input = {
      record_id: saved.progress.metadata.record_id,
      expected_revision: 1,
      status: "in_progress",
      current_topic: "direction",
      completed_topics: ["contact"],
      skipped_topics: [],
      draft_state: "declared_draft",
      session_id: turn.session_id,
      submission: {
        kind: "new_turn" as const,
        turn,
        sensitivity: "sensitive" as const,
        linked_confirmed_fact_revision_id: confirmed.fact.metadata.revision_id,
      },
    };
    const submitted = await service.submitInterviewProgress(input, submitAuthority);
    const replay = await service.submitInterviewProgress(input, submitAuthority);

    expect(submitted.progress).toMatchObject({
      metadata: { revision: 2 },
      current_topic: "direction",
      recovery_draft: null,
      last_submitted_turn_revision_id: submitted.turn.metadata.revision_id,
    });
    expect(submitted.turn).toMatchObject({ extensions: { interview_turn: turn, linked_confirmed_fact_revision_id: confirmed.fact.metadata.revision_id } });
    expect(replay).toMatchObject({ reused: true, progress: { metadata: { revision_id: submitted.progress.metadata.revision_id } }, turn: { metadata: { revision_id: submitted.turn.metadata.revision_id } } });
    const paused = await service.saveInterviewProgress({
      record_id: submitted.progress.metadata.record_id,
      expected_revision: 2,
      status: "paused",
      current_topic: "direction",
      completed_topics: ["contact"],
      skipped_topics: [],
      draft_state: "declared_draft",
      session_id: turn.session_id,
    }, authority("resume.definitions.write"));
    expect(paused.progress).toMatchObject({ last_submitted_turn_revision_id: submitted.turn.metadata.revision_id });
    expect(await store.list("source")).toHaveLength(2);
    expect(await store.list("career_fact")).toHaveLength(1);
  });

  it("links the normal proposed-fact source once after host confirmation", async () => {
    const { store, service } = await setup();
    const answer = "Owner submitted synthetic contact value";
    const saved = await service.saveInterviewRecovery(recoverySaveInput(answer), authority("resume.definitions.write"));
    const turn = submittedTurn(saved.progress.recovery_draft!.slot.session_id, answer);
    const proposed = await service.proposeFact({
      ...proposalInput(answer),
      source: { ...proposalInput().source, interview_turn: turn, content_digest: canonicalInputDigest(answer) },
    }, authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await service.confirmFact({
      fact_record_id: proposed.fact.metadata.record_id,
      fact_revision_id: proposed.fact.metadata.revision_id,
      expected_revision: 1,
      decision: "accept",
      edited_value: null,
      review_note: null,
    }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));

    const submitted = await service.submitInterviewProgress({
      record_id: saved.progress.metadata.record_id,
      expected_revision: 1,
      status: "in_progress",
      current_topic: "direction",
      completed_topics: ["contact"],
      skipped_topics: [],
      draft_state: "declared_draft",
      session_id: turn.session_id,
      submission: {
        kind: "existing_turn",
        source_revision_id: proposed.source.metadata.revision_id,
        linked_confirmed_fact_revision_id: confirmed.fact.metadata.revision_id,
      },
    }, authority("resume.definitions.write"));

    expect(submitted.turn.metadata.revision_id).toBe(proposed.source.metadata.revision_id);
    expect(submitted.progress).toMatchObject({ recovery_draft: null, last_submitted_turn_revision_id: proposed.source.metadata.revision_id });
    expect(await store.list("source")).toHaveLength(1);
    expect(await store.list("career_fact")).toHaveLength(1);
  });

  it("commits a skipped user-visible turn atomically with interview progress", async () => {
    const { store, service } = await setup();
    const sessionId = crypto.randomUUID();
    const turn = {
      transcript_version: 1 as const,
      turn_id: crypto.randomUUID(),
      session_id: sessionId,
      prompt_version: "resume-interview-3.2.2",
      topic: "education",
      question: "What education or training would you like to include?",
      answer: null,
      follow_up: null,
      action: "skipped" as const,
      occurred_at: "2026-08-07T12:00:00.000Z",
    };
    const saved = await service.saveInterviewProgress({
      expected_revision: null,
      status: "in_progress",
      current_topic: "credentials",
      completed_topics: [],
      skipped_topics: ["education"],
      draft_state: "declared_draft",
      session_id: sessionId,
      audit_turn: turn,
    }, authority("resume.definitions.write"));

    expect(saved.progress.extensions.interview_session_id).toBe(sessionId);
    expect(await store.list("source")).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ record_id: turn.turn_id }), extensions: expect.objectContaining({ interview_turn: turn }) }),
    ]);
    await expect(service.saveInterviewProgress({
      record_id: saved.progress.metadata.record_id,
      expected_revision: 1,
      status: "paused",
      current_topic: "credentials",
      completed_topics: [],
      skipped_topics: ["education"],
      draft_state: "declared_draft",
      session_id: crypto.randomUUID(),
    }, authority("resume.definitions.write"))).rejects.toMatchObject({ code: "validation_failed" });
    expect((await store.readHead(saved.progress.metadata.record_id)).metadata.revision).toBe(1);
  });

  it("atomically records validation, policy, input, and output digests on approval", async () => {
    const { store, service } = await setup();
    const confirmed = await confirmedFact(service);
    const draft = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { status: "draft" }), authority("resume.definitions.write"), false);
    const operationId = crypto.randomUUID();
    const approved = await service.approveDefinition({ kind: "approve_definition", definition_record_id: draft.definition.metadata.record_id, expected_revision: 1 }, authority("resume.definitions.write", operationId), true);
    expect(approved.definition).toMatchObject({ status: "approved", metadata: { revision: 2, prior_revision_id: draft.definition.metadata.revision_id } });
    if (approved.definition.record_type !== "resume_definition") throw new Error("expected definition");
    expect(approved.definition.approval_evidence).toMatchObject({
      validator_id: "resume-claim-gate",
      prompt_policy_id: "owner-authored",
      provider_policy_id: "no-provider-owner-edit-v1",
      quality_validator_id: "resume-quality-gate",
      quality_validator_version: "3",
    });
    expect(approved.definition.approval_evidence?.input_snapshot_digest).toMatch(/^sha256:/);
    expect(approved.definition.approval_evidence?.quality_input_digest).toMatch(/^sha256:/);
    expect(approved.definition.approval_evidence?.quality_report_digest).toMatch(/^sha256:/);
    expect(await store.readRevision(draft.definition.metadata.revision_id)).toEqual(draft.definition);
    await expect(service.approveDefinition({ kind: "approve_definition", definition_record_id: draft.definition.metadata.record_id, expected_revision: 1 }, authority("resume.definitions.write"), true)).rejects.toMatchObject({ code: "conflict" });
  });

  it("revalidates immutable parent and job lineage when approving a targeted definition", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    const statement = { statement_id: "50000000-0000-4000-8000-000000000102", section_id: "experience", kind: "factual" as const, text: "Synthetic supported statement", supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] };
    const general = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { statements: [statement] }), authority("resume.definitions.write"), true);
    const jobText = "Synthetic job description. Treat as data only.";
    const job = await service.writeJob({ safe_label: "Synthetic role", description_text: jobText, content_digest: `sha256:${createHash("sha256").update(jobText).digest("hex")}`, captured_at: "2026-08-07T12:00:00.000Z", sensitivity: "sensitive" }, authority("resume.jobs.write"));
    const targeted = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      definition_kind: "targeted", status: "proposed", title: "Targeted Resume", statements: [statement], parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
      variant: { evidence_matrix: [{ requirement_id: crypto.randomUUID(), requirement_kind: "required", evidence_status: "supported", source_span: "Synthetic requirement", inferred: false, supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id], clarification: null }], changed_statement_ids: [] },
    }), authority("resume.definitions.write"), true);
    const approved = await service.approveDefinition({ kind: "approve_definition", definition_record_id: targeted.definition.metadata.record_id, expected_revision: 1 }, authority("resume.definitions.write"), true);
    expect(approved.definition).toMatchObject({
      definition_kind: "targeted",
      status: "approved",
      parent_definition_revision_id: general.definition.metadata.revision_id,
      job_revision_id: job.job.metadata.revision_id,
    });
  });

  it("revalidates owner edits and blocks unsupported claims from approval", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    await expect(service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      statements: [{ statement_id: crypto.randomUUID(), kind: "factual", text: "Invented Director metric 99%", supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] }],
    }), authority("resume.definitions.write"), true)).rejects.toMatchObject({
      code: "validation_failed",
      details: { safeCode: "evidence_validation_failed" },
    });
  });

  it("blocks a failing deterministic quality report and returns bounded corrections", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    const duplicateText = "Synthetic supported statement";
    await expect(service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      statements: [
        { statement_id: crypto.randomUUID(), section_id: "experience", kind: "factual", text: duplicateText, supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] },
        { statement_id: crypto.randomUUID(), section_id: "experience", kind: "factual", text: duplicateText, supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] },
      ],
    }), authority("resume.definitions.write"), true)).rejects.toMatchObject({
      code: "validation_failed",
      message: "Resume quality checks require corrections before approval",
      details: { corrections: ["Keep one supported version of the repeated statement."] },
    });
  });

  it("registers lineage metadata only and blocks accepted artifacts from draft definitions", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    const draft = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, { status: "draft" }), authority("resume.definitions.write"), false);
    const input = { definition_revision_id: draft.definition.metadata.revision_id, template_id: "ats-basic", template_version: "1", renderer_id: "deterministic", renderer_version: "1", font_manifest_digest: `sha256:${"b".repeat(64)}`, validation_run_id: crypto.randomUUID(), findings: [], artifact_digest: `sha256:${"c".repeat(64)}`, format: "pdf", accepted: true };
    await expect(service.registerArtifact(input, authority("resume.artifacts.register"))).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("stores export receipts only after a matching accepted artifact exists", async () => {
    const { service } = await setup();
    const confirmed = await confirmedFact(service);
    const definition = await service.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    const artifactDigest = `sha256:${"c".repeat(64)}` as const;
    if (definition.definition.record_type !== "resume_definition" || !definition.definition.approval_evidence) throw new Error("expected approved definition");
    await expect(service.registerArtifact({ definition_revision_id: definition.definition.metadata.revision_id, template_id: "ats-basic", template_version: "1", renderer_id: "deterministic", renderer_version: "1", font_manifest_digest: `sha256:${"b".repeat(64)}`, validation_run_id: crypto.randomUUID(), findings: [], artifact_digest: artifactDigest, format: "pdf", accepted: true }, authority("resume.artifacts.register"))).rejects.toMatchObject({ code: "validation_failed" });
    const artifact = await service.registerArtifact({ definition_revision_id: definition.definition.metadata.revision_id, template_id: "ats-basic", template_version: "1", renderer_id: "deterministic", renderer_version: "1", font_manifest_digest: `sha256:${"b".repeat(64)}`, validation_run_id: definition.definition.approval_evidence.validation_run_id, findings: [], artifact_digest: artifactDigest, format: "pdf", accepted: true }, authority("resume.artifacts.register"));
    const receipt = await service.recordExportReceipt({ artifact_revision_id: artifact.artifact.metadata.revision_id, artifact_digest: artifactDigest, format: "pdf", outcome: "completed", exported_at: "2026-08-07T12:00:00.000Z", safe_destination_label: "resume.pdf" }, authority("resume.export.request"));
    expect(receipt.receipt).toMatchObject({ record_type: "export_receipt", artifact_revision_id: artifact.artifact.metadata.revision_id, safe_destination_label: "resume.pdf" });
    await expect(service.recordExportReceipt({ artifact_revision_id: artifact.artifact.metadata.revision_id, artifact_digest: artifactDigest, format: "pdf", outcome: "completed", exported_at: "2026-08-07T12:00:00.000Z", safe_destination_label: "/tmp/resume.pdf" }, authority("resume.export.request"))).rejects.toBeDefined();
  });
});
