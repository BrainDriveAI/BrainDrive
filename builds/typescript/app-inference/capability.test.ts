import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { AppInferenceEventSchema, AppInferenceRequestSchema } from "../app-platform/contracts/spec-05-foundation.js";
import { ResumeInferenceRetryAuditDetailsSchema } from "../app-platform/contracts/audit.js";
import { PURPOSE_LIMITS, PURPOSE_OUTPUT_SCHEMAS } from "../app-platform/contracts/inference.js";
import { CapabilityOperationCoordinator } from "../app-capabilities/operations.js";
import { testGrant } from "../resume-domain/test-helpers.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "../resume-inference/policy.js";
import { ResumeAppInferenceAdapter, buildProtectedInferenceRequest } from "./resume-adapter.js";
import { AppInferencePurposeRegistry } from "./registry.js";
import { AppInferenceDispatcher } from "./dispatcher.js";
import { z } from "zod";

const FACTS = { facts: [] };

function invocation(operationId = randomUUID()) {
  return { inference_contract_version: 1 as const, purpose: "interview_assist" as const, operation_id: operationId, fact_revision_ids: [] };
}

const STRATEGY_REVISION_ID = "10000000-0000-4000-8000-000000000010";
const GENERAL_BINDING = {
  semantic_binding_version: 1 as const,
  strategy_revision_id: STRATEGY_REVISION_ID,
  provider_profile_id: "owner-profile",
  model_id: "owner-model",
};

function generalInvocation(operationId = randomUUID(), retryLineage?: Record<string, unknown>) {
  return {
    inference_contract_version: 1 as const,
    purpose: "general_resume_draft" as const,
    operation_id: operationId,
    fact_revision_ids: [],
    record_revision_ids: [STRATEGY_REVISION_ID],
    semantic_binding: GENERAL_BINDING,
    ...(retryLineage ? { retry_lineage: retryLineage } : {}),
  };
}

function internalRequest(operationId: string) {
  const requestedAt = "2026-08-07T12:00:00.000Z";
  return {
    inference_schema_version: 1 as const,
    request_id: randomUUID(),
    owner_id: randomUUID(),
    actor_id: randomUUID(),
    app_id: "ai.braindrive.resume-builder" as const,
    installation_id: randomUUID(),
    operation_id: operationId,
    grant_id: randomUUID(),
    purpose: "interview_assist" as const,
    input_snapshot: { fact_snapshot_revision: 1, fact_snapshot_digest: canonicalInputDigest([]), record_revision_ids: [] },
    data_blocks: [{ category: "confirmed_fact_snapshot" as const, content_digest: canonicalInputDigest(FACTS), schema_id: "resume.confirmed-facts.v1", schema_version: 1, data: FACTS }],
    prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS.interview_assist,
    output_schema_version: 1 as const,
    capability_requirements: { text_generation: true as const, complete_structured_json: true as const, minimum_context_tokens: PURPOSE_LIMITS.interview_assist.input_tokens, model_tools: false as const },
    limits: PURPOSE_LIMITS.interview_assist,
    requested_at: requestedAt,
    deadline_at: "2026-08-07T12:01:00.000Z",
  };
}

function authority(operationId: string, idempotencyKey: string) {
  const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
  return {
    authority_version: 1 as const,
    grant_id: grant.grant_id,
    grant_revision: grant.grant_revision,
    revocation_generation: grant.revocation_generation,
    token_id: randomUUID(),
    token_generation: 1,
    owner_id: grant.owner_id,
    actor_id: grant.actor_id,
    app_id: grant.app_id,
    publisher_id: grant.publisher_id,
    package_digest: grant.package_digest,
    installation_id: grant.installation_id,
    connection_id: randomUUID(),
    view_id: randomUUID(),
    operation_id: operationId,
    audience: "app_inference" as const,
    capabilities: ["app.inference.request" as const],
    record_scopes: grant.record_scopes,
    idempotency_key: idempotencyKey,
    issued_at: "2026-08-07T12:00:00.000Z",
    expires_at: "2026-08-07T12:05:00.000Z",
  };
}

describe("M5 protected app inference capability", () => {
  it("accepts owner retry lineage only from an observed equivalent terminal evidence failure", async () => {
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    const firstOperationId = randomUUID();
    const secondOperationId = randomUUID();
    const inputDigest = canonicalInputDigest(FACTS);
    const build = vi.fn(async (input: { operation_id: string }) => ({
      ...internalRequest(input.operation_id),
      purpose: "general_resume_draft" as const,
      output_schema_id: PURPOSE_OUTPUT_SCHEMAS.general_resume_draft,
    }));
    const execute = vi.fn(async (request: ReturnType<typeof internalRequest>) => ({
      inference: {
        ...request,
        status: "failed" as const,
        input_digest: inputDigest,
        output_digest: null,
        result: null,
        provider_profile_id: "owner-profile",
        model_id: "owner-model",
        attempt_count: 2,
        usage: { available: false, input_tokens: null, output_tokens: null },
        error: { code: "evidence_validation_failed" as const, safe_message: "Safe evidence failure", retryable: false },
        outcome: {
          stage: "recovery" as const,
          finish_category: "stop" as const,
          attempt_count: 2,
          retryable: false,
          recovery_class: "none" as const,
          completion_mode: "none" as const,
          final_disposition: "failed" as const,
        },
        started_at: "2026-08-07T12:00:00.000Z",
        completed_at: "2026-08-07T12:00:01.000Z",
      },
      validation: null,
    }));
    const capability = new ResumeAppInferenceAdapter({
      snapshotBuilder: { build: build as never },
      broker: { execute: execute as never, cancel: vi.fn() },
      operations: new CapabilityOperationCoordinator({ now: () => Date.parse("2026-08-07T12:00:00.000Z") }),
    });
    const context = (operationId: string) => ({
      authority: authority(operationId, `m5-inference-${operationId}`),
      grant,
      operationId,
      idempotencyKey: `m5-inference-${operationId}`,
      deadlineAt: Date.parse("2026-08-07T12:01:00.000Z"),
    });
    const first = await capability.execute(generalInvocation(firstOperationId), context(firstOperationId)) as {
      error: { recovery_contract: { semantic_input_digest: string } };
    };
    expect(first.error.recovery_contract.semantic_input_digest).toBe(inputDigest);
    const lineage = {
      retry_lineage_version: 1,
      reason: "owner_initiated_retry",
      prior_operation_id: firstOperationId,
      prior_input_digest: inputDigest,
      strategy_revision_id: STRATEGY_REVISION_ID,
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
    };
    const second = await capability.execute(generalInvocation(secondOperationId, lineage), context(secondOperationId)) as {
      retry_lineage: { equivalent: boolean; prior_operation_id: string; operation_id: string };
      error: { recovery_contract: { emphasized_action: string } };
    };
    expect(second.retry_lineage).toMatchObject({ equivalent: true, prior_operation_id: firstOperationId, operation_id: secondOperationId });
    expect(second.error.recovery_contract.emphasized_action).toBe("review_confirmed_evidence");
    expect(execute).toHaveBeenCalledTimes(2);

    for (const unobserved of [
      { ...lineage, prior_operation_id: randomUUID() },
      { ...lineage, prior_input_digest: canonicalInputDigest("forged") },
    ]) {
      const operationId = randomUUID();
      const result = await capability.execute(generalInvocation(operationId, unobserved), context(operationId)) as {
        retry_lineage: { equivalent: boolean };
        error: { recovery_contract: { emphasized_action: string } };
      };
      expect(result.retry_lineage.equivalent).toBe(false);
      expect(result.error.recovery_contract.emphasized_action).toBe("try_again");
    }
    expect(execute).toHaveBeenCalledTimes(4);

    for (const forgedBinding of [
      { ...lineage, strategy_revision_id: randomUUID() },
      { ...lineage, provider_profile_id: "forged-provider" },
      { ...lineage, model_id: "forged-model" },
    ]) {
      const operationId = randomUUID();
      await expect(capability.execute(generalInvocation(operationId, forgedBinding), context(operationId)))
        .rejects.toMatchObject({ code: expect.stringMatching(/invalid_input|invalid_request/) });
    }
    expect(execute).toHaveBeenCalledTimes(4);

    for (let index = 0; index < 65; index += 1) {
      const operationId = randomUUID();
      await capability.execute(generalInvocation(operationId), context(operationId));
    }
    const afterEvictionOperationId = randomUUID();
    const afterEviction = await capability.execute(
      generalInvocation(afterEvictionOperationId, lineage),
      context(afterEvictionOperationId),
    ) as { retry_lineage: { equivalent: boolean }; error: { recovery_contract: { emphasized_action: string } } };
    expect(afterEviction.retry_lineage.equivalent).toBe(false);
    expect(afterEviction.error.recovery_contract.emphasized_action).toBe("try_again");
    expect(execute).toHaveBeenCalledTimes(70);

    const restartedCapability = new ResumeAppInferenceAdapter({
      snapshotBuilder: { build: build as never },
      broker: { execute: execute as never, cancel: vi.fn() },
      operations: new CapabilityOperationCoordinator({ now: () => Date.parse("2026-08-07T12:00:00.000Z") }),
    });
    const afterRestartOperationId = randomUUID();
    const afterRestart = await restartedCapability.execute(
      generalInvocation(afterRestartOperationId, lineage),
      context(afterRestartOperationId),
    ) as { retry_lineage: { equivalent: boolean }; error: { recovery_contract: { emphasized_action: string } } };
    expect(afterRestart.retry_lineage.equivalent).toBe(false);
    expect(afterRestart.error.recovery_contract.emphasized_action).toBe("try_again");
    expect(execute).toHaveBeenCalledTimes(71);
  });

  it("rebuilds safe repeat evidence from a durable projected replay after adapter restart", async () => {
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    const firstOperationId = randomUUID();
    const secondOperationId = randomUUID();
    const inputDigest = canonicalInputDigest(FACTS);
    const build = vi.fn(async (input: { operation_id: string }) => ({
      ...internalRequest(input.operation_id),
      purpose: "general_resume_draft" as const,
      output_schema_id: PURPOSE_OUTPUT_SCHEMAS.general_resume_draft,
    }));
    const execute = vi.fn(async (request: ReturnType<typeof internalRequest>) => ({
      inference: {
        ...request,
        status: "failed" as const,
        input_digest: inputDigest,
        output_digest: null,
        result: null,
        provider_profile_id: "owner-profile",
        model_id: "owner-model",
        attempt_count: 2,
        usage: { available: false, input_tokens: null, output_tokens: null },
        error: { code: "evidence_validation_failed" as const, safe_message: "Safe evidence failure", retryable: false },
        outcome: {
          stage: "recovery" as const,
          finish_category: "stop" as const,
          attempt_count: 2,
          retryable: false,
          recovery_class: "none" as const,
          completion_mode: "none" as const,
          final_disposition: "failed" as const,
        },
        started_at: "2026-08-07T12:00:00.000Z",
        completed_at: "2026-08-07T12:00:01.000Z",
      },
      validation: null,
    }));
    const persisted = new Map<string, unknown>();
    const persistResult = async <T>(key: string, _input: unknown, action: () => Promise<T>): Promise<T> => {
      if (persisted.has(key)) return persisted.get(key) as T;
      const value = await action();
      persisted.set(key, value);
      return value;
    };
    const audit = vi.fn();
    const createAdapter = () => new ResumeAppInferenceAdapter({
      snapshotBuilder: { build: build as never },
      broker: { execute: execute as never, cancel: vi.fn() },
      persistResult,
      audit,
      operations: new CapabilityOperationCoordinator({ now: () => Date.parse("2026-08-07T12:00:00.000Z") }),
    });
    const context = (operationId: string) => ({
      authority: authority(operationId, `m5-inference-${operationId}`),
      grant,
      operationId,
      idempotencyKey: `m5-inference-${operationId}`,
      deadlineAt: Date.parse("2026-08-07T12:01:00.000Z"),
    });
    await createAdapter().execute(generalInvocation(firstOperationId), context(firstOperationId));
    expect(execute).toHaveBeenCalledTimes(1);

    const restarted = createAdapter();
    await restarted.execute(generalInvocation(firstOperationId), context(firstOperationId));
    expect(execute).toHaveBeenCalledTimes(1);
    const second = await restarted.execute({ ...generalInvocation(secondOperationId, {
      retry_lineage_version: 1,
      reason: "owner_initiated_retry",
      prior_operation_id: firstOperationId,
      prior_input_digest: inputDigest,
      strategy_revision_id: STRATEGY_REVISION_ID,
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
    }), presentation_preferences: { owner_note: "SENSITIVE_OWNER_TEXT_CANARY" } }, context(secondOperationId)) as {
      retry_lineage: { equivalent: boolean };
      error: { recovery_contract: { emphasized_action: string } };
    };
    expect(second.retry_lineage.equivalent).toBe(true);
    expect(second.error.recovery_contract.emphasized_action).toBe("review_confirmed_evidence");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toBe("app.inference.owner_retry");
    expect(ResumeInferenceRetryAuditDetailsSchema.parse(audit.mock.calls[0]?.[1])).toEqual({
      diagnostic_version: 1,
      retry_relation_version: 1,
      retry_reason: "owner_initiated_retry",
      retry_prior_operation_id: firstOperationId,
      retry_new_operation_id: secondOperationId,
      retry_semantic_input_digest: inputDigest,
      retry_strategy_revision_id: STRATEGY_REVISION_ID,
      retry_provider_profile_id: "owner-profile",
      retry_model_id: "owner-model",
      retry_equivalent: true,
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain("SENSITIVE_OWNER_TEXT_CANARY");
  });
  it("constructs the frozen protected request with no tools or fallback and exact authority", () => {
    const operationId = randomUUID();
    const idempotencyKey = `m5-inference-${operationId}`;
    const request = buildProtectedInferenceRequest(invocation(operationId), internalRequest(operationId), authority(operationId, idempotencyKey));
    expect(AppInferenceRequestSchema.parse(request)).toMatchObject({ inference_contract_version: 1, operation_id: operationId, tools: false, allow_provider_fallback: false });
    expect(request.authority).toMatchObject({ audience: "app_inference", capabilities: ["app.inference.request"], operation_id: operationId, idempotency_key: idempotencyKey });
    expect(request.budget).toEqual({ input_bytes: 65_536, input_tokens: 16_384, output_tokens: 2_048, duration_ms: 60_000, attempts: 2 });
    expect(request).not.toHaveProperty("provider");
    expect(request).not.toHaveProperty("model");
    expect(request).not.toHaveProperty("endpoint");
    expect(request).not.toHaveProperty("api_key");
  });

  it("coalesces duplicate and reconnect operations into one broker spend and conflicts on changed input", async () => {
    const operationId = randomUUID();
    const idempotencyKey = `m5-inference-${operationId}`;
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    const build = vi.fn(async () => internalRequest(operationId));
    const execute = vi.fn(async () => ({
      inference: {
        ...internalRequest(operationId), status: "completed" as const, input_digest: canonicalInputDigest(FACTS), output_digest: canonicalInputDigest({ questions: [] }),
        result: { questions: [] }, provider_profile_id: "owner-profile", model_id: "owner-model", attempt_count: 1,
        usage: { available: true, input_tokens: 11, output_tokens: 3 }, error: null, started_at: "2026-08-07T12:00:00.000Z", completed_at: "2026-08-07T12:00:01.000Z",
      },
      validation: null,
    }));
    const capability = new ResumeAppInferenceAdapter({ snapshotBuilder: { build }, broker: { execute, cancel: vi.fn() }, operations: new CapabilityOperationCoordinator({ now: () => Date.parse("2026-08-07T12:00:00.000Z") }) });
    const context = { authority: authority(operationId, idempotencyKey), grant, operationId, idempotencyKey, deadlineAt: Date.parse("2026-08-07T12:01:00.000Z") };
    const [first, duplicate] = await Promise.all([capability.execute(invocation(operationId), context), capability.execute(invocation(operationId), context)]);
    expect(duplicate).toEqual(first);
    expect(build).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      inference_contract_version: 1,
      status: "completed",
      model_class: "owner_active_compatible",
      prompt_policy_id: "braindrive.resume-builder.fixed",
      prompt_policy_version: "12",
      input_digest: canonicalInputDigest(FACTS),
      output_digest: canonicalInputDigest({ questions: [] }),
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
      usage: { available: true },
      events: [{ event: "progress" }, { event: "completed" }],
    });
    expect((first as { events: unknown[] }).events.every((event) => AppInferenceEventSchema.safeParse(event).success)).toBe(true);
    const visible = JSON.stringify(first);
    for (const forbidden of ["api_key", "endpoint", "prompt_body", "authorization", "secret_ref"]) expect(visible).not.toContain(forbidden);
    await expect(capability.execute({ ...invocation(operationId), presentation_preferences: { locale: "fr" } }, context)).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("denies an inexact grant before snapshot/provider work and projects actionable typed failures", async () => {
    const operationId = randomUUID();
    const idempotencyKey = `m5-inference-${operationId}`;
    const validGrant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    const build = vi.fn(async () => internalRequest(operationId));
    const execute = vi.fn(async () => ({
      inference: {
        ...internalRequest(operationId), status: "rejected_incompatible" as const, input_digest: canonicalInputDigest(FACTS), output_digest: null,
        result: null, provider_profile_id: null, model_id: null, attempt_count: 0,
        usage: { available: false, input_tokens: null, output_tokens: null },
        error: { code: "model_incompatible" as const, safe_message: "The active model is not qualified", retryable: false },
        started_at: "2026-08-07T12:00:00.000Z", completed_at: "2026-08-07T12:00:01.000Z",
      },
      validation: null,
    }));
    const capability = new ResumeAppInferenceAdapter({ snapshotBuilder: { build }, broker: { execute, cancel: vi.fn() }, operations: new CapabilityOperationCoordinator({ now: () => Date.parse("2026-08-07T12:00:00.000Z") }) });
    const base = { authority: authority(operationId, idempotencyKey), operationId, idempotencyKey, deadlineAt: Date.parse("2026-08-07T12:01:00.000Z") };
    await expect(capability.execute(invocation(operationId), { ...base, grant: testGrant() })).rejects.toMatchObject({ code: "denied" });
    expect(build).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    const failure = await capability.execute(invocation(operationId), { ...base, grant: validGrant });
    expect(failure).toMatchObject({
      status: "rejected_incompatible",
      model_class: null,
      provider_profile_id: null,
      model_id: null,
      error: { code: "model_incompatible", retryable: false, recovery: "open_model_settings" },
      events: [{ event: "progress" }, { event: "failed", error: { code: "model_incompatible" } }],
    });
  });

  it("does not return a completion when durable terminal persistence fails", async () => {
    const operationId = randomUUID();
    const idempotencyKey = `m5-inference-${operationId}`;
    const grant = testGrant({ capabilities: [...testGrant().capabilities, "app.inference.request"] });
    const request = internalRequest(operationId);
    const build = vi.fn(async () => request);
    const execute = vi.fn(async () => ({
      inference: {
        ...request, status: "completed" as const, input_digest: canonicalInputDigest(FACTS), output_digest: canonicalInputDigest({ questions: [] }),
        result: { questions: [] }, provider_profile_id: "owner-profile", model_id: "owner-model", attempt_count: 1,
        usage: { available: false, input_tokens: null, output_tokens: null }, error: null,
        started_at: "2026-08-07T12:00:00.000Z", completed_at: "2026-08-07T12:00:01.000Z",
      },
      validation: null,
    }));
    const persistResult = vi.fn(async (_key: string, _input: unknown, action: () => Promise<unknown>) => {
      await action();
      throw new Error("synthetic atomic persistence failure");
    });
    const capability = new ResumeAppInferenceAdapter({ snapshotBuilder: { build }, broker: { execute, cancel: vi.fn() }, persistResult, operations: new CapabilityOperationCoordinator({ now: () => Date.parse("2026-08-07T12:00:00.000Z") }) });
    await expect(capability.execute(invocation(operationId), {
      authority: authority(operationId, idempotencyKey), grant, operationId, idempotencyKey,
      deadlineAt: Date.parse("2026-08-07T12:01:00.000Z"),
    })).rejects.toThrow("synthetic atomic persistence failure");
    expect(build).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(persistResult).toHaveBeenCalledTimes(1);
  });

  it("dispatches only an exact independently registered app purpose before executor work", async () => {
    const executor = vi.fn(async (input: { source: string }) => ({ summary: input.source }));
    const registry = new AppInferencePurposeRegistry([{
      appId: "ai.braindrive.brief-builder",
      purposeId: "brief.generate",
      version: 1,
      inputSchema: z.object({ source: z.string().min(1).max(1_000) }).strict(),
      outputSchema: z.object({ summary: z.string().min(1).max(1_000) }).strict(),
      promptPolicyId: "brief.generate.fixed",
      modelCompatibilityClass: "owner_active_compatible",
      limits: { maxInputBytes: 4_096, maxInputTokens: 1_024, maxOutputTokens: 512, maxDurationMs: 10_000, maxAttempts: 1 },
      validationPolicyId: "brief.grounding.v1",
      retryPolicy: "same_snapshot_only",
      cancellationPolicy: "required",
      auditProjectionId: "brief.generate.audit.v1",
      ownerComponentId: "brief.inference",
      executor,
    }]);
    expect(() => new AppInferencePurposeRegistry([{ ...registry.resolve("ai.braindrive.brief-builder", "brief.generate", 1), promptPolicyId: "" }]))
      .toThrowError(expect.objectContaining({ code: "descriptor_invalid" }));
    const audit = vi.fn();
    const dispatcher = new AppInferenceDispatcher(registry, Date.now, audit);
    const context = {
      appId: "ai.braindrive.brief-builder",
      installationId: "00000000-0000-4000-8000-000000000103",
      packageDigest: `sha256:${"b".repeat(64)}` as const,
      requestedPurposes: [{ purpose_id: "brief.generate", version: 1 }],
      grant: {
        app_id: "ai.braindrive.brief-builder", installation_id: "00000000-0000-4000-8000-000000000103",
        package_digest: `sha256:${"b".repeat(64)}` as const, capabilities: ["app.inference.request"],
        revoked_at: null, expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      operationId: crypto.randomUUID(),
      idempotencyKey: "testtesttesttest01",
      deadlineAt: Date.now() + 10_000,
    };
    await expect(dispatcher.execute({ purpose_id: "brief.generate", version: 1, input: { source: "Synthetic source" } }, context))
      .resolves.toEqual({ summary: "Synthetic source" });
    await expect(dispatcher.execute({ purpose_id: "brief.generate", version: 1, input: { source: "Synthetic source" } }, { ...context, appId: "ai.braindrive.resume-builder" }))
      .rejects.toMatchObject({ code: "denied" });
    await expect(dispatcher.execute({ purpose_id: "brief.generate", version: 2, input: { source: "Synthetic source" } }, context))
      .rejects.toMatchObject({ code: "incompatible_schema" });
    await expect(dispatcher.execute({ purpose_id: "brief.generate", version: 1, input: { source: "Synthetic source" } }, { ...context, grant: { ...context.grant, capabilities: [] } }))
      .rejects.toMatchObject({ code: "denied" });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await dispatcher.execute({ purpose_id: "brief.generate", version: 1, input: { source: "Second" } }, { ...context, operationId: crypto.randomUUID(), idempotencyKey: "testtesttesttest02" })))
      .not.toMatch(/provider_profile_id|model_id|api_key|credential|endpoint/);
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/Synthetic source|Second|provider_profile_id|model_id|credential/);
  });
});
