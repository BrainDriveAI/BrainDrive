import type { HostCapabilityRegistration } from "./registry.js";
import { AppInferenceDispatcher } from "../app-inference/dispatcher.js";
import { BriefApproveInputSchema, BriefApproveResultSchema, BriefDomainService, BriefEditInputSchema, BriefEditResultSchema, BriefGenerateCapabilityInputSchema, BriefGenerateCapabilityResultSchema, BriefReadInputSchema, BriefReadResultSchema } from "../brief-domain/service.js";

export function createBriefCapabilityRegistrations(service: BriefDomainService, inference: AppInferenceDispatcher): readonly HostCapabilityRegistration[] {
  const common = { appId: "ai.braindrive.brief-builder", version: 1, limits: { maxInputBytes: 65_536, maxDurationMs: 30_000, maxCallsPerMinute: 60 }, retryPolicy: "idempotent_only" as const, idempotencyPolicy: "required" as const, ownerComponentId: "brief.domain" };
  return Object.freeze([
    {
      ...common, name: "brief.records.read", audience: "app_data", effect: "read", inputSchema: BriefReadInputSchema, resultSchema: BriefReadResultSchema,
      confirmation: "none", confirmationProjection: null, auditProjectionId: "brief.records.read.audit.v1",
      handler: async () => service.reopen(),
    },
    {
      ...common, name: "brief.records.write", audience: "app_data", effect: "mutation", inputSchema: BriefEditInputSchema, resultSchema: BriefEditResultSchema,
      confirmation: "none", confirmationProjection: null, auditProjectionId: "brief.records.write.audit.v1",
      handler: async (input, context) => service.edit(input, context.idempotencyKey),
    },
    {
      ...common, name: "brief.approvals.confirm", audience: "app_data", effect: "mutation", inputSchema: BriefApproveInputSchema, resultSchema: BriefApproveResultSchema,
      confirmation: "owner_confirmation", confirmationProjection: { title: "Approve this brief?", actionLabel: "Approve brief" }, auditProjectionId: "brief.approvals.confirm.audit.v1",
      handler: async (input, context) => service.approve(input, { idempotencyKey: context.idempotencyKey, ownerConfirmed: context.ownerConfirmation.confirmed, proofId: context.ownerConfirmation.proofId }),
    },
    {
      ...common, name: "app.inference.request", audience: "app_inference", effect: "inference", inputSchema: BriefGenerateCapabilityInputSchema, resultSchema: BriefGenerateCapabilityResultSchema,
      confirmation: "none", confirmationProjection: null, auditProjectionId: "brief.generate.audit.v1", ownerComponentId: "brief.inference",
      handler: async (input, context) => {
        const inferenceContext = {
          appId: context.appId, installationId: context.installationId, packageDigest: context.packageDigest,
          requestedPurposes: context.requestedPurposes, grant: context.grant, operationId: context.operationId,
          idempotencyKey: context.idempotencyKey, deadlineAt: context.deadlineAt, signal: context.signal,
        };
        inference.authorize(input, inferenceContext);
        return service.generate(input, {
          operationId: context.operationId, idempotencyKey: context.idempotencyKey, signal: context.signal,
          executeInference: (request) => inference.execute(request, inferenceContext),
        });
      },
    },
  ]);
}
