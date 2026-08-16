export type ResumeDialogueFactOperation =
  | { operation: "capture"; fact_kind: "identity" | "contact" | "education" | "skill" | "credential" | "project" | "preference"; value: string; source_quote: string }
  | { operation: "capture"; fact_kind: "employment"; source_quote: string; supporting_source_revision_ids?: string[]; employment: { title: string; employer: string; location: string | null; start_date: string | null; end_date: string | null; responsibilities: string | null } }
  | { operation: "capture"; fact_kind: "accomplishment"; source_quote: string; text: string; job_fact_revision_id: string | null }
  | { operation: "capture"; fact_kind: "job_evidence"; source_quote: string; text: string; job_fact_revision_id: string; dimension: "responsibilities" | "accomplishments" | "outcomes" | "tools" | "scope" | "progression" };

export type ResumeDialogueCommitPayload = {
  messageId: string;
  assistantMessage: string;
  factOperations: ResumeDialogueFactOperation[];
  draftAction: ResumeDialogueDraftAction | null;
};

export type ResumeDialogueDraftAction = {
  action: "create_general_draft";
  intent: "explicit_request" | "accepted_offer";
  source_quote: string;
};

export type ResumeDraftReadiness =
  | { ready: true }
  | { ready: false; reason: "missing_employment" | "missing_supporting_evidence"; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIMPLE_FACT_KINDS = new Set(["identity", "contact", "education", "skill", "credential", "project", "preference"]);
const JOB_DIMENSIONS = new Set(["responsibilities", "accomplishments", "outcomes", "tools", "scope", "progression"]);

export type GroundedOwnerMessage = {
  content: string;
  sourceRevisionId: string;
};

export type GroundedEmploymentCandidate = {
  sourceQuote: string;
  sourceRevisionIds: string[];
  employment: {
    title: string;
    employer: string;
    location: null;
    start_date: string | null;
    end_date: string | null;
    responsibilities: null;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown, maximum: number, nullable = false): string | null | undefined {
  if (nullable && value === null) return null;
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum ? value.trim() : undefined;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function normalizedGrounding(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function containsGrounding(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizedGrounding(needle);
  return Boolean(normalizedNeedle) && normalizedGrounding(haystack).includes(normalizedNeedle);
}

function isNonFactControlMarker(value: string): boolean {
  const normalized = normalizedGrounding(value);
  return /^:?\s*skip\s*:?/.test(normalized)
    || /^(?:none|n\/a|not applicable|no (?:fact|detail|information|accomplishment)s? (?:stated|provided|given)(?: in this message)?)\.?$/.test(normalized);
}

function cleanEmploymentSegment(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[,;:\s]+|[,;:\s]+$/g, "").trim();
}

function cleanEmployer(value: string): string {
  return cleanEmploymentSegment(value).replace(
    /\s+(?:an?|the)\s+(?:(?:[a-z][\w-]*)\s+){0,5}(?:company|firm|business|startup|organization|agency|nonprofit)\s*$/i,
    "",
  ).trim();
}

function explicitEmploymentIdentity(answer: string): { title: string; employer: string } | null {
  const called = /\b(?:it|the company|the business)\s+(?:was\s+)?called\s+(.+?)\s+and\s+i\s+was\s+(?:the\s+|an?\s+)?(.+?)\s+(?:of|at)\s+(?:that|the)\s+(?:company|business)\b/i.exec(answer);
  if (called) {
    const employer = cleanEmploymentSegment(called[1] ?? "");
    const title = cleanEmploymentSegment(called[2] ?? "");
    if (title && employer) return { title, employer };
  }
  const namedRole = /\b(?:my\s+(?:(?:most\s+recent|previous|last)\s+)?(?:role|title)(?:\s+there)?\s+(?:was|is)|the\s+(?:role|title)\s+(?:was|is))\s+(?:the\s+|an?\s+)?([^.!?]{1,80}?)\s+(?:at|for|with)\s+([^.!?]{1,100}?)(?=\s+(?:where|which|when|and\s+i)\b|\s+(?:from\s+)?(?:19|20)\d{2}\b|[.!?]|$)/i.exec(answer);
  if (namedRole) {
    const title = cleanEmploymentSegment(namedRole[1] ?? "");
    const employer = cleanEmployer(namedRole[2] ?? "");
    if (title && employer) return { title, employer };
  }
  const roleAt = /\bi\s+(?:worked|work|was|served)\s+(?:as\s+)?(?:the\s+|an?\s+)?(?!working\b)([^.!?]{1,80}?)\s+(?:at|for|with)\s+([^.!?]{1,100}?)(?=\s+(?:where|which|when|and\s+i)\b|\s+(?:from\s+)?(?:19|20)\d{2}\b|[.!?]|$)/i.exec(answer);
  if (!roleAt) return null;
  const title = cleanEmploymentSegment(roleAt[1] ?? "");
  const employer = cleanEmployer(roleAt[2] ?? "");
  return title && employer ? { title, employer } : null;
}

function explicitDateRange(answer: string): { start_date: string; end_date: string } | null {
  const match = /\b(?:from\s+)?((?:19|20)\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(?:19|20)\d{2})\s+(?:to|through|[-–—])\s+(present|current|(?:19|20)\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(?:19|20)\d{2})\b/i.exec(answer);
  return match ? { start_date: match[1]!, end_date: match[2]! } : null;
}

function correctedEmployer(answer: string): string | null {
  const match = /^\s*(.+?)\s+is\s+the\s+correct\s+(?:company\s+)?name(?:\s+and\s+spelling)?\b/i.exec(answer);
  return match ? cleanEmploymentSegment(match[1] ?? "") || null : null;
}

function correctedTitle(answer: string): string | null {
  const match = /\b(?:my|the)\s+(?:title|role)\s+(?:was|is)\s+(.+?)(?=[.!?]|$)/i.exec(answer);
  return match ? cleanEmploymentSegment(match[1] ?? "") || null : null;
}

export function employmentCandidatesFromInterviewTurns(value: unknown): GroundedEmploymentCandidate[] {
  if (!Array.isArray(value)) return [];
  const turns = value.flatMap((candidate) => {
    const source = record(candidate);
    const metadata = record(source?.metadata);
    const extensions = record(source?.extensions);
    const turn = record(extensions?.interview_turn);
    const answer = boundedString(turn?.answer, 16_384);
    const question = boundedString(turn?.question, 16_384);
    const revisionId = boundedString(metadata?.revision_id, 64);
    const occurredAt = boundedString(turn?.occurred_at, 128);
    if (!answer || !revisionId || !UUID.test(revisionId)) return [];
    return [{ answer, question: question ?? "", revisionId, occurredAt: occurredAt ?? "" }];
  }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const candidates: GroundedEmploymentCandidate[] = [];
  for (const turn of turns) {
    const identity = explicitEmploymentIdentity(turn.answer);
    if (identity) {
      const dates = explicitDateRange(turn.answer);
      candidates.push({
        sourceQuote: turn.answer,
        sourceRevisionIds: [turn.revisionId],
        employment: {
          title: identity.title,
          employer: identity.employer,
          location: null,
          start_date: dates?.start_date ?? null,
          end_date: dates?.end_date ?? null,
          responsibilities: null,
        },
      });
      continue;
    }
    const candidate = candidates.at(-1) ?? null;
    if (!candidate) continue;
    const employer = correctedEmployer(turn.answer);
    const title = correctedTitle(turn.answer);
    const dates = explicitDateRange(turn.answer);
    const dateAnswer = dates && (employer || title || /\b(?:what|which)\s+(?:years|dates)|\bwhen\b|\bstart(?:ed)?\b.*\b(?:end(?:ed)?|sold|left)|\bemployment dates\b/i.test(turn.question)) ? dates : null;
    if (!employer && !title && !dateAnswer) continue;
    candidates[candidates.length - 1] = {
      sourceQuote: turn.answer,
      sourceRevisionIds: [...new Set([...candidate.sourceRevisionIds, turn.revisionId])],
      employment: {
        ...candidate.employment,
        ...(employer ? { employer } : {}),
        ...(title ? { title } : {}),
        ...(dateAnswer ? dateAnswer : {}),
      },
    };
  }
  const byIdentity = new Map<string, GroundedEmploymentCandidate>();
  for (const candidate of candidates) {
    const key = `${normalizedGrounding(candidate.employment.title)}\u0000${normalizedGrounding(candidate.employment.employer)}`;
    const prior = byIdentity.get(key);
    byIdentity.set(key, prior ? {
      ...candidate,
      sourceRevisionIds: [...new Set([...prior.sourceRevisionIds, ...candidate.sourceRevisionIds])],
      employment: {
        ...candidate.employment,
        start_date: candidate.employment.start_date ?? prior.employment.start_date,
        end_date: candidate.employment.end_date ?? prior.employment.end_date,
      },
    } : candidate);
  }
  return [...byIdentity.values()];
}

export function employmentCandidateFromInterviewTurns(value: unknown): GroundedEmploymentCandidate | null {
  return employmentCandidatesFromInterviewTurns(value).at(-1) ?? null;
}

export function employmentIdentityKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = record(JSON.parse(value));
    if (parsed?.format !== "resume_job_v1" || typeof parsed.title !== "string" || typeof parsed.employer !== "string") return null;
    const title = normalizedGrounding(parsed.title);
    const employer = normalizedGrounding(parsed.employer);
    return title && employer ? `${title}\u0000${employer}` : null;
  } catch {
    return null;
  }
}

export function parseResumeDialogueCommitPayload(
  value: unknown,
  ownerMessage: string,
  confirmedEmploymentRevisionIds: ReadonlySet<string>,
  priorOwnerMessages: readonly GroundedOwnerMessage[] = [],
  precedingAssistantMessage = "",
): ResumeDialogueCommitPayload | null {
  const payload = record(value);
  if (!payload || !exactKeys(payload, ["messageId", "assistantMessage", "factOperations", "draftAction"])) return null;
  const messageId = boundedString(payload.messageId, 64);
  const assistantMessage = boundedString(payload.assistantMessage, 4_096);
  if (!messageId || !UUID.test(messageId) || !assistantMessage || !Array.isArray(payload.factOperations) || payload.factOperations.length > 8) return null;
  const pureQuestion = /^(?:do|does|did|should|would|could|can|what|which|who|why|how|when|where|is|are|am|was|were)\b/i.test(ownerMessage.trim()) && ownerMessage.trim().endsWith("?");
  if (pureQuestion && payload.factOperations.length > 0) return null;
  const draftAction = parseResumeDialogueDraftAction(payload.draftAction, ownerMessage, precedingAssistantMessage);
  if (payload.draftAction !== null && !draftAction) return null;
  if (pureQuestion && draftAction) return null;
  const factOperations: ResumeDialogueFactOperation[] = [];
  for (const candidate of payload.factOperations) {
    const operation = record(candidate);
    if (!operation || operation.operation !== "capture") return null;
    const factKind = boundedString(operation.fact_kind, 64);
    const sourceQuote = boundedString(operation.source_quote, 16_384);
    if (!factKind || !sourceQuote || !ownerMessage.normalize("NFKC").includes(sourceQuote.normalize("NFKC"))) return null;
    if (SIMPLE_FACT_KINDS.has(factKind)) {
      if (!exactKeys(operation, ["operation", "fact_kind", "value", "source_quote"])) return null;
      const factValue = boundedString(operation.value, 16_384);
      if (!factValue || isNonFactControlMarker(factValue)) return null;
      factOperations.push({ operation: "capture", fact_kind: factKind as Extract<ResumeDialogueFactOperation, { value: string }>["fact_kind"], value: factValue, source_quote: sourceQuote });
      continue;
    }
    if (factKind === "employment") {
      if (!exactKeys(operation, ["operation", "fact_kind", "source_quote", "employment"])) return null;
      const employment = record(operation.employment);
      if (!employment || !exactKeys(employment, ["title", "employer", "location", "start_date", "end_date", "responsibilities"])) return null;
      const title = boundedString(employment.title, 256);
      const employer = boundedString(employment.employer, 256);
      const location = boundedString(employment.location, 256, true);
      const startDate = boundedString(employment.start_date, 128, true);
      const endDate = boundedString(employment.end_date, 128, true);
      const responsibilities = boundedString(employment.responsibilities, 8_192, true);
      if (!title || !employer || location === undefined || startDate === undefined || endDate === undefined || responsibilities === undefined) return null;
      const fields = [title, employer, location, startDate, endDate, responsibilities].filter((item): item is string => typeof item === "string" && Boolean(item));
      const supportingSourceRevisionIds = new Set<string>();
      for (const field of fields) {
        if (containsGrounding(ownerMessage, field)) continue;
        const supporting = [...priorOwnerMessages].reverse().find((message) => UUID.test(message.sourceRevisionId) && containsGrounding(message.content, field));
        if (!supporting) return null;
        supportingSourceRevisionIds.add(supporting.sourceRevisionId);
      }
      const correction = correctedEmployer(ownerMessage);
      if (correction && normalizedGrounding(correction) !== normalizedGrounding(employer)) return null;
      const titleCorrection = correctedTitle(ownerMessage);
      if (titleCorrection && normalizedGrounding(titleCorrection) !== normalizedGrounding(title)) return null;
      const dates = explicitDateRange(ownerMessage);
      if (dates && (normalizedGrounding(dates.start_date) !== normalizedGrounding(startDate ?? "") || normalizedGrounding(dates.end_date) !== normalizedGrounding(endDate ?? ""))) return null;
      factOperations.push({ operation: "capture", fact_kind: "employment", source_quote: sourceQuote, supporting_source_revision_ids: [...supportingSourceRevisionIds], employment: { title, employer, location, start_date: startDate, end_date: endDate, responsibilities } });
      continue;
    }
    if (factKind === "accomplishment") {
      if (!exactKeys(operation, ["operation", "fact_kind", "source_quote", "text", "job_fact_revision_id"])) return null;
      const text = boundedString(operation.text, 8_192);
      const jobId = operation.job_fact_revision_id === null ? null : boundedString(operation.job_fact_revision_id, 64);
      if (!text || isNonFactControlMarker(text) || (jobId !== null && (!jobId || !UUID.test(jobId) || !confirmedEmploymentRevisionIds.has(jobId)))) return null;
      factOperations.push({ operation: "capture", fact_kind: "accomplishment", source_quote: sourceQuote, text, job_fact_revision_id: jobId });
      continue;
    }
    if (factKind === "job_evidence") {
      if (!exactKeys(operation, ["operation", "fact_kind", "source_quote", "text", "job_fact_revision_id", "dimension"])) return null;
      const text = boundedString(operation.text, 8_192);
      const jobId = boundedString(operation.job_fact_revision_id, 64);
      const dimension = boundedString(operation.dimension, 64);
      if (!text || isNonFactControlMarker(text) || !jobId || !UUID.test(jobId) || !confirmedEmploymentRevisionIds.has(jobId) || !dimension || !JOB_DIMENSIONS.has(dimension)) return null;
      factOperations.push({ operation: "capture", fact_kind: "job_evidence", source_quote: sourceQuote, text, job_fact_revision_id: jobId, dimension: dimension as Extract<ResumeDialogueFactOperation, { fact_kind: "job_evidence" }>["dimension"] });
      continue;
    }
    return null;
  }
  return { messageId, assistantMessage, factOperations, draftAction };
}

export function parseResumeDialogueDraftAction(
  value: unknown,
  ownerMessage: string,
  precedingAssistantMessage: string,
): ResumeDialogueDraftAction | null {
  if (value === null) return null;
  const action = record(value);
  if (!action || !exactKeys(action, ["action", "intent", "source_quote"])) return null;
  const sourceQuote = boundedString(action.source_quote, 16_384);
  if (action.action !== "create_general_draft" || !sourceQuote || !ownerMessage.normalize("NFKC").includes(sourceQuote.normalize("NFKC"))) return null;
  const explicitRequest = /\b(?:create|generate|write|start|make|show|build|recreate|regenerate|rewrite|rebuild|put together)\b[^.!?]{0,100}\b(?:draft|resume)\b|\b(?:draft|resume)\b[^.!?]{0,100}\b(?:create|generate|write|start|make|show|build|recreate|regenerate|rewrite|rebuild|put together)\b/i.test(ownerMessage);
  const acceptedOffer = /^(?:no[,\s]*(?:that(?:'s| is) (?:everything|all)|nothing else)|that(?:'s| is) (?:everything|all)|yes|go ahead|please do|sounds good|i(?:'m| am) ready)(?:\s+i think)?[.!]?$/i.test(ownerMessage.trim())
    && /\b(?:draft|resume|start|generate|put (?:it|one) together|anything else|anything more)\b/i.test(precedingAssistantMessage);
  if (action.intent !== "explicit_request" && action.intent !== "accepted_offer") return null;
  if (explicitRequest) return { action: "create_general_draft", intent: "explicit_request", source_quote: sourceQuote };
  if (acceptedOffer) return { action: "create_general_draft", intent: "accepted_offer", source_quote: sourceQuote };
  return null;
}

export function evaluateResumeDraftReadiness(
  confirmedEmploymentRevisionIds: ReadonlySet<string>,
  reviewFacts: readonly { kind: string }[],
): ResumeDraftReadiness {
  if (confirmedEmploymentRevisionIds.size === 0) {
    return { ready: false, reason: "missing_employment", message: "Before I create a useful draft, I need at least one role and employer from you." };
  }
  if (!reviewFacts.some((fact) => fact.kind !== "employment")) {
    return { ready: false, reason: "missing_supporting_evidence", message: "I have your role. Before I create a useful draft, tell me one accomplishment, responsibility, skill, or education detail to include." };
  }
  return { ready: true };
}

export function resumeDialogueFactValue(operation: ResumeDialogueFactOperation): string {
  if (operation.fact_kind === "employment") {
    return JSON.stringify({
      format: "resume_job_v1",
      title: operation.employment.title,
      employer: operation.employment.employer,
      location: operation.employment.location ?? "",
      start_date: operation.employment.start_date ?? "",
      end_date: operation.employment.end_date ?? "",
      responsibilities: operation.employment.responsibilities ?? "",
    });
  }
  if (operation.fact_kind === "accomplishment") {
    return operation.job_fact_revision_id
      ? JSON.stringify({ format: "resume_accomplishment_v1", job_fact_revision_id: operation.job_fact_revision_id, text: operation.text })
      : operation.text;
  }
  if (operation.fact_kind === "job_evidence") {
    return JSON.stringify({ value_version: 1, association: "job", job_fact_revision_id: operation.job_fact_revision_id, dimension: operation.dimension, outcome: "answered", owner_text: operation.text });
  }
  return operation.value;
}

export function resumeDialogueSensitivity(operation: ResumeDialogueFactOperation): "standard" | "sensitive" {
  return operation.fact_kind === "contact" || operation.fact_kind === "identity" ? "sensitive" : "standard";
}

export async function sha256Digest(value: string): Promise<`sha256:${string}`> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}
