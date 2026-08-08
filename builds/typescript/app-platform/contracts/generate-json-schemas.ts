import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z, type ZodType } from "zod";

import { AuditEventSchema } from "./audit.js";
import { CompatibilityMatrixSchema } from "./common.js";
import {
  ArtifactRecordSchema,
  CareerContextProjectionSchema,
  CareerFactRecordSchema,
  CareerReturnSummarySchema,
  ExportReceiptRecordSchema,
  InterviewProgressRecordSchema,
  JobDescriptionRecordSchema,
  LineageGraphSchema,
  MigrationRecordSchema,
  ResumeDefinitionRecordSchema,
  SourceRecordSchema,
  TailoredVariantRecordSchema,
} from "./data.js";
import {
  MigrationCompatibilityPolicySchema,
  MigrationProvenanceSchema,
  OwnerSafeResumeDataStateSchema,
  ResumeDataCapabilityContextSchema,
  ResumeDataCapabilityRequestSchema,
  ResumeDataCapabilityResultSchema,
  RetentionMatrixSchema,
} from "./data-conformance.js";
import { ContractErrorSchema } from "./errors.js";
import { InferenceRequestSchema, InferenceResultSchema, ModelCompatibilityEntrySchema } from "./inference.js";
import { PURPOSE_RESULT_SCHEMAS } from "../../resume-inference/results.js";
import {
  LifecycleOperationSchema,
  LifecycleRecordSchema,
  LifecycleResultSchema,
  LifecycleTransitionSchema,
  OperationRecordSchema,
} from "./lifecycle.js";
import { BridgeMessageSchema, BridgePolicySchema, CompleteMcpResultSchema, McpAppResourceSchema } from "./mcp-app.js";
import {
  CapabilityGrantSchema,
  CapabilityDiffSchema,
  CapabilityTokenSchema,
  PackageDescriptorSchema,
  PackageManifestSchema,
  PackageSourceIndexSchema,
  PackageTrustSchema,
  RevocationFreshnessPolicySchema,
  RevocationListSchema,
  SupervisorPolicySchema,
  TrustRootSchema,
} from "./package.js";
import {
  EndpointDescriptorSchema,
  RuntimeDescriptorSchema,
  RuntimeIdentitySchema,
  SupervisorHealthRequestSchema,
  SupervisorHealthResultSchema,
  SupervisorCleanupRequestSchema,
  SupervisorCleanupResultSchema,
  SupervisorReadyRequestSchema,
  SupervisorReadyResultSchema,
  SupervisorReconcileRequestSchema,
  SupervisorReconcileResultSchema,
  SupervisorRegistrationRequestSchema,
  SupervisorRegistrationResultSchema,
  SupervisorStartRequestSchema,
  SupervisorStartResultSchema,
  SupervisorStopRequestSchema,
  SupervisorStopResultSchema,
  SupervisorTokenRevocationRequestSchema,
  SupervisorTokenRevocationResultSchema,
} from "./supervisor.js";

export const JSON_SCHEMA_AUTHORITIES = {
  "artifact-record": ArtifactRecordSchema,
  "audit-event": AuditEventSchema,
  "bridge-message": BridgeMessageSchema,
  "bridge-policy": BridgePolicySchema,
  "capability-grant": CapabilityGrantSchema,
  "capability-diff": CapabilityDiffSchema,
  "capability-token": CapabilityTokenSchema,
  "career-fact-record": CareerFactRecordSchema,
  "career-context-projection": CareerContextProjectionSchema,
  "career-return-summary": CareerReturnSummarySchema,
  "data-capability-context": ResumeDataCapabilityContextSchema,
  "data-capability-request": ResumeDataCapabilityRequestSchema,
  "data-capability-result": ResumeDataCapabilityResultSchema,
  "compatibility-matrix": CompatibilityMatrixSchema,
  "complete-mcp-result": CompleteMcpResultSchema,
  "contract-error": ContractErrorSchema,
  "export-receipt-record": ExportReceiptRecordSchema,
  "inference-request": InferenceRequestSchema,
  "inference-result": InferenceResultSchema,
  "inference-result-interview-assist": PURPOSE_RESULT_SCHEMAS.interview_assist,
  "inference-result-general-resume-draft": PURPOSE_RESULT_SCHEMAS.general_resume_draft,
  "inference-result-job-description-analyze": PURPOSE_RESULT_SCHEMAS.job_description_analyze,
  "inference-result-requirement-evidence-match": PURPOSE_RESULT_SCHEMAS.requirement_evidence_match,
  "inference-result-tailoring-plan": PURPOSE_RESULT_SCHEMAS.tailoring_plan,
  "inference-result-targeted-resume-draft": PURPOSE_RESULT_SCHEMAS.targeted_resume_draft,
  "job-description-record": JobDescriptionRecordSchema,
  "interview-progress-record": InterviewProgressRecordSchema,
  "lineage-graph": LineageGraphSchema,
  "lifecycle-transition": LifecycleTransitionSchema,
  "lifecycle-record": LifecycleRecordSchema,
  "lifecycle-operation": LifecycleOperationSchema,
  "lifecycle-result": LifecycleResultSchema,
  "mcp-app-resource": McpAppResourceSchema,
  "migration-record": MigrationRecordSchema,
  "migration-compatibility-policy": MigrationCompatibilityPolicySchema,
  "migration-provenance": MigrationProvenanceSchema,
  "model-compatibility-entry": ModelCompatibilityEntrySchema,
  "operation-record": OperationRecordSchema,
  "owner-safe-data-state": OwnerSafeResumeDataStateSchema,
  "package-descriptor": PackageDescriptorSchema,
  "package-manifest": PackageManifestSchema,
  "package-source-index": PackageSourceIndexSchema,
  "package-trust": PackageTrustSchema,
  "revocation-list": RevocationListSchema,
  "revocation-freshness-policy": RevocationFreshnessPolicySchema,
  "resume-definition-record": ResumeDefinitionRecordSchema,
  "retention-matrix": RetentionMatrixSchema,
  "source-record": SourceRecordSchema,
  "supervisor-policy": SupervisorPolicySchema,
  "supervisor-endpoint-descriptor": EndpointDescriptorSchema,
  "supervisor-runtime-descriptor": RuntimeDescriptorSchema,
  "supervisor-runtime-identity": RuntimeIdentitySchema,
  "supervisor-start-request": SupervisorStartRequestSchema,
  "supervisor-start-result": SupervisorStartResultSchema,
  "supervisor-ready-request": SupervisorReadyRequestSchema,
  "supervisor-ready-result": SupervisorReadyResultSchema,
  "supervisor-health-request": SupervisorHealthRequestSchema,
  "supervisor-health-result": SupervisorHealthResultSchema,
  "supervisor-cleanup-request": SupervisorCleanupRequestSchema,
  "supervisor-cleanup-result": SupervisorCleanupResultSchema,
  "supervisor-registration-request": SupervisorRegistrationRequestSchema,
  "supervisor-registration-result": SupervisorRegistrationResultSchema,
  "supervisor-stop-request": SupervisorStopRequestSchema,
  "supervisor-stop-result": SupervisorStopResultSchema,
  "supervisor-token-revocation-request": SupervisorTokenRevocationRequestSchema,
  "supervisor-token-revocation-result": SupervisorTokenRevocationResultSchema,
  "supervisor-reconcile-request": SupervisorReconcileRequestSchema,
  "supervisor-reconcile-result": SupervisorReconcileResultSchema,
  "trust-root": TrustRootSchema,
  "tailored-variant-record": TailoredVariantRecordSchema,
} as const satisfies Record<string, ZodType>;

export function createJsonSchemaCatalog(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(JSON_SCHEMA_AUTHORITIES).map(([name, schema]) => [
      name,
      {
        $id: `https://schemas.braindrive.ai/resume-builder/v1/${name}.schema.json`,
        ...z.toJSONSchema(schema, {
          target: "draft-2020-12",
          io: "input",
          unrepresentable: "any",
        }),
      },
    ]),
  );
}

async function main(): Promise<void> {
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "schemas", "v1");
  await mkdir(directory, { recursive: true });
  const catalog = createJsonSchemaCatalog();
  for (const [name, schema] of Object.entries(catalog)) {
    await writeFile(resolve(directory, `${name}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
