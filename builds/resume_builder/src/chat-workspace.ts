import { createHash, randomUUID } from "node:crypto";

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
    const input = request.action_input as ResumeChatCreateActionInput;
    const capabilityInput = buildResumeCreateCapabilityInput(input, context);
    return actionPlan(request.action_id, [
      capabilityStep("write-resume-capability", "resume.definitions.write", capabilityInput, "inherit"),
      documentWriteStep("write-resume-document", "resume.document", renderResumeMarkdown(input), "text/markdown", "durable_owner_data"),
    ], "write-resume-capability");
  }
  if (request.action_id === "resume.export.pdf.request") {
    const input = request.action_input as { safe_filename?: string; destination_intent?: "new_download" | "replace_existing"; overwrite_confirmed?: boolean };
    const markdown = currentDocumentText(request, "resume.document");
    if (!markdown) throw new Error("resume_document_required");
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

function normalizeResumeMarkdown(markdown: string): string {
  return markdown
    .replace(/\s+(#{1,6}\s+)/g, "\n\n$1")
    .replace(/\s+((?:[-*+]|\d+[.)])\s+)/g, "\n$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function currentDocumentText(request: ResumeActionPlanRequest, documentId: string): string | null {
  const document = request.documents.find((candidate) => candidate.document_id === documentId);
  return typeof document?.content === "string" && document.content.trim() ? document.content : null;
}

function normalizePdfFilename(value?: string): string {
  const candidate = (value ?? "resume.pdf").replace(/[\/\\\u0000-\u001f\u007f]/g, "").trim().slice(0, 128);
  if (!candidate) return "resume.pdf";
  return candidate.toLowerCase().endsWith(".pdf") ? candidate : `${candidate}.pdf`;
}

function renderResumeMarkdownPdf(markdown: string): Buffer {
  const lines = markdownToPdfLines(markdown);
  const textCommands = lines.map((line, index) => {
    const y = 760 - (index * 16);
    return `BT /F1 10 Tf 72 ${y} Td (${escapePdfText(line)}) Tj ET`;
  }).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(textCommands, "utf8")} >>\nstream\n${textCommands}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function markdownToPdfLines(markdown: string): string[] {
  const lines: string[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const text = normalizeStatementText(rawLine.replace(/^#{1,6}\s+/, "").replace(/^(?:[-*+]|\d+[.)])\s+/, ""));
    if (!text) {
      if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
      continue;
    }
    for (const part of wrapPdfLine(text, 92)) lines.push(part);
    if (lines.length >= 42) break;
  }
  return lines.length > 0 ? lines.slice(0, 42) : ["Resume"];
}

function wrapPdfLine(value: string, width: number): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.slice(0, width);
  }
  if (current) lines.push(current);
  return lines;
}

function escapePdfText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function digestBytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
