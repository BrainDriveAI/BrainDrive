export const RESUME_BUILDER_PACKAGE_ID = "ai.braindrive.resume-builder" as const;

export const CONTRACT_BINDING = {
  appContractSchemaVersion: 1,
  resumeDataSchemaVersion: 3,
  resumeInferenceSchemaVersion: 1,
  appBridgeSchemaVersion: 1,
} as const;

export const RUNTIME_ENABLED = true as const;

export * from "./workflow.js";
export * from "./opportunities.js";

export type ResumeBuilderPackageContract = {
  readonly packageId: typeof RESUME_BUILDER_PACKAGE_ID;
  readonly contractBinding: typeof CONTRACT_BINDING;
  readonly runtimeEnabled: typeof RUNTIME_ENABLED;
};

export const RESUME_INFERENCE_PURPOSES = [
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

export const RESUME_INFERENCE_PROGRAMS = {
  interview_assist: { id: "resume.interview-assist", version: 1 },
  general_resume_draft: { id: "resume.general-draft", version: 1 },
  job_description_analyze: { id: "resume.job-description-analyze", version: 1 },
  requirement_evidence_match: { id: "resume.requirement-evidence-match", version: 1 },
  tailoring_plan: { id: "resume.tailoring-plan", version: 1 },
  targeted_resume_draft: { id: "resume.targeted-draft", version: 1 },
  resume_revision_classify: { id: "resume.revision-classify", version: 1 },
  resume_revision_draft: { id: "resume.revision-draft", version: 1 },
  resume_guidance: { id: "resume.guidance", version: 1 },
  resume_strategy: { id: "resume.strategy", version: 2 },
  resume_craft_evaluate: { id: "resume.craft-evaluate", version: 1 },
  resume_craft_repair: { id: "resume.craft-repair", version: 1 },
} as const satisfies Record<ResumeInferencePurpose, { readonly id: string; readonly version: number }>;
