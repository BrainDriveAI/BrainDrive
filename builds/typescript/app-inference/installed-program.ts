import { Buffer } from "node:buffer";

import { z } from "zod";

import type { ModelAdapter } from "../adapters/base.js";
import { canonicalInputDigest, OpaqueIdSchema, Sha256DigestSchema } from "../app-platform/contracts/common.js";
import { CanonicalAppIdSchema } from "../app-platform/contracts/app-registry.js";
import { AppPlatformError } from "../app-platform/lifecycle/errors.js";

const ProgramIdSchema = z.string().min(3).max(128).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
const ProgramSchema = z.object({ id: ProgramIdSchema, version: z.number().int().positive().max(65_535) }).strict();
const AppIssueIdSchema = z.string().min(5).max(160).regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\/[a-z][a-z0-9-]*$/);
const AppInferencePersistenceBindingSchema = z.object({
  prompt_policy_id: z.string().min(1).max(160),
  prompt_policy_version: z.string().min(1).max(64),
  input_digest: Sha256DigestSchema,
  output_digest: Sha256DigestSchema,
}).strict();

export const InstalledAppInferenceInvocationSchema = z.object({
  inference_contract_version: z.literal(2),
  operation_id: OpaqueIdSchema,
  program: ProgramSchema,
  input: z.unknown(),
}).strict();

export const InstalledAppInferencePlanSchema = z.object({
  inference_program_contract_version: z.literal(1),
  program: ProgramSchema,
  attempt: z.number().int().min(1).max(2),
  schema_name: z.string().min(1).max(128).regex(/^[a-z][a-z0-9_]*$/),
  system: z.string().min(1).max(131_072),
  user: z.string().min(1).max(262_144),
  output_schema: z.record(z.string(), z.unknown()),
  max_output_tokens: z.number().int().positive().max(8_192),
  timeout_ms: z.number().int().positive().max(120_000),
}).strict();

export const InstalledAppInferenceAdjudicationSchema = z.object({
  inference_program_contract_version: z.literal(1),
  program: ProgramSchema,
  attempt: z.number().int().min(1).max(2),
  decision: z.enum(["accepted", "retry", "fallback", "failed"]),
  issue_ids: z.array(AppIssueIdSchema).max(20).default([]),
  result: z.unknown().optional(),
  persistence_binding: AppInferencePersistenceBindingSchema.optional(),
  safe_error_code: z.string().min(1).max(96).regex(/^[a-z][a-z0-9_]*$/).optional(),
}).strict().superRefine((value, context) => {
  if (["accepted", "fallback"].includes(value.decision) && value.result === undefined) {
    context.addIssue({ code: "custom", path: ["result"], message: "terminal app adjudication requires a result" });
  }
  if (value.decision === "retry" && (value.attempt !== 1 || value.issue_ids.length === 0)) {
    context.addIssue({ code: "custom", path: ["decision"], message: "only the first attempt may request one bounded retry" });
  }
  if (value.decision === "failed" && !value.safe_error_code) {
    context.addIssue({ code: "custom", path: ["safe_error_code"], message: "failed app adjudication requires a safe code" });
  }
});

type Invocation = z.infer<typeof InstalledAppInferenceInvocationSchema>;
type Plan = z.infer<typeof InstalledAppInferencePlanSchema>;
type Adjudication = z.infer<typeof InstalledAppInferenceAdjudicationSchema>;

type PreviousAttempt = { candidate: unknown; issue_ids: string[] } | null;

export type InstalledAppInferenceProgramClient = {
  prepare(input: { program: Invocation["program"]; input: unknown; attempt: number; previous: PreviousAttempt }): Promise<unknown>;
  adjudicate(input: { program: Invocation["program"]; input: unknown; attempt: number; candidate: unknown }): Promise<unknown>;
};

export type InstalledAppInferenceProvider = {
  providerProfileId: string;
  modelId: string;
  adapter: Pick<ModelAdapter, "completeStructuredNoTools">;
};

export type InstalledAppInferenceProviderResolver = () => Promise<InstalledAppInferenceProvider>;

export type InstalledAppInferenceExecutionContext = {
  appId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  programClient: InstalledAppInferenceProgramClient | null;
  signal?: AbortSignal;
};

function assertIdentity<T extends { program: Invocation["program"]; attempt: number }>(
  value: T,
  invocation: Invocation,
  attempt: number,
): T {
  if (value.program.id !== invocation.program.id || value.program.version !== invocation.program.version || value.attempt !== attempt) {
    throw new AppPlatformError("validation_failed", "Installed app inference program returned a mismatched identity", 409);
  }
  return value;
}

function parseCandidate(text: string): unknown {
  if (Buffer.byteLength(text, "utf8") > 1_048_576) throw new AppPlatformError("validation_failed", "Installed app inference candidate is oversized", 409);
  try { return JSON.parse(text) as unknown; }
  catch { return null; }
}

function parseProgramValue<T>(schema: z.ZodType<T>, raw: unknown, message: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AppPlatformError("invalid_input", message, 400);
  return parsed.data;
}

export class InstalledAppInferenceExecutor {
  constructor(private readonly dependencies: {
    resolveProvider: InstalledAppInferenceProviderResolver;
    audit?: (event: string, details: Record<string, unknown>) => void;
  }) {}

  async execute(raw: unknown, context: InstalledAppInferenceExecutionContext): Promise<unknown> {
    const invocation = InstalledAppInferenceInvocationSchema.safeParse(raw);
    if (!invocation.success) throw new AppPlatformError("invalid_input", "Installed app inference invocation is invalid", 400);
    if (!CanonicalAppIdSchema.safeParse(context.appId).success || !OpaqueIdSchema.safeParse(context.installationId).success || !Sha256DigestSchema.safeParse(context.packageDigest).success) {
      throw new AppPlatformError("denied", "Installed app inference authority is invalid", 403);
    }
    if (!context.programClient) throw new AppPlatformError("denied", "No active installed-app inference program is available", 403);
    const parsed = invocation.data;
    let provider: InstalledAppInferenceProvider | null = null;
    let previous: PreviousAttempt = null;
    let finalIssues: string[] = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (context.signal?.aborted) throw new AppPlatformError("cancelled", "Installed app inference was cancelled", 408);
      const plan = assertIdentity(
        parseProgramValue(InstalledAppInferencePlanSchema, await context.programClient.prepare({ program: parsed.program, input: parsed.input, attempt, previous }), "Installed app inference plan is invalid"),
        parsed,
        attempt,
      ) as Plan;
      provider ??= await this.dependencies.resolveProvider();
      if (typeof provider.adapter.completeStructuredNoTools !== "function") {
        throw new AppPlatformError("protocol_incompatible", "The active provider does not support structured app inference", 409);
      }
      const response = await provider.adapter.completeStructuredNoTools({
        system: plan.system,
        user: plan.user,
        schemaName: plan.schema_name,
        schema: plan.output_schema,
        maxOutputTokens: plan.max_output_tokens,
        timeoutMs: plan.timeout_ms,
        signal: context.signal,
      });
      const candidate = parseCandidate(response.text);
      const adjudication = assertIdentity(
        parseProgramValue(InstalledAppInferenceAdjudicationSchema, await context.programClient.adjudicate({ program: parsed.program, input: parsed.input, attempt, candidate }), "Installed app inference adjudication is invalid"),
        parsed,
        attempt,
      ) as Adjudication;
      const priorIssueIds = previous?.issue_ids ?? [];
      const repeatedIssueIds = adjudication.issue_ids.filter((issueId) => priorIssueIds.includes(issueId));
      finalIssues = adjudication.issue_ids;
      this.emitAudit("app.inference.program_attempt", {
        app_id: context.appId,
        operation_id: parsed.operation_id,
        program_id: parsed.program.id,
        program_version: parsed.program.version,
        attempt,
        attempt_outcome: adjudication.decision,
        app_issue_ids: adjudication.issue_ids,
        repeated_issue_ids: repeatedIssueIds,
        provider_call_count: attempt,
      });
      if (adjudication.decision === "retry") {
        previous = { candidate, issue_ids: adjudication.issue_ids };
        continue;
      }
      if (adjudication.decision === "failed") {
        this.emitTerminal(context.appId, parsed, attempt, "none", adjudication.issue_ids, repeatedIssueIds);
        throw new AppPlatformError("validation_failed", "Installed app inference did not produce a safe result", 409, {
          safeCode: adjudication.safe_error_code,
          operationId: parsed.operation_id,
          attemptCount: attempt,
          completionMode: "none",
          appIssueIds: adjudication.issue_ids,
          retryable: false,
        });
      }
      this.emitTerminal(
        context.appId,
        parsed,
        attempt,
        adjudication.decision === "fallback" ? "deterministic_fallback" : "provider",
        adjudication.issue_ids,
        repeatedIssueIds,
      );
      return {
        inference_contract_version: 2,
        operation_id: parsed.operation_id,
        program: parsed.program,
        input_digest: adjudication.persistence_binding?.input_digest ?? canonicalInputDigest({ program: parsed.program, input: parsed.input }),
        status: "completed",
        completion_mode: adjudication.decision === "fallback" ? "deterministic_fallback" : "provider",
        attempt_count: attempt,
        provider_profile_id: provider.providerProfileId,
        model_id: provider.modelId,
        issue_ids: adjudication.issue_ids,
        result: adjudication.result,
        output_digest: adjudication.persistence_binding?.output_digest ?? canonicalInputDigest(adjudication.result),
        ...(adjudication.persistence_binding ? {
          prompt_policy_id: adjudication.persistence_binding.prompt_policy_id,
          prompt_policy_version: adjudication.persistence_binding.prompt_policy_version,
        } : {}),
      };
    }
    this.emitTerminal(context.appId, parsed, 2, "none", finalIssues, previous?.issue_ids ?? []);
    throw new AppPlatformError("validation_failed", "Installed app inference exhausted its two-call ceiling", 409, {
      safeCode: "candidate_invalid",
      operationId: parsed.operation_id,
      attemptCount: 2,
      completionMode: "none",
      appIssueIds: finalIssues,
      retryable: false,
    });
  }

  private emitTerminal(
    appId: string,
    invocation: Invocation,
    attemptCount: number,
    completionMode: "provider" | "deterministic_fallback" | "none",
    appIssueIds: string[],
    repeatedIssueIds: string[],
  ): void {
    this.emitAudit("app.inference.program_terminal", {
      app_id: appId,
      operation_id: invocation.operation_id,
      program_id: invocation.program.id,
      program_version: invocation.program.version,
      attempt_count: attemptCount,
      completion_mode: completionMode,
      app_issue_ids: appIssueIds,
      repeated_issue_ids: repeatedIssueIds,
      provider_call_count: attemptCount,
      saved_record_written: false,
      approved_record_changed: false,
    });
  }

  private emitAudit(event: string, details: Record<string, unknown>): void {
    try { this.dependencies.audit?.(event, details); }
    catch { /* Diagnostics cannot expose content or interrupt inference. */ }
  }
}
