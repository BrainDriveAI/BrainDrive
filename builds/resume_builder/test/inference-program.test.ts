import { describe, expect, it } from "vitest";

import {
  RESUME_GENERAL_DRAFT_PROGRAM,
  RESUME_INFERENCE_PROGRAMS,
  adjudicateResumeInference,
  adjudicateResumeGeneralDraft,
  prepareResumeInference,
  prepareResumeGeneralDraft,
} from "../resources/inference-program.js";

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
      "Platform Engineer at Example Company",
      "Reduced deployment time by 30%",
    ]);
    expect(recovered.result.draft.statements.map((statement: any) => statement.text).join("\n")).not.toMatch(/resume_job_v1|job_fact_revision_id|[{}]/);
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
    expect(recovered.result.draft.statements).toContainEqual(expect.objectContaining({ section_id: "summary", text: "Platform Engineer at Example.", supporting_confirmed_fact_revision_ids: [jobId] }));
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
});

describe("Resume Builder-owned inference program catalog", () => {
  const standardPurposes = Object.keys(RESUME_INFERENCE_PROGRAMS).filter((purpose) => purpose !== "general_resume_draft") as Array<Exclude<keyof typeof RESUME_INFERENCE_PROGRAMS, "general_resume_draft">>;
  const appInput = (purpose: string) => ({
    purpose,
    data_blocks: [{ category: "confirmed_fact_snapshot", schema_id: "resume.confirmed-facts.v1", schema_version: 1, content_digest: `sha256:${"c".repeat(64)}`, data: { facts: [] } }],
    prompt_policy_id: "braindrive.resume-builder.fixed",
    prompt_policy_version: "12",
  });

  it("prepares every non-General purpose inside the installed app and carries content-free issues into one repair call", () => {
    for (const purpose of standardPurposes) {
      const program = RESUME_INFERENCE_PROGRAMS[purpose];
      const invocation = { program, input: appInput(purpose), attempt: 1, previous: null };
      const plan = prepareResumeInference(invocation);
      expect(plan).toMatchObject({ program, attempt: 1 });
      expect(plan.system).toContain("installed Resume Builder inference program");
      expect(plan.user).toContain(`\"purpose\":\"${purpose}\"`);
      expect(JSON.stringify(plan)).not.toMatch(/api_key|credential|provider_profile_id/);
      const retry = adjudicateResumeInference({ program, input: invocation.input, attempt: 1, candidate: null });
      expect(retry).toMatchObject({ decision: "retry", issue_ids: [`${program.id}/schema-result-invalid`] });
      const repair = prepareResumeInference({ ...invocation, attempt: 2, previous: { candidate: null, issue_ids: retry.issue_ids } });
      expect(repair.user).toContain(retry.issue_ids[0]);
      expect(adjudicateResumeInference({ program, input: invocation.input, attempt: 2, candidate: null })).toMatchObject({ decision: "failed", safe_error_code: "candidate_invalid" });
    }
  });
});
