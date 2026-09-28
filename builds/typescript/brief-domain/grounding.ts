import type { BriefStatement } from "./contracts.js";

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export type GroundingResult = {
  accepted: boolean;
  findings: readonly { statement_id: string; code: "source_quote_missing" | "owner_context_unlabeled" }[];
};

/** Deterministic support check. It makes no claim about prose usefulness or live-model quality. */
export function validateBriefGrounding(sourceText: string, statements: readonly BriefStatement[]): GroundingResult {
  const source = normalized(sourceText);
  const findings: Array<{ statement_id: string; code: "source_quote_missing" | "owner_context_unlabeled" }> = [];
  for (const statement of statements) {
    if (statement.support.kind === "source_quote") {
      if (!source.includes(normalized(statement.support.quote))) findings.push({ statement_id: statement.statement_id, code: "source_quote_missing" });
    } else if (normalized(statement.support.context).length === 0) {
      findings.push({ statement_id: statement.statement_id, code: "owner_context_unlabeled" });
    }
  }
  return Object.freeze({ accepted: findings.length === 0, findings: Object.freeze(findings) });
}
