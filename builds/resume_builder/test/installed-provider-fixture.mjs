import { createInstalledResumeE2eFixtureProvider } from "../../typescript/resume-inference/e2e-fixture.ts";

function parsedFactValue(fact) {
  if (fact?.value && typeof fact.value === "object") return fact.value;
  try { return JSON.parse(fact?.value); } catch { return { owner_text: String(fact?.value ?? "") }; }
}

function resumeText(value) {
  return String(value ?? "")
    .replace(/^(?:Professional link|Leadership or volunteer):\s*/i, "")
    .replace(/^My responsibilities expanded to\s+/i, "Responsibilities expanded to ")
    .replace(/^I was promoted\s+/i, "Promoted ")
    .replace(/^I\s+/i, "")
    .trim();
}

function generalDraftCandidate(envelope) {
  const facts = Array.isArray(envelope?.input?.facts) ? envelope.input.facts : [];
  const slots = Array.isArray(envelope?.draft_slots) ? envelope.draft_slots : [];
  if (facts.length === 0 || slots.length === 0) return null;
  const factsById = new Map(facts.map((fact) => [fact.revision_id, fact]));
  const textBySlot = {};
  for (const slot of slots) {
    const support = slot.supporting_confirmed_fact_revision_ids.map((id) => factsById.get(id)).filter(Boolean);
    if (slot.display_role === "heading") {
      const job = parsedFactValue(support[0]);
      textBySlot[slot.slot_id] = [job.title, job.employer, job.location, [job.start_date, job.end_date].filter(Boolean).join(" - ")].filter(Boolean).join(" | ");
      continue;
    }
    if (slot.section_id === "summary") {
      const jobs = support.map(parsedFactValue);
      textBySlot[slot.slot_id] = `${jobs.map((job) => `${job.title} at ${job.employer}`).join("; ")}.`;
      continue;
    }
    textBySlot[slot.slot_id] = support.map((fact) => {
      const value = parsedFactValue(fact);
      return resumeText(value.owner_text ?? value.responsibilities ?? fact.value);
    }).filter(Boolean).join("; ");
  }
  const contact = facts.find((fact) => fact.fact_kind === "contact" && !String(fact.value).startsWith("Professional link:"));
  return { title: String(contact?.value ?? "Resume").split("|")[0].trim(), text_by_slot: textBySlot };
}

function craftJudgments(contract) {
  const criterionCount = Array.isArray(contract?.criterion_order) ? contract.criterion_order.length : 0;
  const statementEvidence = Array.isArray(contract?.evidence_catalog)
    ? contract.evidence_catalog.find((entry) => entry?.kind === "statement")
    : null;
  if (criterionCount === 0 || !Number.isInteger(statementEvidence?.evidence_index)) return null;
  return {
    judgments: Array.from({ length: criterionCount }, () => ({
      verdict: "pass",
      evidence_indexes: [statementEvidence.evidence_index],
      findings: [],
    })),
  };
}

export async function resolveInstalledAppInferenceProvider() {
  const provider = createInstalledResumeE2eFixtureProvider();
  const complete = provider.adapter.completeStructuredNoTools.bind(provider.adapter);
  return {
    ...provider,
    adapter: {
      ...provider.adapter,
      async completeStructuredNoTools(request) {
        const envelope = JSON.parse(request.user);
        const response = await complete(request);
        if (envelope.policy?.purpose?.startsWith("Create one unapproved General Resume")) {
          const candidate = generalDraftCandidate(envelope);
          return candidate ? { ...response, text: JSON.stringify(candidate) } : response;
        }
        if (envelope.input?.purpose === "resume_strategy") {
          const facts = envelope.input.data_blocks?.find((block) => block?.category === "confirmed_fact_snapshot")?.data?.facts ?? [];
          const jobCount = facts.filter((fact) => fact?.fact_kind === "employment").length;
          const candidate = {
            strategy_version: 1,
            history_mode: jobCount <= 1 ? "early_career" : "chronological_standard",
            summary_mode: jobCount >= 2 ? "include_supported_positioning" : "omit_insufficient_distinct_value",
            owner_rationale: "Lead with the most recent supported experience and preserve each distinct confirmed evidence unit.",
          };
          return { ...response, text: JSON.stringify(candidate) };
        }
        if (envelope.input?.purpose === "tailoring_plan") {
          const policy = envelope.input.data_blocks?.find((block) => block?.category === "target_fit_policy")?.data;
          const candidate = JSON.parse(response.text);
          if (policy?.policy_id && policy?.policy_version) {
            candidate.threshold_policy_id = policy.policy_id;
            candidate.threshold_policy_version = policy.policy_version;
          }
          return { ...response, text: JSON.stringify(candidate) };
        }
        if (envelope.input?.purpose !== "resume_craft_evaluate") return response;
        const candidate = craftJudgments(envelope.craft_contract) ?? JSON.parse(response.text);
        return { ...response, text: JSON.stringify(candidate) };
      },
    },
  };
}
