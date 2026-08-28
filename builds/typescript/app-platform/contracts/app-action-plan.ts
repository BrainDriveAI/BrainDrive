import { z } from "zod";

import {
  AppArtifactSafeMediaTypeSchema,
  AppExportDestinationIntentSchema,
} from "./app-artifacts.js";
import {
  AppDocumentMediaTypeSchema,
  AppStorageRetentionClassSchema,
} from "./app-storage.js";
import {
  CapabilityIdentifierSchema,
  HostBindingIdSchema,
} from "./app-registry.js";
import {
  OpaqueIdSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from "./common.js";

const StepIdSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/);

const ActionPlanCapabilityStepSchema = z
  .object({
    step_id: StepIdSchema,
    type: z.literal("capability.call"),
    capability: CapabilityIdentifierSchema,
    capability_version: z.number().int().positive().max(65_535),
    input: z.unknown(),
    owner_confirmation: z.enum(["inherit", "none"]).default("inherit"),
  })
  .strict();

const ActionPlanDocumentWriteStepSchema = z
  .object({
    step_id: StepIdSchema,
    type: z.literal("document.write"),
    document_id: HostBindingIdSchema,
    expected_revision: z.enum(["current", "none"]),
    media_type: AppDocumentMediaTypeSchema.optional(),
    retention_class: AppStorageRetentionClassSchema.optional(),
    content: z.unknown(),
  })
  .strict();

const ActionPlanDocumentReadStepSchema = z
  .object({
    step_id: StepIdSchema,
    type: z.literal("document.read"),
    document_id: HostBindingIdSchema,
  })
  .strict();

const ActionPlanExportPrepareStepSchema = z
  .object({
    step_id: StepIdSchema,
    type: z.literal("export.prepare"),
    source: z
      .object({
        kind: z.enum(["app_document", "app_operation", "runtime_output"]),
        source_id: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_.:@-]+$/),
      })
      .strict(),
    content_digest: Sha256DigestSchema,
    content_size_bytes: z.number().int().positive().max(2_097_152),
    retention_class: AppStorageRetentionClassSchema,
    media_type: AppArtifactSafeMediaTypeSchema,
    filename: z.string().min(1).max(256).regex(/^[^/\\\u0000-\u001f\u007f]+$/),
    destination_intent: AppExportDestinationIntentSchema,
    overwrite_confirmed: z.boolean(),
    bytes_base64: z.string().min(1).max(2_796_204).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();

export const AppActionPlanStepSchema = z.discriminatedUnion("type", [
  ActionPlanCapabilityStepSchema,
  ActionPlanDocumentReadStepSchema,
  ActionPlanDocumentWriteStepSchema,
  ActionPlanExportPrepareStepSchema,
]);

export const AppActionPlanFinalResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("step_result"), step_id: StepIdSchema }).strict(),
  z.object({ kind: z.literal("literal"), value: z.unknown() }).strict(),
]);

export const AppActionPlanDocumentSnapshotSchema = z
  .object({
    document_id: HostBindingIdSchema,
    document_binding_id: HostBindingIdSchema,
    media_type: AppDocumentMediaTypeSchema,
    revision: z.number().int().positive(),
    revision_id: OpaqueIdSchema,
    content: z.unknown(),
  })
  .strict();

export const AppActionPlanRequestSchema = z
  .object({
    action_planning_contract_version: z.literal(1),
    action_id: HostBindingIdSchema,
    action_input: z.unknown(),
    owner_confirmed: z.boolean(),
    operation_id: OpaqueIdSchema,
    idempotency_key: z.string().min(16).max(256),
    occurred_at: TimestampSchema,
    session: z
      .object({
        session_id: OpaqueIdSchema,
        view_id: OpaqueIdSchema,
        app_id: z.string().min(3).max(128),
        installation_id: OpaqueIdSchema,
      })
      .strict(),
    documents: z.array(AppActionPlanDocumentSnapshotSchema).max(16),
  })
  .strict();

export const AppActionExecutionPlanSchema = z
  .object({
    action_plan_version: z.literal(1),
    action_id: HostBindingIdSchema,
    steps: z.array(AppActionPlanStepSchema).min(1).max(16),
    final_result: AppActionPlanFinalResultSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const stepIds = value.steps.map((step) => step.step_id);
    if (new Set(stepIds).size !== stepIds.length) {
      context.addIssue({ code: "custom", path: ["steps"], message: "duplicate step identity" });
    }
    if (value.final_result?.kind === "step_result" && !stepIds.includes(value.final_result.step_id)) {
      context.addIssue({ code: "custom", path: ["final_result", "step_id"], message: "final result must reference a declared step" });
    }
  });

export type AppActionPlanRequest = z.infer<typeof AppActionPlanRequestSchema>;
export type AppActionExecutionPlan = z.infer<typeof AppActionExecutionPlanSchema>;
export type AppActionPlanStep = z.infer<typeof AppActionPlanStepSchema>;
