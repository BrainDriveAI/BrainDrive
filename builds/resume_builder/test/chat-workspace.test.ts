import { readFile } from "node:fs/promises";

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
  type DurableWorkflowSnapshot,
} from "../src/index.js";

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

  it("plans Resume chat actions into generic host-executable steps", () => {
    const sessionId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const request = {
      action_id: "resume.create",
      action_input: {
        title: "Maya Torres - Director of Product Operations",
        resume_markdown: "## Experience\n- Reduced launch slips by 38% across six product squads.",
      },
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
      documents: [],
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
          content: request.action_input.resume_markdown,
        },
      ],
      final_result: { kind: "step_result", step_id: "write-resume-capability" },
    });
    expect(JSON.stringify(first)).not.toMatch(/Bearer|authorization|credential|secret|\/home\//i);
  });

  it("normalizes model-flattened Resume markdown before planning a create action", () => {
    const operationId = crypto.randomUUID();
    const plan = planResumeAction({
      action_id: "resume.create",
      action_input: {
        title: "Maya Ortiz - Director of Customer Operations Resume",
        resume_markdown: "# Maya Ortiz Austin, Texas ## Professional Summary Customer operations leader. ## Experience - Reduced first response time from 9.4 hours to 1.8 hours. - Improved gross retention from 86% to 93%.",
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
      documents: [],
    });

    const capabilityInput = plan.steps.find((step) => step.step_id === "write-resume-capability")?.input as { statements?: Array<{ text: string }> };
    const documentWrite = plan.steps.find((step) => step.step_id === "write-resume-document") as { content?: unknown } | undefined;
    expect(capabilityInput.statements?.map((statement) => statement.text)).toEqual(expect.arrayContaining([
      "Professional Summary Customer operations leader.",
      "Experience",
      "Reduced first response time from 9.4 hours to 1.8 hours.",
      "Improved gross retention from 86% to 93%.",
    ]));
    expect(documentWrite?.content).toContain("\n\n## Professional Summary");
    expect(documentWrite?.content).toContain("\n- Reduced first response time");
  });

  it("preserves date-range and title hyphens while normalizing flattened Resume markdown", () => {
    const operationId = crypto.randomUUID();
    const plan = planResumeAction({
      action_id: "resume.create",
      action_input: {
        resume_markdown: "# Maya Hart - Customer Experience Resume ## Experience **Customer Experience Operations Manager** | Northstar Cloud | Columbus, OH | January 2022 - Present - Reduced first response time from 11 hours to 2.5 hours. **Support Operations Specialist** | Riverbend Analytics | June 2019 - December 2021 - Maintained Zendesk workflows.",
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
      documents: [],
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
          "Customer experience operations manager leading support and success teams.",
          "",
          "## Experience",
          "**Customer Experience Operations Manager** | Northstar Cloud | Columbus, OH | January 2022 - Present",
          "- Reduced first response time from 11 hours to 2.5 hours",
        ].join("\n"),
      }],
    });

    const pdf = Buffer.from(String(plan.steps[0].bytes_base64), "base64").toString("latin1");
    expect(pdf).toContain("/BaseFont /Helvetica-Bold");
    expect(pdf).toContain("/BaseFont /Times-Bold");
    expect(pdf).toContain("(PROFESSIONAL SUMMARY)");
    expect(pdf).toContain("(Customer Experience Operations Manager)");
    expect(pdf).toContain("(\\225)");
    expect(pdf).not.toContain("**Customer Experience Operations Manager**");
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
    expect(interview).toContain("Resume dates are absolute");
    expect(interview).toContain("An owner's hedge stays hedged");
    expect(interview).toContain("Do not use this as a checklist");
    expect(quality).toContain("The Resume Profile is the editable source of truth");
    expect(quality).toContain("[gap: ...]");
  });
});
