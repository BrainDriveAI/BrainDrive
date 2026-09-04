import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { executeAppActionPlan } from "./app-action-plan-executor.js";

function digestBytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function executionInput(bytes: Buffer, resolverBytes = bytes) {
  const prepareExport = vi.fn(async (request: unknown) => ({
    result_version: 1,
    status: "prepared",
    request,
  }));
  const resolveRuntimeExportBytes = vi.fn(async () => resolverBytes);
  return {
    rawPlan: {
      action_plan_version: 1,
      action_id: "resume.export.pdf.request",
      steps: [{
        step_id: "prepare-pdf-export",
        type: "export.prepare",
        source: { kind: "app_document", source_id: "resume.document" },
        content_digest: digestBytes(bytes),
        content_size_bytes: bytes.length,
        retention_class: "durable_owner_data",
        media_type: "application/pdf",
        filename: "resume.pdf",
        destination_intent: "new_download",
        overwrite_confirmed: false,
        bytes_reference: {
          kind: "runtime_http",
          export_id: "47efb901-eab8-49d1-a185-3f6e8a5f4056",
        },
      }],
    },
    action: {
      action_id: "resume.export.pdf.request",
      kind: "export",
      required_capabilities: [],
    },
    session: {
      appId: "ai.braindrive.resume-builder",
      installationId: "47efb901-eab8-49d1-a185-3f6e8a5f4056",
      packageDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      sessionId: "47efb901-eab8-49d1-a185-3f6e8a5f4057",
      viewId: "47efb901-eab8-49d1-a185-3f6e8a5f4058",
      lifecycleGeneration: 1,
      grantId: "47efb901-eab8-49d1-a185-3f6e8a5f4059",
      grantRevision: 1,
      revocationGeneration: 0,
    },
    workspace: { documents: [] },
    grant: {},
    storedPackage: {},
    manifestRequests: {},
    requestedPurposes: [],
    operationId: "47efb901-eab8-49d1-a185-3f6e8a5f4060",
    idempotencyKey: "reference-export-executor-test-key",
    ownerConfirmed: true,
    now: () => Date.now(),
    capabilityDispatcher: { execute: vi.fn() },
    documentStorage: {},
    artifactExports: { prepareExport },
    resolveRuntimeExportBytes,
    storageAuthority: {},
    artifactAuthority: {},
    audit: vi.fn(),
  } as any;
}

describe("executeAppActionPlan", () => {
  it("resolves a runtime export reference before preparing the export", async () => {
    const bytes = Buffer.from("%PDF-1.4\nreference export\n", "utf8");
    const input = executionInput(bytes);

    const result = await executeAppActionPlan(input);

    expect(input.resolveRuntimeExportBytes).toHaveBeenCalledWith({
      kind: "runtime_http",
      export_id: "47efb901-eab8-49d1-a185-3f6e8a5f4056",
    }, expect.objectContaining({
      contentDigest: digestBytes(bytes),
      contentSizeBytes: bytes.length,
      mediaType: "application/pdf",
      filename: "resume.pdf",
    }));
    expect(input.artifactExports.prepareExport).toHaveBeenCalledWith(expect.objectContaining({
      bytes_base64: bytes.toString("base64"),
    }));
    expect(result).toMatchObject({ status: "prepared" });
  });

  it("rejects a runtime export reference when the resolved bytes do not match the plan", async () => {
    const bytes = Buffer.from("%PDF-1.4\nreference export\n", "utf8");
    const input = executionInput(bytes, Buffer.from("%PDF-1.4\ntampered\n", "utf8"));

    await expect(executeAppActionPlan(input)).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(input.artifactExports.prepareExport).not.toHaveBeenCalled();
  });
});
