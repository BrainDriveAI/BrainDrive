import { describe, expect, it } from "vitest";

import {
  RESUME_GENERAL_DRAFT_PROGRAM,
  RESUME_INFERENCE_PROGRAMS,
  adjudicateResumeInference,
  adjudicateResumeGeneralDraft,
  prepareResumeInference,
  prepareResumeGeneralDraft,
} from "../resources/inference-program.js";
import { seriousProfileFallbackFixture } from "./fixtures/serious-profile-fallback.mjs";

const jobId = "10000000-0000-4000-8000-000000000001";
const evidenceId = "10000000-0000-4000-8000-000000000002";
const generalSkillId = "10000000-0000-4000-8000-000000000003";
const contactId = "10000000-0000-4000-8000-000000000004";
const preferenceId = "10000000-0000-4000-8000-000000000005";
const input = {
  facts: [
    { revision_id: jobId, fact_kind: "employment", value: "Platform Engineer at Example", state: "confirmed" },
    { revision_id: evidenceId, fact_kind: "job_evidence", value: { job_fact_revision_id: jobId, dimension: "accomplishments", owner_text: "Reduced deployment time by 30%", outcome: "answered" }, state: "confirmed" },
  ],
  strategy: { title: "General Resume", fact_revision_ids: [jobId, evidenceId], section_order: ["experience"] },
  presentation_preferences: {},
  persistence_input_digest: `sha256:${"a".repeat(64)}`,
};

function providerCandidateFor(sourceInput: any) {
  const plan = prepareResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: sourceInput, attempt: 1, previous: null });
  const payload = JSON.parse(plan.user);
  const facts = new Map(sourceInput.facts.map((fact: any) => [fact.revision_id, fact]));
  const factText = (fact: any): string => {
    let value = fact?.value;
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { return value; }
    }
    if (value?.format === "resume_job_v1") return `${value.title} at ${value.employer}`;
    return String(value?.owner_text ?? value?.text ?? value?.value ?? fact?.value ?? "Confirmed information");
  };
  return {
    plan,
    payload,
    candidate: {
      title: "General Resume",
      text_by_slot: Object.fromEntries(payload.draft_slots.map((slot: any) => [
        slot.slot_id,
        slot.supporting_confirmed_fact_revision_ids.map((revisionId: string) => factText(facts.get(revisionId))).join(" and "),
      ])),
    },
  };
}

describe("Resume Builder-owned General draft inference program", () => {
  it("assembles exact evidence slots in the app and asks the provider for text only", () => {
    const dimensions = ["responsibilities", "responsibilities", "accomplishments", "outcomes", "tools", "scope", "progression"];
    const evidenceFacts = dimensions.map((dimension, index) => ({
      revision_id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      fact_kind: "job_evidence",
      value: { job_fact_revision_id: jobId, dimension, owner_text: `Synthetic evidence ${index + 1}`, outcome: "answered" },
      state: "confirmed",
    }));
    const structuredInput = {
      ...input,
      facts: [input.facts[0], ...evidenceFacts],
      strategy: {
        ...input.strategy,
        fact_revision_ids: [jobId, ...evidenceFacts.map((fact) => fact.revision_id)],
        evidence_priorities: [jobId, ...evidenceFacts.map((fact) => fact.revision_id)]
          .map((fact_revision_id) => ({ fact_revision_id, priority: "must_use" })),
        omissions: [],
      },
    };

    const plan = prepareResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: structuredInput, attempt: 1, previous: null });
    const payload = JSON.parse(plan.user);
    expect(plan.schema_name).toBe("resume_general_draft_slot_text_v1");
    expect(plan.output_schema.required).toEqual(["title", "text_by_slot"]);
    expect(plan.output_schema.properties.text_by_slot.additionalProperties).toBe(false);
    expect(plan.output_schema.properties.text_by_slot.required).toEqual(payload.draft_slots.map((slot: any) => slot.slot_id));
    expect(payload.draft_slots.filter((slot: any) => slot.display_role === "bullet")).toHaveLength(6);
    expect(payload.draft_slots.flatMap((slot: any) => slot.supporting_confirmed_fact_revision_ids).sort()).toEqual(
      [jobId, ...evidenceFacts.map((fact) => fact.revision_id)].sort(),
    );
    expect(payload.draft_slots.every((slot: any) => Object.keys(slot).sort().join(",") === [
      "display_role", "job_fact_revision_id", "section_id", "slot_id", "supporting_confirmed_fact_revision_ids",
    ].sort().join(","))).toBe(true);

    const textBySlot = providerCandidateFor(structuredInput).candidate.text_by_slot;
    const accepted = adjudicateResumeGeneralDraft({
      program: RESUME_GENERAL_DRAFT_PROGRAM,
      input: structuredInput,
      attempt: 1,
      candidate: { title: "General Resume", text_by_slot: textBySlot },
    });
    expect(accepted).toMatchObject({ decision: "accepted", issue_ids: [] });
    expect(accepted.result.draft.statements.filter((statement: any) => statement.display_role === "bullet")).toHaveLength(6);
    const represented = new Set(accepted.result.draft.statements.flatMap((statement: any) => statement.supporting_confirmed_fact_revision_ids));
    expect(structuredInput.strategy.evidence_priorities.every((item) => represented.has(item.fact_revision_id))).toBe(true);
  });

  it("accepts the strategy-owned nine-section topology on the first valid provider response", () => {
    const sectionOrder = [
      "contact", "summary", "experience", "education", "certifications",
      "skills", "projects", "leadership", "links",
    ];
    const nineSectionInput = {
      ...input,
      strategy: {
        ...input.strategy,
        section_order: sectionOrder,
        summary_decision: "include",
      },
    };
    const valid = providerCandidateFor(nineSectionInput).candidate;

    const accepted = adjudicateResumeGeneralDraft({
      program: RESUME_GENERAL_DRAFT_PROGRAM,
      input: nineSectionInput,
      attempt: 1,
      candidate: valid,
    });

    expect(accepted).toMatchObject({
      decision: "accepted",
      attempt: 1,
      issue_ids: [],
      result: { draft: { section_order: sectionOrder } },
    });
    expect(accepted.decision).not.toBe("fallback");
    expect(accepted.issue_ids).not.toContain("resume.general-draft/schema-section-order-invalid");
  });

  it("keeps provider credentials and final topology outside the provider-facing plan", () => {
    expect(RESUME_GENERAL_DRAFT_PROGRAM).toMatchObject({ id: "resume.general-draft", version: 1, prompt_policy_version: "1" });
    const plan = prepareResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input, attempt: 1, previous: null });
    expect(plan.output_schema.properties).toEqual(expect.objectContaining({ title: expect.any(Object), text_by_slot: expect.any(Object) }));
    expect(plan.output_schema.properties).not.toHaveProperty("statements");
    expect(plan.output_schema.properties).not.toHaveProperty("experience_roles");
    expect(plan.output_schema.properties).not.toHaveProperty("omissions");
    expect(plan).not.toHaveProperty("provider_profile_id");
    expect(plan).not.toHaveProperty("credential");
    expect(plan.user).not.toContain(input.persistence_input_digest);
  });

  it("returns exact slot diagnostics to the one app-owned retry", () => {
    const prepared = providerCandidateFor(input);
    const [missingSlotId, retainedSlotId] = Object.keys(prepared.candidate.text_by_slot);
    const invalid = { title: prepared.candidate.title, text_by_slot: { [retainedSlotId]: "Synthetic line", unexpected_slot: "No" } };
    expect(adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input, attempt: 1, candidate: invalid })).toMatchObject({
      decision: "retry",
      issue_ids: ["resume.general-draft/schema-slot-texts-invalid"],
    });
    const retry = prepareResumeGeneralDraft({
      program: RESUME_GENERAL_DRAFT_PROGRAM,
      input,
      attempt: 2,
      previous: { candidate: invalid, issue_ids: ["resume.general-draft/schema-slot-texts-invalid"] },
    });
    expect(JSON.parse(retry.user).repair).toMatchObject({
      issue_ids: ["resume.general-draft/schema-slot-texts-invalid"],
      missing_slot_ids: [missingSlotId],
      unexpected_slot_ids: ["unexpected_slot"],
      invalid_text_slot_ids: [],
    });
  });

  it.each([
    ["unsupported wording", "Invented enterprise transformation", "resume.general-draft/statement-factual-wording-unsupported"],
    ["unsupported protected value", "Reduced deployment time by 75%", "resume.general-draft/statement-protected-value-unsupported"],
    ["incomplete job heading", "Platform Engineer", "resume.general-draft/job-heading-missing"],
  ])("rejects %s before persistence with an exact content-free issue", (_name, text, expectedIssue) => {
    const sourceInput = expectedIssue === "resume.general-draft/job-heading-missing"
      ? {
          ...input,
          facts: [
            { ...input.facts[0], value: JSON.stringify({ format: "resume_job_v1", title: "Platform Engineer", employer: "Example Company" }) },
            input.facts[1],
          ],
        }
      : input;
    const prepared = providerCandidateFor(sourceInput);
    const targetSlot = prepared.payload.draft_slots.find((slot: any) => (
      expectedIssue === "resume.general-draft/job-heading-missing"
        ? slot.display_role === "heading"
        : slot.display_role === "bullet"
    ));
    const candidate = {
      ...prepared.candidate,
      text_by_slot: { ...prepared.candidate.text_by_slot, [targetSlot.slot_id]: text },
    };
    const first = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: sourceInput, attempt: 1, candidate });
    expect(first).toMatchObject({ decision: "retry", issue_ids: [expectedIssue] });
    const retry = prepareResumeGeneralDraft({
      program: RESUME_GENERAL_DRAFT_PROGRAM,
      input: sourceInput,
      attempt: 2,
      previous: { candidate, issue_ids: first.issue_ids },
    });
    expect(JSON.parse(retry.user).repair.issue_ids).toEqual([expectedIssue]);
  });

  it("accepts slot text and uses deterministic app-owned fallback after a second invalid candidate", () => {
    const valid = providerCandidateFor(input).candidate;
    const accepted = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input, attempt: 1, candidate: valid });
    expect(accepted).toMatchObject({
      decision: "accepted",
      result: {
        draft: { statements: expect.any(Array) },
        persistence_input_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        persistence_output_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(accepted.result.draft.statements).toHaveLength(2);
    expect(accepted.result.draft.statements.map((statement: any) => statement.supporting_confirmed_fact_revision_ids)).toEqual([[jobId], [evidenceId]]);

    const invalid = { ...valid, text_by_slot: {} };
    const recovered = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input, attempt: 2, candidate: invalid });
    expect(recovered).toMatchObject({
      decision: "fallback",
      issue_ids: ["resume.general-draft/schema-slot-texts-invalid"],
      result: { draft: { title: "General Resume", section_order: ["experience"] } },
    });
    expect(recovered.result.draft.statements).toHaveLength(2);
    expect(recovered.result.draft.statements.every((statement: any) => statement.supporting_confirmed_fact_revision_ids.length > 0)).toBe(true);
    expect(recovered.result.persistence_input_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(recovered.result.persistence_output_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("renders structured owner facts as supported resume text in the app-owned fallback", () => {
    const structuredInput = {
      ...input,
      facts: [
        {
          revision_id: jobId,
          fact_kind: "employment",
          value: JSON.stringify({ format: "resume_job_v1", title: "Platform Engineer", employer: "Example Company", location: "Dayton, Ohio" }),
          state: "confirmed",
        },
        {
          revision_id: evidenceId,
          fact_kind: "job_evidence",
          value: JSON.stringify({ value_version: 1, association: "job", job_fact_revision_id: jobId, dimension: "accomplishments", outcome: "answered", owner_text: "Reduced deployment time by 30%" }),
          state: "confirmed",
        },
      ],
    };
    const recovered = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: structuredInput, attempt: 2, candidate: null });
    expect(recovered.result.draft.statements.map((statement: any) => statement.text)).toEqual([
      "Platform Engineer | Example Company | Dayton, Ohio",
      "Reduced deployment time by 30%",
    ]);
    expect(recovered.result.draft.statements.map((statement: any) => statement.text).join("\n")).not.toMatch(/resume_job_v1|job_fact_revision_id|[{}]/);
  });

  it("produces a grounded, complete, readable multi-role deterministic fallback", () => {
    const recovered = adjudicateResumeGeneralDraft({
      program: RESUME_GENERAL_DRAFT_PROGRAM,
      input: seriousProfileFallbackFixture,
      attempt: 2,
      candidate: null,
    });
    expect(recovered).toMatchObject({
      decision: "fallback",
      result: { draft: { section_order: seriousProfileFallbackFixture.strategy.section_order } },
    });
    const statements = recovered.result.draft.statements as Array<{
      section_id: string;
      display_role: string;
      text: string;
      supporting_confirmed_fact_revision_ids: string[];
    }>;
    const text = statements.map((statement) => statement.text).join("\n");
    expect(text).toContain("Customer Experience Operations Manager | Northstar Cloud | Columbus, Ohio | January 2022–Present");
    expect(text).toContain("Senior Customer Support Specialist | HarborPay | Columbus, Ohio | June 2019–December 2021");
    expect(statements.filter((statement) => statement.section_id === "certifications").map((statement) => statement.text)).toEqual([
      "Zendesk Administrator",
      "Lean Six Sigma",
    ]);
    expect(statements.filter((statement) => statement.section_id === "links").map((statement) => statement.text)).toEqual([
      "linkedin.com/in/jordan-lee-cx-ops",
    ]);
    expect(statements.filter((statement) => statement.section_id === "projects")).toHaveLength(1);
    expect(statements.filter((statement) => statement.section_id === "leadership")).toHaveLength(1);
    expect(text).not.toMatch(/Leadership or volunteer:|Professional link:/);
    expect(text).not.toMatch(/\b(?:I|my)\b/i);
    expect(text.match(/promot(?:ed|ion)/gi)).toHaveLength(1);

    const headings = statements.map((statement, index) => ({ statement, index })).filter(({ statement }) => statement.section_id === "experience" && statement.display_role === "heading");
    expect(headings).toHaveLength(2);
    for (let index = 0; index < headings.length; index += 1) {
      const start = headings[index].index + 1;
      const end = headings[index + 1]?.index ?? statements.length;
      expect(statements.slice(start, end).filter((statement) => statement.section_id === "experience" && statement.display_role === "bullet").length).toBeLessThanOrEqual(6);
    }

    const summary = statements.find((statement) => statement.section_id === "summary");
    expect(summary?.text).toMatch(/^Customer Experience Operations Manager with confirmed experience in /);
    expect(summary?.text.length).toBeLessThanOrEqual(240);
    const confirmedIds = new Set(seriousProfileFallbackFixture.facts.filter((fact) => fact.state === "confirmed").map((fact) => fact.revision_id));
    const factsById = new Map(seriousProfileFallbackFixture.facts.map((fact) => [fact.revision_id, fact]));
    const preferenceId = seriousProfileFallbackFixture.facts.find((fact) => fact.fact_kind === "preference")?.revision_id;
    for (const statement of statements) {
      expect(statement.supporting_confirmed_fact_revision_ids.length).toBeGreaterThan(0);
      expect(statement.supporting_confirmed_fact_revision_ids.every((revisionId) => confirmedIds.has(revisionId))).toBe(true);
      expect(statement.supporting_confirmed_fact_revision_ids).not.toContain(preferenceId);
      const supportedSource = statement.supporting_confirmed_fact_revision_ids.map((revisionId) => String(factsById.get(revisionId)?.value ?? "")).join(" ").toLowerCase();
      for (const protectedToken of statement.text.match(/\b\d+(?:[.,]\d+)?%?\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|present)\b|(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?/gi) ?? []) {
        expect(supportedSource).toContain(protectedToken.toLowerCase());
      }
    }
  });

  it("represents every app-owned must-use fact, including general structured skill evidence", () => {
    const mustUseInput = {
      ...input,
      facts: [
        ...input.facts,
        {
          revision_id: generalSkillId,
          fact_kind: "job_evidence",
          value: JSON.stringify({
            value_version: 1,
            association: "general",
            job_fact_revision_id: null,
            dimension: "tools",
            outcome: "answered",
            owner_text: "Microsoft Excel",
          }),
          state: "confirmed",
        },
      ],
      strategy: {
        ...input.strategy,
        fact_revision_ids: [jobId, evidenceId, generalSkillId],
        section_order: ["experience", "skills"],
        evidence_priorities: [
          { fact_revision_id: jobId, priority: "must_use" },
          { fact_revision_id: evidenceId, priority: "must_use" },
          { fact_revision_id: generalSkillId, priority: "must_use" },
        ],
        omissions: [],
      },
    };
    const recovered = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: mustUseInput, attempt: 2, candidate: null });
    const skill = recovered.result.draft.statements.find((statement: any) => statement.supporting_confirmed_fact_revision_ids.includes(generalSkillId));
    expect(skill).toMatchObject({ section_id: "skills", display_role: "bullet", text: "Microsoft Excel" });
    const represented = new Set(recovered.result.draft.statements.flatMap((statement: any) => statement.supporting_confirmed_fact_revision_ids));
    expect(mustUseInput.strategy.evidence_priorities.every((item) => represented.has(item.fact_revision_id))).toBe(true);
  });

  it("keeps every representable must-use fact in app-owned slots", () => {
    const mustUseInput = {
      ...input,
      facts: [
        ...input.facts,
        { revision_id: generalSkillId, fact_kind: "skill", value: "Microsoft Excel", state: "confirmed" },
      ],
      strategy: {
        ...input.strategy,
        fact_revision_ids: [jobId, evidenceId, generalSkillId],
        section_order: ["experience", "skills"],
        evidence_priorities: [
          { fact_revision_id: jobId, priority: "must_use" },
          { fact_revision_id: evidenceId, priority: "must_use" },
          { fact_revision_id: generalSkillId, priority: "must_use" },
        ],
        omissions: [],
      },
    };
    const prepared = providerCandidateFor(mustUseInput);
    const represented = new Set(prepared.payload.draft_slots.flatMap((slot: any) => slot.supporting_confirmed_fact_revision_ids));
    expect(mustUseInput.strategy.evidence_priorities.every((item) => represented.has(item.fact_revision_id))).toBe(true);
    expect(adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: mustUseInput, attempt: 1, candidate: prepared.candidate })).toMatchObject({
      decision: "accepted",
      issue_ids: [],
    });
  });

  it("makes must-use closure machine-actionable in both calls and structurally constrains omissions", () => {
    const mustUseInput = {
      ...input,
      strategy: {
        ...input.strategy,
        evidence_priorities: [
          { fact_revision_id: jobId, priority: "must_use" },
          { fact_revision_id: evidenceId, priority: "must_use" },
        ],
        omissions: [],
      },
    };
    const first = prepareResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: mustUseInput, attempt: 1, previous: null });
    const firstPayload = JSON.parse(first.user);
    expect(firstPayload.must_use_closure).toEqual({
      required_fact_revision_ids: [jobId, evidenceId],
      rule: "Every required fact revision ID must appear in at least one statement support array or in exactly one omission record.",
      allowed_omission_reason_codes: ["structural_mismatch", "redundant", "owner_excluded"],
    });
    expect(firstPayload.draft_slots.flatMap((slot: any) => slot.supporting_confirmed_fact_revision_ids)).toEqual(expect.arrayContaining([jobId, evidenceId]));

    const retry = prepareResumeGeneralDraft({
      program: RESUME_GENERAL_DRAFT_PROGRAM,
      input: mustUseInput,
      attempt: 2,
      previous: { candidate: null, issue_ids: ["resume.general-draft/strategy-must-use-unrepresented"] },
    });
    const retryPayload = JSON.parse(retry.user);
    expect(retryPayload.must_use_closure).toEqual(firstPayload.must_use_closure);
    expect(retryPayload.repair).toMatchObject({
      issue_ids: ["resume.general-draft/strategy-must-use-unrepresented"],
      unresolved_rule: firstPayload.must_use_closure.rule,
      required_fact_revision_ids: [jobId, evidenceId],
    });
  });

  it("makes the strategy summary decision explicit and allocates exactly one app-owned summary slot", () => {
    const summaryInput = {
      ...input,
      strategy: {
        ...input.strategy,
        section_order: ["summary", "experience"],
        summary_decision: "include",
      },
    };
    const first = prepareResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: summaryInput, attempt: 1, previous: null });
    const firstPayload = JSON.parse(first.user);
    expect(firstPayload.summary_closure).toEqual({
      strategy_decision: "include",
      expected_top_level_summary_statement_count: 1,
      rule: "Return exactly one top-level summary statement when the strategy decision is include, and none when it is omit.",
    });

    expect(firstPayload.draft_slots.filter((slot: any) => slot.section_id === "summary")).toHaveLength(1);
    const prepared = providerCandidateFor(summaryInput);
    const accepted = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: summaryInput, attempt: 1, candidate: prepared.candidate });
    expect(accepted).toMatchObject({ decision: "accepted", issue_ids: [] });
    expect(accepted.result.draft.statements.filter((statement: any) => statement.section_id === "summary")).toHaveLength(1);

    const duplicateAttempt = { ...prepared.candidate, text_by_slot: { ...prepared.candidate.text_by_slot, duplicate_summary_slot: "Duplicate" } };
    expect(adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: summaryInput, attempt: 1, candidate: duplicateAttempt })).toMatchObject({
      decision: "retry",
      issue_ids: ["resume.general-draft/schema-slot-texts-invalid"],
    });
  });

  it("derives a reviewable owner identity from the confirmed contact fact instead of a generic title", () => {
    const contactInput = {
      ...input,
      facts: [
        { revision_id: contactId, fact_kind: "contact", value: "Synthetic Owner | owner@example.test", state: "confirmed" },
        ...input.facts,
      ],
      strategy: { ...input.strategy, fact_revision_ids: [contactId, jobId, evidenceId] },
    };
    const recovered = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: contactInput, attempt: 2, candidate: null });
    expect(recovered.result.draft.title).toBe("Synthetic Owner");
  });

  it("keeps owner targeting preferences out of app-owned evidence slots and fallback", () => {
    const preferenceInput = {
      ...input,
      facts: [
        ...input.facts,
        { revision_id: preferenceId, fact_kind: "preference", value: "Resume goal: Customer support supervisor roles", state: "confirmed" },
      ],
      strategy: {
        ...input.strategy,
        fact_revision_ids: [jobId, evidenceId, preferenceId],
        section_order: ["summary", "experience"],
        summary_decision: "include",
        evidence_priorities: [{ fact_revision_id: preferenceId, priority: "must_use" }],
        omissions: [],
      },
    };
    const prepared = providerCandidateFor(preferenceInput);
    expect(prepared.payload.draft_slots.flatMap((slot: any) => slot.supporting_confirmed_fact_revision_ids)).not.toContain(preferenceId);
    const accepted = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: preferenceInput, attempt: 1, candidate: prepared.candidate });
    expect(accepted).toMatchObject({ decision: "accepted", issue_ids: [] });
    expect(accepted.result.draft.omissions).toContainEqual({ fact_revision_id: preferenceId, reason_code: "structural_mismatch" });

    const recovered = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: preferenceInput, attempt: 2, candidate: null });
    expect(recovered.result.draft.statements.map((statement: any) => statement.text).join("\n")).not.toContain("Resume goal:");
    expect(recovered.result.draft.statements).toContainEqual(expect.objectContaining({ section_id: "summary", text: "Platform Engineer at Example with confirmed professional experience.", supporting_confirmed_fact_revision_ids: [jobId] }));
    expect(recovered.result.draft.omissions).toContainEqual({ fact_revision_id: preferenceId, reason_code: "structural_mismatch" });
  });

  it.each([
    ["candidate", null, "resume.general-draft/schema-candidate-shape-invalid"],
    ["title", { title: "", text_by_slot: "valid" }, "resume.general-draft/schema-title-invalid"],
    ["slot map", { title: "General Resume", text_by_slot: null }, "resume.general-draft/schema-slot-texts-invalid"],
    ["unexpected topology", { title: "General Resume", text_by_slot: {}, statements: [] }, "resume.general-draft/schema-candidate-shape-invalid"],
  ])("returns a content-free app-owned issue ID for malformed %s", (_label, mutation, expectedIssue) => {
    const candidate = mutation;
    expect(adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input, attempt: 1, candidate })).toMatchObject({
      decision: "retry",
      issue_ids: [expectedIssue],
    });
  });

  it("keeps deterministic fallback and digests stable when the fact snapshot is reordered", () => {
    const forward = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input, attempt: 2, candidate: null });
    const reversed = adjudicateResumeGeneralDraft({ program: RESUME_GENERAL_DRAFT_PROGRAM, input: { ...input, facts: [...input.facts].reverse() }, attempt: 2, candidate: null });
    expect(reversed).toEqual(forward);
  });
});

describe("Resume Builder-owned standard inference persistence", () => {
  it("binds an accepted result to the app-owned data blocks and policy", () => {
    const standardInput = {
      purpose: "resume_guidance",
      data_blocks: [{
        category: "confirmed_fact_snapshot",
        content_digest: `sha256:${"d".repeat(64)}`,
        schema_id: "resume.confirmed-facts.v1",
        schema_version: 1,
        data: { facts: [] },
      }],
      prompt_policy_id: "braindrive.resume-builder.fixed",
      prompt_policy_version: "12",
    };
    const candidate = { guidance_version: 1, items: [], optional_questions: [] };
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_guidance,
      input: standardInput,
      attempt: 1,
      candidate,
    })).toMatchObject({
      decision: "accepted",
      result: candidate,
      persistence_binding: {
        prompt_policy_id: standardInput.prompt_policy_id,
        prompt_policy_version: standardInput.prompt_policy_version,
        input_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        output_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
  });

  const strategyInput = {
    purpose: "resume_strategy",
    data_blocks: [{
      category: "confirmed_fact_snapshot",
      content_digest: `sha256:${"e".repeat(64)}`,
      schema_id: "resume.confirmed-facts.v1",
      schema_version: 1,
      data: {
        facts: [
          { revision_id: jobId, fact_kind: "employment", value: "Customer Service Lead at Synthetic Lakeside Market", source_revision_ids: [] },
          { revision_id: evidenceId, fact_kind: "job_evidence", value: JSON.stringify({ association: "job", job_fact_revision_id: jobId, dimension: "accomplishments", outcome: "answered", owner_text: "Created a checkout checklist." }), source_revision_ids: [] },
        ],
      },
    }],
    prompt_policy_id: "braindrive.resume-builder.fixed",
    prompt_policy_version: "12",
  };
  const validStrategy = {
    strategy_version: 1,
    history_shape: "early_career",
    history_reason_code: "thin_history",
    role_emphasis: [{ job_fact_revision_id: jobId, priority: "primary", reason_code: "recent", bullet_density: "compact" }],
    section_order: ["experience"],
    evidence_priorities: [
      { fact_revision_id: jobId, priority: "must_use" },
      { fact_revision_id: evidenceId, priority: "must_use" },
    ],
    summary_decision: "omit",
    summary_reason_code: "insufficient_distinct_value",
    skills_context: [],
    omissions: [],
    unresolved_gap_ids: [],
    owner_rationale: "Lead with confirmed experience.",
  };

  const providerStrategy = {
    strategy_version: validStrategy.strategy_version,
    history_mode: "early_career",
    summary_mode: "omit_insufficient_distinct_value",
    owner_rationale: validStrategy.owner_rationale,
  };

  it("keeps evidence identity and summary coherence out of the provider response authority", () => {
    const plan = prepareResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 1,
      previous: null,
    });
    expect(plan.program).toEqual({ id: "resume.strategy", version: 2 });
    expect(plan.schema_name).toBe("resume_strategy_v2");
    expect(plan.output_schema.required).toEqual(["strategy_version", "history_mode", "summary_mode", "owner_rationale"]);
    expect(plan.output_schema.properties).not.toHaveProperty("history_shape");
    expect(plan.output_schema.properties).not.toHaveProperty("history_reason_code");
    expect(plan.output_schema.properties).not.toHaveProperty("role_emphasis");
    expect(plan.output_schema.properties).not.toHaveProperty("section_order");
    expect(plan.output_schema.properties).not.toHaveProperty("evidence_priorities");
    expect(plan.output_schema.properties).not.toHaveProperty("summary_decision");
    expect(plan.output_schema.properties).not.toHaveProperty("summary_reason_code");
    expect(plan.output_schema.properties).not.toHaveProperty("skills_context");
    expect(plan.output_schema.properties).not.toHaveProperty("omissions");
    expect(plan.output_schema.properties).not.toHaveProperty("unresolved_gap_ids");
    expect(plan.output_schema.properties.summary_mode).toEqual({
      type: "string",
      enum: ["include_supported_positioning", "omit_insufficient_distinct_value", "omit_redundant_with_experience"],
    });
  });

  it("projects provider summary mode and exact confirmed annotations into the persisted strategy", () => {
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 1,
      candidate: providerStrategy,
    })).toMatchObject({
      decision: "accepted",
      issue_ids: [],
      result: {
        history_shape: "early_career",
        history_reason_code: "thin_history",
        role_emphasis: validStrategy.role_emphasis,
        section_order: ["experience"],
        evidence_priorities: validStrategy.evidence_priorities,
        summary_decision: "omit",
        summary_reason_code: "insufficient_distinct_value",
      },
    });
  });

  it("derives must-use, preferred, and context priorities without accepting a provider-supplied binding list", () => {
    const skillId = "10000000-0000-4000-8000-000000000007";
    const derivedInput = {
      ...strategyInput,
      data_blocks: [{
        ...strategyInput.data_blocks[0],
        data: {
          facts: [
            ...strategyInput.data_blocks[0].data.facts,
            { revision_id: skillId, fact_kind: "skill", value: "Synthetic skill", source_revision_ids: [] },
            { revision_id: preferenceId, fact_kind: "preference", value: "Synthetic preference", source_revision_ids: [] },
          ],
        },
      }],
    };
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: derivedInput,
      attempt: 1,
      candidate: providerStrategy,
    })).toMatchObject({
      decision: "accepted",
      result: {
        evidence_priorities: [
          { fact_revision_id: jobId, priority: "must_use" },
          { fact_revision_id: evidenceId, priority: "must_use" },
          { fact_revision_id: skillId, priority: "preferred" },
          { fact_revision_id: preferenceId, priority: "context" },
        ],
        skills_context: [{ skill_fact_revision_id: skillId, placement: "skills_section", context_fact_revision_ids: [] }],
      },
    });
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: derivedInput,
      attempt: 1,
      candidate: { ...providerStrategy, evidence_priorities: [] },
    })).toMatchObject({ decision: "retry", issue_ids: ["resume.strategy/schema-result-invalid"] });
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: derivedInput,
      attempt: 1,
      candidate: { ...providerStrategy, skills_context: [] },
    })).toMatchObject({ decision: "retry", issue_ids: ["resume.strategy/schema-result-invalid"] });
  });

  it("expands the single include summary mode into its only coherent persisted pair", () => {
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 1,
      candidate: { ...providerStrategy, summary_mode: "include_supported_positioning" },
    })).toMatchObject({
      decision: "accepted",
      result: { summary_decision: "include", summary_reason_code: "supported_positioning" },
    });
  });

  it("structurally constrains every provider-owned strategy field", () => {
    const plan = prepareResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 1,
      previous: null,
    });
    expect(plan.output_schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        strategy_version: { const: 1 },
        history_mode: { enum: expect.arrayContaining(["early_career", "chronological_standard"]) },
        summary_mode: { enum: ["include_supported_positioning", "omit_insufficient_distinct_value", "omit_redundant_with_experience"] },
        owner_rationale: { type: "string", minLength: 1, maxLength: 1_024 },
      },
    });
    expect(plan.output_schema.properties).not.toHaveProperty("evidence_priorities");
    expect(plan.output_schema.properties).not.toHaveProperty("summary_decision");
    expect(plan.output_schema.properties).not.toHaveProperty("summary_reason_code");
  });

  it.each([
    ["history mode", { history_mode: "recent_first" }, "resume.strategy/schema-history-mode-invalid"],
    ["summary mode", { summary_mode: "maybe" }, "resume.strategy/schema-summary-mode-invalid"],
    ["owner rationale", { owner_rationale: "" }, "resume.strategy/schema-owner-rationale-invalid"],
  ])("returns the precise content-free strategy issue ID for malformed %s", (_label, mutation, expectedIssue) => {
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 1,
      candidate: { ...providerStrategy, ...mutation },
    })).toMatchObject({ decision: "retry", issue_ids: [expectedIssue] });
  });

  it("constructs canonical role ordering, section topology, and evidence-shaped density in the app", () => {
    const accepted = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 1,
      candidate: providerStrategy,
    });
    expect(accepted).toMatchObject({
      decision: "accepted",
      issue_ids: [],
      result: {
        role_emphasis: [{ bullet_density: "compact" }],
        section_order: ["experience"],
        evidence_priorities: validStrategy.evidence_priorities,
      },
      persistence_binding: { output_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
    });
  });

  it("orders job-bound evidence before general evidence using the domain's code-point ordering", () => {
    const generalEvidenceId = "10000000-0000-4000-8000-000000000006";
    const mixedInput = {
      ...strategyInput,
      data_blocks: [{
        ...strategyInput.data_blocks[0],
        data: {
          facts: [
            ...strategyInput.data_blocks[0].data.facts,
            {
              revision_id: generalEvidenceId,
              fact_kind: "job_evidence",
              value: JSON.stringify({ association: "general", dimension: "tools", outcome: "answered", owner_text: "Used synthetic tools." }),
              source_revision_ids: [],
            },
          ],
        },
      }],
    };
    const accepted = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: mixedInput,
      attempt: 1,
      candidate: {
        ...providerStrategy,
      },
    });
    expect(accepted).toMatchObject({
      decision: "accepted",
      result: {
        evidence_priorities: [
          { fact_revision_id: jobId, priority: "must_use" },
          { fact_revision_id: evidenceId, priority: "must_use" },
          { fact_revision_id: generalEvidenceId, priority: "must_use" },
        ],
      },
    });
  });

  it("rejects a provider attempt to supply an app-owned role identity", () => {
    const foreignJobId = "10000000-0000-4000-8000-000000000099";
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 1,
      candidate: { ...providerStrategy, role_emphasis: [{ ...validStrategy.role_emphasis[0], job_fact_revision_id: foreignJobId }] },
    })).toMatchObject({ decision: "retry", issue_ids: ["resume.strategy/schema-result-invalid"] });
  });

  it("preserves the two-call ceiling and returns a valid deterministic strategy after a second malformed candidate", () => {
    const malformed = { ...providerStrategy, history_mode: "recent_first" };
    const first = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 1,
      candidate: malformed,
    });
    expect(first).toMatchObject({ decision: "retry", issue_ids: ["resume.strategy/schema-history-mode-invalid"] });
    const retry = prepareResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 2,
      previous: { candidate: malformed, issue_ids: first.issue_ids },
    });
    expect(JSON.parse(retry.user).repair.issue_ids).toEqual(first.issue_ids);
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 2,
      candidate: malformed,
    })).toMatchObject({
      decision: "fallback",
      issue_ids: ["resume.strategy/schema-history-mode-invalid"],
      result: {
        ...validStrategy,
        owner_rationale: "Lead with the most recent supported experience and preserve every distinct confirmed evidence unit.",
      },
      persistence_binding: {
        input_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        output_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
  });

  it("keeps the app-owned strategy result and digest invariant under fact ordering", () => {
    const forward = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: strategyInput,
      attempt: 1,
      candidate: providerStrategy,
    });
    const reversedInput = {
      ...strategyInput,
      data_blocks: strategyInput.data_blocks.map((block) => ({ ...block, data: { ...block.data, facts: [...block.data.facts].reverse() } })),
    };
    const reversed = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_strategy,
      input: reversedInput,
      attempt: 1,
      candidate: providerStrategy,
    });
    expect(reversed.result).toEqual(forward.result);
    expect(reversed.persistence_binding.output_digest).toBe(forward.persistence_binding.output_digest);
    expect(reversed.persistence_binding.input_digest).toBe(forward.persistence_binding.input_digest);
  });
});

describe("Resume Builder-owned inference program catalog", () => {
  const standardPurposes = Object.keys(RESUME_INFERENCE_PROGRAMS).filter((purpose) => purpose !== "general_resume_draft") as Array<Exclude<keyof typeof RESUME_INFERENCE_PROGRAMS, "general_resume_draft">>;
  const appInput = (purpose: string) => ({
    purpose,
    data_blocks: [{ category: "confirmed_fact_snapshot", schema_id: "resume.confirmed-facts.v1", schema_version: 1, content_digest: `sha256:${"c".repeat(64)}`, data: { facts: [] } }],
    prompt_policy_id: "braindrive.resume-builder.fixed",
    prompt_policy_version: "12",
  });
  const craftDefinitionRevisionId = "30000000-0000-4000-8000-000000000011";
  const craftStrategyRevisionId = "30000000-0000-4000-8000-000000000012";
  const craftStatementId = "30000000-0000-4000-8000-000000000013";
  const craftInput = {
    ...appInput("resume_craft_evaluate"),
    data_blocks: [
      {
        category: "general_resume_definition",
        schema_id: "resume.definition.v1",
        schema_version: 1,
        content_digest: `sha256:${"d".repeat(64)}`,
        data: {
          metadata: { revision_id: craftDefinitionRevisionId },
          definition_kind: "general",
          statements: [{
            statement_id: craftStatementId,
            section_id: "experience",
            kind: "factual",
            display_role: "bullet",
            text: "Improved a confirmed synthetic workflow.",
            supporting_confirmed_fact_revision_ids: [evidenceId],
          }],
        },
      },
      {
        category: "resume_strategy",
        schema_id: "resume.strategy-record.v1",
        schema_version: 1,
        content_digest: `sha256:${"e".repeat(64)}`,
        data: {
          metadata: { revision_id: craftStrategyRevisionId },
          fact_revision_ids: [evidenceId],
          coverage_revision_ids: [],
        },
      },
    ],
  };
  const passingCraftJudgments = Array.from({ length: 7 }, () => ({
    verdict: "pass",
    evidence_indexes: [0],
    findings: [],
  }));

  it("prepares every non-General purpose inside the installed app with a strict schema and carries content-free issues into one repair call", () => {
    for (const purpose of standardPurposes) {
      const program = RESUME_INFERENCE_PROGRAMS[purpose];
      const invocation = { program, input: appInput(purpose), attempt: 1, previous: null };
      const plan = prepareResumeInference(invocation);
      expect(plan).toMatchObject({ program, attempt: 1 });
      expect(plan.system).toContain("installed Resume Builder inference program");
      expect(plan.user).toContain(`\"purpose\":\"${purpose}\"`);
      expect(JSON.stringify(plan)).not.toMatch(/api_key|provider_profile_id|authorization|bearer/i);
      expect(plan.output_schema).toMatchObject({ type: "object", additionalProperties: false });
      const retry = adjudicateResumeInference({ program, input: invocation.input, attempt: 1, candidate: null });
      expect(retry).toMatchObject({ decision: "retry", issue_ids: [`${program.id}/schema-result-invalid`] });
      const repair = prepareResumeInference({ ...invocation, attempt: 2, previous: { candidate: null, issue_ids: retry.issue_ids } });
      expect(repair.user).toContain(retry.issue_ids[0]);
    }
  });

  it("asks only for bounded craft judgments and derives immutable report topology in the app", () => {
    const plan = prepareResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_craft_evaluate,
      input: craftInput,
      attempt: 1,
      previous: null,
    });
    expect(plan.output_schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["judgments"],
      properties: {
        judgments: {
          type: "array",
          minItems: 7,
          maxItems: 7,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["verdict", "evidence_indexes", "findings"],
          },
        },
      },
    });
    expect(plan.timeout_ms).toBeLessThanOrEqual(50_000);
    expect(JSON.stringify(plan.output_schema)).not.toMatch(/criterion|finding_id|evidence_ref_id|evidence_digest/);
    const payload = JSON.parse(plan.user);
    expect(payload.craft_contract).toMatchObject({
      criterion_order: ["C1", "C2", "C3", "C4", "C5", "C6", "C7"],
      app_derives: ["criterion_ids", "evidence_bindings", "evidence_reference_ids", "finding_ids", "digests", "overall_verdict", "target_topology"],
    });
    expect(payload.craft_contract.evidence_catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidence_index: 0, kind: "statement", statement_id: craftStatementId }),
    ]));
  });

  it("recovers from an invalid craft result with one valid correction and app-owned bindings", () => {
    const invalid = { judgments: passingCraftJudgments.slice(0, 6) };
    const first = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_craft_evaluate,
      input: craftInput,
      attempt: 1,
      candidate: invalid,
    });
    expect(first).toMatchObject({
      decision: "retry",
      issue_ids: ["resume.craft-evaluate/schema-criterion-set-mismatch"],
    });
    const retryPlan = prepareResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_craft_evaluate,
      input: craftInput,
      attempt: 2,
      previous: { candidate: invalid, issue_ids: first.issue_ids },
    });
    expect(retryPlan.timeout_ms).toBeLessThanOrEqual(50_000);
    expect(JSON.parse(retryPlan.user).repair.issue_ids).toEqual(first.issue_ids);

    const recovered = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_craft_evaluate,
      input: craftInput,
      attempt: 2,
      candidate: { judgments: passingCraftJudgments },
    });
    expect(recovered).toMatchObject({
      decision: "accepted",
      issue_ids: [],
      result: {
        report_version: 2,
        evidence_context: "standard",
        verdict: "pass",
        criterion_verdicts: [
          { criterion: "C1", verdict: "pass" },
          { criterion: "C2", verdict: "pass" },
          { criterion: "C3", verdict: "pass" },
          { criterion: "C4", verdict: "pass" },
          { criterion: "C5", verdict: "pass" },
          { criterion: "C6", verdict: "pass" },
          { criterion: "C7", verdict: "pass" },
          { criterion: "T1", verdict: "not_applicable" },
          { criterion: "T2", verdict: "not_applicable" },
          { criterion: "T3", verdict: "not_applicable" },
        ],
        findings: [],
      },
    });
    for (const verdict of recovered.result.criterion_verdicts) {
      expect(verdict.evidence_refs).toHaveLength(1);
      expect(verdict.evidence_refs[0]).toMatchObject({
        evidence_ref_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        evidence_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
    }
  });

  it("rejects missing or provider-controlled craft criterion IDs and terminates repeated invalid output with a failing fallback", () => {
    const missing = { judgments: passingCraftJudgments.slice(0, 6) };
    const mismatched = {
      judgments: passingCraftJudgments.map((judgment, index) => index === 0 ? { criterion: "C2", ...judgment } : judgment),
    };
    for (const candidate of [missing, mismatched]) {
      expect(adjudicateResumeInference({
        program: RESUME_INFERENCE_PROGRAMS.resume_craft_evaluate,
        input: craftInput,
        attempt: 1,
        candidate,
      })).toMatchObject({ decision: "retry", issue_ids: ["resume.craft-evaluate/schema-criterion-set-mismatch"] });
    }

    const terminal = adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS.resume_craft_evaluate,
      input: craftInput,
      attempt: 2,
      candidate: missing,
    });
    expect(terminal).toMatchObject({
      decision: "fallback",
      issue_ids: ["resume.craft-evaluate/schema-criterion-set-mismatch"],
      result: {
        report_version: 2,
        evidence_context: "limited",
        verdict: "fail",
        criterion_verdicts: expect.any(Array),
        findings: expect.any(Array),
      },
    });
    expect(terminal.result.criterion_verdicts).toHaveLength(10);
    expect(terminal.result.criterion_verdicts.filter((entry: any) => entry.criterion.startsWith("C")).every((entry: any) => entry.verdict === "fail")).toBe(true);
    expect(terminal.result.criterion_verdicts.filter((entry: any) => entry.criterion.startsWith("T")).every((entry: any) => entry.verdict === "not_applicable")).toBe(true);
    expect(terminal.result.findings.every((finding: any) => finding.severity === "blocking")).toBe(true);
  });

  it.each([
    ["interview_assist", "fallback"],
    ["resume_strategy", "fallback"],
    ["job_description_analyze", "failed"],
    ["requirement_evidence_match", "fallback"],
    ["tailoring_plan", "fallback"],
    ["targeted_resume_draft", "fallback"],
    ["resume_revision_classify", "fallback"],
    ["resume_revision_draft", "failed"],
    ["resume_guidance", "fallback"],
    ["resume_craft_evaluate", "fallback"],
    ["resume_craft_repair", "failed"],
  ] as const)("applies the app-owned terminal policy for %s", (purpose, expectedDecision) => {
    const sourceRevisionId = "30000000-0000-4000-8000-000000000001";
    const requestRevisionId = "30000000-0000-4000-8000-000000000002";
    const opportunityId = "30000000-0000-4000-8000-000000000003";
    const requirementId = "30000000-0000-4000-8000-000000000004";
    const statementId = "30000000-0000-4000-8000-000000000005";
    const dataByPurpose: Record<string, any[]> = {
      interview_assist: [{ category: "job_evidence_summary", data: { active_job_fact_revision_id: jobId, active_job_revision: 7, requested_opportunity_id: opportunityId, requested_dimension: "accomplishments", opportunity_kind: "qualitative", value_category: "distinct_accomplishment" } }],
      resume_strategy: [{ category: "confirmed_fact_snapshot", data: { facts: [{ revision_id: jobId, fact_kind: "employment", value: "Synthetic role" }] } }],
      job_description_analyze: [{ category: "job_description", data: { metadata: { revision_id: sourceRevisionId }, description_text: "Synthetic role requires careful documentation." } }],
      requirement_evidence_match: [
        { category: "confirmed_fact_snapshot", data: { facts: [] } },
        { category: "job_analysis", data: { requirements: [{ requirement_id: requirementId, requirement_kind: "required", source_span: "careful documentation", inferred: false, normalized_requirement: "Careful documentation" }] } },
      ],
      tailoring_plan: [
        { category: "confirmed_fact_snapshot", data: { facts: [] } },
        { category: "evidence_matrix", data: [{ requirement_id: requirementId, requirement_kind: "required", evidence_status: "unsupported", source_span: "careful documentation", inferred: false, supporting_confirmed_fact_revision_ids: [], clarification: null }] },
        { category: "general_resume_definition", data: { metadata: { revision_id: sourceRevisionId }, statements: [{ statement_id: statementId }] } },
        { category: "target_fit_policy", data: { policy_id: "braindrive.resume-builder.target-fit.provisional-rb7-oq3", policy_version: "1", authority_status: "provisional_planning_default", supported_core_minimum: 1, supported_transferable_minimum: 2, material_change_minimum: 1, score_free: true } },
      ],
      targeted_resume_draft: [
        { category: "general_resume_definition", data: { metadata: { revision_id: sourceRevisionId }, title: "General Resume", statements: [], section_order: ["experience"] } },
        { category: "job_description", data: { metadata: { revision_id: requestRevisionId } } },
        { category: "target_fit_analysis", data: { outcome: "targeted_variant", analysis_state: "ready_for_targeted_draft", parent_general_definition_revision_id: sourceRevisionId, job_revision_id: requestRevisionId, material_changes: [] } },
      ],
      resume_revision_classify: [{ category: "revision_instruction", data: { metadata: { revision_id: requestRevisionId }, source_definition_revision_id: sourceRevisionId, target: { scope: "resume", target_id: null }, request_text: "Make this better" } }],
      resume_revision_draft: [
        { category: "resume_definition", data: { metadata: { revision_id: sourceRevisionId }, title: "General Resume", statements: [], section_order: ["experience"] } },
        { category: "revision_instruction", data: { metadata: { revision_id: requestRevisionId }, source_definition_revision_id: sourceRevisionId, target: { scope: "resume", target_id: null }, classification: "presentation", state: "generating" } },
      ],
      resume_guidance: [{ category: "deterministic_findings", data: { findings: [{ code: "missing_detail", evidence_revision_ids: [], safe_message: "A supported summary is not available." }] } }],
      resume_craft_evaluate: [
        { category: "general_resume_definition", data: { metadata: { revision_id: sourceRevisionId }, definition_kind: "general", statements: [{ statement_id: statementId }] } },
        { category: "resume_strategy", data: { metadata: { revision_id: requestRevisionId }, history_shape: "early_career", fact_revision_ids: [], coverage_revision_ids: [] } },
      ],
      resume_craft_repair: [
        { category: "general_resume_definition", data: { metadata: { revision_id: sourceRevisionId }, statements: [{ statement_id: statementId }] } },
        { category: "craft_quality_report", data: { metadata: { revision_id: requestRevisionId } } },
        { category: "craft_repair_scope", data: { statement_ids: [statementId] } },
      ],
    };
    const invocationInput = {
      purpose,
      data_blocks: (dataByPurpose[purpose] ?? []).map((block, index) => ({
        schema_id: `resume.synthetic-${index}.v1`, schema_version: 1, content_digest: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`, ...block,
      })),
      prompt_policy_id: "braindrive.resume-builder.fixed",
      prompt_policy_version: "12",
    };
    expect(adjudicateResumeInference({
      program: RESUME_INFERENCE_PROGRAMS[purpose], input: invocationInput, attempt: 2, candidate: null,
    })).toMatchObject({ decision: expectedDecision });
  });
});
