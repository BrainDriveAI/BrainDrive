import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertContentFreeAudit } from "./audit.js";
import { canonicalInputDigest } from "./common.js";
import {
  assertExpectedRevision,
  assertFactStateTransition,
  assertOperationTransition,
  assertRecordLifecycleTransition,
  deriveSensitivity,
  MIGRATION_COMPATIBILITY_POLICY,
  MigrationCompatibilityPolicySchema,
  MigrationProvenanceSchema,
  nonEnumeratingOwnerError,
  OwnerSafeResumeDataStateSchema,
  RESUME_DATA_RETENTION_MATRIX,
  ResumeDataCapabilityPayloadSchema,
  ResumeDataCapabilityRequestSchema,
  ResumeDataCapabilityResultSchema,
  RetentionMatrixSchema,
} from "./data-conformance.js";
import { JSON_SCHEMA_AUTHORITIES } from "./generate-json-schemas.js";

const directory = dirname(fileURLToPath(import.meta.url));
const id = (suffix: string): string => `90000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const digest = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;
const timestamp = "2026-08-07T12:00:00.000Z";

function confirmationRequest() {
  const operationId = id("4");
  const factRevisionId = id("9");
  const request = {
    request_version: 1,
    request_id: id("1"),
    correlation_id: id("2"),
    operation_id: operationId,
    idempotency_key: "resume-operation-0001",
    canonical_input_digest: digest("a"),
    capability: "career.facts.confirm",
    context: {
      context_version: 1,
      owner_id: id("5"),
      actor_id: id("5"),
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      package_digest: digest("b"),
      installation_id: id("6"),
      grant_id: id("7"),
      audience: "resume_data",
      granted_capabilities: ["career.facts.confirm"],
      record_scope_ids: [id("8")],
      issued_at: timestamp,
      expires_at: "2026-08-07T12:05:00.000Z",
    },
    payload: {
      kind: "fact_confirmation",
      fact_record_id: id("8"),
      fact_revision_id: factRevisionId,
      expected_revision: 1,
      decision: "accept",
      edited_value: null,
      owner_confirmation: {
        confirmation_id: id("10"),
        owner_id: id("5"),
        actor_id: id("5"),
        host_mediated: true,
        decision: "accept",
        confirmed_at: timestamp,
        operation_id: operationId,
        input_revision_id: factRevisionId,
      },
    },
  } as const;
  return {
    ...request,
    canonical_input_digest: canonicalInputDigest({ capability: request.capability, payload: request.payload }),
  } as const;
}

describe("Spec 02 Milestone 1 data conformance", () => {
  it("accepts valid data fixtures and rejects invalid and adversarial authority fixtures", async () => {
    const load = async (path: string): Promise<unknown> => JSON.parse(await readFile(resolve(directory, "fixtures", path), "utf8"));
    expect(ResumeDataCapabilityPayloadSchema.safeParse(await load("valid/spec-02-fact-proposal.json")).success).toBe(true);
    expect(ResumeDataCapabilityPayloadSchema.safeParse(await load("invalid/spec-02-confirmed-proposal.json")).success).toBe(false);
    expect(ResumeDataCapabilityPayloadSchema.safeParse(await load("security/spec-02-untrusted-authority.json")).success).toBe(false);
  });

  it("accepts a bound host-confirmation request and rejects forged or mismatched authority", () => {
    const request = confirmationRequest();
    expect(ResumeDataCapabilityRequestSchema.safeParse(request).success).toBe(true);
    expect(ResumeDataCapabilityRequestSchema.safeParse({
      ...request,
      payload: { ...request.payload, confirmation_authority: true },
    }).success).toBe(false);
    expect(ResumeDataCapabilityRequestSchema.safeParse({
      ...request,
      capability: "resume.jobs.write",
    }).success).toBe(false);
    expect(ResumeDataCapabilityRequestSchema.safeParse({
      ...request,
      payload: {
        ...request.payload,
        owner_confirmation: { ...request.payload.owner_confirmation, actor_id: id("99") },
      },
    }).success).toBe(false);
  });

  it("freezes deterministic fact, record, operation, CAS, and sensitivity rules", () => {
    expect(() => assertFactStateTransition("suggested", "confirmed", { hostOwnerConfirmed: true, createsSuccessor: true })).not.toThrow();
    expect(() => assertFactStateTransition("suggested", "confirmed", { hostOwnerConfirmed: false, createsSuccessor: true })).toThrowError(/host-mediated/);
    expect(() => assertFactStateTransition("rejected", "confirmed", { hostOwnerConfirmed: true, createsSuccessor: true })).toThrowError(/not allowed/);
    expect(() => assertRecordLifecycleTransition("active", "superseded")).not.toThrow();
    expect(() => assertRecordLifecycleTransition("retired", "active")).toThrowError(/not allowed/);
    expect(() => assertOperationTransition("running", "committed")).not.toThrow();
    expect(() => assertOperationTransition("committed", "running")).toThrowError(/not allowed/);
    expect(() => assertExpectedRevision(2, 3)).toThrowError(/stale/);
    expect(deriveSensitivity(["standard", "highly_sensitive", "sensitive"])).toBe("highly_sensitive");
  });

  it("freezes canonical migration and retention decisions", () => {
    expect(MigrationCompatibilityPolicySchema.parse(MIGRATION_COMPATIBILITY_POLICY)).toEqual(MIGRATION_COMPATIBILITY_POLICY);
    expect(MigrationProvenanceSchema.safeParse({
      provenance_version: 1,
      migration_id: id("30"),
      transformer_id: "resume-data-v0-to-v1",
      transformer_version: "1",
      transformer_digest: digest("c"),
      from_schema_version: 0,
      to_schema_version: 1,
      source_catalog_digest: digest("d"),
      result_catalog_digest: digest("e"),
      recovery_snapshot_id: id("31"),
      method: "deterministic_no_ai",
      validated_at: timestamp,
    }).success).toBe(true);
    expect(RetentionMatrixSchema.parse(RESUME_DATA_RETENTION_MATRIX)).toEqual(RESUME_DATA_RETENTION_MATRIX);
    expect(MIGRATION_COMPATIBILITY_POLICY.migration_method).toBe("deterministic_transactional_no_ai");
    expect(RESUME_DATA_RETENTION_MATRIX.records.owner_export).toBe("external_owner_file");
    expect(RESUME_DATA_RETENTION_MATRIX.referenced_records_deletable).toBe(false);
  });

  it("returns indistinguishable owner-safe denial for absent and ungranted records", () => {
    const denied = nonEnumeratingOwnerError("denied", id("20"), timestamp);
    const absent = nonEnumeratingOwnerError("not_found_within_scope", id("20"), timestamp);
    expect(absent).toEqual(denied);
    expect(denied.details?.category).toBe("access_unavailable");
  });

  it("requires conflict proposal preservation and truthful cancellation results", () => {
    expect(OwnerSafeResumeDataStateSchema.safeParse({
      state_version: 1,
      state: "conflict",
      safe_message: "Refresh and review your change.",
      retryable: true,
      refresh_required: true,
      current_revision: 2,
      proposal_preserved: true,
    }).success).toBe(true);
    expect(OwnerSafeResumeDataStateSchema.safeParse({
      state_version: 1,
      state: "conflict",
      safe_message: "Conflict",
      retryable: true,
      refresh_required: true,
      current_revision: null,
      proposal_preserved: false,
    }).success).toBe(false);

    const result = {
      result_version: 1,
      request_id: id("21"),
      operation_id: id("22"),
      capability: "resume.export.request",
      status: "cancelled",
      commit_outcome: "not_committed",
      record_ids: [],
      revision_ids: [],
      owner_state: {
        state_version: 1,
        state: "cancelled",
        safe_message: "Export cancelled.",
        retryable: true,
        refresh_required: false,
        current_revision: null,
        proposal_preserved: false,
      },
      error: null,
      completed_at: timestamp,
    } as const;
    expect(ResumeDataCapabilityResultSchema.safeParse(result).success).toBe(true);
    expect(ResumeDataCapabilityResultSchema.safeParse({ ...result, commit_outcome: "committed" }).success).toBe(false);
  });

  it("rejects prohibited audit content and distinguishes canonical operation input", () => {
    expect(() => assertContentFreeAudit({ event_version: 1, resume_text: "synthetic private content" })).toThrowError(/prohibited/);
    expect(canonicalInputDigest({ alpha: 1, beta: [2, 3] })).toBe(canonicalInputDigest({ beta: [2, 3], alpha: 1 }));
    expect(canonicalInputDigest({ alpha: 1 })).not.toBe(canonicalInputDigest({ alpha: 2 }));
  });

  it("maps Spec 02 REQ-001 through REQ-040 to contracts, tests, and milestones", async () => {
    const manifest = JSON.parse(await readFile(resolve(directory, "fixtures", "spec-02-requirements.json"), "utf8")) as {
      manifest_version: number;
      authority: string;
      requirements: Array<{ id: string; contracts: string[]; tests: string[]; milestones: number[] }>;
    };
    expect(manifest.manifest_version).toBe(1);
    expect(manifest.authority).toBe("accepted-spec-02");
    expect(manifest.requirements.map((entry) => entry.id)).toEqual(
      Array.from({ length: 40 }, (_, index) => `REQ-${String(index + 1).padStart(3, "0")}`),
    );
    expect(new Set(manifest.requirements.map((entry) => entry.id)).size).toBe(40);
    const helperContracts = new Set([
      "all-v1-json-schemas",
      "canonical-input-digest",
      "existing-regression",
      "sensitivity-inheritance",
      "transition-validators",
    ]);
    for (const entry of manifest.requirements) {
      expect(entry.contracts.length, entry.id).toBeGreaterThan(0);
      expect(entry.tests.length, entry.id).toBeGreaterThan(0);
      expect(entry.milestones, entry.id).toContain(1);
      for (const contract of entry.contracts) {
        expect(contract in JSON_SCHEMA_AUTHORITIES || helperContracts.has(contract), `${entry.id}: ${contract}`).toBe(true);
      }
    }
  });
});
