import { describe, expect, it } from "vitest";

import { AppActionExecutionPlanSchema } from "./app-action-plan.js";

const baseExportStep = {
  step_id: "prepare-export",
  type: "export.prepare",
  source: { kind: "app_document", source_id: "resume.document" },
  content_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  content_size_bytes: 14,
  retention_class: "durable_owner_data",
  media_type: "application/pdf",
  filename: "resume.pdf",
  destination_intent: "new_download",
  overwrite_confirmed: false,
} as const;

function planWithStep(step: Record<string, unknown>) {
  return {
    action_plan_version: 1,
    action_id: "resume.export.pdf.request",
    steps: [step],
  };
}

describe("AppActionExecutionPlanSchema", () => {
  it("accepts an export prepare step with inline bytes", () => {
    expect(() => AppActionExecutionPlanSchema.parse(planWithStep({
      ...baseExportStep,
      bytes_base64: Buffer.from("%PDF-1.4\n", "utf8").toString("base64"),
    }))).not.toThrow();
  });

  it("accepts an export prepare step with a runtime bytes reference", () => {
    expect(() => AppActionExecutionPlanSchema.parse(planWithStep({
      ...baseExportStep,
      bytes_reference: {
        kind: "runtime_http",
        export_id: "47efb901-eab8-49d1-a185-3f6e8a5f4056",
      },
    }))).not.toThrow();
  });

  it("rejects export prepare steps without exactly one bytes source", () => {
    expect(() => AppActionExecutionPlanSchema.parse(planWithStep(baseExportStep))).toThrow();
    expect(() => AppActionExecutionPlanSchema.parse(planWithStep({
      ...baseExportStep,
      bytes_base64: Buffer.from("%PDF-1.4\n", "utf8").toString("base64"),
      bytes_reference: {
        kind: "runtime_http",
        export_id: "47efb901-eab8-49d1-a185-3f6e8a5f4056",
      },
    }))).toThrow();
  });
});
