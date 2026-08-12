import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { AppInferenceEventSchema, AppInferenceRequestSchema } from "../app-platform/contracts/spec-05-foundation.js";
import { PURPOSE_LIMITS, PURPOSE_OUTPUT_SCHEMAS } from "../app-platform/contracts/inference.js";
import { CapabilityOperationCoordinator } from "../app-capabilities/operations.js";
import { testGrant } from "../resume-domain/test-helpers.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "../resume-inference/policy.js";
import { AppInferenceCapability, buildProtectedInferenceRequest } from "./capability.js";

const FACTS = { facts: [] };

function invocation(operationId = randomUUID()) {
  return { inference_contract_version: 1 as const, purpose: "interview_assist" as const, operation_id: operationId, fact_revision_ids: [] };
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
    const capability = new AppInferenceCapability({ snapshotBuilder: { build }, broker: { execute, cancel: vi.fn() }, operations: new CapabilityOperationCoordinator({ now: () => Date.parse("2026-08-07T12:00:00.000Z") }) });
    const context = { authority: authority(operationId, idempotencyKey), grant, operationId, idempotencyKey, deadlineAt: Date.parse("2026-08-07T12:01:00.000Z") };
    const [first, duplicate] = await Promise.all([capability.execute(invocation(operationId), context), capability.execute(invocation(operationId), context)]);
    expect(duplicate).toEqual(first);
    expect(build).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      inference_contract_version: 1,
      status: "completed",
      prompt_policy_id: "braindrive.resume-builder.fixed",
      prompt_policy_version: "8",
      input_digest: canonicalInputDigest(FACTS),
      provider_profile_id: "owner-profile",
      model_id: "owner-model",
      model_class: "owner_active_compatible",
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
    const capability = new AppInferenceCapability({ snapshotBuilder: { build }, broker: { execute, cancel: vi.fn() }, operations: new CapabilityOperationCoordinator({ now: () => Date.parse("2026-08-07T12:00:00.000Z") }) });
    const base = { authority: authority(operationId, idempotencyKey), operationId, idempotencyKey, deadlineAt: Date.parse("2026-08-07T12:01:00.000Z") };
    await expect(capability.execute(invocation(operationId), { ...base, grant: testGrant() })).rejects.toMatchObject({ code: "denied" });
    expect(build).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    const failure = await capability.execute(invocation(operationId), { ...base, grant: validGrant });
    expect(failure).toMatchObject({
      status: "rejected_incompatible",
      model_class: null,
      error: { code: "model_incompatible", retryable: false, recovery: "open_model_settings" },
      events: [{ event: "progress" }, { event: "failed", error: { code: "model_incompatible" } }],
    });
    expect(JSON.stringify(failure)).not.toContain("provider_profile_id");
    expect(JSON.stringify(failure)).not.toContain("model_id");
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
    const capability = new AppInferenceCapability({ snapshotBuilder: { build }, broker: { execute, cancel: vi.fn() }, persistResult, operations: new CapabilityOperationCoordinator({ now: () => Date.parse("2026-08-07T12:00:00.000Z") }) });
    await expect(capability.execute(invocation(operationId), {
      authority: authority(operationId, idempotencyKey), grant, operationId, idempotencyKey,
      deadlineAt: Date.parse("2026-08-07T12:01:00.000Z"),
    })).rejects.toThrow("synthetic atomic persistence failure");
    expect(build).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(persistResult).toHaveBeenCalledTimes(1);
  });
});
