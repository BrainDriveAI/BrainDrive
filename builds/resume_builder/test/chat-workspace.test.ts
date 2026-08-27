import { describe, expect, it } from "vitest";

import {
  RESUME_CHAT_ACTIONS,
  RESUME_CHAT_DOCUMENTS,
  RESUME_CHAT_PRESENTATION_ID,
  RESUME_CHAT_RESOURCES,
  RESUME_CHAT_WORKSPACE_ID,
  RESUME_DOCUMENT_BINDING_ID,
  RESUME_PROFILE_BINDING_ID,
  RESUME_STRUCTURED_PRESENTATION_ID,
  RESUME_STRUCTURED_RESOURCE_URI,
  describeResumeChatStateConvergence,
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
  });

  it("keeps Profile and Resume bound to one Resume-domain state source", () => {
    const convergence = describeResumeChatStateConvergence();
    expect(convergence.authoritativeStore).toBe("resume-domain");
    expect(convergence.chatWorkspace.profileBindingId).toBe(RESUME_PROFILE_BINDING_ID);
    expect(convergence.structuredSurface.profileBindingId).toBe(RESUME_PROFILE_BINDING_ID);
    expect(convergence.chatWorkspace.resumeBindingId).toBe(RESUME_DOCUMENT_BINDING_ID);
    expect(convergence.structuredSurface.resumeBindingId).toBe(RESUME_DOCUMENT_BINDING_ID);
    expect(convergence.structuredSurface.ownerVisibility).toBe("internal");
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
      "resume.profile.update",
      "resume.create",
      "resume.export.pdf.request",
      "resume.state.read",
    ]);
    expect(RESUME_CHAT_ACTIONS.every((action) => action.capability.startsWith("resume."))).toBe(true);
    expect(JSON.stringify(RESUME_CHAT_ACTIONS)).not.toMatch(/docx|linkedin|import|tailor|template.choice/i);
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
  });
});
