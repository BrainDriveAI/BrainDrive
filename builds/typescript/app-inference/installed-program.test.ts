import { describe, expect, it, vi } from "vitest";

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
    const executor = new InstalledAppInferenceExecutor({ resolveProvider });

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
});
