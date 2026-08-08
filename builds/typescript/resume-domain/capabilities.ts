import { z } from "zod";

import { CapabilityNameSchema } from "../app-platform/contracts/package.js";
import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import { CareerPlacementAdapter, type CareerReturnSummary } from "./career.js";
import { ResumeDomainError } from "./errors.js";
import { ResumeDomainService, type DataAuthority } from "./service.js";
import type { ResumeExportBroker } from "../resume-renderer/export-broker.js";

const ContextInputSchema = z.object({ entry_point: z.enum(["direct", "career"]) }).strict();
const ReadInputSchema = z.object({ record_id: z.string().uuid().optional() }).strict();
const DefinitionReadInputSchema = z.union([
  ReadInputSchema,
  z.object({ view: z.literal("workspace") }).strict(),
]);
const OperationInputSchema = z.object({ operation_id: z.string().uuid() }).strict();
const InterviewCapabilityInputSchema = z.object({ kind: z.literal("interview_progress"), progress: z.record(z.string(), z.unknown()) }).strict();
const DefinitionApprovalCapabilityInputSchema = z.object({ kind: z.literal("approve_definition"), definition_record_id: z.string().uuid(), expected_revision: z.number().int().positive() }).strict();

export type CapabilityExecutionContext = {
  grant: CapabilityGrant;
  operationId: string;
  idempotencyKey: string;
  hostOwnerConfirmed?: boolean;
  isCancelled?: () => boolean;
};

export class ResumeCapabilityRouter {
  constructor(
    public readonly domain: ResumeDomainService,
    public readonly career: CareerPlacementAdapter,
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
    private readonly exportBroker?: ResumeExportBroker,
  ) {}

  async execute(capabilityInput: unknown, input: unknown, context: CapabilityExecutionContext): Promise<unknown> {
    const capability = CapabilityNameSchema.parse(capabilityInput);
    if (!context.grant.capabilities.includes(capability)) throw new ResumeDomainError("denied", "Capability operation is not authorized", 403);
    const authority: DataAuthority = { grant: context.grant, capability, operationId: context.operationId, idempotencyKey: context.idempotencyKey, isCancelled: context.isCancelled };
    try {
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
          result = await this.domain.confirmFact(input, authority, context.hostOwnerConfirmed === true);
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
          result = await this.domain.store.operation(parsed.operation_id, context.grant.installation_id);
          break;
        }
        case "resume.export.request":
          if (!this.exportBroker) throw new ResumeDomainError("recoverable_internal_failure", "Resume preview is unavailable", 503);
          result = await this.exportBroker.preview(input, authority);
          break;
        case "app.inference.request":
          throw new ResumeDomainError("denied", "Inference is outside the Resume Builder data capability boundary", 403);
      }
      this.audit("app.capability.completed", { app_id: context.grant.app_id, installation_id: context.grant.installation_id, operation_id: context.operationId, capability, outcome: "committed", item_count: Array.isArray(result) ? result.length : 1 });
      return result;
    } catch (error) {
      this.audit("app.capability.completed", { app_id: context.grant.app_id, installation_id: context.grant.installation_id, operation_id: context.operationId, capability, outcome: "failed", error_code: error instanceof ResumeDomainError ? error.code : "invalid_input" });
      if (error instanceof z.ZodError) throw new ResumeDomainError("invalid_input", "Capability input failed schema validation", 400);
      throw error;
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
    if (recordId) return this.domain.store.readHead(recordId, authority.grant.record_scopes);
    return this.domain.readRecords(recordType, authority);
  }

  private async readDefinitions(input: z.infer<typeof DefinitionReadInputSchema>, authority: DataAuthority): Promise<unknown> {
    if ("record_id" in input && input.record_id) return this.domain.store.readHead(input.record_id, authority.grant.record_scopes);
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
}
