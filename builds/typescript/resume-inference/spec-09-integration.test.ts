import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import {
  InferencePurposeSchema,
  InferenceRequestSchema,
  PURPOSE_LIMITS,
  PURPOSE_OUTPUT_SCHEMAS,
  type InferencePurpose,
} from "../app-platform/contracts/inference.js";
import { projectResumeInferenceCompletion } from "../app-inference/resume-adapter.js";
import type { ModelAdapter } from "../adapters/base.js";
import { ResumeInferenceBroker } from "./broker.js";
import { conformanceBlocks } from "./conformance-corpus.js";
import { RESUME_PROMPT_POLICY_ID, RESUME_PROMPT_POLICY_VERSION } from "./policy.js";
import { PURPOSE_RECOVERY_POLICIES } from "./purpose-recovery.js";
import {
  SPEC_09_PROVIDER_FAULTS,
  createSpec09FaultFixture,
  type Spec09ProviderFault,
} from "./spec-09-fault-fixture.js";

const PROVIDER_PURPOSES = InferencePurposeSchema.options.filter((purpose) => purpose !== "resume_craft_evaluate");
const SAFE_CANARIES = [
  "PRIVATE_RESUME_CANARY",
  "PRIVATE_JOB_CANARY",
  "PRIVATE_PROMPT_CANARY",
  "sk-synthetic-secret",
  "https://private.invalid",
  "/home/private/owner.json",
];

function requestFor(
  purpose: InferencePurpose,
  operationId = randomUUID(),
  fixtureId = "ordinary-one-role",
): z.infer<typeof InferenceRequestSchema> {
  const dataBlocks = conformanceBlocks(purpose, fixtureId);
  const facts = (dataBlocks.find((block) => block.category === "confirmed_fact_snapshot")?.data as { facts?: unknown[] } | undefined)?.facts ?? [];
  const recordRevisionIds = [...new Set(collectUuids(dataBlocks))];
  const now = new Date();
  return InferenceRequestSchema.parse({
    inference_schema_version: 1,
    request_id: randomUUID(),
    owner_id: randomUUID(),
    actor_id: randomUUID(),
    app_id: "ai.braindrive.resume-builder",
    installation_id: randomUUID(),
    operation_id: operationId,
    grant_id: randomUUID(),
    purpose,
    input_snapshot: {
      fact_snapshot_revision: 1,
      fact_snapshot_digest: canonicalInputDigest(facts),
      record_revision_ids: recordRevisionIds,
    },
    data_blocks: dataBlocks,
    prompt_policy_id: RESUME_PROMPT_POLICY_ID,
    prompt_policy_version: RESUME_PROMPT_POLICY_VERSION,
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS[purpose],
    output_schema_version: 1,
    capability_requirements: {
      text_generation: true,
      complete_structured_json: true,
      minimum_context_tokens: PURPOSE_LIMITS[purpose].input_tokens,
      model_tools: false,
    },
    limits: PURPOSE_LIMITS[purpose],
    requested_at: now.toISOString(),
    deadline_at: new Date(now.getTime() + PURPOSE_LIMITS[purpose].duration_ms).toISOString(),
  });
}

function collectUuids(value: unknown): string[] {
  if (typeof value === "string") return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collectUuids);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectUuids);
  return [];
}

function semanticCode(fault: Spec09ProviderFault): string | null {
  const codes: Partial<Record<Spec09ProviderFault, string>> = {
    content_filter: "content_filtered",
    refusal: "provider_refused",
    unexpected_tool_call: "unexpected_tool_call",
    authentication: "provider_authentication_failed",
    authorization: "provider_authorization_failed",
    quota: "quota_exceeded",
    rate_limit: "rate_limited",
    deadline: "deadline_exceeded",
    network: "provider_unavailable",
    response_loss: "provider_unavailable",
    model_incompatible: "model_incompatible",
    provider_schema_unsupported: "provider_schema_unsupported",
    internal: "internal_failure",
  };
  return codes[fault] ?? null;
}

describe("Spec 09 cross-layer deterministic reliability", () => {
  it("keeps the test-only fault vocabulary exhaustive and outside runtime composition", async () => {
    expect(new Set(SPEC_09_PROVIDER_FAULTS)).toEqual(new Set([
      "clean", "empty", "malformed_json", "prose_wrapped", "fenced_json", "schema_mismatch",
      "truncated", "deterministic_rejection", "content_filter", "refusal", "unexpected_tool_call",
      "authentication", "authorization", "quota", "rate_limit", "deadline", "network", "response_loss",
      "model_incompatible", "provider_schema_unsupported", "internal",
    ]));
    const gatewaySource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../gateway/server.ts", import.meta.url), "utf8"));
    expect(gatewaySource).not.toContain("spec-09-fault-fixture");
    expect(gatewaySource).not.toContain("SPEC_09_PROVIDER_FAULTS");
  });

  it("completes every purpose through strict no-tools validation and proves craft evaluation is zero-call", async () => {
    for (const purpose of InferencePurposeSchema.options) {
      const fixture = createSpec09FaultFixture(["clean"]);
      const audit = vi.fn();
      const completion = await new ResumeInferenceBroker(fixture.resolver, audit).execute(requestFor(purpose));
      expect(completion.inference.status, purpose).toBe("completed");
      expect(completion.inference.outcome, purpose).toMatchObject({ final_disposition: "completed" });
      expect(completion.validation?.accepted, purpose).toBe(true);
      expect(fixture.callCount(), purpose).toBe(purpose === "resume_craft_evaluate" ? 0 : 1);
      for (const providerRequest of fixture.requests()) {
        expect(providerRequest).toMatchObject({ maxOutputTokens: PURPOSE_LIMITS[purpose].output_tokens });
        expect(providerRequest.signal).toBeInstanceOf(AbortSignal);
        expect(providerRequest.schema).toBeTypeOf("object");
      }
      const projected = projectResumeInferenceCompletion(completion) as { status: string; diagnostic: { purpose: string; final_disposition: string }; events: unknown[] };
      expect(projected).toMatchObject({ status: "completed", diagnostic: { purpose, final_disposition: "completed" } });
      expect(projected.events).toHaveLength(2);
      const safeEvidence = JSON.stringify({ projected, audits: audit.mock.calls });
      for (const canary of SAFE_CANARIES) expect(safeEvidence).not.toContain(canary);
    }
  });

  it("keeps sparse, maximum-size, and Unicode fixture projections inside the same validated boundary", async () => {
    const cases = [
      ["resume_guidance", "sparse-career"],
      ["resume_strategy", "large-evidence-long-output"],
      ["general_resume_draft", "unicode-non-english"],
      ["job_description_analyze", "unicode-non-english"],
    ] as const;
    for (const [purpose, fixtureId] of cases) {
      const fixture = createSpec09FaultFixture(["malformed_json", "clean"]);
      const completion = await new ResumeInferenceBroker(fixture.resolver).execute(requestFor(purpose, randomUUID(), fixtureId));
      expect(completion.inference.status, `${purpose}/${fixtureId}`).toBe("completed");
      expect(completion.validation?.accepted, `${purpose}/${fixtureId}`).toBe(true);
      expect(fixture.callCount(), `${purpose}/${fixtureId}`).toBe(2);
      expect(fixture.requests()[0]?.schema, `${purpose}/${fixtureId}`).toEqual(fixture.requests()[1]?.schema);
    }
  });

  it("repairs all mandatory structural and validation fault classes within two identical-boundary calls", async () => {
    const repairableFaults = ["empty", "malformed_json", "prose_wrapped", "fenced_json", "schema_mismatch", "truncated", "deterministic_rejection"] as const;
    for (const purpose of PROVIDER_PURPOSES) {
      for (const fault of repairableFaults) {
        const fixture = createSpec09FaultFixture([fault, "clean"]);
        const completion = await new ResumeInferenceBroker(fixture.resolver).execute(requestFor(purpose));
        expect(completion.inference.status, `${purpose}/${fault}`).toBe("completed");
        expect(completion.validation?.accepted, `${purpose}/${fault}`).toBe(true);
        const mayNormalizeLocally = fault === "deterministic_rejection"
          && PURPOSE_RECOVERY_POLICIES[purpose].normalization !== "none";
        if (mayNormalizeLocally) expect([1, 2], `${purpose}/${fault}`).toContain(fixture.callCount());
        else expect(fixture.callCount(), `${purpose}/${fault}`).toBe(2);
        const calls = fixture.requests();
        expect(calls[0]?.user, `${purpose}/${fault}`).toContain(`<resume-builder-data purpose="${purpose}">`);
        if (calls.length === 2) {
          expect(calls[0]?.schemaName, `${purpose}/${fault}`).toBe(calls[1]?.schemaName);
          expect(calls[0]?.schema, `${purpose}/${fault}`).toEqual(calls[1]?.schema);
          expect(calls[0]?.maxOutputTokens, `${purpose}/${fault}`).toBe(calls[1]?.maxOutputTokens);
          expect(calls[1]?.user, `${purpose}/${fault}`).toContain(`<resume-builder-data purpose="${purpose}">`);
          expect(completion.inference.outcome?.recovery_class, `${purpose}/${fault}`).toBe(fault === "deterministic_rejection" ? "provider_validation_repair" : "provider_structural_repair");
        } else {
          expect(PURPOSE_RECOVERY_POLICIES[purpose].normalization, `${purpose}/${fault}`).not.toBe("none");
          expect(completion.inference.outcome?.recovery_class, `${purpose}/${fault}`).toBe("none");
        }
      }
    }
  });

  it("keeps final faults exact, preserves all durable owner surfaces, and never exceeds the call ceiling", async () => {
    const terminalFaults = [
      "content_filter", "refusal", "unexpected_tool_call", "authentication", "authorization", "quota",
      "rate_limit", "deadline", "network", "response_loss", "model_incompatible", "provider_schema_unsupported", "internal",
    ] as const;
    for (const purpose of PROVIDER_PURPOSES) {
      for (const fault of terminalFaults) {
        const fixture = createSpec09FaultFixture([fault]);
        const completion = await new ResumeInferenceBroker(fixture.resolver).execute(requestFor(purpose));
        const expectedCode = semanticCode(fault);
        if (completion.inference.status === "completed") {
          expect(PURPOSE_RECOVERY_POLICIES[purpose].operational_fallback_codes, `${purpose}/${fault}`).toContain(expectedCode);
          expect(completion.inference.outcome, `${purpose}/${fault}`).toMatchObject({ recovery_class: "deterministic_fallback", completion_mode: "deterministic_fallback", final_disposition: "completed" });
          expect(completion.validation?.accepted, `${purpose}/${fault}`).toBe(true);
        } else {
          expect(completion.inference.error?.code, `${purpose}/${fault}`).toBe(expectedCode);
          expect(completion.inference.result, `${purpose}/${fault}`).toBeNull();
          expect(completion.inference.outcome?.final_disposition, `${purpose}/${fault}`).toBe("failed");
        }
        expect(fixture.callCount(), `${purpose}/${fault}`).toBe(1);
      }

      const truncated = createSpec09FaultFixture(["truncated", "truncated"]);
      const completion = await new ResumeInferenceBroker(truncated.resolver).execute(requestFor(purpose));
      expect(truncated.callCount(), purpose).toBe(2);
      if (PURPOSE_RECOVERY_POLICIES[purpose].fallback_on.includes("incomplete")) {
        expect(completion.inference.status, purpose).toBe("completed");
        expect(completion.inference.outcome, purpose).toMatchObject({ recovery_class: "deterministic_fallback", final_disposition: "completed" });
        expect(completion.validation?.accepted, purpose).toBe(true);
      } else {
        expect(completion.inference, purpose).toMatchObject({ status: "failed", result: null, error: { code: "incomplete_output" }, outcome: { finish_category: "length", final_disposition: "failed" } });
      }
    }
  });

  it("coalesces duplicates, replays terminals, conflicts changed input, and discards a late cancelled result", async () => {
    const purpose = "general_resume_draft" as const;
    const fixture = createSpec09FaultFixture(["clean"]);
    const broker = new ResumeInferenceBroker(fixture.resolver);
    const operationId = randomUUID();
    const firstRequest = requestFor(purpose, operationId);
    const [first, duplicate] = await Promise.all([broker.execute(firstRequest), broker.execute(firstRequest)]);
    expect(duplicate).toEqual(first);
    expect(await broker.execute({ ...firstRequest, request_id: randomUUID() })).toEqual(first);
    expect(fixture.callCount()).toBe(1);
    await expect(broker.execute({
      ...firstRequest,
      request_id: randomUUID(),
      input_snapshot: { ...firstRequest.input_snapshot, fact_snapshot_revision: 2 },
    })).rejects.toMatchObject({ code: "invalid_request" });

    let release: (() => void) | undefined;
    const lateAdapter: ModelAdapter = {
      async complete() { throw new Error("agent path prohibited"); },
      async completeStructuredNoTools(request) {
        await new Promise<void>((resolve) => { release = resolve; });
        const clean = createSpec09FaultFixture(["clean"]);
        const provider = await clean.resolver(purpose);
        return provider.adapter.completeStructuredNoTools!(request);
      },
    };
    const cancelledBroker = new ResumeInferenceBroker(async () => ({
      providerProfileId: "synthetic-late",
      providerId: "synthetic-late",
      modelId: "synthetic-late",
      modelClass: "owner_active_compatible",
      adapter: lateAdapter,
    }));
    const cancelledRequest = requestFor(purpose);
    const pending = cancelledBroker.execute(cancelledRequest);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(cancelledBroker.cancel(cancelledRequest.operation_id)).toBe(true);
    release?.();
    const cancelled = await pending;
    expect(cancelled.inference).toMatchObject({ status: "cancelled", result: null, error: { code: "cancelled" }, outcome: { stage: "cancellation", final_disposition: "cancelled" } });
    expect(broker.status(operationId)).toBe("completed");
  });
});
