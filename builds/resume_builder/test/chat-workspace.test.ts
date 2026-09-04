import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  RESUME_CHAT_ACTIONS,
  RESUME_CHAT_DOCUMENTS,
  RESUME_CHAT_EMPTY_STATE,
  RESUME_CHAT_PRESENTATION_ID,
  RESUME_CHAT_RESOURCES,
  RESUME_CHAT_WORKSPACE_ID,
  RESUME_DOCUMENT_BINDING_ID,
  RESUME_EXPORT_ARTIFACTS,
  RESUME_PROFILE_BINDING_ID,
  RESUME_STRUCTURED_PRESENTATION_ID,
  RESUME_STRUCTURED_RESOURCE_URI,
  buildResumeCreateCapabilityInput,
  buildResumeProfileReadCapabilityInput,
  buildResumeProfileUpdateCapabilityInput,
  describeResumeChatStateConvergence,
  describeResumeExportMediation,
  planResumeAction,
  projectResumeStorageDocuments,
  projectResumeDocument,
  projectResumeProfile,
  resumeCreateInputSchema,
  type DurableWorkflowSnapshot,
} from "../src/index.js";

function inflatedPdfText(pdfBytes: Buffer): string {
  const source = pdfBytes.toString("latin1");
  const streams: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const streamStart = source.indexOf("stream\n", cursor);
    if (streamStart === -1) break;
    const dataStart = streamStart + "stream\n".length;
    const dataEnd = source.indexOf("\nendstream", dataStart);
    if (dataEnd === -1) break;
    const objectStart = source.lastIndexOf("<<", streamStart);
    const dictionary = objectStart >= 0 ? source.slice(objectStart, streamStart) : "";
    if (dictionary.includes("/Filter /FlateDecode")) {
      const inflated = inflateSync(pdfBytes.subarray(dataStart, dataEnd)).toString("utf8");
      if (inflated.includes(" Tj")) {
        streams.push(inflated);
      }
    }
    cursor = dataEnd + "\nendstream".length;
  }
  return streams.join("\n");
}

function decodedPdfTextRuns(pdfBytes: Buffer): string {
  const inflated = inflatedPdfText(pdfBytes);
  const runs: string[] = [];
  for (const match of inflated.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    runs.push(Buffer.from(match[1], "hex").swap16().toString("utf16le"));
  }
  return runs.join("\n");
}

function rasterizedPdfTextLayoutDigest(pdfBytes: Buffer): string {
  const width = 153;
  const height = 198;
  const pageHeight = 792;
  const scale = 0.25;
  const pixels = Buffer.alloc(width * height);
  const inflated = inflatedPdfText(pdfBytes);
  const commandPattern = /BT \/F[123] ([0-9.]+) Tf ([0-9.]+) ([0-9.]+) Td <([0-9A-Fa-f]+)> Tj ET/g;
  for (const match of inflated.matchAll(commandPattern)) {
    const fontSize = Number(match[1]);
    let x = Math.round(Number(match[2]) * scale);
    const baseline = Math.round((pageHeight - Number(match[3])) * scale);
    const glyphWidth = Math.max(1, Math.round(fontSize * 0.13));
    const glyphHeight = Math.max(2, Math.round(fontSize * 0.25));
    const text = Buffer.from(match[4], "hex").swap16().toString("utf16le");
    for (const character of Array.from(text)) {
      if (/\s/.test(character)) {
        x += glyphWidth;
        continue;
      }
      for (let dy = 0; dy < glyphHeight; dy += 1) {
        const row = baseline - dy;
        if (row < 0 || row >= height) continue;
        for (let dx = 0; dx < glyphWidth; dx += 1) {
          const column = x + dx;
          if (column >= 0 && column < width) pixels[row * width + column] = 1;
        }
      }
      x += glyphWidth + 1;
    }
  }
  return createHash("sha256").update(pixels).digest("hex");
}

function snapshot(overrides: Partial<DurableWorkflowSnapshot> = {}): DurableWorkflowSnapshot {
  return {
    entry_point: "career",
    known_topics: ["contact", "employment"],
    confirmed_fact_count: 7,
    interview: {
      status: "in_progress",
      current_topic: "accomplishments",
      completed_topics: ["contact", "employment"],
      skipped_topics: ["links"],
      recovery_draft: null,
    },
    general_definitions: [{ revision_id: "draft-1", status: "draft" }],
    jobs: [{ revision_id: "job-1" }],
    targeted_definitions: [],
    artifacts: [],
    ...overrides,
  };
}

describe("Resume Builder chat workspace contract", () => {
  it("declares the chat-first presentation and hidden structured surface identities", () => {
    expect(RESUME_CHAT_PRESENTATION_ID).toBe("just.chat");
    expect(RESUME_CHAT_WORKSPACE_ID).toBe("resume.chat");
    expect(RESUME_STRUCTURED_PRESENTATION_ID).toBe("structured.internal");
    expect(RESUME_STRUCTURED_RESOURCE_URI).toBe("ui://resume-builder/main");
    expect(RESUME_CHAT_DOCUMENTS.profile).toBe("resume.profile");
    expect(RESUME_CHAT_DOCUMENTS.resume).toBe("resume.document");
    expect(RESUME_CHAT_EMPTY_STATE).toMatchObject({
      heading: "Let's build your resume",
      cta_label: "Let's get started",
      cta_message: "I want to build my resume.",
    });
  });

  it("keeps Profile and Resume bound to one Resume-domain state source", () => {
    const convergence = describeResumeChatStateConvergence();
    expect(convergence.authoritativeStore).toBe("app-storage");
    expect(convergence.compatibilityReadThrough).toBe("resume-domain");
    expect(convergence.chatWorkspace.profileBindingId).toBe(RESUME_PROFILE_BINDING_ID);
    expect(convergence.structuredSurface.profileBindingId).toBe(RESUME_PROFILE_BINDING_ID);
    expect(convergence.chatWorkspace.resumeBindingId).toBe(RESUME_DOCUMENT_BINDING_ID);
    expect(convergence.structuredSurface.resumeBindingId).toBe(RESUME_DOCUMENT_BINDING_ID);
    expect(convergence.structuredSurface.ownerVisibility).toBe("internal");
  });

  it("declares Resume export artifacts through the generic host-mediated API", () => {
    expect(RESUME_EXPORT_ARTIFACTS).toMatchObject({
      pdf: {
        artifactId: "resume.export.pdf",
        format: "pdf",
        mediaType: "application/pdf",
        sourceDocumentId: "resume.document",
        destinationPolicy: "host_mediated_owner_confirmed",
        safeFilename: "resume.pdf",
      },
      text: {
        artifactId: "resume.export.text",
        format: "text",
        mediaType: "text/plain",
        sourceDocumentId: "resume.document",
        destinationPolicy: "host_mediated_owner_confirmed",
        safeFilename: "resume.txt",
      },
    });

    const mediation = describeResumeExportMediation();
    expect(mediation).toMatchObject({
      api: "generic_app_artifact_export_v1",
      rendererOwner: "resume-builder",
      hostOwner: "braindrive",
    });
    expect(mediation.appReceives).toEqual(["safe_destination_label", "artifact_revision_id", "content_digest", "receipt_revision_id"]);
    expect(mediation.appNeverReceives).toEqual(["raw_filesystem_path", "destination_path", "provider_credentials", "host_authorization"]);
    expect(JSON.stringify(mediation)).not.toMatch(/\/home\/|[A-Za-z]:\\/);
  });

  it("seeds existing Resume-domain Profile and Resume projections into generic app documents", () => {
    const [profile, resume] = projectResumeStorageDocuments(snapshot());

    expect(profile).toMatchObject({
      documentId: "resume.profile",
      bindingId: RESUME_PROFILE_BINDING_ID,
      role: "source_document",
      retentionClass: "durable_owner_data",
      compatibilitySource: "resume-domain",
      content: {
        storage_projection_version: 1,
        compatibility_source: "resume-domain",
        projection: { bindingId: RESUME_PROFILE_BINDING_ID, source: "resume-domain", confirmedFactCount: 7 },
      },
    });
    expect(resume).toMatchObject({
      documentId: "resume.document",
      bindingId: RESUME_DOCUMENT_BINDING_ID,
      role: "derived_document",
      retentionClass: "durable_owner_data",
      content: {
        projection: { bindingId: RESUME_DOCUMENT_BINDING_ID, source: "resume-domain", derivative: true },
      },
    });
  });

  it("keeps the hidden structured surface state-consistent across recovery and approved resume state", () => {
    const current = snapshot({
      interview: {
        status: "in_progress",
        current_topic: "contact",
        completed_topics: ["employment"],
        skipped_topics: [],
        recovery_draft: { value: "Recovered owner draft", acknowledged_revision: 2 },
      },
      general_definitions: [
        { revision_id: "draft-1", status: "draft" },
        { revision_id: "approved-1", status: "approved" },
      ],
    });
    const profile = projectResumeProfile(current);
    const resume = projectResumeDocument(current);
    const convergence = describeResumeChatStateConvergence();

    expect(profile).toMatchObject({
      bindingId: convergence.chatWorkspace.profileBindingId,
      recoveryDraftPresent: true,
      currentTopic: "contact",
    });
    expect(resume).toMatchObject({
      bindingId: convergence.structuredSurface.resumeBindingId,
      sourceProfileBindingId: convergence.structuredSurface.profileBindingId,
      definitionRevisionId: "approved-1",
      status: "approved",
      derivative: true,
    });
    expect(convergence.structuredSurface.ownerVisibility).toBe("internal");
  });

  it("projects the editable Profile from durable workflow state without a second store", () => {
    const profile = projectResumeProfile(snapshot());
    expect(profile).toMatchObject({
      bindingId: RESUME_PROFILE_BINDING_ID,
      source: "resume-domain",
      entryPoint: "career",
      confirmedFactCount: 7,
      currentTopic: "accomplishments",
      recoveryDraftPresent: false,
      jobCount: 1,
      generalResumeCount: 1,
    });
    expect(profile.topics.find((topic) => topic.topic === "contact")?.status).toBe("completed");
    expect(profile.topics.find((topic) => topic.topic === "accomplishments")?.status).toBe("current");
    expect(profile.topics.find((topic) => topic.topic === "links")?.status).toBe("skipped");
  });

  it("projects the formatted Resume as a derivative of the current general definition", () => {
    expect(projectResumeDocument(null)).toEqual({
      bindingId: RESUME_DOCUMENT_BINDING_ID,
      sourceProfileBindingId: RESUME_PROFILE_BINDING_ID,
      source: "resume-domain",
      definitionRevisionId: null,
      status: "missing",
      derivative: true,
    });
    expect(projectResumeDocument(snapshot({
      general_definitions: [
        { revision_id: "draft-1", status: "draft" },
        { revision_id: "proposed-1", status: "proposed" },
        { revision_id: "approved-1", status: "approved" },
      ],
    }))).toMatchObject({ definitionRevisionId: "approved-1", status: "approved", derivative: true });
  });

  it("keeps app actions Resume-owned and excludes non-scope workflows", () => {
    expect(RESUME_CHAT_ACTIONS.map((action) => action.actionId)).toEqual([
      "resume.profile.read",
      "career.fact.propose",
      "career.fact.confirm",
      "resume.profile.update",
      "resume.create",
      "resume.export.pdf.request",
      "resume.state.read",
    ]);
    expect(RESUME_CHAT_ACTIONS.map((action) => action.capability)).toEqual([
      null,
      "career.facts.propose",
      "career.facts.confirm",
      "resume.definitions.write",
      "resume.definitions.write",
      "resume.export.request",
      "resume.operations.read",
    ]);
    expect(JSON.stringify(RESUME_CHAT_ACTIONS)).not.toMatch(/docx|linkedin|import|tailor|template.choice/i);
  });

  it("declares Create Resume input as app-derived from Profile, not model-authored markdown", () => {
    const schema = resumeCreateInputSchema();
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [],
    });
    expect((schema.properties as Record<string, unknown>)).not.toHaveProperty("resume_markdown");
    expect((schema.properties as Record<string, unknown>)).not.toHaveProperty("sections");
  });

  it("owns Resume chat action conversion before generic host dispatch", () => {
    const sessionId = crypto.randomUUID();
    const turnId = crypto.randomUUID();
    const occurredAt = "2026-08-27T12:00:00.000Z";

    expect(buildResumeProfileReadCapabilityInput()).toEqual({});
    expect(buildResumeProfileUpdateCapabilityInput({
      profile_markdown: "Maya Torres profile",
      completed_topics: ["direction", "experience"],
      current_topic: null,
    }, { sessionId, turnId, occurredAt })).toMatchObject({
      kind: "interview_progress",
      progress: {
        status: "review_needed",
        completed_topics: ["direction", "experience"],
        skipped_topics: [],
        draft_state: "owner_reviewed",
        session_id: sessionId,
        audit_turn: {
          turn_id: turnId,
          session_id: sessionId,
          answer: "Maya Torres profile",
          occurred_at: occurredAt,
        },
      },
    });

    expect(buildResumeCreateCapabilityInput({
      title: "Maya Torres - Director of Product Operations",
      resume_markdown: [
        "# Maya Torres",
        "## Summary",
        "Director of Product Operations candidate with 9 years in SaaS operations.",
        "## Experience",
        "- Reduced launch slips by 38% across six product squads.",
      ].join("\n"),
    })).toMatchObject({
      definition_kind: "general",
      status: "proposed",
      title: "Maya Torres - Director of Product Operations",
      section_order: ["summary", "experience"],
      locale: "en-US",
      page_intent: "one_page",
      template_id: "resume.single-column",
      prompt_policy_version: null,
      statements: expect.arrayContaining([
        expect.objectContaining({ section_id: "summary", text: "Summary", display_role: "heading" }),
        expect.objectContaining({ section_id: "experience", text: "Reduced launch slips by 38% across six product squads.", display_role: "bullet" }),
      ]),
    });

    expect(planResumeAction({
      action_planning_contract_version: 1,
      action_id: "resume.profile.read",
      action_input: {},
      owner_confirmed: false,
      operation_id: turnId,
      idempotency_key: `read-${turnId}`,
      occurred_at: occurredAt,
      session: {
        session_id: sessionId,
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [],
    }).steps).toEqual([
      { step_id: "read-profile-document", type: "document.read", document_id: "resume.profile" },
    ]);

    expect(planResumeAction({
      action_planning_contract_version: 1,
      action_id: "career.fact.propose",
      action_input: { source: { source_kind: "owner_interview" }, fact: { fact_kind: "skill", state: "suggested", value: "TypeScript", sensitivity: "standard" } },
      owner_confirmed: false,
      operation_id: turnId,
      idempotency_key: `propose-${turnId}`,
      occurred_at: occurredAt,
      session: {
        session_id: sessionId,
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [],
    }).steps).toEqual([
      { step_id: "propose-career-fact", type: "capability.call", capability: "career.facts.propose", capability_version: 1, input: { source: { source_kind: "owner_interview" }, fact: { fact_kind: "skill", state: "suggested", value: "TypeScript", sensitivity: "standard" } }, owner_confirmation: "none" },
    ]);

    expect(planResumeAction({
      action_planning_contract_version: 1,
      action_id: "career.fact.confirm",
      action_input: { decisions: [] },
      owner_confirmed: true,
      operation_id: turnId,
      idempotency_key: `confirm-${turnId}`,
      occurred_at: occurredAt,
      session: {
        session_id: sessionId,
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [],
    }).steps).toEqual([
      { step_id: "confirm-career-facts", type: "capability.call", capability: "career.facts.confirm", capability_version: 1, input: { decisions: [] }, owner_confirmation: "inherit" },
    ]);
  });

  it("plans Resume chat actions into generic host-executable steps from the Profile document", () => {
    const sessionId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const profileMarkdown = "## Experience\n- Reduced launch slips by 38% across six product squads.";
    const request = {
      action_id: "resume.create",
      action_input: {},
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-plan-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: sessionId,
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.profile",
        document_binding_id: RESUME_PROFILE_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: profileMarkdown,
      }],
    };

    const first = planResumeAction(request);
    const second = planResumeAction(request);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      action_plan_version: 1,
      action_id: "resume.create",
      steps: [
        {
          step_id: "write-resume-capability",
          type: "capability.call",
          capability: "resume.definitions.write",
          owner_confirmation: "inherit",
        },
        {
          step_id: "write-resume-document",
          type: "document.write",
          document_id: "resume.document",
          expected_revision: "current",
          media_type: "text/markdown",
          content: profileMarkdown,
        },
      ],
      final_result: { kind: "step_result", step_id: "write-resume-capability" },
    });
    expect(JSON.stringify(first)).not.toMatch(/Bearer|authorization|credential|secret|\/home\//i);
  });

  it("ignores model-supplied Resume markdown and creates only from the Profile document", () => {
    const operationId = crypto.randomUUID();
    const profileMarkdown = "# Maya Profile\n\n## Experience\n- Profile-owned result.";
    const plan = planResumeAction({
      action_id: "resume.create",
      action_input: {
        resume_markdown: "# Model Draft\n\n## Experience\n- Model-authored content that must not persist.",
        sections: [{ title: "Model Section", statements: ["Model-authored section"] }],
      },
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-plan-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.profile",
        document_binding_id: RESUME_PROFILE_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: profileMarkdown,
      }],
    });

    const capabilityInput = plan.steps.find((step) => step.step_id === "write-resume-capability")?.input as { statements?: Array<{ text: string }> };
    const documentWrite = plan.steps.find((step) => step.step_id === "write-resume-document") as { content?: unknown } | undefined;
    expect(capabilityInput.statements?.map((statement) => statement.text)).toEqual(expect.arrayContaining([
      "Experience",
      "Profile-owned result.",
    ]));
    expect(documentWrite?.content).toBe(profileMarkdown);
    expect(JSON.stringify(plan)).not.toContain("Model-authored");
  });

  it("preserves date-range and title hyphens while normalizing flattened Resume markdown", () => {
    const operationId = crypto.randomUUID();
    const plan = planResumeAction({
      action_id: "resume.create",
      action_input: {
        resume_markdown: "# Ignored Model Draft\n\n## Experience\n- Ignored content.",
      },
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-plan-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.profile",
        document_binding_id: RESUME_PROFILE_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: "# Maya Hart - Customer Experience Resume ## Experience **Customer Experience Operations Manager** | Northstar Cloud | Columbus, OH | January 2022 - Present - Reduced first response time from 11 hours to 2.5 hours. **Support Operations Specialist** | Riverbend Analytics | June 2019 - December 2021 - Maintained Zendesk workflows.",
      }],
    });

    const documentWrite = plan.steps.find((step) => step.step_id === "write-resume-document") as { content?: unknown } | undefined;
    const content = String(documentWrite?.content ?? "");
    expect(content).toContain("# Maya Hart - Customer Experience Resume");
    expect(content).toContain("January 2022 - Present");
    expect(content).toContain("June 2019 - December 2021");
    expect(content).not.toContain("\n- Present");
    expect(content).not.toContain("\n- December 2021");
    expect(content).toContain("\n- Reduced first response time");
    expect(content).toContain("\n- Maintained Zendesk workflows.");
  });

  it("plans direct Create resume from the current app-owned Resume Profile document", () => {
    const operationId = crypto.randomUUID();
    const plan = planResumeAction({
      action_id: "resume.create",
      action_input: {},
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-direct-create-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.profile",
        document_binding_id: RESUME_PROFILE_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: "# Maya Torres\n\n## Experience\n- Reduced launch slips by 38% across six product squads.",
      }],
    });

    const documentWrite = plan.steps.find((step) => step.step_id === "write-resume-document") as { content?: unknown } | undefined;
    expect(plan).toMatchObject({
      action_id: "resume.create",
      steps: [
        { type: "capability.call", capability: "resume.definitions.write", owner_confirmation: "inherit" },
        { type: "document.write", document_id: "resume.document", expected_revision: "current" },
      ],
    });
    expect(documentWrite?.content).toBe("# Maya Torres\n\n## Experience\n- Reduced launch slips by 38% across six product squads.");
  });

  it("rejects Create resume when no reviewed Profile document is available", () => {
    const operationId = crypto.randomUUID();
    expect(() => planResumeAction({
      action_id: "resume.create",
      action_input: {},
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-direct-create-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [],
    })).toThrow("resume_profile_required");
  });

  it("plans PDF export from the current app-owned Resume document", () => {
    const operationId = crypto.randomUUID();
    const plan = planResumeAction({
      action_id: "resume.export.pdf.request",
      action_input: { format: "pdf", safe_filename: "maya-torres", destination_intent: "new_download" },
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-export-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.document",
        document_binding_id: RESUME_DOCUMENT_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: "# Maya Torres\n\n## Experience\n- Reduced launch slips by 38% across six product squads.",
      }],
    });

    expect(plan.steps[0]).toMatchObject({
      step_id: "prepare-pdf-export",
      type: "export.prepare",
      source: { kind: "app_document", source_id: "resume.document" },
      media_type: "application/pdf",
      retention_class: "durable_owner_data",
      filename: "maya-torres.pdf",
      destination_intent: "new_download",
      overwrite_confirmed: false,
    });
    expect(plan.steps[0].content_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Buffer.from(String(plan.steps[0].bytes_base64), "base64").subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  });

  it("can plan PDF export with a runtime bytes reference instead of inline PDF bytes", () => {
    const operationId = crypto.randomUUID();
    let storedBytes: Buffer | null = null;
    const plan = planResumeAction({
      action_id: "resume.export.pdf.request",
      action_input: { format: "pdf", safe_filename: "maya-torres", destination_intent: "new_download" },
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-export-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.document",
        document_binding_id: RESUME_DOCUMENT_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: "# Maya Torres\n\n## Experience\n- Reduced launch slips by 38% across six product squads.",
      }],
    }, {
      exportByteDelivery: "runtime_reference",
      createExportBytesReference: ({ bytes, contentDigest, contentSizeBytes }) => {
        storedBytes = bytes;
        expect(contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(contentSizeBytes).toBe(bytes.length);
        return "47efb901-eab8-49d1-a185-3f6e8a5f4056";
      },
    });

    expect(plan.steps[0]).toMatchObject({
      step_id: "prepare-pdf-export",
      type: "export.prepare",
      content_size_bytes: storedBytes?.length,
      bytes_reference: {
        kind: "runtime_http",
        export_id: "47efb901-eab8-49d1-a185-3f6e8a5f4056",
      },
    });
    expect(plan.steps[0]).not.toHaveProperty("bytes_base64");
    const mcpResultEnvelope = { resultType: "complete", content: [], structuredContent: plan, _meta: { ui: { visibility: ["model"] } }, isError: false };
    expect(Buffer.byteLength(JSON.stringify(mcpResultEnvelope), "utf8")).toBeLessThan(8_192);
    expect(storedBytes?.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  });

  it("renders PDF export with the same resume preview markdown semantics", () => {
    const operationId = crypto.randomUUID();
    const plan = planResumeAction({
      action_id: "resume.export.pdf.request",
      action_input: { format: "pdf", destination_intent: "new_download" },
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-export-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.document",
        document_binding_id: RESUME_DOCUMENT_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: [
          "# Maya Hart",
          "",
          "Columbus, Ohio | maya.hart@example.test | 614-555-0192",
          "",
          "## Professional Summary",
          "Customer experience operations manager leading support and success teams across six product squads, with a track record of reducing launch slips and improving retention.",
          "",
          "## Experience",
          "**Senior CX Operations Manager** | Wilmington Widgets | 2021-Present",
          "- Reduced first response time from 11 hours to 2.5 hours",
          "- Built a 14-person support organization; William Wilmington, MMWW iiill.",
          "",
          "## Education",
          "B.A. Communications, Ohio State University 2014",
        ].join("\n"),
      }],
    });

    const pdfBytes = Buffer.from(String(plan.steps[0].bytes_base64), "base64");
    const pdf = pdfBytes.toString("latin1");
    expect(plan.steps[0].content_size_bytes).toBe(pdfBytes.length);
    expect(pdfBytes.length).toBeLessThan(1_048_576);
    expect(pdf).toContain("/Filter /FlateDecode");
    expect(pdf).toContain("/FontFile2");
    expect(pdf).toContain("/BaseFont /LiberationSans-Regular");
    expect(pdf).toContain("/BaseFont /LiberationSans-Bold");
    expect(pdf).toContain("/W [");
    expect(pdf).toContain("77 [833]");
    expect(pdf).toContain("87 [944]");
    expect(pdf).toContain("105 [222]");
    expect(pdf).toContain("108 [222]");
    expect(pdf).toContain("8226 [350]");
    expect(pdf).not.toContain("/DW 500 /CIDToGIDMap");
    const decoded = decodedPdfTextRuns(pdfBytes);
    expect(decoded).toContain(" | Wilmington Widgets | 2021-Present");
    expect(decoded).toContain("B.A. Communications, Ohio State University 2014");
    expect(pdf).toContain("/Encoding /Identity-H");
    expect(pdf).toContain("/ToUnicode 3 0 R");
    expect(pdf).not.toContain("/Subtype /Type1");
    expect(pdf).not.toContain("/WinAnsiEncoding");
    expect(pdf).not.toContain("**Customer Experience Operations Manager**");
  });

  it("renders extended Latin, Greek, and Cyrillic glyphs without dropping letters", () => {
    const operationId = crypto.randomUUID();
    const plan = planResumeAction({
      action_id: "resume.export.pdf.request",
      action_input: { format: "pdf", destination_intent: "new_download" },
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-export-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.document",
        document_binding_id: RESUME_DOCUMENT_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: [
          "# José Müller-Nguyễn",
          "",
          "São Paulo | jose@example.test | +55 11 5555-0100",
          "",
          "## Professional Summary",
          "Łukasz, Şirin, Ćurić, Đặng, Νίκος, and Алексей all render in this export.",
          "",
          "## Experience",
          "- Delivered résumé, naïve, cooperate, façade, and jalapeño content.",
        ].join("\n"),
      }],
    });

    const decoded = decodedPdfTextRuns(Buffer.from(String(plan.steps[0].bytes_base64), "base64"));
    expect(decoded).toContain("José Müller-Nguyễn");
    expect(decoded).toContain("Łukasz, Şirin, Ćurić, Đặng, Νίκος, and Алексей all render");
  });

  it("refuses PDF export when characters are still outside the embedded font coverage", () => {
    const operationId = crypto.randomUUID();
    expect(() => planResumeAction({
      action_id: "resume.export.pdf.request",
      action_input: { format: "pdf", destination_intent: "new_download" },
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-export-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.document",
        document_binding_id: RESUME_DOCUMENT_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: "# Jordan 李\n\n## Experience\n- Shipped multilingual export checks.",
      }],
    })).toThrow("PDF export cannot include unsupported characters: 李. Remove or replace those characters and try again.");
  });

  it("keeps the PDF export fixture on the rasterized layout golden", () => {
    const operationId = crypto.randomUUID();
    const plan = planResumeAction({
      action_id: "resume.export.pdf.request",
      action_input: { format: "pdf", destination_intent: "new_download" },
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-export-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.document",
        document_binding_id: RESUME_DOCUMENT_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: [
          "# Jordan Lee",
          "",
          "Portland, Oregon | jordan.lee@example.test | 503-555-0147 | linkedin.com/in/jordanlee",
          "",
          "## Professional Summary",
          "Product operations leader with nine years of experience building cross-functional planning systems, launch programs, and analytics practices for B2B SaaS companies.",
          "",
          "## Experience",
          "**Director of Product Operations** | Northstar Cloud | Portland, OR | March 2021 - Present",
          "- Reduced quarterly launch slips by 38% across six product squads by introducing a shared readiness checklist and weekly risk review",
          "- Built and led a 12-person operations team spanning analytics, release management, and customer research",
          "**Senior Program Manager** | Riverbend Analytics | Seattle, WA | June 2017 - February 2021",
          "- Delivered a multi-region data platform migration on schedule, coordinating 40+ engineers across three time zones",
          "- Designed the release train that cut hotfix frequency from weekly to monthly while maintaining a 99.95% uptime commitment",
          "",
          "## Education",
          "M.B.A., University of Washington Foster School of Business, 2015",
          "B.S. Industrial Engineering, Oregon State University, 2012",
          "",
          "## Skills",
          "Roadmap planning, OKR design, SQL, Looker, Jira administration, change management, executive communication, vendor negotiation, hiring and coaching",
        ].join("\n"),
      }],
    });

    const pdfBytes = Buffer.from(String(plan.steps[0].bytes_base64), "base64");
    expect(rasterizedPdfTextLayoutDigest(pdfBytes)).toBe("3f4f705cdce0f942b49aeb4e16e88185b94b264af44cfed0368a7e33f301f94d");
  });

  it("blocks PDF export of the empty Resume placeholder", () => {
    const operationId = crypto.randomUUID();
    expect(() => planResumeAction({
      action_id: "resume.export.pdf.request",
      action_input: { format: "pdf", destination_intent: "new_download" },
      owner_confirmed: true,
      operation_id: operationId,
      idempotency_key: `resume-export-${operationId}`,
      occurred_at: "2026-08-27T12:00:00.000Z",
      session: {
        session_id: crypto.randomUUID(),
        view_id: crypto.randomUUID(),
        app_id: "ai.braindrive.resume-builder",
        installation_id: crypto.randomUUID(),
      },
      documents: [{
        document_id: "resume.document",
        document_binding_id: RESUME_DOCUMENT_BINDING_ID,
        media_type: "text/markdown",
        revision: 1,
        revision_id: crypto.randomUUID(),
        content: "# Resume\n\nYour finished resume will appear here after you create it from your Resume Profile.",
      }],
    })).toThrow("formatted_resume_required");
  });

  it("declares package resources for workspace start, action request, and recovery reference", () => {
    expect(RESUME_CHAT_RESOURCES.map((resource) => resource.resourceId)).toEqual([
      "agent.instructions",
      "interview.guide",
      "quality.standard",
      "template.standard",
      "recovery.guidance",
    ]);
    expect(RESUME_CHAT_RESOURCES.map((resource) => resource.promptInclusion)).toEqual([
      "workspace_start",
      "workspace_start",
      "action_request",
      "action_request",
      "document_open",
    ]);
    expect(RESUME_CHAT_RESOURCES.every((resource) => resource.ownerEditable)).toBe(true);
  });

  it("keeps Dave W's proven interview and profile guardrails in app-owned resources", async () => {
    const [agent, interview, quality] = await Promise.all([
      readFile(new URL("../resources/agent-instructions.md", import.meta.url), "utf8"),
      readFile(new URL("../resources/interview-guide.md", import.meta.url), "utf8"),
      readFile(new URL("../resources/resume-quality-standard.md", import.meta.url), "utf8"),
    ]);

    expect(agent).toContain("No appended effects");
    expect(agent).toContain("No wording upgrades");
    expect(agent).toContain("Your Resume Profile is ready to review in the sidebar");
    expect(agent).toContain("Do not run, offer, or recommend another export in that answer");
    expect(agent).toContain("You receive no record of that owner-started export");
    expect(agent).toContain("Treat any question about a file or download that was already made, downloaded, or exported");
    expect(agent).toContain("Never say the PDF is in the sidebar, in Your Resume, in this conversation, or anywhere else in BrainDrive");
    expect(agent).toContain("No action available to you reports whether Your Resume has been created or whether a PDF was downloaded");
    expect(interview).toContain("Resume dates are absolute");
    expect(interview).toContain("An owner's hedge stays hedged");
    expect(interview).toContain("Do not use this as a checklist");
    expect(quality).toContain("The Resume Profile is the editable source of truth");
    expect(quality).toContain("[gap: ...]");
  });
});
