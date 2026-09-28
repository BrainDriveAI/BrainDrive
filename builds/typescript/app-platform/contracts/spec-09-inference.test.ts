import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  InferenceCompletionModeSchema,
  InferenceErrorCodeSchema,
  InferenceErrorSchema,
  InferenceFinalDispositionSchema,
  InferenceFinishCategorySchema,
  InferenceOutcomeMetadataSchema,
  InferenceRecoveryClassSchema,
  InferenceResultSchema,
  InferenceStageSchema,
  PURPOSE_OUTPUT_SCHEMAS,
} from "./inference.js";
import { AppInferenceEventSchema } from "./spec-05-foundation.js";
import { ResumeInferenceRetryAuditDetailsSchema, assertContentFreeResumeInferenceRetryAudit } from "./audit.js";
import { classifyInferenceError, ResumeInferenceError } from "../../resume-inference/errors.js";

const directory = dirname(fileURLToPath(import.meta.url));

const requestId = "90000000-0000-4000-8000-000000000001";
const operationId = "90000000-0000-4000-8000-000000000002";
const startedAt = "2026-08-14T12:00:00.000Z";
const completedAt = "2026-08-14T12:00:01.000Z";
const digest = `sha256:${"a".repeat(64)}`;

const legacyCompletedResult = {
  inference_schema_version: 1,
  request_id: requestId,
  operation_id: operationId,
  purpose: "general_resume_draft",
  status: "completed",
  prompt_policy_id: "resume.inference.no-tools",
  prompt_policy_version: "3",
  output_schema_id: PURPOSE_OUTPUT_SCHEMAS.general_resume_draft,
  output_schema_version: 1,
  input_digest: digest,
  output_digest: digest,
  result: { sections: [] },
  provider_profile_id: "owner-provider",
  model_id: "owner-model",
  attempt_count: 1,
  usage: { available: false, input_tokens: null, output_tokens: null },
  error: null,
  started_at: startedAt,
  completed_at: completedAt,
} as const;

const failedOutcome = {
  stage: "deterministic_validation",
  finish_category: "stop",
  attempt_count: 2,
  retryable: false,
  recovery_class: "provider_validation_repair",
  completion_mode: "none",
  final_disposition: "failed",
} as const;

describe("Spec 09 typed inference outcome contracts", () => {
  it("accepts every exact stage, finish, recovery, completion, and disposition value", () => {
    const cases = [
      InferenceStageSchema,
      InferenceFinishCategorySchema,
      InferenceRecoveryClassSchema,
      InferenceCompletionModeSchema,
      InferenceFinalDispositionSchema,
    ] as const;

    for (const schema of cases) {
      for (const value of schema.options) expect(schema.parse(value)).toBe(value);
      expect(schema.safeParse("not-an-accepted-value").success).toBe(false);
    }
  });

  it("embeds every final disposition in valid result and app-event envelopes", () => {
    const cases = [
      {
        disposition: "completed",
        status: "completed",
        error: null,
        result: { sections: [] },
        output_digest: digest,
        outcome: {
          stage: "completed", finish_category: "stop", attempt_count: 1, retryable: false,
          recovery_class: "none", completion_mode: "primary", final_disposition: "completed",
        },
      },
      {
        disposition: "failed",
        status: "failed",
        error: { code: "internal_failure", safe_message: "The operation could not complete", retryable: true },
        result: null,
        output_digest: null,
        outcome: {
          stage: "internal", finish_category: "missing", attempt_count: 1, retryable: true,
          recovery_class: "none", completion_mode: "none", final_disposition: "failed",
        },
      },
      {
        disposition: "cancelled",
        status: "cancelled",
        error: { code: "cancelled", safe_message: "The operation was cancelled", retryable: false },
        result: null,
        output_digest: null,
        outcome: {
          stage: "cancellation", finish_category: "missing", attempt_count: 1, retryable: false,
          recovery_class: "none", completion_mode: "none", final_disposition: "cancelled",
        },
      },
    ] as const;

    expect(cases.map((entry) => entry.disposition)).toEqual(InferenceFinalDispositionSchema.options);
    for (const entry of cases) {
      const parsedResult = InferenceResultSchema.parse({
        ...legacyCompletedResult,
        status: entry.status,
        error: entry.error,
        result: entry.result,
        output_digest: entry.output_digest,
        outcome: entry.outcome,
      });
      expect(parsedResult.outcome?.final_disposition).toBe(entry.disposition);

      const parsedEvent = AppInferenceEventSchema.parse(entry.disposition === "completed"
        ? {
            inference_contract_version: 1, request_id: requestId, operation_id: operationId,
            sequence: 1, event: "completed", structured_output: entry.result,
            output_digest: digest, usage: { input_tokens: null, output_tokens: null }, outcome: entry.outcome,
          }
        : {
            inference_contract_version: 1, request_id: requestId, operation_id: operationId,
            sequence: 1, event: "failed", error: entry.error, outcome: entry.outcome,
          });
      if (parsedEvent.event === "progress") throw new Error("terminal fixture parsed as progress");
      expect(parsedEvent.outcome?.final_disposition).toBe(entry.disposition);
    }
  });

  it("accepts every semantic error code while retaining persisted legacy codes", () => {
    for (const code of InferenceErrorCodeSchema.options) {
      expect(InferenceErrorSchema.parse({ code, safe_message: "A safe fixed message", retryable: false }).code).toBe(code);
    }
    expect(InferenceErrorCodeSchema.safeParse("provider_exception_body").success).toBe(false);
  });

  it("reads old terminal results and app events without outcome metadata", () => {
    expect(InferenceResultSchema.parse(legacyCompletedResult)).not.toHaveProperty("outcome");
    const legacyFailedResult = {
      ...legacyCompletedResult,
      status: "failed",
      output_digest: null,
      result: null,
      error: { code: "validation_failed", safe_message: "Generated output was rejected", retryable: false },
    } as const;
    expect(InferenceResultSchema.parse(legacyFailedResult)).not.toHaveProperty("outcome");
    const legacyFailedEvent = {
      inference_contract_version: 1,
      request_id: requestId,
      operation_id: operationId,
      sequence: 1,
      event: "failed",
      error: { code: "schema_validation_failed", safe_message: "The response could not be read", retryable: false },
    } as const;
    expect(AppInferenceEventSchema.parse(legacyFailedEvent)).not.toHaveProperty("outcome");
  });

  it("round-trips exact evidence-validation metadata through result and app-event contracts", () => {
    const error = InferenceErrorSchema.parse({
      code: "evidence_validation_failed",
      safe_message: "Generated wording could not be verified",
      retryable: false,
    });
    const result = InferenceResultSchema.parse({
      ...legacyCompletedResult,
      status: "failed",
      output_digest: null,
      result: null,
      attempt_count: 2,
      error,
      outcome: failedOutcome,
    });
    expect(result.error?.code).toBe("evidence_validation_failed");
    expect(result.outcome).toEqual(failedOutcome);

    const event = AppInferenceEventSchema.parse({
      inference_contract_version: 1,
      request_id: requestId,
      operation_id: operationId,
      sequence: 1,
      event: "failed",
      error,
      outcome: failedOutcome,
    });
    expect(event.event === "failed" && event.error.code).toBe("evidence_validation_failed");
  });

  it("enforces terminal status, attempt, retryability, completion, and recovery consistency", () => {
    const validCompletedOutcome = {
      stage: "completed",
      finish_category: "stop",
      attempt_count: 1,
      retryable: false,
      recovery_class: "none",
      completion_mode: "primary",
      final_disposition: "completed",
    } as const;
    expect(InferenceResultSchema.safeParse({ ...legacyCompletedResult, outcome: validCompletedOutcome }).success).toBe(true);
    expect(InferenceResultSchema.safeParse({ ...legacyCompletedResult, outcome: { ...validCompletedOutcome, attempt_count: 2 } }).success).toBe(false);
    expect(InferenceResultSchema.safeParse({ ...legacyCompletedResult, outcome: { ...validCompletedOutcome, retryable: true } }).success).toBe(false);
    expect(InferenceResultSchema.safeParse({ ...legacyCompletedResult, outcome: { ...validCompletedOutcome, final_disposition: "failed" } }).success).toBe(false);
    expect(InferenceOutcomeMetadataSchema.safeParse({ ...validCompletedOutcome, completion_mode: "none" }).success).toBe(false);
    expect(InferenceOutcomeMetadataSchema.safeParse({ ...failedOutcome, completion_mode: "provider_repair" }).success).toBe(false);
    expect(InferenceOutcomeMetadataSchema.safeParse({ ...validCompletedOutcome, recovery_class: "provider_structural_repair" }).success).toBe(false);
    expect(InferenceOutcomeMetadataSchema.safeParse({ ...validCompletedOutcome, recovery_class: "host_owned_zero_call", completion_mode: "host_owned" }).success).toBe(true);
  });

  it("rejects unknown, oversized, and content-bearing outcome diagnostics", () => {
    const prohibited = ["prompt", "resume", "job", "credential", "endpoint", "path"];
    for (const key of prohibited) {
      expect(InferenceOutcomeMetadataSchema.safeParse({ ...failedOutcome, [key]: `${key}-canary` }).success, key).toBe(false);
      expect(InferenceOutcomeMetadataSchema.safeParse({ ...failedOutcome, stage: `${key}-canary` }).success, key).toBe(false);
    }
    expect(InferenceOutcomeMetadataSchema.safeParse({ ...failedOutcome, attempt_count: 3 }).success).toBe(false);
    expect(InferenceOutcomeMetadataSchema.safeParse({ ...failedOutcome, prompt: "x".repeat(1_000_000) }).success).toBe(false);
  });

  it("classifies only untyped adapter failures while preserving typed errors exactly", () => {
    const typed = new ResumeInferenceError("evidence_validation_failed", "Safe typed finding", false);
    expect(classifyInferenceError(typed)).toBe(typed);

    const cases: Array<[unknown, string, boolean]> = [
      [new Error("HTTP 401"), "provider_authentication_failed", false],
      [new Error("Unauthorized provider request"), "provider_authentication_failed", false],
      [new Error("HTTP 403"), "provider_authorization_failed", false],
      [new Error("HTTP 403 Unauthorized"), "provider_authorization_failed", false],
      [new Error("insufficient funds"), "quota_exceeded", false],
      [new Error("HTTP 429"), "rate_limited", true],
      [new Error("request timeout"), "deadline_exceeded", false],
      [new Error("fetch failed ECONNRESET"), "provider_unavailable", true],
      [new Error("json_schema response format is unsupported"), "provider_schema_unsupported", false],
      [new Error("opaque adapter failure"), "internal_failure", true],
    ];
    for (const [error, code, retryable] of cases) {
      expect(classifyInferenceError(error)).toMatchObject({ code, retryable });
    }

    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    expect(classifyInferenceError(new Error("adapter stopped"), controller.signal)).toMatchObject({ code: "cancelled", retryable: false });
  });

  it("normalizes unknown and missing finish reasons only through explicit safe categories", () => {
    expect(InferenceFinishCategorySchema.parse("unknown")).toBe("unknown");
    expect(InferenceFinishCategorySchema.parse("missing")).toBe("missing");
    expect(InferenceFinishCategorySchema.safeParse("provider-specific-reason").success).toBe(false);
  });

  it("keeps owner retry audit identities strict and content-free", () => {
    const retryAudit = {
      diagnostic_version: 1,
      retry_relation_version: 1,
      retry_reason: "owner_initiated_retry",
      retry_prior_operation_id: "90000000-0000-4000-8000-000000000010",
      retry_new_operation_id: "90000000-0000-4000-8000-000000000011",
      retry_semantic_input_digest: digest,
      retry_strategy_revision_id: "90000000-0000-4000-8000-000000000012",
      retry_provider_profile_id: "owner-provider",
      retry_model_id: "owner-model",
      retry_equivalent: true,
    } as const;
    expect(() => assertContentFreeResumeInferenceRetryAudit(retryAudit)).not.toThrow();
    expect(ResumeInferenceRetryAuditDetailsSchema.safeParse({ ...retryAudit, retry_new_operation_id: retryAudit.retry_prior_operation_id }).success).toBe(false);
    expect(ResumeInferenceRetryAuditDetailsSchema.safeParse({ ...retryAudit, reason: "free form" }).success).toBe(false);
    expect(() => assertContentFreeResumeInferenceRetryAudit({ ...retryAudit, retry_provider_profile_id: "sk-SENSITIVE_ALLOWED_FIELD_CANARY" })).toThrow();
    expect(() => assertContentFreeResumeInferenceRetryAudit({ ...retryAudit, retry_model_id: "/home/owner/private-model" })).toThrow();
  });

  it("freezes the legacy validation-collapse regression for Milestone 4", async () => {
    const regression = JSON.parse(await readFile(resolve(directory, "fixtures", "spec-09", "m1-validation-collapse.json"), "utf8")) as {
      broker_error: unknown;
      legacy_adapter_projection_code: string;
      required_projection_code: string;
    };
    const parsed = InferenceErrorSchema.parse(regression.broker_error);
    expect(parsed.code).toBe("evidence_validation_failed");
    expect(regression.legacy_adapter_projection_code).toBe("schema_validation_failed");
    expect(regression.required_projection_code).toBe(parsed.code);
    expect(regression.legacy_adapter_projection_code).not.toBe(regression.required_projection_code);
  });

  it("keeps generated model-compatibility schema parity for v1 and strict v2 evidence", async () => {
    const generated = JSON.parse(await readFile(resolve(directory, "schemas", "v1", "model-compatibility-entry.schema.json"), "utf8")) as {
      oneOf?: Array<{ properties?: { registry_version?: { const?: number } }; required?: string[]; additionalProperties?: boolean }>;
    };
    expect(generated.oneOf?.map((variant) => variant.properties?.registry_version?.const)).toEqual([1, 2]);
    const v2 = generated.oneOf?.[1];
    expect(v2?.required).toEqual(expect.arrayContaining([
      "effective_config_fingerprint", "observed_model_id", "fixture_count", "runs_per_fixture",
      "operation_count", "outcomes", "expires_at", "runs", "evidence_class",
    ]));
    expect(v2?.additionalProperties).toBe(false);
  });
});
