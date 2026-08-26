export type ResumeModelAction =
  | { action_id: string; action: "create_fact"; fact_kind: "identity" | "contact" | "employment" | "education" | "skill" | "credential" | "accomplishment" | "project" | "preference"; value: string; source_references: Array<{ message_id: string; quote: string }> }
  | { action_id: string; action: "update_fact"; record_id: string; expected_revision: number; fact_kind: "identity" | "contact" | "employment" | "education" | "skill" | "credential" | "accomplishment" | "project" | "preference"; value: string; source_references: Array<{ message_id: string; quote: string }> }
  | { action_id: string; action: "save_resume_version"; base_definition_revision_id: string | null; title: string; statements: Array<{ statement_id: string; section_id: string; kind: "factual" | "presentation"; display_role?: "heading" | "bullet" | "line"; text: string; supporting_fact_refs: string[] }>; section_order: string[]; presentation_preferences: Record<string, string>; locale: string; page_intent: "one_page" | "two_pages" | "concise" | "detailed"; template_id: string; template_version: string }
  | { action_id: string; action: "request_export"; definition_revision_id: string | null; format: "pdf" | "text" };

export type ResumeModelTurnCommitPayload = {
  messageId: string;
  assistantMessage: string;
  actions: ResumeModelAction[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FACT_KINDS = new Set(["identity", "contact", "employment", "education", "skill", "credential", "accomplishment", "project", "preference"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum ? value.trim() : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

/**
 * Performs only bridge-envelope and fact-action bright-line checks. The domain
 * owns the complete action schema, quote membership, references, revisions,
 * authorization, and atomic commit. No conversational meaning is interpreted here.
 */
export function parseResumeModelTurnCommitPayload(value: unknown): ResumeModelTurnCommitPayload | null {
  const payload = record(value);
  if (!payload || !exactKeys(payload, ["messageId", "assistantMessage", "actions"])) return null;
  const messageId = boundedString(payload.messageId, 64);
  const assistantMessage = boundedString(payload.assistantMessage, 4_096);
  if (!messageId || !UUID.test(messageId) || !assistantMessage || !Array.isArray(payload.actions) || payload.actions.length > 32) return null;

  const actions: ResumeModelAction[] = [];
  const actionIds = new Set<string>();
  for (const raw of payload.actions) {
    const action = record(raw);
    const actionId = boundedString(action?.action_id, 64);
    if (!action || !actionId || !UUID.test(actionId) || actionIds.has(actionId)) return null;
    actionIds.add(actionId);

    if (action.action === "create_fact" || action.action === "update_fact") {
      const isUpdate = action.action === "update_fact";
      if (!exactKeys(action, isUpdate
        ? ["action_id", "action", "record_id", "expected_revision", "fact_kind", "value", "source_references"]
        : ["action_id", "action", "fact_kind", "value", "source_references"])) return null;
      const factKind = boundedString(action.fact_kind, 64);
      const factValue = boundedString(action.value, 16_384);
      const recordId = isUpdate ? boundedString(action.record_id, 64) : null;
      const expectedRevision = isUpdate ? action.expected_revision : null;
      if (!factKind || !FACT_KINDS.has(factKind) || !factValue || (isUpdate && (!recordId || !UUID.test(recordId) || !Number.isInteger(expectedRevision) || Number(expectedRevision) < 1))) return null;
      if (!Array.isArray(action.source_references) || action.source_references.length < 1 || action.source_references.length > 32) return null;
      const references = action.source_references.flatMap((rawReference) => {
        const reference = record(rawReference);
        if (!reference || !exactKeys(reference, ["message_id", "quote"])) return [];
        const id = boundedString(reference.message_id, 64);
        const quote = boundedString(reference.quote, 16_384);
        return id && UUID.test(id) && quote ? [{ message_id: id, quote }] : [];
      });
      if (references.length !== action.source_references.length) return null;
      const body = { action_id: actionId, fact_kind: factKind as Extract<ResumeModelAction, { action: "create_fact" }>["fact_kind"], value: factValue, source_references: references };
      actions.push(isUpdate
        ? { ...body, action: "update_fact", record_id: recordId!, expected_revision: Number(expectedRevision) }
        : { ...body, action: "create_fact" });
      continue;
    }

    // Full draft/export validation intentionally stays in the shared inference
    // and domain schemas so the browser does not become an intelligence layer.
    if (action.action === "save_resume_version" || action.action === "request_export") {
      actions.push(action as ResumeModelAction);
      continue;
    }
    return null;
  }
  return { messageId, assistantMessage, actions };
}
