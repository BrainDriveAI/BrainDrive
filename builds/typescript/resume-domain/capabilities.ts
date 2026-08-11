import { randomUUID } from "node:crypto";

import { z } from "zod";

import { assertContentFreeAudit, AuditEventSchema } from "../app-platform/contracts/audit.js";
import { OpaqueIdSchema } from "../app-platform/contracts/common.js";
import { JobEvidenceValueSchema } from "../app-platform/contracts/data.js";
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
  z.object({ kind: z.literal("remembered_match"), explicit_job_fact_revision_id: z.string().uuid().nullable(), description: z.string().max(512) }).strict(),
  z.object({ kind: z.literal("compare_definitions"), left_revision_id: z.string().uuid(), right_revision_id: z.string().uuid(), left_expected_revision: z.number().int().positive().optional(), right_expected_revision: z.number().int().positive().optional() }).strict(),
  z.object({ kind: z.literal("impact_analysis"), source_definition_revision_id: z.string().uuid(), changed_fact_revision_ids: z.array(z.string().uuid()).max(500) }).strict(),
]);
const OperationInputSchema = z.object({ queried_operation_id: z.string().uuid() }).strict();
const InterviewCapabilityInputSchema = z.object({ kind: z.literal("interview_progress"), progress: z.record(z.string(), z.unknown()) }).strict();
const InterviewTurnCapabilityInputSchema = z.object({
  kind: z.literal("interview_turn"),
  turn: z.record(z.string(), z.unknown()),
  sensitivity: z.enum(["standard", "sensitive", "highly_sensitive"]),
  linked_confirmed_fact_revision_id: z.string().uuid().nullable(),
}).strict();
const InterviewRecoverySaveCapabilityInputSchema = z.object({
  kind: z.literal("interview_recovery_save"),
  recovery: z.record(z.string(), z.unknown()),
}).strict();
const InterviewRecoveryDiscardCapabilityInputSchema = z.object({
  kind: z.literal("interview_recovery_discard"),
  progress: z.record(z.string(), z.unknown()),
}).strict();
const InterviewProgressSubmitCapabilityInputSchema = z.object({
  kind: z.literal("interview_progress_submit"),
  progress: z.record(z.string(), z.unknown()),
}).strict();
const DefinitionApprovalCapabilityInputSchema = z.object({ kind: z.literal("approve_definition"), definition_record_id: z.string().uuid(), expected_revision: z.number().int().positive() }).strict();
const RevisionRequestCapabilityInputSchema = z.object({ kind: z.literal("revision_request"), source_definition_revision_id: z.string().uuid(), target: z.object({ scope: z.enum(["statement", "section", "resume"]), target_id: z.string().min(1).max(256).nullable() }).strict(), request_text: z.string().min(1).max(8_192) }).strict();
const RevisionOutcomeCapabilityInputSchema = z.object({ kind: z.literal("revision_outcome"), request_record_id: z.string().uuid(), expected_revision: z.number().int().positive(), classification: z.enum(["presentation", "factual", "mixed", "ambiguous"]).nullable(), state: z.enum(["submitted", "clarification_needed", "awaiting_confirmation", "generating", "proposed", "accepted", "edited", "rejected", "regenerate", "failed"]), clarification: z.string().max(2_048).nullable(), resulting_definition_revision_id: z.string().uuid().nullable(), owner_outcome: z.enum(["accept", "edit", "reject", "regenerate"]).nullable() }).strict();
const RevisionProposalCapabilityInputSchema = z.object({
  kind: z.literal("revision_proposal"),
  request_record_id: z.string().uuid(),
  expected_revision: z.number().int().positive(),
  draft: z.record(z.string(), z.unknown()),
  owner_outcome: z.literal("edit").nullable().optional(),
}).strict();

export type CapabilityExecutionContext = {
  authority: RestrictedCapabilityAuthority;
  operationId: string;
  correlationId: string;
  idempotencyKey: string;
  connectionId?: string;
  viewId?: string | null;
  ownerDecision?: HostOwnerDecisionEvidence;
  hostOwnerConfirmed?: boolean;
  isCancelled?: () => boolean;
  idempotencyDecision?: "created" | "resumed" | "reused" | "conflict";
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
      grant = await this.policy.authorize(capability, context.authority, context.operationId, {
        connectionId: context.connectionId,
        viewId: context.viewId,
      });
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
          const interviewTurn = InterviewTurnCapabilityInputSchema.safeParse(input);
          const recoverySave = InterviewRecoverySaveCapabilityInputSchema.safeParse(input);
          const recoveryDiscard = InterviewRecoveryDiscardCapabilityInputSchema.safeParse(input);
          const progressSubmit = InterviewProgressSubmitCapabilityInputSchema.safeParse(input);
          const approval = DefinitionApprovalCapabilityInputSchema.safeParse(input);
          const revisionRequest = RevisionRequestCapabilityInputSchema.safeParse(input);
          const revisionOutcome = RevisionOutcomeCapabilityInputSchema.safeParse(input);
          const revisionProposal = RevisionProposalCapabilityInputSchema.safeParse(input);
          result = recoverySave.success
            ? await this.domain.saveInterviewRecovery(recoverySave.data.recovery, authority)
            : recoveryDiscard.success
              ? await this.domain.discardInterviewRecovery(recoveryDiscard.data.progress, authority)
              : progressSubmit.success
                ? await this.domain.submitInterviewProgress(progressSubmit.data.progress, authority)
          : interviewTurn.success
            ? await this.domain.recordInterviewTurn(interviewTurn.data, authority)
            : interview.success
            ? await this.domain.saveInterviewProgress(interview.data.progress, authority)
            : revisionRequest.success
              ? await this.domain.submitRevisionRequest(revisionRequest.data, authority)
              : revisionProposal.success
                ? await this.domain.createRevisionProposal(revisionProposal.data, authority, context.hostOwnerConfirmed === true)
              : revisionOutcome.success
                ? await this.domain.recordRevisionOutcome(revisionOutcome.data, authority, context.hostOwnerConfirmed === true)
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
      this.emitAudit(
        capability,
        context,
        grant,
        input,
        this.isMutation(capability) ? "committed" : "allowed",
        null,
        Date.now() - startedAt,
        Array.isArray(result) ? result.length : 1,
        this.resultWasReused(result) ? "reused" : context.idempotencyDecision ?? "created",
        result,
      );
      return result;
    } catch (error) {
      const failure = error instanceof ResumeDomainError
        ? error
        : error instanceof z.ZodError
          ? new ResumeDomainError("invalid_input", "Capability input failed schema validation", 400)
          : new ResumeDomainError("recoverable_internal_failure", "Resume Builder data operation failed safely", 500);
      this.emitAudit(capability, context, grant, input, this.auditOutcome(failure), failure.code, Date.now() - startedAt, null, "created", undefined);
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
    if ("kind" in input && input.kind === "remembered_match") {
      const { kind: _kind, ...matchInput } = input;
      return this.domain.matchRememberedJob(matchInput, authority);
    }
    if ("kind" in input && input.kind === "compare_definitions") {
      const { kind: _kind, ...comparisonInput } = input;
      return this.domain.compareDefinitions(comparisonInput, authority);
    }
    if ("kind" in input && input.kind === "impact_analysis") {
      const { kind: _kind, ...impactInput } = input;
      return this.domain.analyzeImpact(impactInput, authority);
    }
    if ("record_id" in input && input.record_id) {
      const record = await this.domain.store.readHead(input.record_id, authority.grant.record_scopes);
      if (record.record_type !== "resume_definition" && record.record_type !== "tailored_variant") {
        throw new ResumeDomainError("not_found_within_scope", "Record was not found within the granted scope", 404);
      }
      return record;
    }
    if ("view" in input) {
      const [definitions, allHistory, variants, artifacts, exports, interview, jobs, revisionRequests] = await Promise.all([
        this.domain.store.list("resume_definition", authority.grant.record_scopes),
        this.domain.store.allRevisions(authority.grant.record_scopes),
        this.domain.store.list("tailored_variant", authority.grant.record_scopes),
        this.domain.store.list("artifact", authority.grant.record_scopes),
        this.domain.store.list("export_receipt", authority.grant.record_scopes),
        this.domain.store.list("interview_progress", authority.grant.record_scopes),
        this.domain.store.list("job_description", authority.grant.record_scopes),
        this.domain.store.list("resume_revision_request", authority.grant.record_scopes),
      ]);
      return {
        workspace_version: 2,
        definitions,
        definition_history: allHistory.filter((record) => record.record_type === "resume_definition"),
        variants,
        artifacts,
        exports,
        interview,
        jobs,
        job_history: allHistory.filter((record) => record.record_type === "job_description"),
        revision_requests: revisionRequests,
      };
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
    idempotencyDecision: "created" | "resumed" | "reused" | "conflict" = "created",
    result?: unknown,
  ): void {
    const binding = RestrictedCapabilityAuthoritySchema.safeParse(context.authority);
    if (!binding.success || !OpaqueIdSchema.safeParse(context.correlationId).success) return;
    const source = grant ?? binding.data.context;
    const target = this.auditTarget(capability, input);
    const eventName = this.recoveryAuditEvent(capability, input, outcome, result);
    if (eventName === null) return;
    const event = AuditEventSchema.parse({
      event_version: 1,
      event_id: randomUUID(),
      event_name: eventName,
      occurred_at: new Date().toISOString(),
      correlation_id: context.correlationId,
      actor_id: source.actor_id,
      owner_id: source.owner_id,
      app_id: source.app_id,
      publisher_id: source.publisher_id,
      package_digest: source.package_digest,
      installation_id: source.installation_id,
      connection_id: binding.data.connection_id,
      view_id: binding.data.view_id,
      operation_id: context.operationId,
      capability,
      capability_version: 1,
      grant_revision: binding.data.grant_revision,
      revocation_generation: binding.data.revocation_generation,
      idempotency_decision: idempotencyDecision,
      target_category: target.category,
      target_id: target.id,
      input_revision: target.inputRevision,
      outcome,
      error_code: errorCode,
      schema_version: 1,
      duration_ms: Math.max(0, Math.floor(durationMs)),
      item_count: itemCount,
      ...this.interviewAuditDetails(eventName, input, result),
    });
    assertContentFreeAudit(event);
    const { event_name: emittedEventName, ...details } = event;
    this.audit(emittedEventName, details);
  }

  private resultWasReused(result: unknown): boolean {
    return Boolean(result && typeof result === "object" && !Array.isArray(result) && (result as { reused?: unknown }).reused === true);
  }

  private auditTarget(capability: string, input: unknown): { category: string; id: string | null; inputRevision: number | null } {
    const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const nested = value.kind === "interview_recovery_save"
      ? value.recovery
      : value.kind === "interview_recovery_discard" || value.kind === "interview_progress_submit"
        ? value.progress
        : null;
    const nestedValue = nested && typeof nested === "object" && !Array.isArray(nested) ? nested as Record<string, unknown> : {};
    const candidate = [
      value.record_id,
      nestedValue.record_id,
      value.fact_record_id,
      value.definition_record_id,
      value.artifact_revision_id,
      value.queried_operation_id,
      value.current_definition_record_id,
      value.target_definition_revision_id,
      value.source_definition_revision_id,
      value.request_record_id,
      value.explicit_job_fact_revision_id,
    ].find((item) => OpaqueIdSchema.safeParse(item).success);
    const expectedRevision = value.expected_revision ?? nestedValue.expected_revision;
    const revision = typeof expectedRevision === "number" && Number.isSafeInteger(expectedRevision) && expectedRevision > 0
      ? expectedRevision
      : null;
    const category = typeof value.kind === "string" && value.kind.startsWith("interview_recovery_") ? "resume_recovery" : capability.split(".").slice(0, 2).join("_");
    return { category, id: typeof candidate === "string" ? candidate : null, inputRevision: revision };
  }

  private recoveryAuditEvent(capability: string, input: unknown, outcome: string, result: unknown): z.infer<typeof AuditEventSchema>["event_name"] | null {
    const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const resultValue = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
    const resultFact = resultValue.fact && typeof resultValue.fact === "object" && !Array.isArray(resultValue.fact) ? resultValue.fact as Record<string, unknown> : {};
    if (capability === "resume.definitions.read" && value.kind === "remembered_match") return "app.resume_remembered.match";
    if (capability === "resume.definitions.read" && value.kind === "impact_analysis") return "app.resume_impact.analyzed";
    if (capability === "resume.definitions.read" && value.kind === "compare_definitions") return "app.resume_comparison.completed";
    if (capability === "resume.definitions.write" && value.kind === "revision_request") return "app.resume_revision.submitted";
    if (capability === "resume.definitions.write" && value.kind === "revision_proposal") return "app.resume_revision.proposed";
    if (capability === "resume.definitions.write" && value.kind === "revision_outcome") {
      return ["accepted", "edited", "rejected", "regenerate"].includes(String(value.state))
        ? "app.resume_revision.outcome"
        : "app.resume_revision.classified";
    }
    const successorContext = value.successor_context && typeof value.successor_context === "object" && !Array.isArray(value.successor_context)
      ? value.successor_context as Record<string, unknown>
      : {};
    if (capability === "resume.definitions.write" && successorContext.kind === "remembered_information") return "app.resume_remembered.successor";
    if (resultFact.fact_kind === "job_evidence" && resultFact.state === "confirmed") return "app.resume_interview.question_outcome";
    if (value.kind === "interview_progress" || value.kind === "interview_progress_submit") {
      const progress = value.progress && typeof value.progress === "object" && !Array.isArray(value.progress) ? value.progress as Record<string, unknown> : {};
      if (progress.active_job_fact_revision_id && progress.job_dimension && progress.selection_method) return "app.resume_interview.question_selected";
    }
    if (value.kind === "interview_recovery_save") return outcome === "conflict" ? "app.resume_recovery.conflict" : "app.resume_recovery.save";
    if (value.kind === "interview_recovery_discard") return outcome === "conflict" ? "app.resume_recovery.conflict" : "app.resume_recovery.discard";
    if (capability === "resume.definitions.read" && value.view === "workspace") {
      const interview = result && typeof result === "object" && !Array.isArray(result) ? (result as { interview?: unknown }).interview : null;
      if (Array.isArray(interview) && interview.some((record) => record && typeof record === "object" && (record as { recovery_draft?: unknown }).recovery_draft)) {
        return "app.resume_recovery.restore";
      }
    }
    return "app.capability.completed";
  }

  private interviewAuditDetails(eventName: z.infer<typeof AuditEventSchema>["event_name"], input: unknown, result: unknown): Record<string, unknown> {
    if (eventName.startsWith("app.resume_revision.")) {
      const rawInput = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
      const rawResult = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
      const request = rawResult.request && typeof rawResult.request === "object" && !Array.isArray(rawResult.request) ? rawResult.request as Record<string, unknown> : {};
      const target = request.target && typeof request.target === "object" && !Array.isArray(request.target) ? request.target as Record<string, unknown> : rawInput.target && typeof rawInput.target === "object" && !Array.isArray(rawInput.target) ? rawInput.target as Record<string, unknown> : {};
      const draft = rawInput.draft && typeof rawInput.draft === "object" && !Array.isArray(rawInput.draft) ? rawInput.draft as Record<string, unknown> : {};
      return {
        revision_classification: request.classification ?? rawInput.classification ?? null,
        revision_state: request.state ?? rawInput.state ?? null,
        revision_scope: target.scope ?? null,
        attempt: request.attempt ?? null,
        change_count: Array.isArray(draft.changed_statement_ids) ? draft.changed_statement_ids.length : null,
      };
    }
    if (eventName === "app.resume_comparison.completed") {
      const rawInput = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
      const value = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
      const leftRevision = OpaqueIdSchema.safeParse(rawInput.left_revision_id);
      const rightRevision = OpaqueIdSchema.safeParse(rawInput.right_revision_id);
      return {
        left_definition_revision_id: leftRevision.success ? leftRevision.data : null,
        right_definition_revision_id: rightRevision.success ? rightRevision.data : null,
        left_definition_digest: value.left_digest ?? null,
        right_definition_digest: value.right_digest ?? null,
        comparison_relation: value.relation ?? null,
        comparison_result: value.result ?? null,
        added_count: Array.isArray(value.added) ? value.added.length : null,
        removed_count: Array.isArray(value.removed) ? value.removed.length : null,
        changed_count: Array.isArray(value.changed) ? value.changed.length : null,
        moved_count: Array.isArray(value.moved) ? value.moved.length : null,
        evidence_change_count: Array.isArray(value.evidence_changed) ? value.evidence_changed.length : null,
      };
    }
    if (eventName === "app.resume_remembered.match") {
      const value = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
      const matches = Array.isArray(value.matches) ? value.matches : [];
      const first = matches[0] && typeof matches[0] === "object" && !Array.isArray(matches[0]) ? matches[0] as Record<string, unknown> : {};
      return {
        match_method: value.method ?? null,
        result_class: value.result_class ?? null,
        fact_revision_id: matches.length === 1 ? first.fact_revision_id ?? null : null,
        change_count: null,
        variant_count: null,
      };
    }
    if (eventName === "app.resume_impact.analyzed") {
      const value = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
      return {
        definition_revision_id: value.source_definition_revision_id ?? null,
        change_count: Array.isArray(value.affected_statements) ? value.affected_statements.length : null,
        variant_count: Array.isArray(value.stale_tailored_variants) ? value.stale_tailored_variants.length : null,
      };
    }
    if (eventName === "app.resume_remembered.successor") {
      const value = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
      const definition = value.definition && typeof value.definition === "object" && !Array.isArray(value.definition) ? value.definition as Record<string, unknown> : {};
      const metadata = definition.metadata && typeof definition.metadata === "object" && !Array.isArray(definition.metadata) ? definition.metadata as Record<string, unknown> : {};
      const rawInput = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
      const context = rawInput.successor_context && typeof rawInput.successor_context === "object" && !Array.isArray(rawInput.successor_context) ? rawInput.successor_context as Record<string, unknown> : {};
      return {
        definition_revision_id: metadata.revision_id ?? null,
        change_count: Array.isArray(context.changed_fact_revision_ids) ? context.changed_fact_revision_ids.length : null,
        variant_count: Array.isArray(context.stale_tailored_variant_revision_ids) ? context.stale_tailored_variant_revision_ids.length : null,
      };
    }
    if (eventName === "app.resume_interview.question_selected") {
      const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
      const progress = value.progress && typeof value.progress === "object" && !Array.isArray(value.progress) ? value.progress as Record<string, unknown> : {};
      return {
        job_revision_id: progress.active_job_fact_revision_id ?? null,
        job_dimension: progress.job_dimension ?? null,
        selection_method: progress.selection_method ?? null,
        question_outcome: null,
      };
    }
    if (eventName === "app.resume_interview.question_outcome") {
      const value = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
      const fact = value.fact && typeof value.fact === "object" && !Array.isArray(value.fact) ? value.fact as Record<string, unknown> : {};
      let parsed: ReturnType<typeof JobEvidenceValueSchema.safeParse> | null = null;
      if (typeof fact.value === "string") {
        try { parsed = JobEvidenceValueSchema.safeParse(JSON.parse(fact.value)); } catch { parsed = null; }
      }
      if (!parsed?.success) return {};
      return {
        job_revision_id: parsed.data.job_fact_revision_id,
        job_dimension: parsed.data.dimension === "identity" ? null : parsed.data.dimension,
        selection_method: null,
        question_outcome: parsed.data.outcome,
      };
    }
    return {};
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
