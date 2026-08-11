import { describe, expect, it, vi } from "vitest";

import { createResumeInferenceMcpOperations, RESUME_INFERENCE_MCP_RESOURCES, RESUME_INFERENCE_MCP_TOOLS, RESUME_INFERENCE_PURPOSES } from "../src/index.js";

describe("Resume Builder inference MCP surface", () => {
  it("declares the preserved, purpose-minimum, strategy, and craft app-visible operations", () => {
    expect(RESUME_INFERENCE_PURPOSES).toHaveLength(12);
    expect(RESUME_INFERENCE_PURPOSES).toEqual(expect.arrayContaining([
      "resume_revision_classify", "resume_revision_draft", "resume_guidance",
      "resume_strategy", "resume_craft_evaluate", "resume_craft_repair",
    ]));
    expect(RESUME_INFERENCE_MCP_TOOLS.map((tool) => tool.name)).toEqual(RESUME_INFERENCE_PURPOSES.map((purpose) => `resume.${purpose}`));
    expect(RESUME_INFERENCE_MCP_RESOURCES).toHaveLength(1);
    expect(JSON.stringify(RESUME_INFERENCE_MCP_TOOLS)).not.toContain("api_key");
    expect(JSON.stringify(RESUME_INFERENCE_MCP_TOOLS)).not.toContain("provider_profile");
  });

  it("routes through the host client, rejects unknown tools, and forwards cancellation", async () => {
    const request = vi.fn(async (input) => ({ status: "completed", purpose: input.purpose }));
    const cancel = vi.fn(async () => true);
    const operations = createResumeInferenceMcpOperations({ request, cancel });
    const operationId = crypto.randomUUID();
    await expect(operations.callTool("resume.interview_assist", { inference_contract_version: 1, operation_id: operationId, fact_revision_ids: [] })).resolves.toMatchObject({ status: "completed", purpose: "interview_assist" });
    expect(request).toHaveBeenCalledWith({ inference_contract_version: 1, purpose: "interview_assist", operation_id: operationId, fact_revision_ids: [] }, undefined);
    await expect(operations.callTool("resume.override_provider", { inference_contract_version: 1, operation_id: operationId, fact_revision_ids: [] })).rejects.toThrow("tool_not_found");
    await expect(operations.cancel(operationId)).resolves.toBe(true);
    expect(operations.readResource("resource://resume-builder/inference/purposes").text).toContain("targeted_resume_draft");
  });
});
