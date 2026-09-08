import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MODERN_FIXTURE_VERSION } from "../app-platform/lifecycle/fixture-repository.js";
import { createDockerAppLifecycle } from "../app-platform/lifecycle/bootstrap.js";
import { AppMcpHost } from "../app-platform/mcp-host/app-host.js";
import { ResumeAppHostAdapter } from "../app-platform/mcp-host/resume-host-adapter.js";

type AuditRow = { event: string; details: Record<string, unknown> };
type WorkspaceResource = { resource_id: string; content_digest: string; prompt_inclusion: string };
type WorkspaceDocument = { document_id: string; data_binding_id: string | null };

const requireResource = process.argv.includes("--require-resource");
const root = await mkdtemp(path.join(os.tmpdir(), "bd-phase0-instrumentation-"));
const audits: AuditRow[] = [];
let host: AppMcpHost | null = null;
let lifecycle: Awaited<ReturnType<typeof createDockerAppLifecycle>> | null = null;

try {
  lifecycle = await createDockerAppLifecycle({
    memoryRoot: path.join(root, "memory"),
    stateRoot: path.join(root, "host"),
    hostVersion: "26.7.23",
  });
  await lifecycle.install({
    version: MODERN_FIXTURE_VERSION,
    idempotencyKey: "phase0-instrumentation-install",
    approveCapabilities: true,
  });

  host = new AppMcpHost(new ResumeAppHostAdapter(lifecycle, {
    audit: (event, details) => audits.push({ event, details: sanitizeAudit(details) }),
  }));

  const launch = await host.launchChatWorkspace();
  const resources = launch.workspace.resources.filter(isWorkspaceResource);
  const documents = launch.workspace.documents.filter(isWorkspaceDocument);
  if (requireResource && resources.length === 0) {
    throw new Error("Expected at least one digest-bound app-chat workspace resource");
  }

  const resourceReads = [];
  for (const resource of resources) {
    const read = await host.readAppResource(launch.session.session_id, resource.resource_id);
    if (read.content_digest !== resource.content_digest) {
      throw new Error(`Resource digest mismatch for ${resource.resource_id}`);
    }
    resourceReads.push({
      resource_id: read.resource_id,
      prompt_inclusion: read.prompt_inclusion,
      byte_length: Buffer.byteLength(read.content, "utf8"),
      content_digest: read.content_digest,
    });
  }

  for (const document of documents.filter((candidate) => candidate.data_binding_id)) {
    await host.readAppDocument(launch.session.session_id, document.document_id);
  }

  const modelContext = await host.buildChatWorkspaceModelContext({
    metadata_version: 1,
    app_id: launch.session.app_id,
    installation_id: launch.session.installation_id,
    package_digest: launch.session.package_digest,
    session_id: launch.session.session_id,
    view_id: launch.session.view_id,
    operation_id: launch.session.operation_id,
    session_generation: launch.session.session_generation,
    presentation_id: launch.session.presentation_id,
    workspace_id: launch.session.workspace_id,
    context_grant_set_digest: launch.session.context_grant_set_digest,
  });
  if (requireResource && !modelContext.evidence.resources.some((resource) => resource.included)) {
    throw new Error("Expected at least one resource included in model context evidence");
  }

  console.log(JSON.stringify({
    evidence_contract_version: 1,
    check: "phase0-app-chat-workspace-instrumentation",
    status: "passed",
    app_id: launch.session.app_id,
    package_digest: launch.session.package_digest,
    presentation_id: launch.session.presentation_id,
    workspace_id: launch.session.workspace_id,
    context_grant_set_digest: launch.session.context_grant_set_digest,
    document_count: documents.length,
    resource_count: resources.length,
    resource_reads: resourceReads,
    model_context: {
      resource_rows: modelContext.evidence.resources,
      action_rows: modelContext.evidence.action_exposure,
      tool_count: modelContext.tools.length,
      prompt_context_bytes: Buffer.byteLength(modelContext.prompt_context, "utf8"),
    },
    audits: audits.map((row) => ({
      event: row.event,
      detail_keys: Object.keys(row.details).sort(),
      outcome: typeof row.details.outcome === "string" ? row.details.outcome : null,
    })),
    content_free: true,
  }, null, 2));
} finally {
  await host?.closeAll().catch(() => undefined);
  await lifecycle?.dependencies.supervisor.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

function isWorkspaceResource(value: unknown): value is WorkspaceResource {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as WorkspaceResource).resource_id === "string"
    && typeof (value as WorkspaceResource).content_digest === "string"
    && typeof (value as WorkspaceResource).prompt_inclusion === "string";
}

function isWorkspaceDocument(value: unknown): value is WorkspaceDocument {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as WorkspaceDocument).document_id === "string"
    && ((value as WorkspaceDocument).data_binding_id === null || typeof (value as WorkspaceDocument).data_binding_id === "string");
}

function sanitizeAudit(details: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "app_id",
    "installation_id",
    "package_digest",
    "view_id",
    "operation_id",
    "presentation_id",
    "workspace_id",
    "lifecycle_generation",
    "grant_revision",
    "revocation_generation",
    "context_grant_set_digest",
    "context_count",
    "reconnect_outcome",
    "outcome",
  ];
  return Object.fromEntries(allowed.filter((key) => key in details).map((key) => [key, details[key]]));
}
