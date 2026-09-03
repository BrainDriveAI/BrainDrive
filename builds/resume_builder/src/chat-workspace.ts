import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { INTERVIEW_TOPICS, type DurableWorkflowSnapshot, type InterviewTopic } from "./workflow.js";

export const RESUME_CHAT_PRESENTATION_ID = "just.chat" as const;
export const RESUME_STRUCTURED_PRESENTATION_ID = "structured.internal" as const;
export const RESUME_CHAT_WORKSPACE_ID = "resume.chat" as const;
export const RESUME_STRUCTURED_RESOURCE_URI = "ui://resume-builder/main" as const;

export const RESUME_PROFILE_BINDING_ID = "resume.profile.current" as const;
export const RESUME_DOCUMENT_BINDING_ID = "resume.definition.current.general" as const;

export const RESUME_CHAT_EMPTY_STATE = {
  empty_state_version: 1,
  heading: "Let's build your resume",
  description: "Tell me the role you want, paste an existing resume, or describe your experience. I'll help shape it into a focused resume profile and draft.",
  cta_label: "Let's get started",
  cta_message: "I want to build my resume.",
} as const;

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
  { resourceId: "agent.instructions", role: "agent_instructions", packagePath: "payload/resources/agent-instructions.md", ownerEditable: true, promptInclusion: "workspace_start" },
  { resourceId: "interview.guide", role: "interview_guide", packagePath: "payload/resources/interview-guide.md", ownerEditable: true, promptInclusion: "workspace_start" },
  { resourceId: "quality.standard", role: "quality_standard", packagePath: "payload/resources/resume-quality-standard.md", ownerEditable: true, promptInclusion: "action_request" },
  { resourceId: "template.standard", role: "template_standard", packagePath: "payload/resources/resume-template-standard.md", ownerEditable: true, promptInclusion: "action_request" },
  { resourceId: "recovery.guidance", role: "recovery_guidance", packagePath: "payload/resources/recovery-guidance.md", ownerEditable: true, promptInclusion: "document_open" },
] as const;

export const RESUME_CHAT_ACTIONS = [
  {
    actionId: "resume.profile.read",
    kind: "read",
    capability: null,
    inputSchemaId: "resume.profile.read.input.v1",
    resultSchemaId: "resume.profile.read.result.v1",
    idempotencyPolicy: "not_applicable",
    confirmation: "none",
  },
  {
    actionId: "career.fact.propose",
    kind: "write",
    capability: "career.facts.propose",
    inputSchemaId: "career.fact.propose.input.v1",
    resultSchemaId: "career.fact.propose.result.v1",
    idempotencyPolicy: "required",
    confirmation: "none",
  },
  {
    actionId: "career.fact.confirm",
    kind: "write",
    capability: "career.facts.confirm",
    inputSchemaId: "career.fact.confirm.input.v1",
    resultSchemaId: "career.fact.confirm.result.v1",
    idempotencyPolicy: "required",
    confirmation: "owner_confirmation",
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

export function resumeCreateInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      locale: { type: "string", minLength: 2, maxLength: 35 },
      page_intent: { type: "string", enum: ["one_page", "two_pages", "concise", "detailed"] },
    },
    required: [],
  };
}

export type ResumeChatActionRuntimeContext = {
  sessionId: string;
  occurredAt?: string;
  turnId?: string;
};

export type ResumeActionPlanRequest = {
  action_id: string;
  action_input: unknown;
  owner_confirmed: boolean;
  operation_id: string;
  idempotency_key: string;
  occurred_at: string;
  session: {
    session_id: string;
    view_id: string;
    app_id: string;
    installation_id: string;
  };
  documents: ReadonlyArray<{
    document_id: string;
    document_binding_id: string;
    media_type: string;
    revision: number;
    revision_id: string;
    content: unknown;
  }>;
};

export type ResumeActionExecutionPlan = {
  action_plan_version: 1;
  action_id: string;
  steps: ReadonlyArray<Record<string, unknown>>;
  final_result?: Record<string, unknown>;
};

type ChatResumeStatement = {
  statement_id: string;
  section_id: string;
  kind: "presentation";
  display_role: "heading" | "bullet" | "line";
  text: string;
  supporting_confirmed_fact_revision_ids: [];
};

export function buildResumeProfileReadCapabilityInput(): Record<string, never> {
  return {};
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

export function buildResumeCreateCapabilityInput(input: ResumeChatCreateActionInput, context?: ResumeChatActionRuntimeContext) {
  const parsed = parseResumeChatContent(input, context);
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

export function planResumeAction(request: ResumeActionPlanRequest): ResumeActionExecutionPlan {
  const context = {
    sessionId: request.session.session_id,
    turnId: request.operation_id,
    occurredAt: request.occurred_at,
  };
  if (request.action_id === "resume.profile.read") {
    return actionPlan(request.action_id, [
      documentReadStep("read-profile-document", "resume.profile"),
    ]);
  }
  if (request.action_id === "career.fact.propose") {
    return actionPlan(request.action_id, [
      capabilityStep("propose-career-fact", "career.facts.propose", request.action_input, "none"),
    ]);
  }
  if (request.action_id === "career.fact.confirm") {
    return actionPlan(request.action_id, [
      capabilityStep("confirm-career-facts", "career.facts.confirm", request.action_input, "inherit"),
    ]);
  }
  if (request.action_id === "resume.profile.update") {
    const input = request.action_input as ResumeChatProfileUpdateActionInput;
    if (!input || typeof input.profile_markdown !== "string" || input.profile_markdown.trim().length === 0) {
      throw new Error("resume_profile_markdown_required");
    }
    const profileMarkdown = normalizeResumeMarkdown(input.profile_markdown);
    return actionPlan(request.action_id, [
      capabilityStep("write-profile-capability", "resume.definitions.write", buildResumeProfileUpdateCapabilityInput({ ...input, profile_markdown: profileMarkdown }, context), "none"),
      documentWriteStep("write-profile-document", "resume.profile", profileMarkdown, "text/markdown", "durable_owner_data"),
    ], "write-profile-capability");
  }
  if (request.action_id === "resume.create") {
    const rawInput = isRecord(request.action_input) ? request.action_input as ResumeChatCreateActionInput : {};
    const profileMarkdown = currentDocumentText(request, "resume.profile");
    if (!profileMarkdown) throw new Error("resume_profile_required");
    const input = {
      locale: rawInput.locale,
      page_intent: rawInput.page_intent,
      resume_markdown: profileMarkdown,
    } satisfies ResumeChatCreateActionInput;
    const capabilityInput = buildResumeCreateCapabilityInput(input, context);
    return actionPlan(request.action_id, [
      capabilityStep("write-resume-capability", "resume.definitions.write", capabilityInput, "inherit"),
      documentWriteStep("write-resume-document", "resume.document", renderResumeMarkdown(input), "text/markdown", "durable_owner_data"),
    ], "write-resume-capability");
  }
  if (request.action_id === "resume.export.pdf.request") {
    const input = request.action_input as { safe_filename?: string; destination_intent?: "new_download" | "replace_existing"; overwrite_confirmed?: boolean };
    const markdown = currentDocumentText(request, "resume.document");
    if (!isExportableResumeMarkdown(markdown)) throw new Error("formatted_resume_required");
    const bytes = renderResumeMarkdownPdf(markdown);
    return actionPlan(request.action_id, [
      {
        step_id: "prepare-pdf-export",
        type: "export.prepare",
        source: { kind: "app_document", source_id: "resume.document" },
        content_digest: digestBytes(bytes),
        content_size_bytes: bytes.length,
        retention_class: "durable_owner_data",
        media_type: "application/pdf",
        filename: normalizePdfFilename(input?.safe_filename),
        destination_intent: input?.destination_intent ?? "new_download",
        overwrite_confirmed: input?.overwrite_confirmed ?? false,
        bytes_base64: bytes.toString("base64"),
      },
    ]);
  }
  if (request.action_id === "resume.state.read") {
    return actionPlan(request.action_id, [
      capabilityStep("read-state", "resume.operations.read", request.action_input, "none"),
    ]);
  }
  throw new Error("resume_action_unknown");
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

function parseResumeChatContent(input: ResumeChatCreateActionInput, context?: ResumeChatActionRuntimeContext): {
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
      statement_id: context ? stableUuid(`${context.turnId ?? context.sessionId}:${sectionId}:${displayRole}:${statements.length}:${normalizedText}`) : randomUUID(),
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

  const normalizedMarkdown = input.resume_markdown ? normalizeResumeMarkdown(input.resume_markdown) : "";
  if (normalizedMarkdown) {
    let currentSection = "summary";
    for (const rawLine of normalizedMarkdown.split(/\r?\n/)) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionPlan(actionId: string, steps: ReadonlyArray<Record<string, unknown>>, finalStepId = steps.at(-1)?.step_id): ResumeActionExecutionPlan {
  return {
    action_plan_version: 1,
    action_id: actionId,
    steps,
    ...(typeof finalStepId === "string" ? { final_result: { kind: "step_result", step_id: finalStepId } } : {}),
  };
}

function capabilityStep(stepId: string, capability: string, input: unknown, ownerConfirmation: "inherit" | "none") {
  return {
    step_id: stepId,
    type: "capability.call",
    capability,
    capability_version: 1,
    input,
    owner_confirmation: ownerConfirmation,
  } as const;
}

function documentWriteStep(stepId: string, documentId: string, content: unknown, mediaType: string, retentionClass: string) {
  return {
    step_id: stepId,
    type: "document.write",
    document_id: documentId,
    expected_revision: "current",
    media_type: mediaType,
    retention_class: retentionClass,
    content,
  } as const;
}

function documentReadStep(stepId: string, documentId: string) {
  return {
    step_id: stepId,
    type: "document.read",
    document_id: documentId,
  } as const;
}

function renderResumeMarkdown(input: ResumeChatCreateActionInput): string {
  if (input.resume_markdown?.trim()) return normalizeResumeMarkdown(input.resume_markdown);
  const lines = input.title?.trim() ? [`# ${input.title.trim()}`, ""] : [];
  for (const section of input.sections ?? []) {
    const title = normalizeStatementText(section.title ?? section.section_id ?? "");
    if (title) lines.push(`## ${title}`);
    for (const statement of section.statements) lines.push(`- ${normalizeStatementText(statement)}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

const DATE_ENDPOINT_PATTERN = String.raw`(?:Present|Current|Now|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+[12][0-9]{3}|[12][0-9]{3})`;

function normalizeResumeMarkdown(markdown: string): string {
  const dateTrailingBulletPattern = new RegExp(String.raw`\b(${DATE_ENDPOINT_PATTERN})\s+([-*+]\s+)(?!(?:${DATE_ENDPOINT_PATTERN})\b)`, "gi");
  return markdown
    .replace(/\s+(#{1,6}\s+)/g, "\n\n$1")
    .replace(/(^|\n)(#{2,6}\s+[A-Za-z][A-Za-z0-9 &/().,:]{0,80})\s+([-*+]\s+)/g, "$1$2\n$3")
    .replace(dateTrailingBulletPattern, "$1\n$2")
    .replace(/([.!?])\s+((?:[-*+]|\d+[.)])\s+)/g, "$1\n$2")
    .replace(/\n[ \t]+((?:[-*+]|\d+[.)])\s+)/g, "\n$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function currentDocumentText(request: ResumeActionPlanRequest, documentId: string): string | null {
  const document = request.documents.find((candidate) => candidate.document_id === documentId);
  return typeof document?.content === "string" && document.content.trim() ? document.content : null;
}

function isExportableResumeMarkdown(markdown: string | null): markdown is string {
  if (!markdown) return false;
  const normalized = normalizeResumeMarkdown(markdown);
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  if (lines.length === 1 && /^#\s*resume\s*$/i.test(lines[0] ?? "")) return false;
  return lines.some((line) => /^#{2,6}\s+\S/.test(line))
    && lines.some((line) => !/^#{1,6}\s+\S/.test(line));
}

function normalizePdfFilename(value?: string): string {
  const candidate = (value ?? "resume.pdf").replace(/[\/\\\u0000-\u001f\u007f]/g, "").trim().slice(0, 128);
  if (!candidate) return "resume.pdf";
  return candidate.toLowerCase().endsWith(".pdf") ? candidate : `${candidate}.pdf`;
}

type PdfTextRun = {
  text: string;
  bold: boolean;
};

type PdfBlock =
  | { kind: "spacer" }
  | { kind: "heading"; depth: number; runs: PdfTextRun[] }
  | { kind: "bullet"; runs: PdfTextRun[] }
  | { kind: "paragraph"; runs: PdfTextRun[] };

type PdfLine = {
  runs: PdfTextRun[];
  width: number;
};

type PdfObject = string | { dictionary: string; stream: Buffer };

const PDF_FONTS = {
  regular: { baseFont: "Questrial-Regular", fileName: "Questrial-Regular.ttf", type0Ref: 4, cidRef: 6, descriptorRef: 8, fileRef: 10, cidToGidRef: 12 },
  bold: { baseFont: "Montserrat-Bold", fileName: "Montserrat-Bold.ttf", type0Ref: 5, cidRef: 7, descriptorRef: 9, fileRef: 11, cidToGidRef: 13 },
} as const;

const pdfFontCache = new Map<string, Buffer>();

function renderResumeMarkdownPdf(markdown: string): Buffer {
  const pages = renderPdfPages(markdownToPdfBlocks(markdown));
  const objects: PdfObject[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    toUnicodeCMapObject(),
    type0FontObject(PDF_FONTS.regular.baseFont, PDF_FONTS.regular.cidRef),
    type0FontObject(PDF_FONTS.bold.baseFont, PDF_FONTS.bold.cidRef),
    cidFontObject(PDF_FONTS.regular.baseFont, PDF_FONTS.regular.descriptorRef, PDF_FONTS.regular.cidToGidRef),
    cidFontObject(PDF_FONTS.bold.baseFont, PDF_FONTS.bold.descriptorRef, PDF_FONTS.bold.cidToGidRef),
    fontDescriptorObject(PDF_FONTS.regular.baseFont, PDF_FONTS.regular.fileRef),
    fontDescriptorObject(PDF_FONTS.bold.baseFont, PDF_FONTS.bold.fileRef),
    fontFileObject(readPackageFont(PDF_FONTS.regular.fileName)),
    fontFileObject(readPackageFont(PDF_FONTS.bold.fileName)),
    cidToGidMapObject(readPackageFont(PDF_FONTS.regular.fileName)),
    cidToGidMapObject(readPackageFont(PDF_FONTS.bold.fileName)),
  ];
  const pageRefs: number[] = [];
  for (const page of pages) {
    const pageRef = objects.length + 1;
    const contentRef = pageRef + 1;
    pageRefs.push(pageRef);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${PDF_FONTS.regular.type0Ref} 0 R /F2 ${PDF_FONTS.bold.type0Ref} 0 R /F3 ${PDF_FONTS.bold.type0Ref} 0 R >> >> /Contents ${contentRef} 0 R >>`);
    objects.push(pdfStream(Buffer.from(page, "utf8"), "", true));
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
  return buildPdf(objects);
}

function buildPdf(objects: readonly PdfObject[]): Buffer {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [0];
  let byteLength = chunks[0].length;
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(byteLength);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      objectBuffer(objects[index]),
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(chunk);
    byteLength += chunk.length;
  }
  const xrefOffset = byteLength;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\n`, "latin1"));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}

function readPackageFont(filename: string): Buffer {
  const cached = pdfFontCache.get(filename);
  if (cached) return cached;
  const bytes = readFileSync(new URL(`../resources/fonts/${filename}`, import.meta.url));
  pdfFontCache.set(filename, bytes);
  return bytes;
}

function type0FontObject(baseFont: string, cidFontRef: number): string {
  return `<< /Type /Font /Subtype /Type0 /BaseFont /${baseFont} /Encoding /Identity-H /DescendantFonts [${cidFontRef} 0 R] /ToUnicode 3 0 R >>`;
}

function cidFontObject(baseFont: string, descriptorRef: number, cidToGidRef: number): string {
  return `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseFont} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorRef} 0 R /DW 500 /CIDToGIDMap ${cidToGidRef} 0 R >>`;
}

function fontDescriptorObject(fontName: string, fontFileRef: number): string {
  return `<< /Type /FontDescriptor /FontName /${fontName} /Flags 32 /FontBBox [-600 -300 1600 1100] /ItalicAngle 0 /Ascent 920 /Descent -260 /CapHeight 700 /StemV 80 /MissingWidth 500 /FontFile2 ${fontFileRef} 0 R >>`;
}

function fontFileObject(bytes: Buffer): PdfObject {
  return pdfStream(bytes, ` /Length1 ${bytes.length}`, true);
}

function cidToGidMapObject(fontBytes: Buffer): PdfObject {
  return pdfStream(buildCidToGidMap(fontBytes), "", true);
}

function toUnicodeCMapObject(): PdfObject {
  return pdfStream(Buffer.from([
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    "1 beginbfrange",
    "<0000> <FFFF> <0000>",
    "endbfrange",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n"), "utf8"), "", true);
}

function pdfStream(stream: Buffer, extraDictionary = "", compress = false): PdfObject {
  const output = compress ? deflateSync(stream) : stream;
  return {
    dictionary: `<< /Length ${output.length}${extraDictionary}${compress ? " /Filter /FlateDecode" : ""} >>`,
    stream: output,
  };
}

function objectBuffer(object: PdfObject): Buffer {
  if (typeof object === "string") return Buffer.from(object, "latin1");
  return Buffer.concat([
    Buffer.from(`${object.dictionary}\nstream\n`, "latin1"),
    object.stream,
    Buffer.from("\nendstream", "latin1"),
  ]);
}

function markdownToPdfBlocks(markdown: string): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (blocks.length > 0 && blocks.at(-1)?.kind !== "spacer") blocks.push({ kind: "spacer" });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", depth: heading[1].length, runs: parsePdfInlineMarkdown(heading[2]) });
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push({ kind: "bullet", runs: parsePdfInlineMarkdown(bullet[1]) });
      continue;
    }
    blocks.push({ kind: "paragraph", runs: parsePdfInlineMarkdown(line) });
  }
  return blocks.length > 0 ? blocks : [{ kind: "paragraph", runs: [{ text: "Resume", bold: false }] }];
}

function renderPdfPages(blocks: PdfBlock[]): string[] {
  const pages: string[] = [];
  let commands: string[] = [];
  let y = 738;
  const left = 54;
  const right = 558;
  const contentWidth = right - left;

  const newPage = () => {
    if (commands.length > 0) pages.push(commands.join("\n"));
    commands = [];
    y = 738;
  };
  const ensure = (height: number) => {
    if (y - height < 48) newPage();
  };
  const drawRuns = (runs: PdfTextRun[], x: number, baseline: number, fontSize: number) => {
    let cursor = x;
    for (const run of runs) {
      if (!run.text) continue;
      commands.push(textCommand(run.bold ? "F2" : "F1", fontSize, cursor, baseline, run.text));
      cursor += textWidth(run.text, fontSize, run.bold);
    }
  };

  for (const block of blocks) {
    if (block.kind === "spacer") {
      y -= 8;
      continue;
    }
    if (block.kind === "heading") {
      if (block.depth === 1) {
        ensure(38);
        const text = runsPlainText(block.runs);
        const fontSize = 20;
        commands.push(textCommand("F3", fontSize, Math.max(left, 306 - (textWidth(text, fontSize, true) / 2)), y, text));
        y -= 30;
      } else {
        ensure(34);
        y -= 10;
        const text = runsPlainText(block.runs).toUpperCase();
        commands.push(textCommand("F2", 9.5, left, y, text));
        commands.push(`0.72 0.75 0.80 RG 0.5 w ${left} ${round(y - 8)} m ${right} ${round(y - 8)} l S 0 0 0 RG`);
        y -= 28;
      }
      continue;
    }
    if (block.kind === "bullet") {
      const lines = wrapPdfRuns(block.runs, contentWidth - 20, 10);
      ensure(lines.length * 15 + 6);
      commands.push(textCommand("F1", 10, left, y, "\u2022"));
      for (const line of lines) {
        drawRuns(line.runs, left + 16, y, 10);
        y -= 15;
      }
      y -= 3;
      continue;
    }
    const lines = wrapPdfRuns(block.runs, contentWidth, 10);
    ensure(lines.length * 15 + 8);
    for (const line of lines) {
      drawRuns(line.runs, left, y, 10);
      y -= 15;
    }
    y -= 7;
  }
  if (commands.length > 0) pages.push(commands.join("\n"));
  return pages.length > 0 ? pages : [textCommand("F1", 10, left, y, "Resume")];
}

function parsePdfInlineMarkdown(text: string): PdfTextRun[] {
  return text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g).filter(Boolean).map((part) => {
    const strong = /^(\*\*|__)(.+)\1$/.exec(part);
    return strong ? { text: normalizePdfText(strong[2]), bold: true } : { text: normalizePdfText(part), bold: false };
  }).filter((run) => run.text.length > 0);
}

function wrapPdfRuns(runs: PdfTextRun[], maxWidth: number, fontSize: number): PdfLine[] {
  const lines: PdfLine[] = [];
  let current: PdfTextRun[] = [];
  let currentWidth = 0;
  const pushRun = (run: PdfTextRun) => {
    const last = current.at(-1);
    if (last && last.bold === run.bold) last.text += run.text;
    else current.push({ ...run });
    currentWidth += textWidth(run.text, fontSize, run.bold);
  };
  const flush = () => {
    if (current.length === 0) return;
    lines.push({ runs: current, width: currentWidth });
    current = [];
    currentWidth = 0;
  };

  for (const run of runs) {
    for (const word of run.text.split(/\s+/).filter(Boolean)) {
      const prefix = current.length > 0 ? " " : "";
      const piece = `${prefix}${word}`;
      const pieceWidth = textWidth(piece, fontSize, run.bold);
      if (current.length > 0 && currentWidth + pieceWidth > maxWidth) flush();
      if (pieceWidth > maxWidth) {
        const chunkSize = Math.max(8, Math.floor(maxWidth / (fontSize * 0.55)));
        for (let index = 0; index < word.length; index += chunkSize) {
          const chunkPrefix = current.length > 0 ? " " : "";
          pushRun({ text: `${chunkPrefix}${word.slice(index, index + chunkSize)}`, bold: run.bold });
          flush();
        }
        continue;
      }
      pushRun({ text: current.length > 0 ? piece : word, bold: run.bold });
    }
  }
  flush();
  return lines.length > 0 ? lines : [{ runs: [{ text: "", bold: false }], width: 0 }];
}

function runsPlainText(runs: readonly PdfTextRun[]): string {
  return runs.map((run) => run.text).join("");
}

function textWidth(value: string, fontSize: number, bold: boolean): number {
  return normalizePdfText(value).split("").reduce((sum, character) => {
    if (character === " ") return sum + fontSize * 0.28;
    if (/[ilI.,|]/.test(character)) return sum + fontSize * 0.24;
    if (/[mwMW@]/.test(character)) return sum + fontSize * 0.78;
    if (/[A-Z]/.test(character)) return sum + fontSize * (bold ? 0.65 : 0.61);
    return sum + fontSize * (bold ? 0.55 : 0.51);
  }, 0);
}

function textCommand(font: "F1" | "F2" | "F3", size: number, x: number, y: number, value: string): string {
  return `BT /${font} ${size} Tf ${round(x)} ${round(y)} Td <${encodePdfUtf16Hex(value)}> Tj ET`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizePdfText(value: string): string {
  return value
    .replace(/[ \t]+/g, " ")
    .replace(/[\u2012-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, " ")
    .trim();
}

function encodePdfUtf16Hex(value: string): string {
  return Buffer.from(normalizePdfText(value).replace(/[\u0000-\u001f\u007f]/g, " "), "utf16le").swap16().toString("hex").toUpperCase();
}

function buildCidToGidMap(fontBytes: Buffer): Buffer {
  const glyphs = readTrueTypeCmap(fontBytes);
  const map = Buffer.alloc(65_536 * 2);
  for (let code = 0; code <= 0xffff; code += 1) {
    map.writeUInt16BE(glyphs[code] ?? 0, code * 2);
  }
  return map;
}

function readTrueTypeCmap(fontBytes: Buffer): Uint16Array {
  const cmapOffset = findTrueTypeTable(fontBytes, "cmap");
  if (cmapOffset === null) throw new Error("pdf_font_cmap_missing");
  const tableCount = fontBytes.readUInt16BE(cmapOffset + 2);
  let selectedOffset: number | null = null;
  let selectedRank = Number.POSITIVE_INFINITY;
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = cmapOffset + 4 + index * 8;
    const platform = fontBytes.readUInt16BE(recordOffset);
    const encoding = fontBytes.readUInt16BE(recordOffset + 2);
    const subtableOffset = cmapOffset + fontBytes.readUInt32BE(recordOffset + 4);
    const format = fontBytes.readUInt16BE(subtableOffset);
    const rank = cmapRank(platform, encoding, format);
    if (rank < selectedRank) {
      selectedRank = rank;
      selectedOffset = subtableOffset;
    }
  }
  if (selectedOffset === null) throw new Error("pdf_font_cmap_unsupported");
  const format = fontBytes.readUInt16BE(selectedOffset);
  if (format === 12) return readFormat12Cmap(fontBytes, selectedOffset);
  if (format === 4) return readFormat4Cmap(fontBytes, selectedOffset);
  throw new Error("pdf_font_cmap_unsupported");
}

function cmapRank(platform: number, encoding: number, format: number): number {
  if (format === 12 && platform === 3 && encoding === 10) return 0;
  if (format === 12 && platform === 0) return 1;
  if (format === 4 && platform === 3 && encoding === 1) return 2;
  if (format === 4 && platform === 0) return 3;
  return Number.POSITIVE_INFINITY;
}

function findTrueTypeTable(fontBytes: Buffer, tag: string): number | null {
  const tableCount = fontBytes.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    if (fontBytes.toString("latin1", recordOffset, recordOffset + 4) === tag) {
      return fontBytes.readUInt32BE(recordOffset + 8);
    }
  }
  return null;
}

function readFormat12Cmap(fontBytes: Buffer, offset: number): Uint16Array {
  const glyphs = new Uint16Array(65_536);
  const groupCount = fontBytes.readUInt32BE(offset + 12);
  for (let index = 0; index < groupCount; index += 1) {
    const groupOffset = offset + 16 + index * 12;
    const start = fontBytes.readUInt32BE(groupOffset);
    const end = fontBytes.readUInt32BE(groupOffset + 4);
    const startGlyph = fontBytes.readUInt32BE(groupOffset + 8);
    const cappedEnd = Math.min(end, 0xffff);
    for (let code = start; code <= cappedEnd; code += 1) {
      glyphs[code] = (startGlyph + code - start) & 0xffff;
    }
  }
  return glyphs;
}

function readFormat4Cmap(fontBytes: Buffer, offset: number): Uint16Array {
  const glyphs = new Uint16Array(65_536);
  const length = fontBytes.readUInt16BE(offset + 2);
  const segCount = fontBytes.readUInt16BE(offset + 6) / 2;
  const endCodeOffset = offset + 14;
  const startCodeOffset = endCodeOffset + segCount * 2 + 2;
  const idDeltaOffset = startCodeOffset + segCount * 2;
  const idRangeOffsetOffset = idDeltaOffset + segCount * 2;
  for (let segment = 0; segment < segCount; segment += 1) {
    const start = fontBytes.readUInt16BE(startCodeOffset + segment * 2);
    const end = fontBytes.readUInt16BE(endCodeOffset + segment * 2);
    const delta = fontBytes.readInt16BE(idDeltaOffset + segment * 2);
    const rangeOffsetPosition = idRangeOffsetOffset + segment * 2;
    const rangeOffset = fontBytes.readUInt16BE(rangeOffsetPosition);
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      let glyph = 0;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const glyphOffset = rangeOffsetPosition + rangeOffset + (code - start) * 2;
        if (glyphOffset + 2 <= offset + length) {
          glyph = fontBytes.readUInt16BE(glyphOffset);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
      }
      glyphs[code] = glyph;
    }
  }
  return glyphs;
}

function digestBytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
