import { randomUUID } from "node:crypto";

import { z } from "zod";

import { assertContentFreeAudit, AuditEventSchema } from "../app-platform/contracts/audit.js";
import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import { CapabilityNameSchema } from "../app-platform/contracts/package.js";
import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import { CareerPlacementAdapter, type CareerReturnSummary } from "./career.js";
import { ResumeDomainError } from "./errors.js";
import { ResumeDomainService, type DataAuthority } from "./service.js";
import type { ResumeExportBroker } from "../resume-renderer/export-broker.js";
import type { HostOwnerDecisionEvidence } from "./career-data.js";
import {
  RestrictedCapabilityAuthoritySchema,
  ResumeCapabilityPolicy,
  type RestrictedCapabilityAuthority,
} from "./capability-policy.js";

const ContextInputSchema = z.object({ entry_point: z.enum(["direct", "career"]) }).strict();
const ReadInputSchema = z.object({ record_id: z.string().uuid().optional() }).strict();
const DefinitionReadInputSchema = z.union([
  ReadInputSchema,
  z.object({ view: z.literal("workspace") }).strict(),
]);
const OperationInputSchema = z.object({ queried_operation_id: z.string().uuid() }).strict();
const InterviewCapabilityInputSchema = z.object({ kind: z.literal("interview_progress"), progress: z.record(z.string(), z.unknown()) }).strict();
const DefinitionApprovalCapabilityInputSchema = z.object({ kind: z.literal("approve_definition"), definition_record_id: z.string().uuid(), expected_revision: z.number().int().positive() }).strict();

export type CapabilityExecutionContext = {
  authority: RestrictedCapabilityAuthority;
  operationId: string;
  correlationId: string;
  idempotencyKey: string;
  ownerDecision?: HostOwnerDecisionEvidence;
  hostOwnerConfirmed?: boolean;
  isCancelled?: () => boolean;
};

export class ResumeCapabilityRouter {
  constructor(
    public readonly domain: ResumeDomainService,
    public readonly career: CareerPlacementAdapter,
    private readonly policy: ResumeCapabilityPolicy,
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
    private readonly exportBroker?: ResumeExportBroker,
  ) {}

  async execute(capabilityInput: unknown, input: unknown, context: CapabilityExecutionContext): Promise<unknown> {
    const capability = CapabilityNameSchema.parse(capabilityInput);
    if (capability === "app.inference.request") throw new ResumeDomainError("denied", "Inference is outside the Resume Builder data capability boundary", 403);
    const startedAt = Date.now();
    let grant: CapabilityGrant | null = null;
    try {
      this.assertBoundedInput(input);
      this.assertNoAppAuthority(input);
      if (!OpaqueIdSchema.safeParse(context.correlationId).success) throw new ResumeDomainError("invalid_input", "Capability correlation identity is invalid", 400);
      grant = await this.policy.authorize(capability, context.authority, context.operationId);
      const restrictedGrant: CapabilityGrant = {
        ...grant,
        capabilities: [capability],
        record_scopes: context.authority.context.record_scope_ids,
      };
      const authority: DataAuthority = { grant: restrictedGrant, capability, operationId: context.operationId, idempotencyKey: context.idempotencyKey, isCancelled: context.isCancelled };
      let result: unknown;
      switch (capability) {
        case "career.context.read":
          result = await this.career.project(ContextInputSchema.parse(input).entry_point);
          break;
        case "career.facts.read":
          result = await this.read("career_fact", ReadInputSchema.parse(input).record_id, authority);
          break;
        case "career.facts.propose":
          result = await this.domain.proposeFact(input, authority);
          break;
        case "career.facts.confirm":
          result = await this.domain.confirmFact(input, authority, context.ownerDecision!);
          break;
        case "resume.definitions.read":
          result = await this.readDefinitions(DefinitionReadInputSchema.parse(input), authority);
          break;
        case "resume.definitions.write": {
          const interview = InterviewCapabilityInputSchema.safeParse(input);
          const approval = DefinitionApprovalCapabilityInputSchema.safeParse(input);
          result = interview.success
            ? await this.domain.saveInterviewProgress(interview.data.progress, authority)
            : approval.success
              ? await this.domain.approveDefinition(approval.data, authority, context.hostOwnerConfirmed === true)
              : await this.domain.writeDefinition(input, authority, context.hostOwnerConfirmed === true);
          break;
        }
        case "resume.jobs.read":
          result = await this.read("job_description", ReadInputSchema.parse(input).record_id, authority);
          break;
        case "resume.jobs.write":
          result = await this.domain.writeJob(input, authority);
          break;
        case "resume.artifacts.register":
          result = await this.domain.registerArtifact(input, authority);
          break;
        case "resume.operations.read": {
          const parsed = OperationInputSchema.parse(input);
          result = await this.domain.store.operation(parsed.queried_operation_id, restrictedGrant.installation_id, {
            ownerId: restrictedGrant.owner_id,
            actorId: restrictedGrant.actor_id,
            grantedCapabilities: grant.capabilities,
            recordScopes: restrictedGrant.record_scopes,
          });
          break;
        }
        case "resume.export.request":
          if (!this.exportBroker) throw new ResumeDomainError("recoverable_internal_failure", "Resume preview is unavailable", 503);
          result = await this.exportBroker.preview(input, authority);
          break;
      }
      this.emitAudit(capability, context, grant, input, this.isMutation(capability) ? "committed" : "allowed", null, Date.now() - startedAt, Array.isArray(result) ? result.length : 1);
      return result;
    } catch (error) {
      const failure = error instanceof ResumeDomainError
        ? error
        : error instanceof z.ZodError
          ? new ResumeDomainError("invalid_input", "Capability input failed schema validation", 400)
          : new ResumeDomainError("recoverable_internal_failure", "Resume Builder data operation failed safely", 500);
      this.emitAudit(capability, context, grant, input, this.auditOutcome(failure), failure.code, Date.now() - startedAt, null);
      throw failure;
    }
  }

  async placeCareerReturn(summary: CareerReturnSummary, entryPoint: "direct" | "career", operationId: string, grant: CapabilityGrant): Promise<{ placement: "career_journal" | "none"; committed: boolean; reused: boolean }> {
    if (entryPoint !== "career") return { placement: "none", committed: false, reused: false };
    if (summary.approved_reference) {
      const approved = await this.domain.store.readRevision(summary.approved_reference.revision_id, grant.record_scopes);
      if (approved.metadata.record_id !== summary.approved_reference.record_id) throw new ResumeDomainError("validation_failed", "Career return approved reference is invalid");
      if (summary.approved_reference.kind === "general_resume") {
        if (approved.record_type !== "resume_definition" || approved.definition_kind !== "general" || approved.status !== "approved") throw new ResumeDomainError("validation_failed", "Career return approved reference is invalid");
      } else {
        if (approved.record_type !== "tailored_variant") throw new ResumeDomainError("validation_failed", "Career return approved reference is invalid");
        const targeted = await this.domain.store.readRevision(approved.targeted_definition_revision_id, grant.record_scopes);
        if (targeted.record_type !== "resume_definition" || targeted.definition_kind !== "targeted" || targeted.status !== "approved") throw new ResumeDomainError("validation_failed", "Career return approved reference is invalid");
      }
    }
    for (const proposal of summary.stable_fact_proposals) {
      const fact = await this.domain.store.readRevision(proposal.fact_revision_id, grant.record_scopes);
      if (fact.record_type !== "career_fact" || fact.metadata.record_id !== proposal.fact_record_id || fact.state !== "confirmed") throw new ResumeDomainError("validation_failed", "Career return stable fact proposal is invalid");
    }
    return this.career.placeReturn(summary, operationId);
  }

  private async read(recordType: "career_fact" | "resume_definition" | "job_description", recordId: string | undefined, authority: DataAuthority): Promise<unknown> {
    if (recordId) {
      const record = await this.domain.store.readHead(recordId, authority.grant.record_scopes);
      if (record.record_type !== recordType) throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
      return record;
    }
    return this.domain.readRecords(recordType, authority);
  }

  private async readDefinitions(input: z.infer<typeof DefinitionReadInputSchema>, authority: DataAuthority): Promise<unknown> {
    if ("record_id" in input && input.record_id) {
      const record = await this.domain.store.readHead(input.record_id, authority.grant.record_scopes);
      if (record.record_type !== "resume_definition" && record.record_type !== "tailored_variant") {
        throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
      }
      return record;
    }
    if ("view" in input) {
      const [definitions, variants, artifacts, exports, interview, jobs] = await Promise.all([
        this.domain.store.list("resume_definition", authority.grant.record_scopes),
        this.domain.store.list("tailored_variant", authority.grant.record_scopes),
        this.domain.store.list("artifact", authority.grant.record_scopes),
        this.domain.store.list("export_receipt", authority.grant.record_scopes),
        this.domain.store.list("interview_progress", authority.grant.record_scopes),
        this.domain.store.list("job_description", authority.grant.record_scopes),
      ]);
      return { workspace_version: 1, definitions, variants, artifacts, exports, interview, jobs };
    }
    return this.domain.readRecords("resume_definition", authority);
  }

  private assertBoundedInput(input: unknown): void {
    try {
      const serialized = JSON.stringify(input) ?? "";
      if (Buffer.byteLength(serialized, "utf8") > 262_144) {
        throw new ResumeDomainError("invalid_input", "Capability input exceeds the accepted byte limit", 413);
      }
    } catch (error) {
      if (error instanceof ResumeDomainError) throw error;
      throw new ResumeDomainError("invalid_input", "Capability input could not be encoded", 400);
    }
  }

  private assertNoAppAuthority(input: unknown): void {
    const forbidden = new Set([
      "actor_id", "app_id", "capability", "grant", "grant_id", "granted_capabilities", "host_owner_confirmed",
      "idempotency_key", "installation_id", "migration", "migration_id", "model", "model_id", "operation_id",
      "owner_confirmation", "owner_id", "package_digest", "permission", "permissions", "provider", "provider_id",
      "provider_profile_id", "publisher_id", "schema_version",
    ]);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (forbidden.has(key.toLowerCase())) throw new ResumeDomainError("invalid_input", "Capability input contains host-controlled authority", 400);
        visit(nested);
      }
    };
    visit(input);
  }

  private emitAudit(
    capability: Exclude<z.infer<typeof CapabilityNameSchema>, "app.inference.request">,
    context: CapabilityExecutionContext,
    grant: CapabilityGrant | null,
    input: unknown,
    outcome: "allowed" | "denied" | "committed" | "cancelled" | "conflict" | "failed",
    errorCode: string | null,
    durationMs: number,
    itemCount: number | null,
  ): void {
    const binding = RestrictedCapabilityAuthoritySchema.safeParse(context.authority);
    if (!binding.success || !OpaqueIdSchema.safeParse(context.correlationId).success) return;
    const source = grant ?? binding.data.context;
    const target = this.auditTarget(capability, input);
    const event = AuditEventSchema.parse({
      event_version: 1,
      event_id: randomUUID(),
      event_name: "app.capability.completed",
      occurred_at: new Date().toISOString(),
      correlation_id: context.correlationId,
      actor_id: source.actor_id,
      owner_id: source.owner_id,
      app_id: source.app_id,
      publisher_id: source.publisher_id,
      package_digest: source.package_digest,
      installation_id: source.installation_id,
      operation_id: context.operationId,
      capability,
      target_category: target.category,
      target_id: target.id,
      input_revision: target.inputRevision,
      outcome,
      error_code: errorCode,
      schema_version: 1,
      duration_ms: Math.max(0, Math.floor(durationMs)),
      item_count: itemCount,
    });
    assertContentFreeAudit(event);
    const { event_name: eventName, ...details } = event;
    this.audit(eventName, details);
  }

  private auditTarget(capability: string, input: unknown): { category: string; id: string | null; inputRevision: number | null } {
    const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const candidate = [
      value.record_id,
      value.fact_record_id,
      value.definition_record_id,
      value.artifact_revision_id,
      value.queried_operation_id,
      value.current_definition_record_id,
      value.target_definition_revision_id,
    ].find((item) => OpaqueIdSchema.safeParse(item).success);
    const revision = typeof value.expected_revision === "number" && Number.isSafeInteger(value.expected_revision) && value.expected_revision > 0
      ? value.expected_revision
      : null;
    return { category: capability.split(".").slice(0, 2).join("_"), id: typeof candidate === "string" ? candidate : null, inputRevision: revision };
  }

  private isMutation(capability: string): boolean {
    return ["career.facts.propose", "career.facts.confirm", "resume.definitions.write", "resume.jobs.write", "resume.artifacts.register"].includes(capability);
  }

  private auditOutcome(error: ResumeDomainError): "denied" | "cancelled" | "conflict" | "failed" {
    if (error.code === "denied" || error.code === "not_found_within_scope") return "denied";
    if (error.code === "cancelled") return "cancelled";
    if (error.code === "conflict" || error.code === "idempotency_conflict") return "conflict";
    return "failed";
  }
}
