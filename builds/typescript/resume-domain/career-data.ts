import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CareerFactRecordSchema,
  OwnerConfirmationProofSchema,
  SourceRecordSchema,
} from "../app-platform/contracts/data.js";
import { OpaqueIdSchema, TimestampSchema } from "../app-platform/contracts/common.js";
import { ResumeDomainError } from "./errors.js";
import { ResumeDataStore } from "./store.js";

export type CareerFactRecord = z.infer<typeof CareerFactRecordSchema>;
export type CareerSourceRecord = z.infer<typeof SourceRecordSchema>;
export type OwnerConfirmationProof = z.infer<typeof OwnerConfirmationProofSchema>;

export const FactDecisionInputSchema = z.object({
  fact_record_id: OpaqueIdSchema,
  fact_revision_id: OpaqueIdSchema,
  expected_revision: z.number().int().positive(),
  decision: z.enum(["accept", "edit_and_accept", "reject"]),
  edited_value: z.string().min(1).max(16_384).nullable(),
  review_note: z.string().max(512).nullable().default(null),
}).strict().superRefine((value, context) => {
  if ((value.decision === "edit_and_accept") !== (value.edited_value !== null)) {
    context.addIssue({ code: "custom", message: "edited value must match edit-and-accept decision" });
  }
});

export type FactDecisionInput = z.infer<typeof FactDecisionInputSchema>;

const HostOwnerDecisionIssueSchema = z.object({
  ownerId: OpaqueIdSchema,
  actorId: OpaqueIdSchema,
  operationId: OpaqueIdSchema,
  inputRevisionId: OpaqueIdSchema,
  decision: z.enum(["accept", "edit_and_accept", "reject"]),
  confirmedAt: TimestampSchema,
}).strict();

/**
 * A host-issued, non-serializable owner-decision witness. App/model payloads can
 * copy its fields, but cannot satisfy the runtime instance boundary.
 */
export class HostOwnerDecisionEvidence {
  readonly #proof: OwnerConfirmationProof;

  private constructor(input: z.infer<typeof HostOwnerDecisionIssueSchema>) {
    this.#proof = OwnerConfirmationProofSchema.parse({
      confirmation_id: randomUUID(),
      owner_id: input.ownerId,
      actor_id: input.actorId,
      host_mediated: true,
      decision: input.decision,
      confirmed_at: input.confirmedAt,
      operation_id: input.operationId,
      input_revision_id: input.inputRevisionId,
    });
  }

  static issue(raw: unknown): HostOwnerDecisionEvidence {
    return new HostOwnerDecisionEvidence(HostOwnerDecisionIssueSchema.parse(raw));
  }

  confirmationRecord(): OwnerConfirmationProof {
    return OwnerConfirmationProofSchema.parse(this.#proof);
  }
}

export function issueHostOwnerDecisionEvidence(raw: unknown): HostOwnerDecisionEvidence {
  return HostOwnerDecisionEvidence.issue(raw);
}

export function requireHostOwnerDecisionEvidence(
  evidence: unknown,
  expected: {
    ownerId: string;
    actorId: string;
    operationId: string;
    inputRevisionId: string;
    decision: FactDecisionInput["decision"];
  },
): OwnerConfirmationProof {
  if (!(evidence instanceof HostOwnerDecisionEvidence)) {
    throw new ResumeDomainError("denied", "Fact confirmation requires authenticated host-owner evidence", 403);
  }
  const proof = evidence.confirmationRecord();
  if (
    proof.owner_id !== expected.ownerId ||
    proof.actor_id !== expected.actorId ||
    proof.operation_id !== expected.operationId ||
    proof.input_revision_id !== expected.inputRevisionId ||
    proof.decision !== expected.decision
  ) {
    throw new ResumeDomainError("denied", "Host-owner evidence does not match the fact decision", 403);
  }
  return proof;
}

export type ProposalClassification = {
  kind: "new" | "duplicate" | "conflict";
  related_fact_revision_ids: string[];
};

export type RememberedEmploymentMatch = {
  match_version: 1;
  method: "explicit_revision" | "exact_label" | "none";
  result_class: "matched" | "ambiguous" | "none";
  matches: Array<{ fact_revision_id: string; safe_label: string }>;
};

export class CareerSourceRepository {
  constructor(private readonly store: ResumeDataStore) {}

  async requireRevision(revisionId: string, scopes: readonly string[] = []): Promise<CareerSourceRecord> {
    const record = await this.store.readRevision(revisionId, scopes);
    if (record.record_type !== "source") {
      throw new ResumeDomainError("validation_failed", "Career fact provenance must resolve to source revisions", 409);
    }
    return record;
  }

  async requireMany(revisionIds: readonly string[], scopes: readonly string[] = []): Promise<CareerSourceRecord[]> {
    if (revisionIds.length === 0 || new Set(revisionIds).size !== revisionIds.length) {
      throw new ResumeDomainError("invalid_input", "Career fact provenance requires unique source revisions", 400);
    }
    return Promise.all(revisionIds.map((revisionId) => this.requireRevision(revisionId, scopes)));
  }
}

export class CareerFactRepository {
  constructor(private readonly store: ResumeDataStore) {}

  async requireHead(recordId: string, scopes: readonly string[] = []): Promise<CareerFactRecord> {
    const record = await this.store.readHead(recordId, scopes);
    if (record.record_type !== "career_fact") {
      throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    }
    return record;
  }

  async requireRevision(revisionId: string, scopes: readonly string[] = []): Promise<CareerFactRecord> {
    const record = await this.store.readRevision(revisionId, scopes);
    if (record.record_type !== "career_fact") {
      throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
    }
    return record;
  }

  async history(recordId: string, scopes: readonly string[] = []): Promise<CareerFactRecord[]> {
    await this.requireHead(recordId, scopes);
    const catalog = await this.store.catalog();
    const revisions = Object.values(catalog.revisions)
      .filter((locator) => locator.record_type === "career_fact" && locator.record_id === recordId)
      .sort((left, right) => left.revision - right.revision);
    return Promise.all(revisions.map((locator) => this.requireRevision(locator.revision_id, scopes)));
  }

  async classify(factKind: CareerFactRecord["fact_kind"], value: string, scopes: readonly string[] = []): Promise<ProposalClassification> {
    const candidates = (await this.store.list("career_fact", scopes))
      .map((fact) => CareerFactRecordSchema.parse(fact))
      .filter((fact) => fact.fact_kind === factKind);
    const normalized = normalizeComparisonValue(value);
    const duplicates = candidates.filter((fact) => normalizeComparisonValue(fact.value) === normalized);
    if (duplicates.length > 0) {
      return { kind: "duplicate", related_fact_revision_ids: duplicates.map((fact) => fact.metadata.revision_id) };
    }
    if (factKind === "employment") {
      const identity = employmentIdentity(value);
      if (identity) {
        const conflicts = candidates.filter((fact) => {
          const candidate = employmentIdentity(fact.value);
          return candidate !== null && candidate.employer === identity.employer && (
            candidate.title !== identity.title ||
            candidate.startDate !== identity.startDate ||
            candidate.endDate !== identity.endDate
          );
        });
        if (conflicts.length > 0) {
          return { kind: "conflict", related_fact_revision_ids: conflicts.map((fact) => fact.metadata.revision_id) };
        }
      }
    }
    return { kind: "new", related_fact_revision_ids: [] };
  }

  async matchRememberedEmployment(
    input: { explicit_job_fact_revision_id: string | null; description: string },
    scopes: readonly string[] = [],
  ): Promise<RememberedEmploymentMatch> {
    const jobs = (await this.store.list("career_fact", scopes))
      .map((fact) => CareerFactRecordSchema.parse(fact))
      .filter((fact) => fact.state === "confirmed" && fact.fact_kind === "employment")
      .map((fact) => ({ fact_revision_id: fact.metadata.revision_id, safe_label: employmentSafeLabel(fact.value) }));
    if (input.explicit_job_fact_revision_id) {
      const selected = jobs.find((job) => job.fact_revision_id === input.explicit_job_fact_revision_id);
      return selected
        ? { match_version: 1, method: "explicit_revision", result_class: "matched", matches: [selected] }
        : { match_version: 1, method: "none", result_class: "none", matches: [] };
    }
    const description = normalizeComparisonValue(input.description);
    if (!description) return { match_version: 1, method: "none", result_class: "none", matches: [] };
    const matches = jobs.filter((job) => normalizeComparisonValue(job.safe_label) === description);
    return {
      match_version: 1,
      method: matches.length > 0 ? "exact_label" : "none",
      result_class: matches.length === 1 ? "matched" : matches.length > 1 ? "ambiguous" : "none",
      matches,
    };
  }
}

export function proposalClassificationFromFact(fact: CareerFactRecord): ProposalClassification {
  const parsed = z.object({
    kind: z.enum(["new", "duplicate", "conflict"]),
    related_fact_revision_ids: z.array(OpaqueIdSchema),
  }).strict().safeParse(fact.extensions.proposal_classification);
  return parsed.success ? parsed.data : { kind: "new", related_fact_revision_ids: [] };
}

function normalizeComparisonValue(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function employmentIdentity(value: string): { employer: string; title: string; startDate: string; endDate: string } | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null;
    const field = (...names: string[]) => {
      const found = names.map((name) => parsed[name]).find((candidate) => typeof candidate === "string");
      return typeof found === "string" ? normalizeComparisonValue(found) : "";
    };
    const employer = field("employer", "company", "organization");
    if (!employer) return null;
    return {
      employer,
      title: field("title", "role"),
      startDate: field("start_date", "startDate"),
      endDate: field("end_date", "endDate"),
    };
  } catch {
    return null;
  }
}

function employmentSafeLabel(value: string): string {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
      const title = typeof parsed.title === "string" ? parsed.title.trim() : typeof parsed.role === "string" ? parsed.role.trim() : "";
      const employer = typeof parsed.employer === "string" ? parsed.employer.trim() : typeof parsed.company === "string" ? parsed.company.trim() : "";
      if (title && employer) return `${title} at ${employer}`;
      if (title || employer) return title || employer;
    }
  } catch {
    // Fall through to a bounded owner-visible label from the saved value.
  }
  return value.trim().split(/[.;\n]/, 1)[0]!.slice(0, 256) || "Saved job";
}
