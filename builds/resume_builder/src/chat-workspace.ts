import { randomUUID } from "node:crypto";

import { INTERVIEW_TOPICS, type DurableWorkflowSnapshot, type InterviewTopic } from "./workflow.js";

export const RESUME_CHAT_PRESENTATION_ID = "just.chat" as const;
export const RESUME_STRUCTURED_PRESENTATION_ID = "structured.internal" as const;
export const RESUME_CHAT_WORKSPACE_ID = "resume.chat" as const;
export const RESUME_STRUCTURED_RESOURCE_URI = "ui://resume-builder/main" as const;

export const RESUME_PROFILE_BINDING_ID = "resume.profile.current" as const;
export const RESUME_DOCUMENT_BINDING_ID = "resume.definition.current.general" as const;

export const RESUME_EXPORT_ARTIFACTS = {
  pdf: {
    artifactId: "resume.export.pdf",
    format: "pdf",
    mediaType: "application/pdf",
    sourceDocumentId: "resume.document",
    retentionClass: "durable_owner_data",
    destinationPolicy: "host_mediated_owner_confirmed",
    safeFilename: "resume.pdf",
  },
  text: {
    artifactId: "resume.export.text",
    format: "text",
    mediaType: "text/plain",
    sourceDocumentId: "resume.document",
    retentionClass: "durable_owner_data",
    destinationPolicy: "host_mediated_owner_confirmed",
    safeFilename: "resume.txt",
  },
} as const;

export const RESUME_APP_STORAGE_DOCUMENTS = {
  profile: {
    documentId: "resume.profile",
    bindingId: RESUME_PROFILE_BINDING_ID,
    role: "source_document",
    retentionClass: "durable_owner_data",
    mediaType: "text/markdown",
    compatibilitySource: "resume-domain",
  },
  resume: {
    documentId: "resume.document",
    bindingId: RESUME_DOCUMENT_BINDING_ID,
    role: "derived_document",
    retentionClass: "durable_owner_data",
    mediaType: "text/markdown",
    compatibilitySource: "resume-domain",
  },
  recovery: {
    documentId: "resume.recovery",
    bindingId: "resume.recovery.current",
    role: "recovery_document",
    retentionClass: "rollback_recovery_window",
    mediaType: "application/json",
    compatibilitySource: "resume-domain",
  },
  actionResult: {
    documentId: "resume.action-result",
    bindingId: "resume.action-result.latest",
    role: "action_result_document",
    retentionClass: "durable_operation_lookup",
    mediaType: "application/json",
    compatibilitySource: "resume-domain",
  },
} as const;

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

export type ResumeChatProfileUpdateActionInput = {
  profile_markdown: string;
  completed_topics?: readonly string[];
  current_topic?: string | null;
  skipped_topics?: readonly string[];
};

export type ResumeChatCreateSectionInput = {
  section_id?: string;
  title?: string;
  statements: readonly string[];
};

export type ResumeChatCreateActionInput = {
  title?: string;
  resume_markdown?: string;
  sections?: readonly ResumeChatCreateSectionInput[];
  locale?: string;
  page_intent?: "one_page" | "two_pages" | "concise" | "detailed";
};

export type ResumeChatActionRuntimeContext = {
  sessionId: string;
  occurredAt?: string;
  turnId?: string;
};

type ChatResumeStatement = {
  statement_id: string;
  section_id: string;
  kind: "presentation";
  display_role: "heading" | "bullet" | "line";
  text: string;
  supporting_confirmed_fact_revision_ids: [];
};

export function buildResumeProfileReadCapabilityInput(): { view: "workspace" } {
  return { view: "workspace" };
}

export function buildResumeProfileUpdateCapabilityInput(
  input: ResumeChatProfileUpdateActionInput,
  context: ResumeChatActionRuntimeContext,
) {
  return {
    kind: "interview_progress",
    progress: {
      expected_revision: null,
      status: "review_needed",
      current_topic: input.current_topic ?? null,
      completed_topics: [...(input.completed_topics ?? ["direction", "experience", "education", "credentials", "skills"])],
      skipped_topics: [...(input.skipped_topics ?? [])],
      draft_state: "owner_reviewed",
      session_id: context.sessionId,
      audit_turn: {
        transcript_version: 1,
        turn_id: context.turnId ?? randomUUID(),
        session_id: context.sessionId,
        prompt_version: "resume-builder-chat-profile-v1",
        topic: "resume_profile",
        question: "Capture the owner-reviewed Resume Profile from the app chat.",
        answer: input.profile_markdown,
        follow_up: null,
        action: "answered",
        occurred_at: context.occurredAt ?? new Date().toISOString(),
      },
    },
  } as const;
}

export function buildResumeCreateCapabilityInput(input: ResumeChatCreateActionInput) {
  const parsed = parseResumeChatContent(input);
  if (parsed.statements.length === 0 || parsed.sectionOrder.length === 0) {
    throw new Error("Resume create requires at least one resume statement");
  }
  return {
    definition_kind: "general",
    status: "proposed",
    title: parsed.title,
    statements: parsed.statements,
    section_order: parsed.sectionOrder,
    presentation_preferences: {},
    locale: input.locale ?? "en-US",
    page_intent: input.page_intent ?? "one_page",
    template_id: "resume.single-column",
    template_version: "1",
    parent_definition_revision_id: null,
    job_revision_id: null,
    policy_version: "owner-authored-v1",
    prompt_policy_version: null,
    variant: null,
  } as const;
}

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
    authoritativeStore: "app-storage",
    compatibilityReadThrough: "resume-domain",
    migrationEvidence: "profile and resume projections are seeded into generic app documents without rewriting existing Resume-domain records",
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

export function describeResumeExportMediation() {
  return {
    api: "generic_app_artifact_export_v1",
    rendererOwner: "resume-builder",
    hostOwner: "braindrive",
    appReceives: ["safe_destination_label", "artifact_revision_id", "content_digest", "receipt_revision_id"],
    appNeverReceives: ["raw_filesystem_path", "destination_path", "provider_credentials", "host_authorization"],
    artifacts: RESUME_EXPORT_ARTIFACTS,
  } as const;
}

export function projectResumeStorageDocuments(snapshot: DurableWorkflowSnapshot | null) {
  return [
    {
      ...RESUME_APP_STORAGE_DOCUMENTS.profile,
      content: {
        storage_projection_version: 1,
        compatibility_source: "resume-domain",
        projection: projectResumeProfile(snapshot),
      },
    },
    {
      ...RESUME_APP_STORAGE_DOCUMENTS.resume,
      content: {
        storage_projection_version: 1,
        compatibility_source: "resume-domain",
        projection: projectResumeDocument(snapshot),
      },
    },
  ] as const;
}

function parseResumeChatContent(input: ResumeChatCreateActionInput): {
  title: string;
  statements: ChatResumeStatement[];
  sectionOrder: string[];
} {
  const sectionOrder: string[] = [];
  const statements: ChatResumeStatement[] = [];
  let title = normalizeStatementText(input.title ?? "") || null;

  const addSection = (sectionId: string) => {
    if (!sectionOrder.includes(sectionId)) sectionOrder.push(sectionId);
  };
  const addStatement = (sectionId: string, text: string, displayRole: ChatResumeStatement["display_role"]) => {
    const normalizedText = normalizeStatementText(text);
    if (!normalizedText) return;
    addSection(sectionId);
    statements.push({
      statement_id: randomUUID(),
      section_id: sectionId,
      kind: "presentation",
      display_role: displayRole,
      text: normalizedText,
      supporting_confirmed_fact_revision_ids: [],
    });
  };

  if (input.sections) {
    for (const section of input.sections) {
      const sectionTitle = normalizeStatementText(section.title ?? section.section_id ?? "resume");
      const sectionId = sectionIdFor(section.section_id ?? sectionTitle);
      addSection(sectionId);
      if (section.title) addStatement(sectionId, sectionTitle, "heading");
      for (const statement of section.statements) addStatement(sectionId, statement, "bullet");
    }
  }

  if (input.resume_markdown) {
    let currentSection = "summary";
    for (const rawLine of input.resume_markdown.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const h1 = /^#\s+(.+)$/.exec(line);
      if (h1) {
        title ??= normalizeStatementText(h1[1]);
        continue;
      }
      const h2 = /^#{2,6}\s+(.+)$/.exec(line);
      if (h2) {
        const heading = normalizeStatementText(h2[1]);
        currentSection = sectionIdFor(heading);
        addStatement(currentSection, heading, "heading");
        continue;
      }
      const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
      if (bullet) {
        addStatement(currentSection, bullet[1], "bullet");
        continue;
      }
      addStatement(currentSection, line, "line");
    }
  }

  if (statements.length > 500) {
    throw new Error("Resume create supports up to 500 statements");
  }
  return {
    title: title ?? "General Resume",
    statements,
    sectionOrder: sectionOrder.length > 0 ? sectionOrder : ["summary"],
  };
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

function sectionIdFor(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || `section-${randomUUID()}`;
}

function normalizeStatementText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
