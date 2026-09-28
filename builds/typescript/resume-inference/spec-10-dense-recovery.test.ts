import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import type { ModelAdapter, StructuredCompletionResponse } from "../adapters/base.js";
import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { ResumeStrategyRecordSchema } from "../app-platform/contracts/data.js";
import {
  InferenceDataBlockSchema,
  InferenceRequestSchema,
  PURPOSE_LIMITS,
  PURPOSE_OUTPUT_SCHEMAS,
} from "../app-platform/contracts/inference.js";
import { ResumeInferenceBroker } from "./broker.js";
import { structureResumeE2eProviderResult, synthesizeResumeE2eResult } from "./e2e-fixture.js";
import { deterministicHostFallback } from "./host-assistance.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";
import { parsePurposeResult } from "./results.js";
import {
  SPEC_10_DENSE_CORPUS,
  SPEC_10_DENSE_CORPUS_DIGEST,
  SPEC_10_HOLDOUT_CORPUS,
  SPEC_10_HOLDOUT_CORPUS_DIGEST,
  fixtureIdentity,
  permuteSpec10Fixture,
  type Spec10SyntheticFixture,
} from "./spec-10-acceptance-fixture.js";
import { validateInferenceClaims } from "./validators.js";
import { ImmutableInferenceSnapshotBuilder } from "./snapshot.js";
import { ResumeDomainService } from "../resume-domain/service.js";
import { ResumeDataStore } from "../resume-domain/store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "../resume-domain/test-helpers.js";
import {
  RESUME_QUALITY_STANDARD_DIGEST,
  RESUME_QUALITY_STANDARD_ID,
  RESUME_QUALITY_STANDARD_VERSION,
} from "./strategy.js";

type DataBlock = z.infer<typeof InferenceDataBlockSchema>;
type Request = z.infer<typeof InferenceRequestSchema>;
type Draft = {
  title: string;
  statements: Array<{
    statement_id: string;
    section_id: string;
    display_role?: "heading" | "bullet" | "line";
    kind: "factual" | "presentation";
    text: string;
    supporting_confirmed_fact_revision_ids: string[];
  }>;
  section_order: string[];
  omissions: Array<{ fact_revision_id: string; reason_code: string }>;
};
type ProviderDraft = Draft & {
  experience_roles: Array<{
    job_fact_revision_id: string;
    heading_statement: Draft["statements"][number];
    bullet_statements: Draft["statements"];
  }>;
};

const OWNER_ID = "83000000-0000-4000-8000-000000000001";
const INSTALLATION_ID = "83000000-0000-4000-8000-000000000002";
const FIXED_TIME = "2026-08-15T12:00:00.000Z";
const SHA = `sha256:${"a".repeat(64)}`;
const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function block(category: DataBlock["category"], schemaId: string, data: unknown): DataBlock {
  return InferenceDataBlockSchema.parse({
    category,
    schema_id: schemaId,
    schema_version: 1,
    content_digest: canonicalInputDigest(data),
    data,
  });
}

function runtimeBlocks(fixture: Spec10SyntheticFixture): DataBlock[] {
  const answeredIds = new Set(fixture.coverage.flatMap((coverage) => Object.values(coverage.dimensions)
    .filter((dimension) => dimension.outcome === "answered")
    .flatMap((dimension) => dimension.evidence_revision_ids)));
  const facts = fixture.facts
    .filter((fact) => fact.fact_kind !== "job_evidence" || answeredIds.has(fact.revision_id))
    .map((fact) => ({
      revision_id: fact.revision_id,
      fact_kind: fact.fact_kind,
      value: fact.fact_kind === "job_evidence"
        ? JSON.stringify({
            value_version: 1,
            association: "job",
            job_fact_revision_id: fact.job_fact_revision_id,
            dimension: fact.dimension,
            outcome: "answered",
            owner_text: fact.value,
          })
        : fact.value,
      source_revision_ids: [fact.revision_id],
    }))
    .sort((left, right) => left.revision_id.localeCompare(right.revision_id));
  const strategy = {
    schema_version: 3,
    record_type: "resume_strategy",
    metadata: {
      record_id: fixture.strategy!.revision_id,
      revision_id: fixture.strategy!.revision_id,
      revision: 1,
      created_at: FIXED_TIME,
      created_by: {
        owner_id: OWNER_ID,
        actor_id: OWNER_ID,
        app_id: "ai.braindrive.resume-builder",
        publisher_id: "ai.braindrive",
        package_digest: SHA,
        installation_id: INSTALLATION_ID,
      },
      prior_revision_id: null,
      extensions: {},
    },
    owner_id: OWNER_ID,
    updated_at: FIXED_TIME,
    lifecycle_state: "active",
    sensitivity: "sensitive",
    retention_class: "durable_owner_data",
    extensions: {},
    strategy_version: 1,
    fact_snapshot_digest: canonicalInputDigest(facts),
    fact_revision_ids: facts.map((fact) => fact.revision_id),
    coverage_revision_ids: [...fixture.strategy!.coverage_revision_ids].sort(),
    target_revision_id: null,
    history_shape: "chronological_standard",
    history_reason_code: "standard_chronology",
    role_emphasis: [...fixture.jobs]
      .sort((left, right) => left.fact_revision_id.localeCompare(right.fact_revision_id))
      .map((job, index) => ({
        job_fact_revision_id: job.fact_revision_id,
        priority: index === 0 ? "primary" : "supporting",
        reason_code: index === 0 ? "recent" : "continuity",
        bullet_density: "expanded",
      })),
    section_order: [...fixture.strategy!.section_order],
    summary_decision: fixture.strategy!.summary_decision,
    summary_reason_code: "supported_positioning",
    evidence_priorities: facts
      .filter((fact) => fact.fact_kind !== "preference")
      .map((fact) => ({ fact_revision_id: fact.revision_id, priority: "must_use" as const })),
    skills_context: [],
    omissions: [],
    unresolved_gap_ids: [],
    owner_rationale: "Use each eligible confirmed evidence unit and preserve role association.",
    prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    quality_standard_id: "braindrive.resume-quality",
    quality_standard_version: "3",
    quality_standard_digest: SHA,
    provider_profile_id: "synthetic-owner-profile",
    model_id: "synthetic-model",
    input_digest: SHA,
    output_digest: SHA,
  };
  return [
    block("confirmed_fact_snapshot", "resume.confirmed-facts.v1", { facts }),
    block("resume_strategy", "resume.strategy-record.v1", strategy),
  ];
}

function request(fixture: Spec10SyntheticFixture, operationId = randomUUID()): Request {
  const dataBlocks = runtimeBlocks(fixture);
  const facts = (dataBlocks[0]!.data as { facts: Array<{ revision_id: string }> }).facts;
  const requestedAt = new Date();
  return InferenceRequestSchema.parse({
    inference_schema_version: 1,
    request_id: randomUUID(),
    owner_id: OWNER_ID,
    actor_id: OWNER_ID,
    app_id: "ai.braindrive.resume-builder",
    installation_id: INSTALLATION_ID,
    operation_id: operationId,
    grant_id: randomUUID(),
    purpose: "general_resume_draft",
    input_snapshot: {
      fact_snapshot_revision: 1,
      fact_snapshot_digest: canonicalInputDigest(facts),
      record_revision_ids: [...facts.map((fact) => fact.revision_id), fixture.strategy!.revision_id],
    },
    data_blocks: dataBlocks,
    prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS.general_resume_draft,
    output_schema_version: 1,
    capability_requirements: {
      text_generation: true,
      complete_structured_json: true,
      minimum_context_tokens: PURPOSE_LIMITS.general_resume_draft.input_tokens,
      model_tools: false,
    },
    limits: PURPOSE_LIMITS.general_resume_draft,
    requested_at: requestedAt.toISOString(),
    deadline_at: new Date(requestedAt.getTime() + PURPOSE_LIMITS.general_resume_draft.duration_ms).toISOString(),
  });
}

function deterministicDraft(invocation: Request): Draft {
  const fallback = deterministicHostFallback("general_resume_draft", invocation.data_blocks);
  return parsePurposeResult("general_resume_draft", PURPOSE_OUTPUT_SCHEMAS.general_resume_draft, fallback) as Draft;
}

function providerDraft(invocation: Request): ProviderDraft {
  return structureResumeE2eProviderResult("general_resume_draft", deterministicDraft(invocation), invocation.data_blocks) as ProviderDraft;
}

function providerStatements(draft: ProviderDraft): Draft["statements"] {
  return [
    ...draft.statements,
    ...draft.experience_roles.flatMap((role) => [role.heading_statement, ...role.bullet_statements]),
  ];
}

function unsupportedDraft(invocation: Request, foreignSupport = false): ProviderDraft {
  const draft = structuredClone(providerDraft(invocation));
  const target = providerStatements(draft).find((statement) => statement.display_role !== "heading")!;
  target.text = foreignSupport ? "Foreign unsupported assertion" : "Invented metric 99%";
  if (foreignSupport) target.supporting_confirmed_fact_revision_ids = ["83999999-0000-4000-8000-000000000999"];
  return draft;
}

function adapter(outputs: Array<unknown | (() => Promise<unknown>)>) {
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const value: ModelAdapter = {
    async complete() { throw new Error("general chat path is prohibited"); },
    async completeStructuredNoTools(): Promise<StructuredCompletionResponse> {
      const index = calls;
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        const configured = outputs[Math.min(index, outputs.length - 1)];
        const output = typeof configured === "function" ? await configured() : configured;
        return { text: typeof output === "string" ? output : JSON.stringify(output), finishReason: "stop", modelId: "synthetic-model" };
      } finally {
        active -= 1;
      }
    },
  };
  return { value, calls: () => calls, maximumActive: () => maximumActive };
}

function provider(value: ModelAdapter) {
  return {
    adapter: value,
    providerProfileId: "synthetic-owner-profile",
    providerId: "ollama",
    modelId: "synthetic-model",
    expectedObservedModelId: "synthetic-model",
    modelClass: "owner_active_compatible" as const,
  };
}

describe("Spec 10 dense General Resume recovery", () => {
  it("keeps the accepted dense and holdout fixture identities active", () => {
    expect(fixtureIdentity(SPEC_10_DENSE_CORPUS).fixture_digest).toBe(SPEC_10_DENSE_CORPUS_DIGEST);
    expect(fixtureIdentity(SPEC_10_HOLDOUT_CORPUS).fixture_digest).toBe(SPEC_10_HOLDOUT_CORPUS_DIGEST);
  });

  it.each([
    ["dense", SPEC_10_DENSE_CORPUS],
    ["holdout", SPEC_10_HOLDOUT_CORPUS],
  ] as const)("accepts %s primary and provider-repair paths with exact limits", async (_name, fixture) => {
    const primaryRequest = request(fixture);
    const primaryModel = adapter([providerDraft(primaryRequest)]);
    const primary = await new ResumeInferenceBroker(async () => provider(primaryModel.value)).execute(primaryRequest);
    expect(primary.inference).toMatchObject({ status: "completed", attempt_count: 1, outcome: { completion_mode: "primary" } });
    expect(primary.validation).toMatchObject({ accepted: true, findings: [] });
    expect(primaryModel.calls()).toBe(1);
    expect(primaryModel.maximumActive()).toBe(1);

    const structuralRequest = request(fixture);
    const structuralModel = adapter(["{}", providerDraft(structuralRequest)]);
    const structural = await new ResumeInferenceBroker(async () => provider(structuralModel.value)).execute(structuralRequest);
    expect(structural.inference).toMatchObject({ status: "completed", attempt_count: 2, outcome: { completion_mode: "provider_repair", recovery_class: "provider_structural_repair" } });
    expect(structuralModel.calls()).toBe(2);
    expect(structuralModel.maximumActive()).toBe(1);

    const evidenceRequest = request(fixture);
    const evidenceModel = adapter([unsupportedDraft(evidenceRequest), providerDraft(evidenceRequest)]);
    const evidence = await new ResumeInferenceBroker(async () => provider(evidenceModel.value)).execute(evidenceRequest);
    expect(evidence.inference).toMatchObject({ status: "completed", attempt_count: 2, outcome: { completion_mode: "provider_repair", recovery_class: "provider_validation_repair" } });
    expect(evidenceModel.calls()).toBe(2);
    expect(evidenceModel.maximumActive()).toBe(1);
  });

  it.each([
    ["dense", SPEC_10_DENSE_CORPUS],
    ["holdout", SPEC_10_HOLDOUT_CORPUS],
  ] as const)("tries targeted then full deterministic recovery for %s evidence exhaustion", async (_name, fixture) => {
    const targetedRequest = request(fixture);
    const targetedModel = adapter([unsupportedDraft(targetedRequest), unsupportedDraft(targetedRequest)]);
    const targetedEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    const targeted = await new ResumeInferenceBroker(
      async () => provider(targetedModel.value),
      (event, details) => targetedEvents.push({ event, details }),
    ).execute(targetedRequest);
    expect(targeted.inference).toMatchObject({ status: "completed", attempt_count: 2, outcome: { completion_mode: "deterministic_fallback" } });
    expect(targeted.validation).toMatchObject({ accepted: true, findings: [] });
    expect(targeted.recovery_diagnostics).toMatchObject({
      local_candidate_classes: ["targeted_fact_repair"],
      targeted_fact_repair_disposition: "accepted",
      recovery_disposition: "targeted_accepted",
    });
    expect(targetedModel.calls()).toBe(2);
    expect(targetedEvents.at(-1)?.details).toMatchObject({
      local_candidate_classes: ["targeted_fact_repair"],
      targeted_fact_repair_validator_codes: [],
      targeted_fact_repair_disposition: "accepted",
      recovery_disposition: "targeted_accepted",
    });

    const fullRequest = request(fixture);
    const fullModel = adapter([unsupportedDraft(fullRequest, true), unsupportedDraft(fullRequest, true)]);
    const fullEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    const full = await new ResumeInferenceBroker(
      async () => provider(fullModel.value),
      (event, details) => fullEvents.push({ event, details }),
    ).execute(fullRequest);
    expect(full.inference).toMatchObject({ status: "completed", attempt_count: 2, outcome: { completion_mode: "deterministic_fallback", recovery_class: "deterministic_fallback" } });
    expect(full.validation).toMatchObject({ accepted: true, findings: [] });
    expect(full.recovery_diagnostics).toMatchObject({
      provider_validator_codes: ["missing_provenance"],
      local_candidate_classes: ["targeted_fact_repair", "full_general_constructor"],
      targeted_fact_repair_disposition: "rejected",
      full_general_constructor_disposition: "accepted",
      recovery_disposition: "full_constructor_accepted",
    });
    expect(fullModel.calls()).toBe(2);
    expect(fullModel.maximumActive()).toBe(1);
    expect(fullEvents.at(-1)?.details).toMatchObject({
      provider_validator_codes: ["missing_provenance"],
      local_candidate_classes: ["targeted_fact_repair", "full_general_constructor"],
      targeted_fact_repair_validator_codes: ["missing_provenance"],
      targeted_fact_repair_disposition: "rejected",
      full_general_constructor_validator_codes: [],
      full_general_constructor_disposition: "accepted",
      recovery_disposition: "full_constructor_accepted",
      original_failure_code: "evidence_validation_failed",
      final_disposition: "completed",
    });
  });

  it("fails closed with dual-stage safe diagnostics when both local candidates are invalid", async () => {
    const invocation = request(SPEC_10_DENSE_CORPUS);
    const strategy = invocation.data_blocks.find((candidate) => candidate.category === "resume_strategy")!;
    const invalidStrategy = {
      ...(strategy.data as object),
      evidence_priorities: [{ fact_revision_id: "83999999-0000-4000-8000-000000000999", priority: "must_use" }],
    };
    strategy.data = invalidStrategy;
    strategy.content_digest = canonicalInputDigest(invalidStrategy);
    const invalid = unsupportedDraft(invocation, true);
    const model = adapter([invalid, invalid]);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const completion = await new ResumeInferenceBroker(
      async () => provider(model.value),
      (event, details) => events.push({ event, details }),
    ).execute(invocation);
    expect(completion.inference).toMatchObject({
      status: "failed",
      result: null,
      attempt_count: 2,
      error: { code: "evidence_validation_failed" },
      outcome: { stage: "recovery", completion_mode: "none", final_disposition: "failed" },
    });
    expect(completion.recovery_diagnostics).toMatchObject({
      targeted_fact_repair_disposition: "rejected",
      full_general_constructor_disposition: "rejected",
      recovery_disposition: "recovery_rejected",
    });
    expect(model.calls()).toBe(2);
    expect(events.at(-1)?.details).toMatchObject({
      local_candidate_classes: ["targeted_fact_repair", "full_general_constructor"],
      targeted_fact_repair_disposition: "rejected",
      full_general_constructor_disposition: "rejected",
      recovery_disposition: "recovery_rejected",
      original_failure_code: "evidence_validation_failed",
    });
    expect(JSON.stringify(events)).not.toContain("Foreign unsupported assertion");
  });

  it("classifies a schema-invalid full constructor separately and writes no result", async () => {
    const invocation = request(SPEC_10_DENSE_CORPUS);
    const providerCandidate = unsupportedDraft(invocation, true);
    const factsBlock = invocation.data_blocks.find((candidate) => candidate.category === "confirmed_fact_snapshot")!;
    const facts = structuredClone((factsBlock.data as { facts: Array<{ fact_kind: string; value: string }> }).facts);
    const project = facts.find((fact) => fact.fact_kind === "project")!;
    project.value = "x".repeat(9_000);
    factsBlock.data = { facts };
    factsBlock.content_digest = canonicalInputDigest({ facts });
    invocation.input_snapshot.fact_snapshot_digest = canonicalInputDigest(facts);
    const model = adapter([providerCandidate, providerCandidate]);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const completion = await new ResumeInferenceBroker(
      async () => provider(model.value),
      (event, details) => events.push({ event, details }),
    ).execute(invocation);
    expect(completion.inference).toMatchObject({ status: "failed", result: null, error: { code: "evidence_validation_failed" } });
    expect(events.at(-1)?.details).toMatchObject({
      targeted_fact_repair_disposition: "rejected",
      full_general_constructor_validator_codes: ["schema_invalid"],
      full_general_constructor_disposition: "schema_rejected",
      recovery_disposition: "recovery_rejected",
    });
  });

  it("excludes one omitted evidence unit from a partially retained grouped bullet", () => {
    for (const fixture of [SPEC_10_DENSE_CORPUS, SPEC_10_HOLDOUT_CORPUS].map((candidate) => permuteSpec10Fixture(candidate, 7))) {
      const invocation = request(fixture);
      const groupedEvidenceIds = fixture.coverage
        .flatMap((coverage) => Object.values(coverage.dimensions))
        .find((dimension) => dimension.evidence_revision_ids.length > 1)!.evidence_revision_ids;
      const omittedId = groupedEvidenceIds[0]!;
      const retainedId = groupedEvidenceIds[1]!;
      const omittedText = fixture.facts.find((fact) => fact.revision_id === omittedId)!.value;
      const strategyBlock = invocation.data_blocks.find((candidate) => candidate.category === "resume_strategy")!;
      const strategy = structuredClone(strategyBlock.data as {
        evidence_priorities: Array<{ fact_revision_id: string; priority: string }>;
        omissions: Array<{ fact_revision_id: string; reason_code: string }>;
      });
      strategy.evidence_priorities = strategy.evidence_priorities.filter((entry) => entry.fact_revision_id !== omittedId);
      strategy.omissions = [{ fact_revision_id: omittedId, reason_code: "space" }];
      strategyBlock.data = strategy;
      strategyBlock.content_digest = canonicalInputDigest(strategy);

      const draft = deterministicDraft(invocation);
      expect(draft.omissions).toContainEqual({ fact_revision_id: omittedId, reason_code: "space" });
      expect(draft.statements.some((statement) => statement.supporting_confirmed_fact_revision_ids.includes(omittedId))).toBe(false);
      expect(draft.statements.some((statement) => statement.text.includes(omittedText))).toBe(false);
      expect(draft.statements.some((statement) => statement.supporting_confirmed_fact_revision_ids.includes(retainedId))).toBe(true);
      expect(validateInferenceClaims("general_resume_draft", draft, invocation.data_blocks)).toMatchObject({ accepted: true, findings: [] });
    }
  });

  it("is stable across fixture permutations and coalesces an equivalent concurrent operation", async () => {
    for (const fixture of [SPEC_10_DENSE_CORPUS, SPEC_10_HOLDOUT_CORPUS]) {
      const digests = [0, 1, 7, 19].map((seed) => {
        const invocation = request(permuteSpec10Fixture(fixture, seed));
        const draft = deterministicDraft(invocation);
        const validation = validateInferenceClaims("general_resume_draft", draft, invocation.data_blocks);
        expect(validation.accepted, JSON.stringify({ findings: validation.findings, draft })).toBe(true);
        return canonicalInputDigest(draft);
      });
      expect(new Set(digests).size).toBe(1);
    }

    const invocation = request(SPEC_10_DENSE_CORPUS);
    const output = providerDraft(invocation);
    let release!: () => void;
    const delayed = adapter([async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return output;
    }]);
    const broker = new ResumeInferenceBroker(async () => provider(delayed.value));
    const first = broker.execute(invocation);
    const duplicate = broker.execute(structuredClone(invocation));
    await vi.waitFor(() => expect(delayed.calls()).toBe(1));
    release();
    const [firstCompletion, duplicateCompletion] = await Promise.all([first, duplicate]);
    expect(duplicateCompletion).toEqual(firstCompletion);
    expect(delayed.calls()).toBe(1);
    expect(delayed.maximumActive()).toBe(1);
  });

  it("rejects stale immutable input before provider resolution", async () => {
    const invocation = request(SPEC_10_DENSE_CORPUS);
    invocation.input_snapshot.fact_snapshot_digest = `sha256:${"0".repeat(64)}`;
    const resolveProvider = vi.fn(async () => provider(adapter([providerDraft(request(SPEC_10_DENSE_CORPUS))]).value));
    await expect(new ResumeInferenceBroker(resolveProvider).execute(invocation)).rejects.toMatchObject({ code: "invalid_request" });
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("discards a late cancelled dense response and replays a completed response without new spend", async () => {
    const cancellationRequest = request(SPEC_10_DENSE_CORPUS);
    const output = providerDraft(cancellationRequest);
    let release!: () => void;
    const delayed = adapter([async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return output;
    }]);
    const cancellationBroker = new ResumeInferenceBroker(async () => provider(delayed.value));
    const pending = cancellationBroker.execute(cancellationRequest);
    await vi.waitFor(() => expect(delayed.calls()).toBe(1));
    expect(cancellationBroker.cancel(cancellationRequest.operation_id)).toBe(true);
    release();
    await expect(pending).resolves.toMatchObject({ inference: { status: "cancelled", result: null, error: { code: "cancelled" } } });
    expect(delayed.calls()).toBe(1);

    const replayRequest = request(SPEC_10_HOLDOUT_CORPUS);
    const replayModel = adapter([providerDraft(replayRequest)]);
    const replayBroker = new ResumeInferenceBroker(async () => provider(replayModel.value));
    const completed = await replayBroker.execute(replayRequest);
    const replayed = await replayBroker.execute({ ...structuredClone(replayRequest), request_id: randomUUID() });
    expect(replayed).toEqual(completed);
    expect(replayModel.calls()).toBe(1);
  });

  it.each([
    ["dense", SPEC_10_DENSE_CORPUS],
    ["holdout", SPEC_10_HOLDOUT_CORPUS],
  ] as const)("persists and reads back one exact unapproved %s recovery proposal", async (_name, fixture) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-spec10-general-store-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const inferenceGrant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    await store.initialize(inferenceGrant.owner_id);
    const service = new ResumeDomainService(store);
    const revisionByFixtureId = new Map<string, string>();
    const persistFact = async (factKind: Spec10SyntheticFixture["facts"][number]["fact_kind"], value: string) => {
      const proposed = await service.proposeFact({
        ...proposalInput(value),
        fact: { ...proposalInput().fact, fact_kind: factKind, value },
      }, authority("career.facts.propose"));
      const confirmationAuthority = authority("career.facts.confirm");
      return (await service.confirmFact({
        fact_record_id: proposed.fact.metadata.record_id,
        fact_revision_id: proposed.fact.metadata.revision_id,
        expected_revision: proposed.fact.metadata.revision,
        decision: "accept",
        edited_value: null,
        review_note: null,
      }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id))).fact;
    };

    for (const fact of fixture.facts.filter((candidate) => candidate.fact_kind !== "job_evidence")) {
      const persisted = await persistFact(fact.fact_kind, fact.value);
      revisionByFixtureId.set(fact.revision_id, persisted.metadata.revision_id);
    }
    for (const fact of fixture.facts.filter((candidate) => candidate.fact_kind === "job_evidence")) {
      const jobId = revisionByFixtureId.get(fact.job_fact_revision_id!);
      if (!jobId || !fact.dimension) throw new Error("Spec 10 job evidence fixture association is incomplete");
      const value = JSON.stringify({
        value_version: 1,
        association: "job",
        job_fact_revision_id: jobId,
        dimension: fact.dimension,
        outcome: "answered",
        owner_text: fact.value,
      });
      const persisted = await persistFact("job_evidence", value);
      revisionByFixtureId.set(fact.revision_id, persisted.metadata.revision_id);
    }

    const coverageRevisionIds: string[] = [];
    for (const coverageFixture of fixture.coverage) {
      const jobId = revisionByFixtureId.get(coverageFixture.job_fact_revision_id);
      if (!jobId) throw new Error("Spec 10 coverage job fixture association is incomplete");
      let coverage = (await service.writeJobEvidenceCoverage({ action: "initialize", job_fact_revision_id: jobId }, authority("resume.definitions.write"))).coverage;
      for (const [dimension, disposition] of Object.entries(coverageFixture.dimensions)) {
        const evidenceRevisionIds = disposition.evidence_revision_ids.map((id) => revisionByFixtureId.get(id)!);
        coverage = (await service.writeJobEvidenceCoverage({
          action: "record",
          coverage_record_id: coverage.metadata.record_id,
          expected_revision: coverage.metadata.revision,
          job_fact_revision_id: jobId,
          dimension,
          state: disposition.outcome === "answered" ? "answered" : "unknown",
          evidence_revision_ids: evidenceRevisionIds,
          opportunity: null,
        }, authority("resume.definitions.write"))).coverage;
      }
      coverageRevisionIds.push(coverage.metadata.revision_id);
    }

    const factRevisionIds = fixture.facts.map((fact) => revisionByFixtureId.get(fact.revision_id)!);
    const snapshotBuilder = new ImmutableInferenceSnapshotBuilder(store, () => new Date("2026-08-15T12:00:00.000Z"));
    const strategyRequest = await snapshotBuilder.build({
      inference_contract_version: 1,
      purpose: "resume_strategy",
      operation_id: randomUUID(),
      fact_revision_ids: factRevisionIds,
      record_revision_ids: coverageRevisionIds,
    }, inferenceGrant);
    const strategyResult = synthesizeResumeE2eResult("resume_strategy", strategyRequest.data_blocks);
    const strategy = ResumeStrategyRecordSchema.parse((await service.writeResumeStrategy({
      kind: "resume_strategy",
      fact_revision_ids: factRevisionIds,
      coverage_revision_ids: coverageRevisionIds,
      target_revision_id: null,
      presentation_preferences: {},
      strategy: strategyResult,
      inference_binding: {
        prompt_policy_id: strategyRequest.prompt_policy_id,
        prompt_policy_version: strategyRequest.prompt_policy_version,
        input_digest: canonicalInputDigest(strategyRequest.data_blocks),
        output_digest: canonicalInputDigest(strategyResult),
        provider_profile_id: "synthetic-owner-profile",
        model_id: "synthetic-model",
      },
    }, authority("resume.definitions.write"))).strategy);

    const before = {
      facts: canonicalInputDigest(await store.list("career_fact")),
      coverage: canonicalInputDigest(await store.list("job_evidence_coverage")),
      strategy: canonicalInputDigest(await store.list("resume_strategy")),
      definitions: canonicalInputDigest(await store.list("resume_definition")),
    };
    const generalInvocation = {
      inference_contract_version: 1,
      purpose: "general_resume_draft" as const,
      operation_id: randomUUID(),
      fact_revision_ids: factRevisionIds,
      record_revision_ids: [...coverageRevisionIds, strategy.metadata.revision_id],
      semantic_binding: {
        semantic_binding_version: 1 as const,
        strategy_revision_id: strategy.metadata.revision_id,
        provider_profile_id: strategy.provider_profile_id,
        model_id: strategy.model_id,
      },
    };
    const { semantic_binding: _missingBinding, ...missingBindingInvocation } = generalInvocation;
    await expect(snapshotBuilder.build(missingBindingInvocation, inferenceGrant))
      .resolves.toMatchObject({ purpose: "general_resume_draft" });
    await expect(snapshotBuilder.build({
      ...generalInvocation,
      operation_id: randomUUID(),
      semantic_binding: { ...generalInvocation.semantic_binding, strategy_revision_id: randomUUID() },
    }, inferenceGrant)).rejects.toMatchObject({ code: "validation_failed" });
    await expect(snapshotBuilder.build({
      ...generalInvocation,
      operation_id: randomUUID(),
      semantic_binding: { ...generalInvocation.semantic_binding, provider_profile_id: "forged-provider" },
    }, inferenceGrant)).rejects.toMatchObject({ code: "validation_failed" });
    await expect(snapshotBuilder.build({
      ...generalInvocation,
      operation_id: randomUUID(),
      semantic_binding: { ...generalInvocation.semantic_binding, model_id: "stale-model" },
    }, inferenceGrant)).rejects.toMatchObject({ code: "validation_failed" });
    const generalRequest = await snapshotBuilder.build(generalInvocation, inferenceGrant);
    const invalid = unsupportedDraft(generalRequest, true);
    const model = adapter([invalid, invalid]);
    const completion = await new ResumeInferenceBroker(
      async () => provider(model.value),
      () => undefined,
      () => new Date(FIXED_TIME),
    ).execute(generalRequest);
    expect(completion.inference).toMatchObject({
      status: "completed",
      attempt_count: 2,
      provider_profile_id: "synthetic-owner-profile",
      model_id: "synthetic-model",
      outcome: { completion_mode: "deterministic_fallback" },
    });
    expect(completion.validation).toMatchObject({ accepted: true, findings: [] });
    expect(model.calls()).toBe(2);
    const generationResult = completion.inference.result as Draft;
    const usedIds = new Set(generationResult.statements.flatMap((statement) => statement.supporting_confirmed_fact_revision_ids));
    const usedMustUseFactRevisionIds = strategy.evidence_priorities
      .filter((entry) => entry.priority === "must_use" && usedIds.has(entry.fact_revision_id))
      .map((entry) => entry.fact_revision_id)
      .sort();
    const binding = {
      binding_version: 1 as const,
      strategy_revision_id: strategy.metadata.revision_id,
      fact_snapshot_digest: strategy.fact_snapshot_digest,
      fact_revision_ids: strategy.fact_revision_ids,
      coverage_revision_ids: strategy.coverage_revision_ids,
      strategy_input_digest: strategy.input_digest,
      strategy_output_digest: strategy.output_digest,
      generation_input_digest: canonicalInputDigest(generalRequest.data_blocks),
      generation_output_digest: canonicalInputDigest(generationResult),
      prompt_policy_id: strategy.prompt_policy_id,
      prompt_policy_version: strategy.prompt_policy_version,
      quality_standard_id: RESUME_QUALITY_STANDARD_ID,
      quality_standard_version: RESUME_QUALITY_STANDARD_VERSION,
      quality_standard_digest: RESUME_QUALITY_STANDARD_DIGEST,
      provider_profile_id: strategy.provider_profile_id,
      model_id: strategy.model_id,
      used_must_use_fact_revision_ids: usedMustUseFactRevisionIds,
      omissions: generationResult.omissions,
    };
    const persistenceAuthority = authority("resume.definitions.write");
    const written = await service.writeDefinition(definitionInput(factRevisionIds[0]!, {
      status: "proposed",
      title: generationResult.title,
      statements: generationResult.statements,
      section_order: generationResult.section_order,
      prompt_policy_version: strategy.prompt_policy_version,
      strategy_binding: binding,
      generation_result: generationResult,
    }), persistenceAuthority);
    const readback = await store.readRevision(written.definition.metadata.revision_id);
    expect(readback).toMatchObject({
      record_type: "resume_definition",
      status: "proposed",
      strategy_binding: {
        strategy_revision_id: strategy.metadata.revision_id,
        generation_output_digest: canonicalInputDigest(generationResult),
        provider_profile_id: "synthetic-owner-profile",
        model_id: "synthetic-model",
      },
    });
    expect(validateInferenceClaims("general_resume_draft", generationResult, generalRequest.data_blocks)).toMatchObject({ accepted: true, findings: [] });
    expect(canonicalInputDigest(await store.list("career_fact"))).toBe(before.facts);
    expect(canonicalInputDigest(await store.list("job_evidence_coverage"))).toBe(before.coverage);
    expect(canonicalInputDigest(await store.list("resume_strategy"))).toBe(before.strategy);
    expect((await store.list("resume_definition")).filter((record) => record.record_type === "resume_definition" && record.status === "proposed")).toHaveLength(1);
    expect((await store.list("resume_definition")).filter((record) => record.record_type === "resume_definition" && record.status === "approved")).toHaveLength(0);

    await expect(service.writeDefinition(definitionInput(factRevisionIds[0]!, {
      status: "proposed",
      title: `${generationResult.title} changed`,
      statements: generationResult.statements,
      section_order: generationResult.section_order,
      prompt_policy_version: strategy.prompt_policy_version,
      strategy_binding: binding,
      generation_result: generationResult,
    }), persistenceAuthority)).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect((await store.list("resume_definition")).filter((record) => record.record_type === "resume_definition")).toHaveLength(1);
    expect(before.definitions).not.toBe(canonicalInputDigest(await store.list("resume_definition")));
  }, 90_000);
});
