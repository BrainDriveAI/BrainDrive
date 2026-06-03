export type AssistantClaimType =
  | "todo_updated"
  | "budget_updated"
  | "report_updated"
  | "statement_integrated"
  | "category_mapped";

export type AssistantClaim = {
  type: AssistantClaimType;
  sourceText: string;
  requiredArtifacts: string[];
  expectedKeywords: string[];
};

export type ObservedArtifact = {
  path: string;
  status?: "added" | "removed" | "modified" | "unchanged";
  content?: string;
  summary?: string;
};

export type ClaimToArtifactLedgerEntry = {
  claim: AssistantClaim;
  observedArtifacts: ObservedArtifact[];
  verificationStatus: "verified" | "missing" | "contradicted" | "not_applicable";
  ownerImpact: string;
};

const CLAIM_PATTERNS: Array<{
  type: AssistantClaimType;
  pattern: RegExp;
  requiredArtifacts: string[];
  expectedKeywords?: (sourceText: string) => string[];
}> = [
  {
    type: "todo_updated",
    pattern: /\b(?:updated|added|saved|put).{0,80}\b(?:todo list|todos|action items|next actions)\b/gi,
    requiredArtifacts: ["me/todo.md"],
    expectedKeywords: todoKeywords,
  },
  {
    type: "budget_updated",
    pattern: /\b(?:updated|created|saved|revised|built|drafted|prepared|set up|created).{0,80}\b(?:saved budget|budget|first-pass budget|first pass budget|budget draft)\b/gi,
    requiredArtifacts: ["documents/finance/budget/budget.md"],
  },
  {
    type: "budget_updated",
    pattern: /\b(?:saved budget|budget|first-pass budget|first pass budget|budget draft).{0,80}\b(?:ready|created|saved|updated|built|prepared|set up)\b/gi,
    requiredArtifacts: ["documents/finance/budget/budget.md"],
  },
  {
    type: "report_updated",
    pattern: /\b(?:updated|created|saved|refreshed).{0,80}\b(?:latest budget report|budget report|report)\b/gi,
    requiredArtifacts: ["documents/finance/budget/reports/latest.md"],
  },
  {
    type: "report_updated",
    pattern: /\b(?:latest budget report|budget report|report).{0,80}\b(?:ready|created|saved|updated|refreshed|available)\b/gi,
    requiredArtifacts: ["documents/finance/budget/reports/latest.md"],
  },
  {
    type: "statement_integrated",
    pattern: /\b(?:all|seven|7).{0,80}\b(?:statements?|files?).{0,80}\b(?:saved|uploaded|integrated|used)\b/gi,
    requiredArtifacts: ["documents/finance/budget/statements/"],
  },
  {
    type: "category_mapped",
    pattern: /\b(?:mapped|categorized|classified|cleared|resolved).{0,80}\b(?:MJP|Blue Door|merchant|transaction|item|mystery list|needs-review|needs review)\b/gi,
    requiredArtifacts: [
      "documents/finance/budget/budget.md",
      "documents/finance/budget/reports/latest.md",
      "documents/finance/budget/budget-rules-user.md",
    ],
    expectedKeywords: categoryKeywords,
  },
  {
    type: "category_mapped",
    pattern: /\b(?:MJP|Blue Door|merchant|transaction|item|mystery list|needs-review|needs review).{0,80}\b(?:mapped|categorized|classified|cleared|resolved)\b/gi,
    requiredArtifacts: [
      "documents/finance/budget/budget.md",
      "documents/finance/budget/reports/latest.md",
      "documents/finance/budget/budget-rules-user.md",
    ],
    expectedKeywords: categoryKeywords,
  },
  {
    type: "category_mapped",
    pattern: /\b(?:going to|will|I'll|I will).{0,40}\bsave.{0,80}\b(?:these updates|category updates|classifications|needs-review|needs review)\b/gi,
    requiredArtifacts: [
      "documents/finance/budget/budget.md",
      "documents/finance/budget/reports/latest.md",
      "documents/finance/budget/budget-rules-user.md",
    ],
    expectedKeywords: categoryKeywords,
  },
];

export function buildClaimToArtifactLedger(input: {
  assistantText: string;
  observedArtifacts: ObservedArtifact[];
}): ClaimToArtifactLedgerEntry[] {
  return extractAssistantClaims(input.assistantText).map((claim) => {
    const observedArtifacts = findObservedArtifacts(claim, input.observedArtifacts);
    const verificationStatus = verifyClaim(claim, observedArtifacts);
    return {
      claim,
      observedArtifacts,
      verificationStatus,
      ownerImpact: ownerImpactFor(claim, verificationStatus),
    };
  });
}

export function extractAssistantClaims(assistantText: string): AssistantClaim[] {
  const claims: AssistantClaim[] = [];
  for (const definition of CLAIM_PATTERNS) {
    for (const match of assistantText.matchAll(definition.pattern)) {
      const sourceText = match[0].trim();
      if (isNegativeSaveStatusClaim(assistantText, match.index ?? 0, sourceText)) {
        continue;
      }
      claims.push({
        type: definition.type,
        sourceText,
        requiredArtifacts: definition.requiredArtifacts,
        expectedKeywords: definition.expectedKeywords?.(sourceText) ?? [],
      });
    }
  }
  return claims;
}

function isNegativeSaveStatusClaim(assistantText: string, matchIndex: number, sourceText: string): boolean {
  const lookback = assistantText.slice(Math.max(0, matchIndex - 80), matchIndex);
  const context = `${lookback} ${sourceText}`.toLowerCase();
  return /\bnot saved yet\b/.test(context) ||
    /\bcould not verify\b/.test(context) ||
    /\bnot verified\b/.test(context) ||
    /\bmay still need\b/.test(context);
}

function findObservedArtifacts(claim: AssistantClaim, observedArtifacts: ObservedArtifact[]): ObservedArtifact[] {
  return observedArtifacts.filter((artifact) =>
    claim.requiredArtifacts.some((requiredPath) =>
      requiredPath.endsWith("/")
        ? normalizePath(artifact.path).startsWith(requiredPath)
        : normalizePath(artifact.path) === requiredPath
    )
  );
}

function verifyClaim(
  claim: AssistantClaim,
  observedArtifacts: ObservedArtifact[]
): ClaimToArtifactLedgerEntry["verificationStatus"] {
  if (observedArtifacts.length === 0) {
    return "missing";
  }

  if (claim.type === "statement_integrated") {
    const savedStatements = observedArtifacts.filter((artifact) => artifact.status === "added" || artifact.status === "modified");
    return savedStatements.length > 0 ? "verified" : "missing";
  }

  const changedArtifacts = observedArtifacts.filter((artifact) => artifact.status !== "unchanged");
  if (changedArtifacts.length === 0) {
    return "missing";
  }

  if (claim.expectedKeywords.length === 0) {
    return "verified";
  }

  const combinedContent = changedArtifacts.map((artifact) => `${artifact.content ?? ""}\n${artifact.summary ?? ""}`).join("\n").toLowerCase();
  const matchedKeyword = claim.expectedKeywords.some((keyword) => combinedContent.includes(keyword.toLowerCase()));
  return matchedKeyword ? "verified" : "contradicted";
}

function ownerImpactFor(claim: AssistantClaim, status: ClaimToArtifactLedgerEntry["verificationStatus"]): string {
  if (status === "verified") {
    return `${claim.type} claim is backed by the expected artifact.`;
  }
  if (status === "contradicted") {
    return `${claim.type} claim has an artifact change, but the changed content does not contain the promised item.`;
  }
  if (status === "missing") {
    return `${claim.type} claim is missing the expected durable artifact change.`;
  }
  return `${claim.type} claim does not require artifact verification.`;
}

function todoKeywords(sourceText: string): string[] {
  const text = sourceText.toLowerCase();
  return [
    text.includes("autopay") || text.includes("auto-pay") ? "autopay" : null,
    text.includes("northbridge") || text.includes("surplus") ? "northbridge" : null,
    text.includes("savings") || text.includes("bucket") || text.includes("sinking") ? "savings" : null,
  ].filter((keyword): keyword is string => Boolean(keyword));
}

function categoryKeywords(sourceText: string): string[] {
  const text = sourceText.toLowerCase();
  return [
    text.includes("mjp") ? "mjp" : null,
    text.includes("blue door") ? "blue door" : null,
  ].filter((keyword): keyword is string => Boolean(keyword));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}
