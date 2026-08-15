export type ResumeDialogueFactOperation =
  | { operation: "capture"; fact_kind: "identity" | "contact" | "education" | "skill" | "credential" | "project" | "preference"; value: string; source_quote: string }
  | { operation: "capture"; fact_kind: "employment"; source_quote: string; employment: { title: string; employer: string; location: string | null; start_date: string | null; end_date: string | null; responsibilities: string | null } }
  | { operation: "capture"; fact_kind: "accomplishment"; source_quote: string; text: string; job_fact_revision_id: string | null }
  | { operation: "capture"; fact_kind: "job_evidence"; source_quote: string; text: string; job_fact_revision_id: string; dimension: "responsibilities" | "accomplishments" | "outcomes" | "tools" | "scope" | "progression" };

export type ResumeDialogueCommitPayload = {
  messageId: string;
  assistantMessage: string;
  factOperations: ResumeDialogueFactOperation[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIMPLE_FACT_KINDS = new Set(["identity", "contact", "education", "skill", "credential", "project", "preference"]);
const JOB_DIMENSIONS = new Set(["responsibilities", "accomplishments", "outcomes", "tools", "scope", "progression"]);

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

export function parseResumeDialogueCommitPayload(
  value: unknown,
  ownerMessage: string,
  confirmedEmploymentRevisionIds: ReadonlySet<string>,
): ResumeDialogueCommitPayload | null {
  const payload = record(value);
  if (!payload || !exactKeys(payload, ["messageId", "assistantMessage", "factOperations"])) return null;
  const messageId = boundedString(payload.messageId, 64);
  const assistantMessage = boundedString(payload.assistantMessage, 4_096);
  if (!messageId || !UUID.test(messageId) || !assistantMessage || !Array.isArray(payload.factOperations) || payload.factOperations.length > 8) return null;
  const pureQuestion = /^(?:do|does|did|should|would|could|can|what|which|who|why|how|when|where|is|are|am|was|were)\b/i.test(ownerMessage.trim()) && ownerMessage.trim().endsWith("?");
  if (pureQuestion && payload.factOperations.length > 0) return null;
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
      if (!factValue) return null;
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
      factOperations.push({ operation: "capture", fact_kind: "employment", source_quote: sourceQuote, employment: { title, employer, location, start_date: startDate, end_date: endDate, responsibilities } });
      continue;
    }
    if (factKind === "accomplishment") {
      if (!exactKeys(operation, ["operation", "fact_kind", "source_quote", "text", "job_fact_revision_id"])) return null;
      const text = boundedString(operation.text, 8_192);
      const jobId = operation.job_fact_revision_id === null ? null : boundedString(operation.job_fact_revision_id, 64);
      if (!text || (jobId !== null && (!jobId || !UUID.test(jobId) || !confirmedEmploymentRevisionIds.has(jobId)))) return null;
      factOperations.push({ operation: "capture", fact_kind: "accomplishment", source_quote: sourceQuote, text, job_fact_revision_id: jobId });
      continue;
    }
    if (factKind === "job_evidence") {
      if (!exactKeys(operation, ["operation", "fact_kind", "source_quote", "text", "job_fact_revision_id", "dimension"])) return null;
      const text = boundedString(operation.text, 8_192);
      const jobId = boundedString(operation.job_fact_revision_id, 64);
      const dimension = boundedString(operation.dimension, 64);
      if (!text || !jobId || !UUID.test(jobId) || !confirmedEmploymentRevisionIds.has(jobId) || !dimension || !JOB_DIMENSIONS.has(dimension)) return null;
      factOperations.push({ operation: "capture", fact_kind: "job_evidence", source_quote: sourceQuote, text, job_fact_revision_id: jobId, dimension: dimension as Extract<ResumeDialogueFactOperation, { fact_kind: "job_evidence" }>["dimension"] });
      continue;
    }
    return null;
  }
  return { messageId, assistantMessage, factOperations };
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
