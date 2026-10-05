import { createHash } from "node:crypto";

import { canonicalInputDigest } from "../app-platform/contracts/common.js";

export type CraftAnchorKind =
  | "professional_identity"
  | "contact"
  | "experience_heading"
  | "experience_evidence"
  | "education"
  | "skill_usage"
  | "strategy_evidence_priority";

export type CraftAnchorSource = {
  statement_id: string;
  section_id: string;
  display_role?: "heading" | "bullet" | "line";
  text: string;
  supporting_confirmed_fact_revision_ids: string[];
};

export type CraftAnchorContext = {
  definition_revision_id: string;
  strategy_revision_id: string;
  title: string;
  statements: CraftAnchorSource[];
  strategy: {
    evidence_priorities: Array<{ fact_revision_id: string; priority: "must_use" | "preferred" | "context" }>;
  };
};

export type CraftAnchor = {
  anchor_id: string;
  anchor_kind: CraftAnchorKind;
  section_id: string | null;
  statement_id: string | null;
  ordinal: number;
  fact_revision_ids: string[];
  content_digest: `sha256:${string}`;
  evidence_digest: `sha256:${string}`;
};

export type CraftAnchorEvidence = {
  extraction_version: 1;
  definition_revision_id: string;
  strategy_revision_id: string;
  anchors: CraftAnchor[];
  criterion_inputs: Array<{ criterion: "C1" | "C2" | "C3"; anchor_ids: string[] }>;
  extraction_digest: `sha256:${string}`;
};

/**
 * Extracts content-minimized, identity-bound C1/C2/C3 inputs without importing
 * renderer internals or making a semantic craft verdict.
 */
export function extractCraftAnchorEvidence(context: CraftAnchorContext): CraftAnchorEvidence {
  const anchors: CraftAnchor[] = [];
  const add = (
    anchorKind: CraftAnchorKind,
    ordinal: number,
    text: string,
    statementId: string | null,
    sectionId: string | null,
    factRevisionIds: string[],
  ) => {
    const identity = `${context.definition_revision_id}:${context.strategy_revision_id}:${anchorKind}:${statementId ?? "definition"}:${ordinal}`;
    const body = {
      anchor_id: deterministicUuid(identity),
      anchor_kind: anchorKind,
      section_id: sectionId,
      statement_id: statementId,
      ordinal,
      fact_revision_ids: [...new Set(factRevisionIds)].sort(),
      content_digest: canonicalInputDigest(normalize(text)),
    };
    anchors.push({ ...body, evidence_digest: canonicalInputDigest(body) });
  };

  add("professional_identity", 0, context.title, null, null, []);
  context.statements.forEach((statement, ordinal) => {
    const kind = anchorKind(statement);
    if (kind) add(kind, ordinal + 1, statement.text, statement.statement_id, statement.section_id, statement.supporting_confirmed_fact_revision_ids);
  });
  const mustUse = context.strategy.evidence_priorities
    .filter((entry) => entry.priority === "must_use")
    .map((entry) => entry.fact_revision_id)
    .sort();
  if (mustUse.length > 0) add("strategy_evidence_priority", anchors.length + 1, mustUse.join("|"), null, null, mustUse);

  const anchorIds = (kinds: CraftAnchorKind[]) => anchors.filter((anchor) => kinds.includes(anchor.anchor_kind)).map((anchor) => anchor.anchor_id);
  const body = {
    extraction_version: 1 as const,
    definition_revision_id: context.definition_revision_id,
    strategy_revision_id: context.strategy_revision_id,
    anchors,
    criterion_inputs: [
      { criterion: "C1" as const, anchor_ids: anchorIds(["professional_identity", "contact", "experience_heading", "education"]) },
      { criterion: "C2" as const, anchor_ids: anchorIds(["experience_heading", "experience_evidence", "skill_usage", "strategy_evidence_priority"]) },
      { criterion: "C3" as const, anchor_ids: anchorIds(["experience_evidence"]) },
    ],
  };
  return { ...body, extraction_digest: canonicalInputDigest(body) };
}

function anchorKind(statement: CraftAnchorSource): CraftAnchorKind | null {
  if (statement.section_id === "contact") return "contact";
  if (statement.section_id === "education") return "education";
  if (statement.section_id === "experience" && statement.display_role === "heading") return "experience_heading";
  if (statement.section_id === "experience") return "experience_evidence";
  if (["skills", "projects", "leadership", "volunteer"].includes(statement.section_id) && statement.supporting_confirmed_fact_revision_ids.length > 0) return "skill_usage";
  return null;
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
