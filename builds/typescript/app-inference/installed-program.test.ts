import { describe, expect, it, vi } from "vitest";

import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import { InstalledAppInferenceExecutor } from "./installed-program.js";

const invocation = {
  inference_contract_version: 2,
  operation_id: "10000000-0000-4000-8000-000000000001",
  program: { id: "resume.general-draft", version: 1 },
  input: { synthetic: true },
};

describe("installed app-owned inference execution", () => {
  it("does not resolve a provider when no active installed-app program is available", async () => {
    const resolveProvider = vi.fn();
    const executor = new InstalledAppInferenceExecutor({ resolveProvider });

    await expect(executor.execute(invocation, {
      appId: "ai.example.resume-builder",
      installationId: "20000000-0000-4000-8000-000000000001",
      packageDigest: `sha256:${"a".repeat(64)}`,
      programClient: null,
    })).rejects.toMatchObject({ code: "denied" });
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("lets the installed app own plans, semantic issue IDs, retry, and fallback while the host enforces two calls", async () => {
    const audit = vi.fn();
    const completeStructuredNoTools = vi
      .fn()
      .mockResolvedValueOnce({ text: JSON.stringify({ malformed: "first" }), finishReason: "stop" })
      .mockResolvedValueOnce({ text: JSON.stringify({ malformed: "second" }), finishReason: "stop" });
    const resolveProvider = vi.fn(async () => ({
      providerProfileId: "owner-active",
      modelId: "owner-model",
      adapter: { completeStructuredNoTools },
    }));
    const prepare = vi.fn(async ({ attempt }: { attempt: number }) => ({
      inference_program_contract_version: 1,
      program: invocation.program,
      attempt,
      schema_name: "resume_general_draft_v1",
      system: "app-owned system policy",
      user: attempt === 1 ? "app-owned input" : "app-owned repair with prior issue",
      output_schema: { type: "object", additionalProperties: true },
      max_output_tokens: 2048,
      timeout_ms: 30_000,
    }));
    const adjudicate = vi
      .fn()
      .mockResolvedValueOnce({
        inference_program_contract_version: 1,
        program: invocation.program,
        attempt: 1,
        decision: "retry",
        issue_ids: ["resume.general-draft/experience-role-top-level-leakage"],
      })
      .mockResolvedValueOnce({
        inference_program_contract_version: 1,
        program: invocation.program,
        attempt: 2,
        decision: "fallback",
        issue_ids: ["resume.general-draft/experience-role-top-level-leakage"],
        result: { title: "Deterministic app-owned fallback" },
        persistence_binding: {
          prompt_policy_id: "example.resume-builder.policy",
          prompt_policy_version: "2",
          input_digest: `sha256:${"b".repeat(64)}`,
          output_digest: `sha256:${"c".repeat(64)}`,
        },
      });
    const executor = new InstalledAppInferenceExecutor({ resolveProvider, audit });

    await expect(executor.execute(invocation, {
      appId: "ai.example.resume-builder",
      installationId: "20000000-0000-4000-8000-000000000001",
      packageDigest: `sha256:${"a".repeat(64)}`,
      programClient: { prepare, adjudicate },
    })).resolves.toMatchObject({
      status: "completed",
      completion_mode: "deterministic_fallback",
      attempt_count: 2,
      result: { title: "Deterministic app-owned fallback" },
      issue_ids: ["resume.general-draft/experience-role-top-level-leakage"],
      prompt_policy_id: "example.resume-builder.policy",
      prompt_policy_version: "2",
      input_digest: `sha256:${"b".repeat(64)}`,
      output_digest: `sha256:${"c".repeat(64)}`,
    });
    expect(resolveProvider).toHaveBeenCalledTimes(1);
    expect(completeStructuredNoTools).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(adjudicate).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1]?.[0]).toMatchObject({
      attempt: 2,
      previous: { issue_ids: ["resume.general-draft/experience-role-top-level-leakage"] },
    });
    expect(audit.mock.calls).toEqual([
      ["app.inference.program_attempt", expect.objectContaining({
        app_id: "ai.example.resume-builder",
        operation_id: invocation.operation_id,
        program_id: invocation.program.id,
        attempt: 1,
        attempt_outcome: "retry",
        app_issue_ids: ["resume.general-draft/experience-role-top-level-leakage"],
        repeated_issue_ids: [],
        provider_call_count: 1,
      })],
      ["app.inference.program_attempt", expect.objectContaining({
        attempt: 2,
        attempt_outcome: "fallback",
        repeated_issue_ids: ["resume.general-draft/experience-role-top-level-leakage"],
        provider_call_count: 2,
      })],
      ["app.inference.program_terminal", expect.objectContaining({
        attempt_count: 2,
        completion_mode: "deterministic_fallback",
        app_issue_ids: ["resume.general-draft/experience-role-top-level-leakage"],
        provider_call_count: 2,
        saved_record_written: false,
        approved_record_changed: false,
      })],
    ]);
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/app-owned|malformed|owner-model|owner-active/);
  });

  it("rejects app attempts to request tools, a third call, or an unnamespaced issue", async () => {
    const completeStructuredNoTools = vi.fn(async () => ({ text: "{}", finishReason: "stop" }));
    const executor = new InstalledAppInferenceExecutor({ resolveProvider: async () => ({ providerProfileId: "active", modelId: "model", adapter: { completeStructuredNoTools } }) });
    const baseClient = {
      prepare: vi.fn(async () => ({
        inference_program_contract_version: 1,
        program: invocation.program,
        attempt: 1,
        schema_name: "resume_general_draft_v1",
        system: "policy",
        user: "input",
        output_schema: { type: "object" },
        max_output_tokens: 2048,
        timeout_ms: 30_000,
        tools: true,
      })),
      adjudicate: vi.fn(),
    };
    await expect(executor.execute(invocation, { appId: "ai.example.resume-builder", installationId: crypto.randomUUID(), packageDigest: `sha256:${"a".repeat(64)}`, programClient: baseClient })).rejects.toMatchObject({ code: "invalid_input" });

    const badIssueClient = {
      prepare: vi.fn(async () => {
        const { tools: _tools, ...plan } = await baseClient.prepare();
        return plan;
      }),
      adjudicate: vi.fn(async () => ({ inference_program_contract_version: 1, program: invocation.program, attempt: 1, decision: "retry", issue_ids: ["experience_role_invalid"] })),
    };
    await expect(executor.execute({ ...invocation, operation_id: crypto.randomUUID() }, { appId: "ai.example.resume-builder", installationId: crypto.randomUUID(), packageDigest: `sha256:${"a".repeat(64)}`, programClient: badIssueClient })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("returns structured content-free app failure details after the two-call ceiling", async () => {
    const audit = vi.fn();
    const appIssueIds = ["brief.generate/schema-title-invalid", "brief.generate/evidence-binding-invalid"];
    const completeStructuredNoTools = vi
      .fn()
      .mockResolvedValueOnce({ text: JSON.stringify({ poison: "PRIVATE_CANDIDATE_CANARY" }), finishReason: "stop" })
      .mockResolvedValueOnce({ text: JSON.stringify({ poison: "PRIVATE_REPAIR_CANARY" }), finishReason: "stop" });
    const executor = new InstalledAppInferenceExecutor({
      resolveProvider: async () => ({ providerProfileId: "active", modelId: "model", adapter: { completeStructuredNoTools } }),
      audit,
    });
    const prepare = vi.fn(async ({ attempt }: { attempt: number }) => ({
      inference_program_contract_version: 1,
      program: invocation.program,
      attempt,
      schema_name: "brief_generate_v1",
      system: "app-owned policy",
      user: "app-owned request",
      output_schema: { type: "object", additionalProperties: false },
      max_output_tokens: 512,
      timeout_ms: 30_000,
    }));
    const adjudicate = vi
      .fn()
      .mockResolvedValueOnce({
        inference_program_contract_version: 1,
        program: invocation.program,
        attempt: 1,
        decision: "retry",
        issue_ids: appIssueIds,
      })
      .mockResolvedValueOnce({
        inference_program_contract_version: 1,
        program: invocation.program,
        attempt: 2,
        decision: "failed",
        issue_ids: appIssueIds,
        safe_error_code: "candidate_invalid",
      });

    const failure = await executor.execute(invocation, {
      appId: "ai.example.brief-builder",
      installationId: crypto.randomUUID(),
      packageDigest: `sha256:${"a".repeat(64)}`,
      programClient: { prepare, adjudicate },
    }).catch((error) => error);

    expect(failure).toMatchObject({
      code: "validation_failed",
      message: "Installed app inference did not produce a safe result",
      details: {
        safeCode: "candidate_invalid",
        operationId: invocation.operation_id,
        attemptCount: 2,
        completionMode: "none",
        appIssueIds,
        retryable: false,
      },
    });
    expect(completeStructuredNoTools).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(failure)).not.toMatch(/PRIVATE_CANDIDATE_CANARY|PRIVATE_REPAIR_CANARY/);
    expect(audit).toHaveBeenLastCalledWith("app.inference.program_terminal", expect.objectContaining({
      completion_mode: "none",
      attempt_count: 2,
      provider_call_count: 2,
      app_issue_ids: appIssueIds,
      saved_record_written: false,
      approved_record_changed: false,
    }));
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/PRIVATE_CANDIDATE_CANARY|PRIVATE_REPAIR_CANARY|active|model/);
  });

  it("propagates genuine provider cancellation and never spends the correction call", async () => {
    const controller = new AbortController();
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const completeStructuredNoTools = vi.fn(async ({ signal }: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      providerStarted();
      signal?.addEventListener("abort", () => reject(new AppPlatformError("cancelled", "Installed app inference was cancelled", 408)), { once: true });
    }));
    const prepare = vi.fn(async ({ attempt, program }: { attempt: number; program: { id: string; version: number } }) => ({
      inference_program_contract_version: 1,
      program,
      attempt,
      schema_name: "resume_craft_evaluate_v1",
      system: "app-owned craft policy",
      user: "app-owned craft input",
      output_schema: { type: "object", additionalProperties: false },
      max_output_tokens: 2048,
      timeout_ms: 50_000,
    }));
    const adjudicate = vi.fn();
    const executor = new InstalledAppInferenceExecutor({
      resolveProvider: async () => ({ providerProfileId: "active", modelId: "model", adapter: { completeStructuredNoTools } }),
    });
    const pending = executor.execute({ ...invocation, program: { id: "resume.craft-evaluate", version: 1 } }, {
      appId: "ai.example.resume-builder",
      installationId: crypto.randomUUID(),
      packageDigest: `sha256:${"a".repeat(64)}`,
      programClient: { prepare, adjudicate },
      signal: controller.signal,
    });
    await started;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(completeStructuredNoTools).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(adjudicate).not.toHaveBeenCalled();
  });
});
