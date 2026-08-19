import { canonicalInputDigest } from "../app-platform/contracts/common.js";

export const RESUME_QUALITY_VALIDATOR_ID = "resume-quality-gate" as const;
export const RESUME_QUALITY_VALIDATOR_VERSION = "3" as const;

export type QualityDefinition = {
  title: string;
  statements: Array<{
    statement_id: string;
    section_id: string;
    kind: "factual" | "presentation";
    display_role?: "heading" | "bullet" | "line";
    text: string;
    supporting_confirmed_fact_revision_ids: string[];
  }>;
  section_order: string[];
  selected_fact_revision_ids: string[];
  locale: string;
  page_intent: string;
  template_id: string;
  template_version: string;
};

export type ResumeQualityFinding = {
  code:
    | "nonstandard_section"
    | "invalid_contact"
    | "sensitive_contact"
    | "summary_too_long"
    | "role_density"
    | "chronology_order"
    | "duplicate_statement"
    | "repeated_opening"
    | "generic_language"
    | "invalid_url";
  severity: "error";
  statement_id: string | null;
  safe_message: string;
  correction: string;
};

export type RuntimeResumeQualityReport = {
  report_schema_version: 1;
  standard_revision: 3;
  validator_id: typeof RESUME_QUALITY_VALIDATOR_ID;
  validator_version: typeof RESUME_QUALITY_VALIDATOR_VERSION;
  input_digest: `sha256:${string}`;
  findings: ResumeQualityFinding[];
  accepted: boolean;
  report_digest: `sha256:${string}`;
};

const STANDARD_SECTIONS = new Set([
  "contact", "summary", "experience", "work_experience", "education", "certifications",
  "skills", "projects", "leadership", "volunteer", "volunteer_experience", "awards",
  "publications", "links",
]);
const GENERIC_LANGUAGE = /\b(?:results-driven|detail-oriented|go-getter|rockstar|best-in-class|world-class|guru|ninja)\b/i;
const SENSITIVE_CONTACT = /\b(?:ssn|social security|date of birth|dob|marital status|street address)\b/i;
const URL_TOKEN = /\b(?:https?:\/\/|www\.)\S+/gi;

export function qualityDefinitionInput(definition: QualityDefinition): Record<string, unknown> {
  return {
    title: definition.title,
    statements: definition.statements,
    section_order: definition.section_order,
    selected_fact_revision_ids: definition.selected_fact_revision_ids,
    locale: definition.locale,
    page_intent: definition.page_intent,
    template_id: definition.template_id,
    template_version: definition.template_version,
  };
}

export function evaluateResumeQuality(definition: QualityDefinition): RuntimeResumeQualityReport {
  const findings: ResumeQualityFinding[] = [];
  const add = (finding: ResumeQualityFinding) => findings.push(finding);
  for (const section of definition.section_order) {
    if (!STANDARD_SECTIONS.has(normalizeSection(section))) add({
      code: "nonstandard_section", severity: "error", statement_id: null,
      safe_message: `The ${section} section does not use a standard recoverable heading.`,
      correction: "Use a standard resume section heading.",
    });
  }
  const normalizedStatements = new Map<string, string>();
  const experienceOpenings: string[] = [];
  let experienceBullets = 0;
  const chronology: Array<{ year: number; statement_id: string }> = [];
  for (const statement of definition.statements) {
    const text = normalizeText(statement.text);
    const normalized = text.toLocaleLowerCase("en-US");
    const duplicate = normalizedStatements.get(normalized);
    if (duplicate) add({
      code: "duplicate_statement", severity: "error", statement_id: statement.statement_id,
      safe_message: "The resume repeats the same statement.", correction: "Keep one supported version of the repeated statement.",
    });
    else normalizedStatements.set(normalized, statement.statement_id);
    if (GENERIC_LANGUAGE.test(text)) add({
      code: "generic_language", severity: "error", statement_id: statement.statement_id,
      safe_message: "The wording uses generic self-praise.", correction: "Replace self-praise with a concrete supported action or result.",
    });
    if (statement.section_id === "contact") {
      if (SENSITIVE_CONTACT.test(text)) add({
        code: "sensitive_contact", severity: "error", statement_id: statement.statement_id,
        safe_message: "The contact section contains sensitive information that is excluded from the current resume format.",
        correction: "Remove sensitive personal data; use city and state when location is useful.",
      });
      if (text.includes("@") && !/\b[^\s@|]+@[^\s@|]+\.[^\s@|]+\b/.test(text)) add({
        code: "invalid_contact", severity: "error", statement_id: statement.statement_id,
        safe_message: "An included email address is not recoverable.", correction: "Correct the email address or omit it.",
      });
    }
    for (const url of text.match(URL_TOKEN) ?? []) {
      try { new URL(url.startsWith("www.") ? `https://${url}` : url); }
      catch { add({ code: "invalid_url", severity: "error", statement_id: statement.statement_id, safe_message: "An included link is invalid.", correction: "Correct the link or omit it." }); }
    }
    if (statement.section_id === "experience" && (statement.display_role ?? "bullet") === "bullet") {
      experienceBullets += 1;
      const opening = normalized.match(/^[\p{L}\p{N}]+/u)?.[0];
      if (opening) experienceOpenings.push(opening);
    }
    if (statement.section_id === "experience" && statement.display_role === "heading") {
      const years = [...text.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
      chronology.push({ year: /\bPresent\b/i.test(text) ? 9_999 : Math.max(0, ...years), statement_id: statement.statement_id });
    }
  }
  const summaries = definition.statements.filter((statement) => statement.section_id === "summary");
  if (summaries.length > 4) add({
    code: "summary_too_long", severity: "error", statement_id: summaries[4]?.statement_id ?? null,
    safe_message: "The summary is longer than four readable lines.", correction: "Shorten the summary to two to four supported lines, or omit it.",
  });
  if (experienceBullets > 36) add({
    code: "role_density", severity: "error", statement_id: null,
    safe_message: "The experience section is too dense for the accepted two-page resume.", correction: "Prioritize recent, relevant supported evidence and compress older roles.",
  });
  if (chronology.some((entry, index) => index > 0 && entry.year > chronology[index - 1]!.year)) add({
    code: "chronology_order", severity: "error", statement_id: chronology.find((entry, index) => index > 0 && entry.year > chronology[index - 1]!.year)?.statement_id ?? null,
    safe_message: "Experience roles are not in reverse chronological order.", correction: "Order roles newest first while preserving legitimate overlap and promotion dates.",
  });
  for (let index = 2; index < experienceOpenings.length; index += 1) {
    if (experienceOpenings[index] === experienceOpenings[index - 1] && experienceOpenings[index] === experienceOpenings[index - 2]) {
      add({ code: "repeated_opening", severity: "error", statement_id: null, safe_message: "Three consecutive experience bullets use the same opening.", correction: "Vary supported action wording without changing factual meaning." });
      break;
    }
  }
  const inputDigest = canonicalInputDigest(qualityDefinitionInput(definition));
  const body = {
    report_schema_version: 1 as const,
    standard_revision: 3 as const,
    validator_id: RESUME_QUALITY_VALIDATOR_ID,
    validator_version: RESUME_QUALITY_VALIDATOR_VERSION,
    input_digest: inputDigest,
    findings,
    accepted: findings.length === 0,
  };
  return { ...body, report_digest: canonicalInputDigest(body) };
}

export function assertBoundQualityReport(definition: QualityDefinition & {
  approval_evidence?: null | {
    quality_report_digest?: string;
    quality_input_digest?: string;
    quality_validator_id?: string;
    quality_validator_version?: string;
  };
}): RuntimeResumeQualityReport {
  const report = evaluateResumeQuality(definition);
  const evidence = definition.approval_evidence;
  if (!report.accepted || !evidence || evidence.quality_report_digest !== report.report_digest || evidence.quality_input_digest !== report.input_digest || evidence.quality_validator_id !== report.validator_id || evidence.quality_validator_version !== report.validator_version) {
    throw new Error("Resume quality report is missing, stale, or failing");
  }
  return report;
}

function normalizeSection(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[ -]+/g, "_");
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}
