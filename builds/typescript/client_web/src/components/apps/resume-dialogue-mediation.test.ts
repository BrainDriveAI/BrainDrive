import {
  parseResumeDialogueCommitPayload,
  resumeDialogueFactValue,
  resumeDialogueSensitivity,
} from "./resume-dialogue-mediation";

const messageId = crypto.randomUUID();

describe("Resume Builder dialogue mediation", () => {
  it("rejects fact operations attached to a clarification question", () => {
    expect(parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "Let’s start with your most recent role and add earlier roles afterward.",
      factOperations: [{ operation: "capture", fact_kind: "employment", source_quote: "my last role", employment: { title: "Last role", employer: "Unknown", location: null, start_date: null, end_date: null, responsibilities: null } }],
    }, "Do you mean my last role or all my roles?", new Set())).toBeNull();
  });

  it("accepts exact owner-grounded employment and a known job association", () => {
    const jobRevisionId = crypto.randomUUID();
    const ownerMessage = "I’m Director of Operations at Northwind. I cut onboarding time by 30%.";
    const parsed = parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "That gives me a useful starting point. What did you change to cut onboarding time?",
      factOperations: [
        { operation: "capture", fact_kind: "employment", source_quote: "Director of Operations at Northwind", employment: { title: "Director of Operations", employer: "Northwind", location: null, start_date: null, end_date: null, responsibilities: null } },
        { operation: "capture", fact_kind: "accomplishment", source_quote: "I cut onboarding time by 30%", text: "Cut onboarding time by 30%", job_fact_revision_id: jobRevisionId },
      ],
    }, ownerMessage, new Set([jobRevisionId]));

    expect(parsed?.factOperations).toHaveLength(2);
    expect(parsed?.factOperations[1]).toMatchObject({ fact_kind: "accomplishment", job_fact_revision_id: jobRevisionId });
  });

  it("rejects invented source quotes and unknown job associations", () => {
    const ownerMessage = "I improved onboarding.";
    expect(parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "How did you measure that improvement?",
      factOperations: [{ operation: "capture", fact_kind: "accomplishment", source_quote: "I improved onboarding by 30%", text: "Improved onboarding by 30%", job_fact_revision_id: null }],
    }, ownerMessage, new Set())).toBeNull();

    expect(parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "What was the outcome?",
      factOperations: [{ operation: "capture", fact_kind: "job_evidence", source_quote: ownerMessage, text: ownerMessage, job_fact_revision_id: crypto.randomUUID(), dimension: "outcomes" }],
    }, ownerMessage, new Set())).toBeNull();
  });

  it("projects only validated operations into deterministic domain values", () => {
    const employment = {
      operation: "capture" as const,
      fact_kind: "employment" as const,
      source_quote: "Director at Northwind",
      employment: { title: "Director", employer: "Northwind", location: null, start_date: null, end_date: null, responsibilities: null },
    };
    expect(JSON.parse(resumeDialogueFactValue(employment))).toEqual({
      format: "resume_job_v1",
      title: "Director",
      employer: "Northwind",
      location: "",
      start_date: "",
      end_date: "",
      responsibilities: "",
    });
    expect(resumeDialogueSensitivity(employment)).toBe("standard");
    expect(resumeDialogueSensitivity({ operation: "capture", fact_kind: "contact", value: "owner@example.com", source_quote: "owner@example.com" })).toBe("sensitive");
  });
});
