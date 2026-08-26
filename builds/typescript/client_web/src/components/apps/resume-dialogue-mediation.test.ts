import { parseResumeModelTurnCommitPayload } from "./resume-dialogue-mediation";

describe("Resume Builder model-turn bridge mediation", () => {
  it("accepts a clarification with no action and performs no language interpretation", () => {
    expect(parseResumeModelTurnCommitPayload({
      messageId: crypto.randomUUID(),
      assistantMessage: "Let’s start with your most recent role, then add others if they strengthen the story.",
      actions: [],
    })).toMatchObject({ actions: [] });
  });

  it("accepts a compact sourced fact and model-authored draft action envelope", () => {
    const messageId = crypto.randomUUID();
    const factActionId = crypto.randomUUID();
    expect(parseResumeModelTurnCommitPayload({
      messageId,
      assistantMessage: "I’ve prepared a concise version for BrainDrive to save.",
      actions: [
        { action_id: factActionId, action: "create_fact", fact_kind: "employment", value: "Product Lead at Acme Labs", source_references: [{ message_id: messageId, quote: "Product Lead at Acme Labs" }] },
        { action_id: crypto.randomUUID(), action: "save_resume_version", base_definition_revision_id: null, title: "Resume", statements: [{ statement_id: crypto.randomUUID(), section_id: "experience", kind: "factual", display_role: "heading", text: "Product Lead at Acme Labs", supporting_fact_refs: [factActionId] }], section_order: ["experience"], presentation_preferences: {}, locale: "en-US", page_intent: "concise", template_id: "ats-basic", template_version: "1" },
      ],
    })).toMatchObject({ actions: [{ action: "create_fact" }, { action: "save_resume_version" }] });
  });

  it.each([
    { name: "unknown operation", mutate: { action_id: crypto.randomUUID(), action: "interpret_owner" } },
    { name: "invalid fact revision pair", mutate: { action_id: crypto.randomUUID(), action: "update_fact", record_id: crypto.randomUUID(), expected_revision: null, fact_kind: "skill", value: "TypeScript", source_references: [{ message_id: crypto.randomUUID(), quote: "TypeScript" }] } },
    { name: "malformed citation", mutate: { action_id: crypto.randomUUID(), action: "create_fact", fact_kind: "skill", value: "TypeScript", source_references: [{ message_id: "not-an-id", quote: "TypeScript" }] } },
  ])("rejects $name at the bridge envelope", ({ mutate }) => {
    expect(parseResumeModelTurnCommitPayload({ messageId: crypto.randomUUID(), assistantMessage: "Thanks.", actions: [mutate] })).toBeNull();
  });
});
