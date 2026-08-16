import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertContentFreeAudit,
  assertContentFreeInferenceAttemptAudit,
  assertContentFreeInferenceTerminalAudit,
} from "./audit.js";
import { CONTRACT_SIZE_LIMITS } from "./constants.js";
import { BRIDGE_POLICY, parseBridgeMessage, assertUniqueIdentities } from "./mcp-app.js";
import { assertGrantSubset, CapabilityDiffSchema, CapabilityTokenSchema, PackageTrustSchema, SUPERVISOR_POLICY } from "./package.js";

const directory = dirname(fileURLToPath(import.meta.url));

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(directory, "fixtures", path), "utf8"));
}

describe("grant, token, and trust security", () => {
  it("deterministically rejects widened grants and duplicate identities", async () => {
    const value = await fixture("security/widened-grant.json") as { installed: string[]; requested: string[] };
    expect(() => assertGrantSubset(value.installed as never[], value.requested as never[])).toThrowError(/exceed/);
    expect(() => assertUniqueIdentities(["same", "same"])).toThrowError(/duplicate/);
    expect(CapabilityDiffSchema.safeParse({
      diff_version: 1,
      prior_capabilities: ["career.facts.read"],
      requested_capabilities: ["career.facts.read", "career.facts.propose"],
      added: ["career.facts.propose"],
      removed: [],
      unchanged: ["career.facts.read"],
      decision: "owner_approval_required",
    }).success).toBe(true);
    expect(CapabilityDiffSchema.safeParse({
      diff_version: 1,
      prior_capabilities: ["career.facts.read"],
      requested_capabilities: ["career.facts.read", "career.facts.propose"],
      added: [],
      removed: [],
      unchanged: ["career.facts.read"],
      decision: "no_change",
    }).success).toBe(false);
  });

  it("requires executable permission to derive from every trust check", () => {
    const trust = {
      trust_policy_version: 1,
      descriptor_digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      package_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      manifest_digest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      publisher_id: "ai.braindrive",
      signing_key_id: "braindrive-app-release-2026-01",
      trust_root_version: 1,
      source_index_sequence: 1,
      source_index_signature_valid: true,
      package_signature_valid: false,
      archive_digest_valid: true,
      file_inventory_valid: true,
      source_trusted: true,
      compatibility_valid: true,
      revocation_list_sequence: 1,
      revocation_status: "not_revoked_fresh",
      revocation_age_seconds: 0,
      verification_context: "candidate_install_or_update",
      checked_at: "2026-08-07T12:00:00.000Z",
      executable_allowed: true,
    };
    expect(PackageTrustSchema.safeParse(trust).success).toBe(false);
    expect(PackageTrustSchema.safeParse({ ...trust, package_signature_valid: true, revocation_status: "not_revoked_stale", verification_context: "verified_local_recheck" }).success).toBe(true);
    expect(PackageTrustSchema.safeParse({ ...trust, package_signature_valid: true, revocation_status: "not_revoked_stale" }).success).toBe(false);
    expect(PackageTrustSchema.safeParse({ ...trust, package_signature_valid: true, revocation_status: "revoked" }).success).toBe(false);
  });

  it("rejects ambient or unknown authority on scoped tokens", () => {
    const token = {
      token_version: 1,
      token_generation: 1,
      grant_revision: 1,
      revocation_generation: 0,
      token_id: "a0000000-0000-4000-8000-000000000001",
      audience: "app_data",
      grant_id: "a0000000-0000-4000-8000-000000000002",
      owner_id: "a0000000-0000-4000-8000-000000000003",
      actor_id: "a0000000-0000-4000-8000-000000000003",
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      package_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      installation_id: "a0000000-0000-4000-8000-000000000004",
      connection_id: "a0000000-0000-4000-8000-000000000006",
      view_id: null,
      operation_id: "a0000000-0000-4000-8000-000000000005",
      idempotency_key: "security-token-operation-0001",
      capabilities: ["career.facts.read"],
      record_scopes: [],
      issued_at: "2026-08-07T12:00:00.000Z",
      expires_at: "2026-08-07T12:05:00.000Z",
      nonce: "unique-one-use-nonce",
    };
    expect(CapabilityTokenSchema.safeParse(token).success).toBe(true);
    expect(CapabilityTokenSchema.safeParse({ ...token, broad_permissions: { administration: true } }).success).toBe(false);
    expect(CapabilityTokenSchema.safeParse({ ...token, expires_at: "2026-08-07T13:00:00.000Z" }).success).toBe(false);
    expect(CapabilityTokenSchema.safeParse({ ...token, audience: "app_inference" }).success).toBe(false);
  });

  it("freezes sandbox, rate, resource, and restart ceilings", () => {
    expect(BRIDGE_POLICY.sandbox_same_origin).toBe(false);
    expect(BRIDGE_POLICY.max_messages_per_10_seconds).toBe(100);
    expect(SUPERVISOR_POLICY.max_memory_bytes).toBe(536_870_912);
    expect(SUPERVISOR_POLICY.restart_backoff_ms).toEqual([1_000, 2_000, 4_000]);
    expect(SUPERVISOR_POLICY.public_bind_allowed).toBe(false);
  });
});

describe("bridge and audit security", () => {
  it("accepts a versioned view-bound bridge handshake", () => {
    const message = {
      bridge_version: 1,
      message_id: "b0000000-0000-4000-8000-000000000001",
      app_id: "ai.braindrive.resume-builder",
      installation_id: "b0000000-0000-4000-8000-000000000002",
      view_id: "b0000000-0000-4000-8000-000000000003",
      operation_id: null,
      sent_at: "2026-08-07T12:00:00.000Z",
      type: "bridge.ready",
      payload: { supported_capabilities: ["resume.definitions.read"] },
    };
    expect(parseBridgeMessage(message)).toEqual(message);
  });

  it("rejects malformed and oversized bridge envelopes deterministically", () => {
    expect(() => parseBridgeMessage({ type: "tool.call", forged: true })).toThrowError(/schema validation/);
    expect(() => parseBridgeMessage({ payload: "x".repeat(CONTRACT_SIZE_LIMITS.bridgeMessageBytes + 1) })).toThrowError(/byte limit/);
  });

  it("rejects forbidden audit keys, paths, and credentials", async () => {
    const forbiddenAudit = await fixture("security/forbidden-audit.json");
    expect(() => assertContentFreeAudit(forbiddenAudit)).toThrowError(/prohibited/);
    expect(() => assertContentFreeAudit({ safe_message: "read /home/owner/private.txt" })).toThrowError(/path or credential/);
    expect(() => assertContentFreeAudit({ safe_message: "Bearer abcdefghijklmnopqrstuvwxyz" })).toThrowError(/path or credential/);
  });

  it("accepts only content-minimized terminal inference diagnostics", () => {
    const diagnostic = {
      diagnostic_version: 1,
      app_id: "ai.braindrive.resume-builder",
      operation_id: "b0000000-0000-4000-8000-000000000001",
      request_id: "b0000000-0000-4000-8000-000000000002",
      purpose: "general_resume_draft",
      prompt_policy_id: "braindrive.resume-builder.fixed",
      prompt_policy_version: "8",
      output_schema_id: "resume.general-draft.v1",
      output_schema_version: 1,
      model_class: "owner_active_compatible",
      attempt_count: 2,
      stage: "completed",
      finish_category: "stop",
      error_code: null,
      retryable: false,
      recovery_class: "deterministic_fallback",
      completion_mode: "deterministic_fallback",
      final_disposition: "completed",
      usage_available: true,
      duration_class: "under_5s",
      validator_codes: ["unsupported_claim"],
      provider_validator_codes: ["missing_provenance", "unsupported_claim"],
      provider_validator_rule_ids: ["statement_support_unresolved", "statement_factual_wording_unsupported"],
      local_candidate_classes: ["targeted_fact_repair", "full_general_constructor"],
      targeted_fact_repair_validator_codes: ["missing_provenance"],
      targeted_fact_repair_validator_rule_ids: ["statement_support_unresolved"],
      targeted_fact_repair_disposition: "rejected",
      full_general_constructor_validator_codes: [],
      full_general_constructor_validator_rule_ids: [],
      full_general_constructor_disposition: "accepted",
      original_failure_code: "evidence_validation_failed",
      recovery_disposition: "full_constructor_accepted",
    };
    expect(() => assertContentFreeInferenceTerminalAudit(diagnostic)).not.toThrow();
    const recoveryKeys = [
      "provider_validator_codes",
      "provider_validator_rule_ids",
      "local_candidate_classes",
      "targeted_fact_repair_validator_codes",
      "targeted_fact_repair_validator_rule_ids",
      "targeted_fact_repair_disposition",
      "full_general_constructor_validator_codes",
      "full_general_constructor_validator_rule_ids",
      "full_general_constructor_disposition",
      "original_failure_code",
      "recovery_disposition",
    ];
    const legacy = { ...diagnostic } as Record<string, unknown>;
    for (const key of recoveryKeys) delete legacy[key];
    Object.assign(legacy, {
      attempt_count: 1,
      stage: "completed",
      error_code: null,
      recovery_class: "none",
      completion_mode: "primary",
      final_disposition: "completed",
      validator_codes: [],
    });
    expect(() => assertContentFreeInferenceTerminalAudit(legacy)).not.toThrow();
    const contradictions = [
      { ...diagnostic, provider_validator_codes: undefined },
      { ...diagnostic, local_candidate_classes: ["full_general_constructor", "targeted_fact_repair"] },
      { ...diagnostic, full_general_constructor_disposition: undefined },
      { ...diagnostic, recovery_disposition: "targeted_accepted" },
      { ...diagnostic, targeted_fact_repair_disposition: "accepted" },
      { ...diagnostic, recovery_disposition: "recovery_rejected" },
      { ...diagnostic, original_failure_code: "internal_failure" },
      { ...diagnostic, error_code: "evidence_validation_failed" },
      { ...diagnostic, purpose: "resume_strategy" },
      { ...diagnostic, attempt_count: 1 },
      { ...diagnostic, retryable: true },
    ];
    for (const contradiction of contradictions) {
      expect(() => assertContentFreeInferenceTerminalAudit(contradiction)).toThrowError(/content-free schema/);
    }
    for (const poisoned of [
      { prompt_body: "private resume text" },
      { resume_text: "private resume text" },
      { job_description: "private job text" },
      { authorization: "Bearer synthetic-secret-value" },
      { endpoint: "https://private.example.test/v1" },
      { raw_path: "/home/owner/private.txt" },
    ]) expect(() => assertContentFreeInferenceTerminalAudit({ ...diagnostic, ...poisoned })).toThrow();
  });

  it("accepts only content-minimized inference attempt diagnostics", () => {
    const diagnostic = {
      diagnostic_version: 1,
      app_id: "ai.braindrive.resume-builder",
      operation_id: "b0000000-0000-4000-8000-000000000001",
      request_id: "b0000000-0000-4000-8000-000000000002",
      purpose: "general_resume_draft",
      attempt: 1,
      stage: "structured_parse",
      finish_category: "stop",
      attempt_outcome: "retry",
      duration_class: "under_1s",
      structural_failure_class: "empty_output",
    };
    expect(() => assertContentFreeInferenceAttemptAudit(diagnostic)).not.toThrow();
    const { structural_failure_class: _structuralFailureClass, ...nonStructuralDiagnostic } = diagnostic;
    expect(() => assertContentFreeInferenceAttemptAudit({
      ...nonStructuralDiagnostic,
      stage: "deterministic_validation",
      validator_rule_ids: ["statement_support_unresolved"],
    })).not.toThrow();
    expect(() => assertContentFreeInferenceAttemptAudit({
      ...diagnostic,
      validator_rule_ids: ["statement_support_unresolved"],
    })).toThrowError(/content-free schema/);
    expect(() => assertContentFreeInferenceAttemptAudit({
      ...diagnostic,
      stage: "deterministic_validation",
      structural_failure_class: "purpose_schema_mismatch",
    })).toThrowError(/content-free schema/);
    expect(() => assertContentFreeInferenceAttemptAudit({
      ...diagnostic,
      stage: "output_schema_validation",
      structural_failure_class: "purpose_schema_mismatch",
      schema_issue_ids: ["title_invalid", "experience_role_bullet_limit_exceeded"],
    })).not.toThrow();
    expect(() => assertContentFreeInferenceAttemptAudit({
      ...diagnostic,
      schema_issue_ids: ["title_invalid"],
    })).toThrowError(/content-free schema/);
    for (const poisoned of [
      { prompt_body: "private resume text" },
      { raw_response: "private provider response" },
      { authorization: "Bearer synthetic-secret-value" },
      { endpoint: "https://private.example.test/v1" },
      { raw_path: "/home/owner/private.txt" },
    ]) expect(() => assertContentFreeInferenceAttemptAudit({ ...diagnostic, ...poisoned })).toThrow();
  });
});
