export const RESUME_BUILDER_PACKAGE_ID = "ai.braindrive.resume-builder" as const;

export const CONTRACT_BINDING = {
  appContractSchemaVersion: 1,
  resumeDataSchemaVersion: 3,
  resumeInferenceSchemaVersion: 1,
  appBridgeSchemaVersion: 1,
} as const;

export const RUNTIME_ENABLED = false as const;

export * from "./workflow.js";
export * from "./opportunities.js";

export type ResumeBuilderPackageContract = {
  readonly packageId: typeof RESUME_BUILDER_PACKAGE_ID;
  readonly contractBinding: typeof CONTRACT_BINDING;
  readonly runtimeEnabled: typeof RUNTIME_ENABLED;
};

export const RESUME_INFERENCE_PURPOSES = [
  "resume_dialogue",
  "interview_assist",
  "general_resume_draft",
  "job_description_analyze",
  "requirement_evidence_match",
  "tailoring_plan",
  "targeted_resume_draft",
  "resume_revision_classify",
  "resume_revision_draft",
  "resume_guidance",
  "resume_strategy",
  "resume_craft_evaluate",
  "resume_craft_repair",
] as const;

export type ResumeInferencePurpose = typeof RESUME_INFERENCE_PURPOSES[number];

export const RESUME_INFERENCE_MCP_TOOLS = RESUME_INFERENCE_PURPOSES.map((purpose) => ({
  name: `resume.${purpose}`,
  description: `Request the host-brokered ${purpose} structured proposal`,
  inputSchema: {
    type: "object",
    properties: {
      inference_contract_version: { const: 1 },
      operation_id: { type: "string", format: "uuid" },
      fact_revision_ids: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 500 },
      record_revision_ids: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 64 },
      presentation_preferences: { type: "object", additionalProperties: { type: "string", maxLength: 2048 } },
      derived_blocks: { type: "array", maxItems: 8 },
    },
    required: ["inference_contract_version", "operation_id", "fact_revision_ids"],
    additionalProperties: false,
  },
  _meta: { "io.modelcontextprotocol/ui": { visibility: ["app"] } },
})) as ReadonlyArray<Record<string, unknown>>;

export const RESUME_INFERENCE_MCP_RESOURCES = [{
  uri: "resource://resume-builder/inference/purposes",
  name: "Resume Builder inference purposes",
  mimeType: "application/json",
  _meta: { sensitivity: "public_policy", retention: "immutable_package" },
}] as const;

export type HostInferenceClient = {
  request(input: {
    inference_contract_version: 1;
    purpose: ResumeInferencePurpose;
    operation_id: string;
    fact_revision_ids: string[];
    record_revision_ids?: string[];
    presentation_preferences?: Record<string, string>;
    derived_blocks?: unknown[];
  }, signal?: AbortSignal): Promise<unknown>;
  cancel(operationId: string): Promise<boolean>;
};

export function createResumeInferenceMcpOperations(host: HostInferenceClient) {
  return {
    listTools: () => RESUME_INFERENCE_MCP_TOOLS,
    listResources: () => RESUME_INFERENCE_MCP_RESOURCES,
    readResource: (uri: string) => {
      if (uri !== RESUME_INFERENCE_MCP_RESOURCES[0].uri) throw new Error("resource_not_found");
      return { uri, mimeType: "application/json", text: JSON.stringify({ schema_version: 1, purposes: RESUME_INFERENCE_PURPOSES }) };
    },
    callTool: async (name: string, input: Omit<Parameters<HostInferenceClient["request"]>[0], "purpose">, signal?: AbortSignal) => {
      const purpose = name.startsWith("resume.") ? name.slice("resume.".length) : "";
      if (!RESUME_INFERENCE_PURPOSES.includes(purpose as ResumeInferencePurpose)) throw new Error("tool_not_found");
      return host.request({ ...input, purpose: purpose as ResumeInferencePurpose }, signal);
    },
    cancel: (operationId: string) => host.cancel(operationId),
  };
}
