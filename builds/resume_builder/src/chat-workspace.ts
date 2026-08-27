import { INTERVIEW_TOPICS, type DurableWorkflowSnapshot, type InterviewTopic } from "./workflow.js";

export const RESUME_CHAT_PRESENTATION_ID = "just.chat" as const;
export const RESUME_STRUCTURED_PRESENTATION_ID = "structured.internal" as const;
export const RESUME_CHAT_WORKSPACE_ID = "resume.chat" as const;
export const RESUME_STRUCTURED_RESOURCE_URI = "ui://resume-builder/main" as const;

export const RESUME_PROFILE_BINDING_ID = "resume.profile.current" as const;
export const RESUME_DOCUMENT_BINDING_ID = "resume.definition.current.general" as const;

export const RESUME_CHAT_DOCUMENTS = {
  conversation: "conversation",
  profile: "resume.profile",
  resume: "resume.document",
  agentInstructions: "agent.instructions",
  interviewGuide: "interview.guide",
  qualityStandard: "quality.standard",
  templateStandard: "template.standard",
  recoveryGuidance: "recovery.guidance",
} as const;

export const RESUME_CHAT_RESOURCES = [
  { resourceId: "agent.instructions", role: "agent_instructions", packagePath: "payload/resources/agent-instructions.md", promptInclusion: "workspace_start" },
  { resourceId: "interview.guide", role: "interview_guide", packagePath: "payload/resources/interview-guide.md", promptInclusion: "workspace_start" },
  { resourceId: "quality.standard", role: "quality_standard", packagePath: "payload/resources/resume-quality-standard.md", promptInclusion: "action_request" },
  { resourceId: "template.standard", role: "template_standard", packagePath: "payload/resources/resume-template-standard.md", promptInclusion: "action_request" },
  { resourceId: "recovery.guidance", role: "recovery_guidance", packagePath: "payload/resources/recovery-guidance.md", promptInclusion: "document_open" },
] as const;

export const RESUME_CHAT_ACTIONS = [
  {
    actionId: "resume.profile.read",
    kind: "read",
    capability: "resume.definitions.read",
    inputSchemaId: "resume.profile.read.input.v1",
    resultSchemaId: "resume.profile.read.result.v1",
    idempotencyPolicy: "not_applicable",
    confirmation: "none",
  },
  {
    actionId: "resume.profile.update",
    kind: "write",
    capability: "resume.definitions.write",
    inputSchemaId: "resume.profile.update.input.v1",
    resultSchemaId: "resume.profile.update.result.v1",
    idempotencyPolicy: "required",
    confirmation: "none",
  },
  {
    actionId: "resume.create",
    kind: "render",
    capability: "resume.definitions.write",
    inputSchemaId: "resume.create.input.v1",
    resultSchemaId: "resume.create.result.v1",
    idempotencyPolicy: "required",
    confirmation: "owner_confirmation",
  },
  {
    actionId: "resume.export.pdf.request",
    kind: "export",
    capability: "resume.export.request",
    inputSchemaId: "resume.export.pdf.request.input.v1",
    resultSchemaId: "resume.export.pdf.request.result.v1",
    idempotencyPolicy: "required",
    confirmation: "trusted_owner_confirmation",
  },
  {
    actionId: "resume.state.read",
    kind: "inspect",
    capability: "resume.operations.read",
    inputSchemaId: "resume.state.read.input.v1",
    resultSchemaId: "resume.state.read.result.v1",
    idempotencyPolicy: "not_applicable",
    confirmation: "none",
  },
] as const;

export type ResumeProfileTopicProjection = {
  topic: InterviewTopic;
  status: "current" | "completed" | "skipped" | "pending";
};

export type ResumeProfileProjection = {
  bindingId: typeof RESUME_PROFILE_BINDING_ID;
  source: "resume-domain";
  entryPoint: DurableWorkflowSnapshot["entry_point"] | null;
  confirmedFactCount: number;
  topics: ResumeProfileTopicProjection[];
  currentTopic: InterviewTopic | null;
  recoveryDraftPresent: boolean;
  jobCount: number;
  generalResumeCount: number;
  targetedResumeCount: number;
};

export type ResumeDocumentProjection = {
  bindingId: typeof RESUME_DOCUMENT_BINDING_ID;
  sourceProfileBindingId: typeof RESUME_PROFILE_BINDING_ID;
  source: "resume-domain";
  definitionRevisionId: string | null;
  status: "missing" | "draft" | "proposed" | "approved";
  derivative: true;
};

export function projectResumeProfile(snapshot: DurableWorkflowSnapshot | null): ResumeProfileProjection {
  const completed = new Set(snapshot?.interview?.completed_topics ?? []);
  const skipped = new Set(snapshot?.interview?.skipped_topics ?? []);
  const current = normalizeTopic(snapshot?.interview?.current_topic ?? null);
  return {
    bindingId: RESUME_PROFILE_BINDING_ID,
    source: "resume-domain",
    entryPoint: snapshot?.entry_point ?? null,
    confirmedFactCount: snapshot?.confirmed_fact_count ?? 0,
    topics: INTERVIEW_TOPICS.map((topic) => ({
      topic,
      status: current === topic ? "current" : completed.has(topic) ? "completed" : skipped.has(topic) ? "skipped" : "pending",
    })),
    currentTopic: current,
    recoveryDraftPresent: Boolean(snapshot?.interview?.recovery_draft),
    jobCount: snapshot?.jobs.length ?? 0,
    generalResumeCount: snapshot?.general_definitions.length ?? 0,
    targetedResumeCount: snapshot?.targeted_definitions.length ?? 0,
  };
}

export function projectResumeDocument(snapshot: DurableWorkflowSnapshot | null): ResumeDocumentProjection {
  const selected = selectCurrentGeneralDefinition(snapshot);
  return {
    bindingId: RESUME_DOCUMENT_BINDING_ID,
    sourceProfileBindingId: RESUME_PROFILE_BINDING_ID,
    source: "resume-domain",
    definitionRevisionId: selected?.revision_id ?? null,
    status: selected?.status ?? "missing",
    derivative: true,
  };
}

export function describeResumeChatStateConvergence() {
  return {
    authoritativeStore: "resume-domain",
    chatWorkspace: {
      profileBindingId: RESUME_PROFILE_BINDING_ID,
      resumeBindingId: RESUME_DOCUMENT_BINDING_ID,
    },
    structuredSurface: {
      profileBindingId: RESUME_PROFILE_BINDING_ID,
      resumeBindingId: RESUME_DOCUMENT_BINDING_ID,
      presentationId: RESUME_STRUCTURED_PRESENTATION_ID,
      ownerVisibility: "internal",
    },
  } as const;
}

function normalizeTopic(value: string | null): InterviewTopic | null {
  return INTERVIEW_TOPICS.find((topic) => topic === value) ?? null;
}

function selectCurrentGeneralDefinition(snapshot: DurableWorkflowSnapshot | null): DurableWorkflowSnapshot["general_definitions"][number] | null {
  if (!snapshot || snapshot.general_definitions.length === 0) return null;
  return snapshot.general_definitions.find((definition) => definition.status === "approved")
    ?? snapshot.general_definitions.find((definition) => definition.status === "proposed")
    ?? snapshot.general_definitions.find((definition) => definition.status === "draft")
    ?? null;
}
