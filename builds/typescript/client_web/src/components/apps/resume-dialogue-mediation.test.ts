import {
  evaluateResumeDraftReadiness,
  employmentCandidateFromInterviewTurns,
  employmentCandidatesFromInterviewTurns,
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
      draftAction: null,
      factOperations: [{ operation: "capture", fact_kind: "employment", source_quote: "my last role", employment: { title: "Last role", employer: "Unknown", location: null, start_date: null, end_date: null, responsibilities: null } }],
    }, "Do you mean my last role or all my roles?", new Set())).toBeNull();
  });

  it("accepts only grounded explicit or offered draft intent", () => {
    const explicit = "Please create my resume draft now.";
    expect(parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "I can ask BrainDrive to start a fact-backed draft.",
      factOperations: [],
      draftAction: { action: "create_general_draft", intent: "explicit_request", source_quote: explicit },
    }, explicit, new Set())).toMatchObject({ draftAction: { intent: "explicit_request" } });

    const accepted = "No, that's everything.";
    expect(parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "I can ask BrainDrive to start a fact-backed draft.",
      factOperations: [],
      draftAction: { action: "create_general_draft", intent: "explicit_request", source_quote: accepted },
    }, accepted, new Set(), [], "Would you like to add anything else, or should I start your draft?")).toMatchObject({ draftAction: { intent: "accepted_offer" } });

    expect(parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "What would you like to discuss next?",
      factOperations: [],
      draftAction: { action: "create_general_draft", intent: "accepted_offer", source_quote: accepted },
    }, accepted, new Set(), [], "What else would you like me to know?")).toBeNull();
  });

  it("rejects model control markers instead of persisting them as owner facts", () => {
    const ownerMessage = "Before Acme Ventures, I was VP of Global Sales at Nova Markets from 2008 to 2015.";
    expect(parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "What were your standout accomplishments there?",
      draftAction: null,
      factOperations: [{
        operation: "capture",
        fact_kind: "accomplishment",
        source_quote: ownerMessage,
        text: ":skip: no accomplishment stated in this message",
        job_fact_revision_id: null,
      }],
    }, ownerMessage, new Set())).toBeNull();
  });

  it("requires employment and supporting evidence before host draft authorization", () => {
    expect(evaluateResumeDraftReadiness(new Set(), [{ kind: "education" }])).toMatchObject({ ready: false, reason: "missing_employment" });
    expect(evaluateResumeDraftReadiness(new Set([crypto.randomUUID()]), [{ kind: "employment" }])).toMatchObject({ ready: false, reason: "missing_supporting_evidence" });
    expect(evaluateResumeDraftReadiness(new Set([crypto.randomUUID()]), [{ kind: "employment" }, { kind: "accomplishment" }])).toEqual({ ready: true });
  });

  it("accepts exact owner-grounded employment and a known job association", () => {
    const jobRevisionId = crypto.randomUUID();
    const ownerMessage = "I’m Director of Operations at Northwind. I cut onboarding time by 30%.";
    const parsed = parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "That gives me a useful starting point. What did you change to cut onboarding time?",
      draftAction: null,
      factOperations: [
        { operation: "capture", fact_kind: "employment", source_quote: "Director of Operations at Northwind", employment: { title: "Director of Operations", employer: "Northwind", location: null, start_date: null, end_date: null, responsibilities: null } },
        { operation: "capture", fact_kind: "accomplishment", source_quote: "I cut onboarding time by 30%", text: "Cut onboarding time by 30%", job_fact_revision_id: jobRevisionId },
      ],
    }, ownerMessage, new Set([jobRevisionId]));

    expect(parsed?.factOperations).toHaveLength(2);
    expect(parsed?.factOperations[1]).toMatchObject({ fact_kind: "accomplishment", job_fact_revision_id: jobRevisionId });
  });

  it("reconciles a role, corrected employer, and dates from exact adjacent owner turns", () => {
    const roleSourceRevisionId = crypto.randomUUID();
    const correctionSourceRevisionId = crypto.randomUUID();
    const candidate = employmentCandidateFromInterviewTurns([
      {
        metadata: { revision_id: roleSourceRevisionId },
        extensions: { interview_turn: { occurred_at: "2026-08-15T12:00:00.000Z", answer: "It was called ACME ACME and I was the founder and CEO of that company." } },
      },
      {
        metadata: { revision_id: correctionSourceRevisionId },
        extensions: { interview_turn: { occurred_at: "2026-08-15T12:01:00.000Z", answer: "Acme Ventures is the correct name and spelling. 2015 to 2025" } },
      },
    ]);

    expect(candidate).toEqual({
      sourceQuote: "Acme Ventures is the correct name and spelling. 2015 to 2025",
      sourceRevisionIds: [roleSourceRevisionId, correctionSourceRevisionId],
      employment: {
        title: "founder and CEO",
        employer: "Acme Ventures",
        location: null,
        start_date: "2015",
        end_date: "2025",
        responsibilities: null,
      },
    });
  });

  it("does not create employment without an owner-stated employer", () => {
    expect(employmentCandidateFromInterviewTurns([{
      metadata: { revision_id: crypto.randomUUID() },
      extensions: { interview_turn: { occurred_at: "2026-08-15T12:00:00.000Z", answer: "I was the CEO, but which role do you want to discuss?" } },
    }])).toBeNull();
  });

  it("does not turn a long aspirational startup description into employment", () => {
    expect(employmentCandidateFromInterviewTurns([{
      metadata: { revision_id: crypto.randomUUID() },
      extensions: {
        interview_turn: {
          occurred_at: "2026-08-15T12:00:00.000Z",
          answer: "I recently sold the company that I was working on which is a startup that I grew from zero to over 10 million revenues and over 100 employees and I'm in the process of starting a new job search and I would like to find a role where I can be the CEO of a new startup somewhere between five and 50 employees and do the same type of growth that I did at my last startup that I just sold",
        },
      },
    }])).toBeNull();
  });

  it("finds each distinct grounded role and ignores an ambiguous role mention", () => {
    const candidates = employmentCandidatesFromInterviewTurns([
      {
        metadata: { revision_id: crypto.randomUUID() },
        extensions: { interview_turn: { occurred_at: "2026-08-15T12:00:00.000Z", answer: "I was Director at Northwind from 2018 to 2020." } },
      },
      {
        metadata: { revision_id: crypto.randomUUID() },
        extensions: { interview_turn: { occurred_at: "2026-08-15T12:01:00.000Z", answer: "I was Head of Global Sales for FXCM a currency trading firm where I led the global team." } },
      },
      {
        metadata: { revision_id: crypto.randomUUID() },
        extensions: { interview_turn: { occurred_at: "2026-08-15T12:02:00.000Z", answer: "I had another leadership role, but which one do you want?" } },
      },
    ]);

    expect(candidates.map((candidate) => candidate.employment)).toEqual([
      expect.objectContaining({ title: "Director", employer: "Northwind", start_date: "2018", end_date: "2020" }),
      expect.objectContaining({ title: "Head of Global Sales", employer: "FXCM", start_date: null, end_date: null }),
    ]);
  });

  it("grounds cross-turn employment and attaches a later metric to the confirmed role", () => {
    const roleSourceRevisionId = crypto.randomUUID();
    const jobRevisionId = crypto.randomUUID();
    const ownerMessage = "Northwind is the correct name. 2020 to 2024";
    const employment = parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "Thanks. What changed because of your work there?",
      draftAction: null,
      factOperations: [{ operation: "capture", fact_kind: "employment", source_quote: ownerMessage, employment: { title: "Director of Operations", employer: "Northwind", location: null, start_date: "2020", end_date: "2024", responsibilities: null } }],
    }, ownerMessage, new Set(), [{ content: "I was Director of Operations at the company.", sourceRevisionId: roleSourceRevisionId }]);
    expect(employment?.factOperations[0]).toMatchObject({ fact_kind: "employment", supporting_source_revision_ids: [roleSourceRevisionId] });

    const metricMessage = "I reduced onboarding time by 30%.";
    const metric = parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "That is useful evidence. What did you change to get that result?",
      draftAction: null,
      factOperations: [{ operation: "capture", fact_kind: "job_evidence", source_quote: metricMessage, text: metricMessage, job_fact_revision_id: jobRevisionId, dimension: "outcomes" }],
    }, metricMessage, new Set([jobRevisionId]));
    expect(JSON.parse(resumeDialogueFactValue(metric!.factOperations[0]!))).toMatchObject({
      association: "job",
      job_fact_revision_id: jobRevisionId,
      owner_text: metricMessage,
    });
  });

  it("rejects invented source quotes and unknown job associations", () => {
    const ownerMessage = "I improved onboarding.";
    expect(parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "How did you measure that improvement?",
      draftAction: null,
      factOperations: [{ operation: "capture", fact_kind: "accomplishment", source_quote: "I improved onboarding by 30%", text: "Improved onboarding by 30%", job_fact_revision_id: null }],
    }, ownerMessage, new Set())).toBeNull();

    expect(parseResumeDialogueCommitPayload({
      messageId,
      assistantMessage: "What was the outcome?",
      draftAction: null,
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
