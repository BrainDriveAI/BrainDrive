import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import type { DataAuthority } from "./service.js";
import { issueHostOwnerDecisionEvidence } from "./career-data.js";

export const TEST_DIGEST = `sha256:${"a".repeat(64)}` as const;

export function testGrant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  const now = "2026-08-07T12:00:00.000Z";
  const actorId = "40000000-0000-4000-8000-000000000002";
  return {
    grant_version: 1, grant_revision: 1, revocation_generation: 0,
    grant_id: "40000000-0000-4000-8000-000000000003",
    owner_id: "40000000-0000-4000-8000-000000000001", actor_id: actorId,
    app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive",
    package_digest: TEST_DIGEST,
    installation_id: "40000000-0000-4000-8000-000000000004",
    capabilities: ["career.context.read", "career.facts.read", "career.facts.propose", "career.facts.confirm", "resume.definitions.read", "resume.definitions.write", "resume.jobs.read", "resume.jobs.write", "resume.artifacts.register", "resume.export.request", "resume.operations.read"],
    record_scopes: [], decision: { decision_id: "40000000-0000-4000-8000-000000000005", decided_by_actor_id: actorId, decided_at: now, outcome: "approved" },
    issued_at: now, expires_at: "2036-01-01T00:00:00.000Z", revoked_at: null,
    ...overrides,
  };
}

export function authority(capability: DataAuthority["capability"], operationId = crypto.randomUUID(), overrides: Partial<DataAuthority> = {}): DataAuthority {
  return { grant: testGrant(), capability, operationId, idempotencyKey: `m4-${operationId}`, ...overrides };
}

export function proposalInput(value = "Synthetic supported statement") {
  return {
    source: { source_kind: "owner_interview", safe_label: "Owner interview", content_digest: TEST_DIGEST, captured_at: "2026-08-07T12:00:00.000Z" },
    fact: { fact_kind: "accomplishment", state: "suggested", value, sensitivity: "standard" },
  } as const;
}

export function ownerDecision(
  authorityInput: DataAuthority,
  inputRevisionId: string,
  decision: "accept" | "edit_and_accept" | "reject" = "accept",
) {
  return issueHostOwnerDecisionEvidence({
    ownerId: authorityInput.grant.owner_id,
    actorId: authorityInput.grant.actor_id,
    operationId: authorityInput.operationId,
    inputRevisionId,
    decision,
    confirmedAt: "2026-08-07T12:00:00.000Z",
  });
}

export function definitionInput(factRevisionId: string, overrides: Record<string, unknown> = {}) {
  return {
    definition_kind: "general", status: "approved", title: "General Resume",
    statements: [{ statement_id: crypto.randomUUID(), kind: "factual", text: "Synthetic supported statement", supporting_confirmed_fact_revision_ids: [factRevisionId] }],
    section_order: ["experience"], presentation_preferences: {}, locale: "en-US", page_intent: "one_page",
    template_id: "ats-basic", template_version: "1", parent_definition_revision_id: null, job_revision_id: null,
    policy_version: "owner-authored-v1", prompt_policy_version: null, variant: null,
    ...overrides,
  };
}
