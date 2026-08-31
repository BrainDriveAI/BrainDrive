import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertContentFreeAudit, AuditEventSchema } from "./audit.js";
import { AppIdentitySchema, AppRetentionPolicySchema, DEFAULT_APP_RETENTION_POLICY, GenericPackageManifestSchema } from "./app-registry.js";
import { canonicalInputDigest, canonicalJson, COMPATIBILITY_MATRIX, CompatibilityMatrixSchema } from "./common.js";
import {
  ArtifactRecordSchema,
  CareerFactRecordSchema,
  DefinitionComparisonResultSchema,
  ExportReceiptRecordSchema,
  GuidanceResultSchema,
  ImpactAnalysisResultSchema,
  InterviewProgressRecordSchema,
  JobEvidenceValueSchema,
  LineageGraphSchema,
  ResumeRevisionRequestRecordSchema,
  ResumeStatementSchema,
  RETENTION_MATRIX,
} from "./data.js";
import { createJsonSchemaCatalog, JSON_SCHEMA_AUTHORITIES } from "./generate-json-schemas.js";
import {
  InferenceRequestSchema,
  InferenceResultSchema,
  parseInferencePurpose,
  PURPOSE_LIMITS,
  PURPOSE_OUTPUT_SCHEMAS,
} from "./inference.js";
import { CompleteMcpResultSchema, McpAppResourceSchema } from "./mcp-app.js";
import { PackageManifestSchema } from "./package.js";

const directory = dirname(fileURLToPath(import.meta.url));

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(directory, "fixtures", path), "utf8"));
}

describe("versioned contract authorities", () => {
  const ownerId = "60000000-0000-4000-8000-000000000003";
  const envelope = (recordType: string) => ({
    schema_version: 2,
    record_type: recordType,
    metadata: {
      record_id: crypto.randomUUID(), revision_id: crypto.randomUUID(), revision: 1,
      created_at: "2026-08-10T12:00:00.000Z",
      created_by: {
        owner_id: ownerId, actor_id: ownerId, app_id: "ai.braindrive.resume-builder",
        publisher_id: "ai.braindrive", package_digest: `sha256:${"a".repeat(64)}`,
        installation_id: "60000000-0000-4000-8000-000000000004",
      },
      prior_revision_id: null, extensions: {},
    },
    owner_id: ownerId, updated_at: "2026-08-10T12:00:00.000Z", lifecycle_state: "active",
    sensitivity: "sensitive", retention_class: "durable_owner_data", extensions: {},
  });

  it("defines strict schema-v2 recovery, job evidence, revision, compare, impact, and guidance contracts", () => {
    const slot = {
      session_id: crypto.randomUUID(), job_fact_revision_id: crypto.randomUUID(),
      question_id: "responsibilities", field_id: "answer",
    };
    const progress = {
      ...envelope("interview_progress"), status: "in_progress", current_topic: "experience",
      completed_topics: [], skipped_topics: [], draft_state: "declared_draft",
      active_job_fact_revision_id: slot.job_fact_revision_id, current_question_id: slot.question_id,
      current_field_id: slot.field_id, job_dimension: "responsibilities",
      recovery_draft: {
        slot, value: "Synthetic private draft", value_digest: canonicalInputDigest("Synthetic private draft"),
        saved_at: "2026-08-10T12:00:00.000Z", acknowledged_revision: 1,
      },
      last_submitted_turn_revision_id: null,
    };
    expect(InterviewProgressRecordSchema.parse(progress).schema_version).toBe(2);
    expect(InterviewProgressRecordSchema.safeParse({ ...progress, recovery_draft: { ...progress.recovery_draft, value: "x".repeat(16_385) } }).success).toBe(false);
    expect(InterviewProgressRecordSchema.safeParse({ ...progress, owner_id: crypto.randomUUID() }).success).toBe(false);
    expect(InterviewProgressRecordSchema.safeParse({ ...progress, schema_version: 1 }).success).toBe(false);

    const jobEvidence = {
      value_version: 1, association: "job", job_fact_revision_id: slot.job_fact_revision_id,
      dimension: "outcomes", outcome: "answered", owner_text: "Synthetic qualitative outcome",
    };
    expect(JobEvidenceValueSchema.safeParse(jobEvidence).success).toBe(true);
    expect(JobEvidenceValueSchema.safeParse({ ...jobEvidence, association: "general" }).success).toBe(false);
    const jobEvidenceFact = {
      ...envelope("career_fact"), fact_kind: "job_evidence", state: "suggested",
      value: JSON.stringify(jobEvidence), source_revision_ids: [crypto.randomUUID()],
      supersedes_fact_revision_id: null, confirmation: null, review: { reviewed_at: null, review_note: null },
    };
    expect(CareerFactRecordSchema.safeParse(jobEvidenceFact).success).toBe(true);
    expect(CareerFactRecordSchema.safeParse({ ...jobEvidenceFact, schema_version: 1 }).success).toBe(false);

    const revision = {
      ...envelope("resume_revision_request"), source_definition_revision_id: crypto.randomUUID(),
      target: { scope: "section", target_id: "experience" }, request_text: "Shorten this section.",
      request_digest: canonicalInputDigest("Shorten this section."), classification: null,
      state: "submitted", clarification: null, attempt: 0, resulting_definition_revision_id: null,
      owner_outcome: null, submitted_at: "2026-08-10T12:00:00.000Z", completed_at: null,
    };
    expect(ResumeRevisionRequestRecordSchema.safeParse(revision).success).toBe(true);
    expect(ResumeRevisionRequestRecordSchema.safeParse({ ...revision, request_text: "x".repeat(8_193) }).success).toBe(false);
    expect(ResumeRevisionRequestRecordSchema.safeParse({ ...revision, schema_version: 1 }).success).toBe(false);
    expect(ResumeRevisionRequestRecordSchema.safeParse({ ...revision, owner_id: crypto.randomUUID() }).success).toBe(false);
    expect(ResumeRevisionRequestRecordSchema.safeParse({ ...revision, state: "accepted", resulting_definition_revision_id: crypto.randomUUID(), completed_at: revision.submitted_at }).success).toBe(false);

    const comparison = {
      comparison_version: 2, left_revision_id: crypto.randomUUID(), right_revision_id: crypto.randomUUID(),
      left_digest: `sha256:${"b".repeat(64)}`, right_digest: `sha256:${"c".repeat(64)}`,
      result: "available", compatibility: "compatible", relation: "related", unavailable_reason: null,
      added: [], removed: [], changed: [], moved: [], evidence_changed: [], unchanged: [], unchanged_count: 0,
      evidence_changes: { added_revision_ids: [], removed_revision_ids: [] }, observable_summary: [],
    };
    expect(DefinitionComparisonResultSchema.safeParse(comparison).success).toBe(true);
    expect(DefinitionComparisonResultSchema.safeParse({ ...comparison, owner_resume_text: "forbidden" }).success).toBe(false);
    expect(ImpactAnalysisResultSchema.safeParse({
      impact_version: 1, source_definition_revision_id: comparison.left_revision_id,
      changed_fact_revision_ids: [], affected_statements: [], stale_tailored_variants: [],
    }).success).toBe(true);
    expect(GuidanceResultSchema.safeParse({
      guidance_version: 1, items: [{ category: "strong_evidence", evidence_revision_ids: [slot.job_fact_revision_id], evidence_labels: ["Confirmed job evidence"], message: "Supported evidence is available." }],
      optional_questions: [],
    }).success).toBe(true);
  });

  it("accepts the valid package, owner-confirmed fact, and complete MCP result fixtures", async () => {
    expect(PackageManifestSchema.safeParse(await fixture("valid/package-manifest.json")).success).toBe(true);
    expect(CareerFactRecordSchema.safeParse(await fixture("valid/career-fact.json")).success).toBe(true);
    const result = CompleteMcpResultSchema.parse(await fixture("valid/complete-mcp-result.json"));
    expect(result.content.map((item) => item.type)).toEqual(["text", "resource_link", "resource"]);
    expect(result.structuredContent).toEqual({ ready: true });
    expect(result._meta).toBeDefined();
  });

  it("freezes the Spec 08 generic identity and manifest-authority fixture corpus", async () => {
    const corpus = await fixture("spec-08/m1-contract-corpus.json") as {
      corpus_version: number;
      valid_identities: unknown[];
      invalid_identities: unknown[];
      forbidden_manifest_authority_fields: string[];
    };
    expect(corpus.corpus_version).toBe(1);
    expect(corpus.valid_identities.map((identity) => AppIdentitySchema.parse(identity))).toHaveLength(2);
    for (const identity of corpus.invalid_identities) expect(AppIdentitySchema.safeParse(identity).success).toBe(false);
    expect(corpus.forbidden_manifest_authority_fields).toEqual([
      "handler", "handler_name", "module", "module_path", "import_name", "data_adapter", "inference_policy",
    ]);
    for (const field of corpus.forbidden_manifest_authority_fields) {
      expect(GenericPackageManifestSchema.safeParse({ manifest_version: 2, [field]: "host.internal.execute" }).success).toBe(false);
    }
  });

  it("validates generic manifest-declared retention policy classes and uninstall controls", () => {
    expect(AppRetentionPolicySchema.parse(DEFAULT_APP_RETENTION_POLICY)).toEqual(DEFAULT_APP_RETENTION_POLICY);
    expect(DEFAULT_APP_RETENTION_POLICY.classes.map((entry) => entry.retention_class)).toEqual([
      "runtime_authority",
      "verified_package",
      "disposable_cache",
      "app_storage",
      "artifact_records",
      "export_receipts",
      "owner_exports",
      "lifecycle_tombstone",
    ]);
    expect(GenericPackageManifestSchema.safeParse({ manifest_version: 2, retention_policy: "retain_owner_data_remove_runtime_authority" }).success).toBe(false);
    expect(AppRetentionPolicySchema.safeParse({
      ...DEFAULT_APP_RETENTION_POLICY,
      classes: DEFAULT_APP_RETENTION_POLICY.classes.map((entry) => entry.retention_class === "app_storage"
        ? { ...entry, owner_controls: ["delete_after_uninstall"] }
        : entry),
    }).success).toBe(false);
    expect(AppRetentionPolicySchema.safeParse({
      ...DEFAULT_APP_RETENTION_POLICY,
      classes: DEFAULT_APP_RETENTION_POLICY.classes.map((entry) => entry.retention_class === "runtime_authority"
        ? { ...entry, uninstall_behavior: "retain" }
        : entry),
    }).success).toBe(false);
  });

  it("rejects unknown authority fields while preserving explicit durable extensions", async () => {
    const packageManifest = await fixture("valid/package-manifest.json") as { requested_capabilities: string[] };
    expect(PackageManifestSchema.safeParse(await fixture("invalid/package-unknown-field.json")).success).toBe(false);
    expect(PackageManifestSchema.safeParse({ ...packageManifest, requested_capabilities: ["career.facts.read", "career.facts.read"] }).success).toBe(false);
    const fact = CareerFactRecordSchema.parse(await fixture("valid/career-fact.json"));
    expect(fact.extensions.future_display_hint).toBe("preserved but non-authoritative");
    expect(CareerFactRecordSchema.safeParse({ ...fact, confirmation_authority: true }).success).toBe(false);
  });

  it("freezes compatibility, downgrade, platform, and retention policies", () => {
    expect(CompatibilityMatrixSchema.parse(COMPATIBILITY_MATRIX)).toEqual(COMPATIBILITY_MATRIX);
    expect(COMPATIBILITY_MATRIX.desktop_release_targets).toEqual(["windows"]);
    expect(COMPATIBILITY_MATRIX.downgrade.destructive_downgrade).toBe("prohibited");
    expect(RETENTION_MATRIX.career_fact).toBe("durable_owner_data");
    expect(RETENTION_MATRIX.package_runtime).toBe("runtime_authority");
    expect(CompatibilityMatrixSchema.safeParse({ ...COMPATIBILITY_MATRIX, data_read_versions: [2] }).success).toBe(false);
  });

  it("canonicalizes semantically equivalent operation input before hashing", () => {
    const left = { beta: [2, { zeta: true, alpha: "same" }], alpha: 1 };
    const right = { alpha: 1, beta: [2, { alpha: "same", zeta: true }] };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalInputDigest(left)).toBe(canonicalInputDigest(right));
    expect(canonicalInputDigest({ ...right, alpha: 2 })).not.toBe(canonicalInputDigest(left));
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrowError(/non-finite/);
  });

  it("requires confirmation and provenance for approved factual content", async () => {
    const fact = CareerFactRecordSchema.parse(await fixture("valid/career-fact.json"));
    expect(CareerFactRecordSchema.safeParse({ ...fact, state: "suggested" }).success).toBe(false);
    expect(CareerFactRecordSchema.safeParse({ ...fact, confirmation: null }).success).toBe(false);
    expect(
      ResumeStatementSchema.safeParse({
        statement_id: "60000000-0000-4000-8000-000000000001",
        kind: "factual",
        text: "Built a product",
        supporting_confirmed_fact_revision_ids: [],
      }).success,
    ).toBe(false);
  });

  it("fails closed for broken, cyclic, unconfirmed, and sensitivity-lowering lineage", () => {
    const confirmedFact = { revision_id: "61000000-0000-4000-8000-000000000001", record_type: "career_fact", fact_state: "confirmed", sensitivity: "sensitive" } as const;
    const definition = { revision_id: "61000000-0000-4000-8000-000000000002", record_type: "resume_definition", fact_state: null, sensitivity: "sensitive" } as const;
    const valid = {
      graph_version: 1,
      nodes: [confirmedFact, definition],
      edges: [{ from_revision_id: definition.revision_id, to_revision_id: confirmedFact.revision_id, relation: "supported_by" }],
    };
    expect(LineageGraphSchema.safeParse(valid).success).toBe(true);
    expect(LineageGraphSchema.safeParse({ ...valid, edges: [{ ...valid.edges[0], to_revision_id: "61000000-0000-4000-8000-000000000099" }] }).success).toBe(false);
    expect(LineageGraphSchema.safeParse({ ...valid, nodes: [{ ...confirmedFact, fact_state: "suggested" }, definition] }).success).toBe(false);
    expect(LineageGraphSchema.safeParse({ ...valid, nodes: [confirmedFact, { ...definition, sensitivity: "standard" }], edges: [{ ...valid.edges[0], relation: "derived_from" }] }).success).toBe(false);
    expect(LineageGraphSchema.safeParse({ ...valid, edges: [
      { from_revision_id: definition.revision_id, to_revision_id: confirmedFact.revision_id, relation: "parent" },
      { from_revision_id: confirmedFact.revision_id, to_revision_id: definition.revision_id, relation: "parent" },
    ] }).success).toBe(false);
  });

  it("blocks unsafe artifacts and raw export paths", () => {
    const base = {
      schema_version: 1,
      record_type: "artifact",
      metadata: {
        record_id: "60000000-0000-4000-8000-000000000001",
        revision_id: "60000000-0000-4000-8000-000000000002",
        revision: 1,
        created_at: "2026-08-07T12:00:00.000Z",
        created_by: {
          owner_id: "60000000-0000-4000-8000-000000000003",
          actor_id: "60000000-0000-4000-8000-000000000003",
          app_id: "ai.braindrive.resume-builder",
          publisher_id: "ai.braindrive",
          package_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          installation_id: "60000000-0000-4000-8000-000000000004",
        },
        prior_revision_id: null,
        extensions: {},
      },
      owner_id: "60000000-0000-4000-8000-000000000003",
      sensitivity: "sensitive",
      retention_class: "durable_owner_data",
      extensions: {},
      definition_revision_id: "60000000-0000-4000-8000-000000000005",
      template_id: "ats-basic",
      template_version: "1",
      renderer_id: "deterministic-pdf",
      renderer_version: "1",
      font_manifest_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      validation_run_id: "60000000-0000-4000-8000-000000000006",
      findings: [{ finding_id: "60000000-0000-4000-8000-000000000007", validator_id: "claims", validator_version: "1", severity: "error", code: "unsupported_claim", statement_id: "60000000-0000-4000-8000-000000000008", safe_message: "Unsupported claim" }],
      artifact_digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      format: "pdf",
      accepted: true,
    };
    expect(ArtifactRecordSchema.safeParse(base).success).toBe(false);
    expect(ExportReceiptRecordSchema.safeParse({ ...base, record_type: "export_receipt", safe_destination_label: "/home/owner/resume.pdf" }).success).toBe(false);
  });

  it("validates MCP App resource MIME, ui URI, encoded size, and envelope ceiling", () => {
    const resource = {
      resource_version: 1,
      app_id: "ai.braindrive.resume-builder",
      package_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      uri: "ui://resume-builder/main",
      mime_type: "text/html;profile=mcp-app",
      extension: { id: "io.modelcontextprotocol/ui", version: "2026-01-26" },
      content_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      size_bytes: 13,
      cache_policy: "immutable_package_digest",
      html: "<main></main>",
    };
    expect(McpAppResourceSchema.safeParse(resource).success).toBe(true);
    expect(McpAppResourceSchema.safeParse({ ...resource, uri: "https://example.com/app" }).success).toBe(false);
    expect(McpAppResourceSchema.safeParse({ ...resource, size_bytes: 12 }).success).toBe(false);

    const complete = {
      envelope_version: 1,
      protocol_version: "2026-07-28",
      connection_id: "62000000-0000-4000-8000-000000000001",
      request_id: "large",
      operation_id: "62000000-0000-4000-8000-000000000002",
      content: [
        { type: "text", text: "x".repeat(131_072) },
        { type: "text", text: "y".repeat(131_072) },
      ],
      isError: false,
      progress_token: null,
      cancellation_id: null,
      protocol_error: null,
    };
    expect(CompleteMcpResultSchema.safeParse(complete).success).toBe(false);
  });
});

describe("inference contracts", () => {
  const request = {
    inference_schema_version: 1,
    request_id: "70000000-0000-4000-8000-000000000001",
    owner_id: "70000000-0000-4000-8000-000000000002",
    actor_id: "70000000-0000-4000-8000-000000000002",
    app_id: "ai.braindrive.resume-builder",
    installation_id: "70000000-0000-4000-8000-000000000003",
    operation_id: "70000000-0000-4000-8000-000000000004",
    grant_id: "70000000-0000-4000-8000-000000000005",
    purpose: "general_resume_draft",
    input_snapshot: { fact_snapshot_revision: 1, fact_snapshot_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", record_revision_ids: [] },
    data_blocks: [{ category: "confirmed_fact_snapshot", content_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", schema_id: "resume.facts.v1", schema_version: 1, data: { facts: [] } }],
    prompt_policy_id: "resume.general",
    prompt_policy_version: "1",
    output_schema_id: PURPOSE_OUTPUT_SCHEMAS.general_resume_draft,
    output_schema_version: 1,
    capability_requirements: { text_generation: true, complete_structured_json: true, minimum_context_tokens: 16_384, model_tools: false },
    limits: PURPOSE_LIMITS.general_resume_draft,
    requested_at: "2026-08-07T12:00:00.000Z",
    deadline_at: "2026-08-07T12:02:00.000Z",
  } as const;

  it("accepts each exact purpose/schema/limit tuple", () => {
    for (const purpose of Object.keys(PURPOSE_OUTPUT_SCHEMAS) as Array<keyof typeof PURPOSE_OUTPUT_SCHEMAS>) {
      const candidate = { ...request, purpose, output_schema_id: PURPOSE_OUTPUT_SCHEMAS[purpose], limits: PURPOSE_LIMITS[purpose] };
      expect(InferenceRequestSchema.safeParse(candidate).success, purpose).toBe(true);
    }
  });

  it("deterministically rejects unknown purposes, mismatched schemas, widened budgets, and provider fields", async () => {
    expect(() => parseInferencePurpose("write_cover_letter")).toThrowError(/allowlist/);
    expect(InferenceRequestSchema.safeParse({ ...request, output_schema_id: "arbitrary.schema" }).success).toBe(false);
    expect(InferenceRequestSchema.safeParse({ ...request, limits: { ...request.limits, output_tokens: request.limits.output_tokens + 1 } }).success).toBe(false);
    expect(InferenceRequestSchema.safeParse({ ...request, provider_api_key: "sk-not-allowed" }).success).toBe(false);
    expect(InferenceRequestSchema.safeParse(await fixture("invalid/inference-purpose.json")).success).toBe(false);
  });

  it("requires unambiguous terminal result/error outcomes", () => {
    const result = {
      inference_schema_version: 1,
      request_id: request.request_id,
      operation_id: request.operation_id,
      purpose: request.purpose,
      status: "completed",
      prompt_policy_id: request.prompt_policy_id,
      prompt_policy_version: request.prompt_policy_version,
      output_schema_id: request.output_schema_id,
      output_schema_version: 1,
      input_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      output_digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      result: { sections: [] },
      provider_profile_id: "ollama",
      model_id: "owner-selected-model",
      attempt_count: 1,
      usage: { available: false, input_tokens: null, output_tokens: null },
      error: null,
      started_at: request.requested_at,
      completed_at: request.deadline_at,
    };
    expect(InferenceResultSchema.safeParse(result).success).toBe(true);
    expect(InferenceResultSchema.safeParse({ ...result, result: null }).success).toBe(false);
  });
});

describe("JSON Schema and traceability artifacts", () => {
  it("keeps every generated JSON Schema artifact in sync with its Zod authority", async () => {
    const catalog = createJsonSchemaCatalog();
    expect(Object.keys(catalog)).toEqual(Object.keys(JSON_SCHEMA_AUTHORITIES));
    expect((await readdir(resolve(directory, "schemas", "v1"))).sort()).toEqual(
      Object.keys(catalog).map((name) => `${name}.schema.json`).sort(),
    );
    for (const [name, schema] of Object.entries(catalog)) {
      const disk = JSON.parse(await readFile(resolve(directory, "schemas", "v1", `${name}.schema.json`), "utf8"));
      expect(disk, name).toEqual(schema);
    }
  });

  it("maps REQ-001 through REQ-034 exactly once to contracts, scenarios, and milestones", async () => {
    const manifest = await fixture("requirements.json") as { requirements: Array<{ id: string; summary: string; contracts: string[]; scenarios: string[]; milestones: number[] }> };
    expect(manifest.requirements).toHaveLength(34);
    expect(new Set(manifest.requirements.map((entry) => entry.id)).size).toBe(34);
    expect(manifest.requirements.map((entry) => entry.id)).toEqual(
      Array.from({ length: 34 }, (_, index) => `REQ-${String(index + 1).padStart(3, "0")}`),
    );
    expect(manifest.requirements.map((entry) => entry.summary)).toEqual([
      "Genuine installable package",
      "One minimal Apps lifecycle surface",
      "Durable lifecycle, reconciliation, LKG, retention",
      "Trust, compatibility, revocation, grants",
      "Career/direct known-context preflight",
      "Bounded Career return",
      "Adaptive interview",
      "Fact state/provenance/confirmation",
      "Distinct versioned records",
      "CAS/idempotency/commit boundary",
      "Migration/compatibility/backup/retention",
      "Approved general resume",
      "Pasted JD and evidence classes",
      "Separate tailored variant",
      "Brokered owner-provider inference",
      "Purpose schemas/budgets/cancel/repair",
      "Deterministic validation and lineage",
      "Untrusted content boundary",
      "Complete modern/legacy MCP",
      "Sandboxed ui resource bridge",
      "Named scoped capabilities/tokens",
      "Docker/desktop supervision",
      "Reproducible sanitized rendering",
      "Host-mediated export",
      "Reopen/history/recovery",
      "Existing UX and accessibility",
      "Content-free evidence",
      "Docker then Windows parity",
      "Existing-system regression",
      "No credential/content/path leakage",
      "Safe visible states/recovery",
      "Complete acceptance evidence",
      "General private-sector quality/no score",
      "Exclusions",
    ]);
    for (const entry of manifest.requirements) {
      expect(entry.contracts.length, entry.id).toBeGreaterThan(0);
      expect(entry.scenarios.length, entry.id).toBeGreaterThan(0);
      expect(entry.milestones, entry.id).toContain(1);
      expect(entry.milestones, entry.id).toContain(8);
      expect(Math.max(...entry.milestones), entry.id).toBeLessThanOrEqual(8);
      for (const contract of entry.contracts) {
        expect(contract === "all-v1-json-schemas" || contract in JSON_SCHEMA_AUTHORITIES, `${entry.id}: ${contract}`).toBe(true);
      }
    }
  });

  it("maps every requirement and invariant to reproducible M8 evidence without waiving blockers", async () => {
    type EvidenceEntry = { id: string; status?: "pass" | "blocked" };
    type MatrixEntry = {
      id: string;
      status: "pass" | "blocked";
      tests: string[];
      commands: string[];
      environments?: string[];
      artifacts?: string[];
      human?: string[];
      blockers?: string[];
    };
    const manifest = await fixture("acceptance-evidence.json") as {
      manifest_version: number;
      milestone: number;
      commands: Array<EvidenceEntry & { command: string; result: string; environment_id: string }>;
      environments: EvidenceEntry[];
      artifacts: EvidenceEntry[];
      automated_tests: Array<EvidenceEntry & { location: string }>;
      human_evidence: EvidenceEntry[];
      requirements: MatrixEntry[];
      invariants: MatrixEntry[];
    };
    expect(manifest.manifest_version).toBe(1);
    expect(manifest.milestone).toBe(8);
    expect(manifest.requirements.map((entry) => entry.id)).toEqual(
      Array.from({ length: 34 }, (_, index) => `REQ-${String(index + 1).padStart(3, "0")}`),
    );
    expect(manifest.invariants.map((entry) => entry.id)).toEqual(
      Array.from({ length: 15 }, (_, index) => `INV-${String(index + 1).padStart(2, "0")}`),
    );

    const tests = new Set(manifest.automated_tests.map((entry) => entry.id));
    const commands = new Set(manifest.commands.map((entry) => entry.id));
    const environments = new Set(manifest.environments.map((entry) => entry.id));
    const artifacts = new Set(manifest.artifacts.map((entry) => entry.id));
    const humanEvidence = new Set(manifest.human_evidence.map((entry) => entry.id));
    const blockedEvidence = new Set([
      ...manifest.environments.filter((entry) => entry.status === "blocked").map((entry) => entry.id),
      ...manifest.artifacts.filter((entry) => entry.status === "blocked").map((entry) => entry.id),
      ...manifest.human_evidence.filter((entry) => entry.status === "blocked").map((entry) => entry.id),
    ]);

    expect(tests.size).toBe(manifest.automated_tests.length);
    expect(commands.size).toBe(manifest.commands.length);
    expect(environments.size).toBe(manifest.environments.length);
    expect(artifacts.size).toBe(manifest.artifacts.length);
    expect(humanEvidence.size).toBe(manifest.human_evidence.length);
    for (const command of manifest.commands) {
      expect(command.command.length, command.id).toBeGreaterThan(0);
      expect(command.result.length, command.id).toBeGreaterThan(0);
      expect(command.result, command.id).not.toMatch(/\bpending\b/i);
      expect(environments.has(command.environment_id), command.id).toBe(true);
    }

    for (const entry of [...manifest.requirements, ...manifest.invariants]) {
      expect(entry.tests.length, entry.id).toBeGreaterThan(0);
      expect(entry.commands.length, entry.id).toBeGreaterThan(0);
      for (const id of entry.tests) expect(tests.has(id), `${entry.id}: ${id}`).toBe(true);
      for (const id of entry.commands) expect(commands.has(id), `${entry.id}: ${id}`).toBe(true);
      for (const id of entry.environments ?? []) expect(environments.has(id), `${entry.id}: ${id}`).toBe(true);
      for (const id of entry.artifacts ?? []) expect(artifacts.has(id), `${entry.id}: ${id}`).toBe(true);
      for (const id of entry.human ?? []) expect(humanEvidence.has(id), `${entry.id}: ${id}`).toBe(true);
      for (const id of entry.blockers ?? []) {
        expect(environments.has(id) || artifacts.has(id) || humanEvidence.has(id), `${entry.id}: ${id}`).toBe(true);
      }
      if (entry.status === "blocked") {
        const references = [...(entry.environments ?? []), ...(entry.artifacts ?? []), ...(entry.human ?? []), ...(entry.blockers ?? [])];
        expect(references.some((id) => blockedEvidence.has(id)), `${entry.id}: missing explicit blocked evidence`).toBe(true);
      }
    }

    const releaseReport = await readFile(resolve(directory, "..", "M8-RELEASE-VERIFICATION.md"), "utf8");
    expect(releaseReport).toContain("**HOLD — not ready for release approval.**");
    expect(releaseReport).toContain("contracts/fixtures/acceptance-evidence.json");
    expect(releaseReport).toContain("INV-13 blocked");
  });

  it("maps all 44 Spec 08 requirements and fails release acceptance closed on missing environment or human evidence", async () => {
    const matrix = await fixture("spec-08/m8-requirement-evidence.json") as {
      evidence_version: number;
      milestone: number;
      candidate: { state: string; immutable_source_revision: string | null; source_candidate_proof: string | null };
      mapping_convention: {
        relative_path_base: string;
        repository_root_prefixes: string[];
        named_evidence: string[];
      };
      evidence_classes: Record<string, string>;
      overall_disposition: "pass" | "hold";
      hold_reasons: string[];
      requirements: Array<{
        id: string;
        code: string[];
        tests: string[];
        evidence: string[];
        disposition: string;
      }>;
    };
    expect(matrix.evidence_version).toBe(1);
    expect(matrix.milestone).toBe(8);
    expect(matrix.requirements.map(({ id }) => id)).toEqual(
      Array.from({ length: 44 }, (_, index) => `APP8-REQ-${String(index + 1).padStart(3, "0")}`),
    );
    expect(new Set(matrix.requirements.map(({ id }) => id)).size).toBe(44);
    const repositoryRoot = resolve(directory, "../../../..");
    const relativePathBase = resolve(repositoryRoot, matrix.mapping_convention.relative_path_base);
    expect(matrix.mapping_convention.relative_path_base).toBe("builds/typescript");
    expect(matrix.mapping_convention.repository_root_prefixes).toEqual(["builds/", "docs/", "installer/", "tools/"]);
    expect(matrix.mapping_convention.named_evidence).toEqual(["static forbidden-surface audit"]);
    const namedEvidence = new Set(matrix.mapping_convention.named_evidence);
    let mappingCount = 0;
    for (const requirement of matrix.requirements) {
      expect(requirement.code.length, `${requirement.id}: code`).toBeGreaterThan(0);
      expect(requirement.tests.length, `${requirement.id}: tests`).toBeGreaterThan(0);
      expect(requirement.evidence.length, `${requirement.id}: evidence`).toBeGreaterThan(0);
      for (const evidence of requirement.evidence) {
        expect(matrix.evidence_classes[evidence], `${requirement.id}: ${evidence}`).toBeTypeOf("string");
      }
      expect(requirement.disposition, requirement.id).toMatch(/^(automated_pass|environment_hold|human_hold|environment_human_hold|evidence_identity_hold)$/);
      for (const reference of [...requirement.code, ...requirement.tests]) {
        mappingCount += 1;
        if (namedEvidence.has(reference)) continue;
        expect(reference, `${requirement.id}: mapping must be relative`).not.toBe("");
        expect(isAbsolute(reference), `${requirement.id}: ${reference}`).toBe(false);
        expect(reference.includes("\\"), `${requirement.id}: ${reference}`).toBe(false);
        const base = matrix.mapping_convention.repository_root_prefixes.some((prefix) => reference.startsWith(prefix))
          ? repositoryRoot
          : relativePathBase;
        const candidate = resolve(base, reference);
        const candidateRelative = relative(repositoryRoot, candidate);
        expect(candidateRelative === ".." || candidateRelative.startsWith(`..${sep}`), `${requirement.id}: ${reference}`).toBe(false);
        const resolved = await realpath(candidate);
        const resolvedRelative = relative(repositoryRoot, resolved);
        expect(resolvedRelative === ".." || resolvedRelative.startsWith(`..${sep}`), `${requirement.id}: ${reference}`).toBe(false);
        await expect(stat(resolved), `${requirement.id}: ${reference}`).resolves.toBeTruthy();
      }
    }
    expect(mappingCount).toBe(181);
    const requiredHumanAndReleaseHolds = ["brief_live_human", "resume_human", "release_evidence"];
    let nativeWindowsSatisfied = false;
    if (matrix.candidate.state === "pre_freeze_working_tree_hold") {
      expect(matrix.candidate).toMatchObject({ immutable_source_revision: null, source_candidate_proof: null });
      expect(matrix.hold_reasons).toEqual(["immutable_candidate", "native_windows", ...requiredHumanAndReleaseHolds]);
      expect(matrix.evidence_classes.immutable_candidate).toMatch(/^blocked/);
      expect(matrix.evidence_classes.native_windows).toMatch(/^blocked:/);
    } else {
      expect(matrix.candidate.state).toBe("post_freeze_evidence_bound_hold");
      expect(matrix.candidate.immutable_source_revision).toMatch(/^[0-9a-f]{40}$/);
      expect(matrix.candidate.source_candidate_proof).toMatch(/^source-candidate sha256 [0-9a-f]{64}; entries \d+; revision [0-9a-f]{40}$/);
      expect(matrix.candidate.source_candidate_proof).toContain(`; revision ${matrix.candidate.immutable_source_revision}`);
      expect(matrix.evidence_classes.immutable_candidate).toMatch(/^satisfied:/);
      nativeWindowsSatisfied = matrix.evidence_classes.native_windows.startsWith("satisfied:");
      if (nativeWindowsSatisfied) {
        expect(matrix.hold_reasons).toEqual(requiredHumanAndReleaseHolds);
      } else {
        expect(matrix.evidence_classes.native_windows).toMatch(/^blocked:/);
        expect(matrix.hold_reasons).toEqual(["native_windows", ...requiredHumanAndReleaseHolds]);
      }
    }
    for (const hold of requiredHumanAndReleaseHolds) expect(matrix.evidence_classes[hold]).toMatch(/^blocked:/);
    expect(matrix.requirements.filter(({ disposition }) => disposition !== "automated_pass").map(({ id }) => id)).toEqual(
      nativeWindowsSatisfied
        ? ["APP8-REQ-027", "APP8-REQ-041", "APP8-REQ-043"]
        : ["APP8-REQ-009", "APP8-REQ-027", "APP8-REQ-038", "APP8-REQ-041", "APP8-REQ-042", "APP8-REQ-043"],
    );
    if (nativeWindowsSatisfied) {
      for (const id of ["APP8-REQ-009", "APP8-REQ-038", "APP8-REQ-042"]) {
        expect(matrix.requirements.find((requirement) => requirement.id === id)?.disposition, id).toBe("automated_pass");
      }
      expect(matrix.requirements.find(({ id }) => id === "APP8-REQ-041")?.disposition).toBe("human_hold");
    }
    expect(matrix.overall_disposition).toBe("hold");
  });

  it("accepts only the content-free audit schema", () => {
    const event = {
      event_version: 1,
      event_id: "80000000-0000-4000-8000-000000000001",
      event_name: "app.validation.completed",
      occurred_at: "2026-08-07T12:00:00.000Z",
      correlation_id: "80000000-0000-4000-8000-000000000002",
      actor_id: "80000000-0000-4000-8000-000000000003",
      owner_id: "80000000-0000-4000-8000-000000000003",
      app_id: "ai.braindrive.resume-builder",
      publisher_id: "ai.braindrive",
      package_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      installation_id: "80000000-0000-4000-8000-000000000004",
      operation_id: "80000000-0000-4000-8000-000000000005",
      capability: null,
      target_category: "artifact",
      target_id: "80000000-0000-4000-8000-000000000006",
      input_revision: 1,
      outcome: "committed",
      error_code: null,
      schema_version: 1,
      duration_ms: 12,
      item_count: 0,
    };
    expect(AuditEventSchema.safeParse(event).success).toBe(true);
    expect(() => assertContentFreeAudit(event)).not.toThrow();
    const interviewEvent = {
      ...event,
      event_name: "app.resume_interview.question_outcome",
      job_revision_id: "80000000-0000-4000-8000-000000000007",
      job_dimension: "outcomes",
      selection_method: null,
      question_outcome: "unknown",
    };
    expect(() => assertContentFreeAudit(interviewEvent)).not.toThrow();
    expect(() => assertContentFreeAudit({ ...interviewEvent, prompt: "private answer" })).toThrow(/prohibited/);
  });
});
