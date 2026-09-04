import Fastify from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthContext, PermissionSet } from "../../contracts.js";
import { createBriefCapabilityRegistrations } from "../../app-capabilities/brief-registry.js";
import type { AppInferenceDispatcher } from "../../app-inference/dispatcher.js";
import { BriefDataLifecycleAdapter } from "../../brief-domain/lifecycle.js";
import { BriefDomainService } from "../../brief-domain/service.js";
import { BriefDataStore } from "../../brief-domain/store.js";
import { ToolExecutor } from "../../engine/tool-executor.js";
import type { ResumeCapabilityRouter } from "../../resume-domain/capabilities.js";
import { preserveMcpResult } from "../../mcp/result-envelope.js";
import type { GenericPackageManifest } from "../contracts/app-registry.js";
import { canonicalInputDigest } from "../contracts/common.js";
import { createSyntheticFirstPartyFixtureRepository, MODERN_FIXTURE_VERSION } from "../lifecycle/fixture-repository.js";
import { createLifecycleHarness } from "../lifecycle/test-helpers.js";
import { AppMcpHost, type AppChatWorkspaceLaunch } from "./app-host.js";
import { BriefAppHostAdapter } from "./brief-host-adapter.js";
import { registerAppMcpHostRoutes } from "./routes.js";
import { ResumeAppHostAdapter } from "./resume-host-adapter.js";

const roots: string[] = [];

const permissions: PermissionSet = {
  memory_access: true,
  tool_access: true,
  system_actions: true,
  delegation: true,
  approval_authority: true,
  administration: true,
};

const ownerAuth: AuthContext = {
  actorId: "owner",
  actorType: "owner",
  mode: "local",
  permissions,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SCAF-007 self-contained installed app proof", () => {
  it("keeps production host source free of app-specific app-chat action schema, translation, and action ID branches", async () => {
    const files = await productionTypeScriptFiles([
      "app-platform/mcp-host",
      "app-capabilities",
      "app-inference",
      "gateway",
    ]);
    const banned = [
      /\bResumeChat(?:ProfileUpdate|Create)\w*Schema\b/,
      /\btranslateChatWorkspaceDataActionInput\b/,
      /\bexecuteAppOwnedResumeChatAction\b/,
      /\bbuildResume(?:ProfileUpdate|DefinitionWrite)Input\b/,
      /\brenderAppOwnedResumeMarkdownPdf\b/,
      /\binput_schema_id\s*:\s*["']resume\./,
      /\bresult_schema_id\s*:\s*["']resume\./,
      /\b(?:case|if)\b[^\n]*(?:actionId|action_id|action\.action_id)[^\n]*["']resume\.(?:profile\.(?:read|update)|create|state\.read|export\.pdf\.request)["']/,
      /\bbrief\.proof\.(?:read|write)\b/,
    ];
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const pattern of banned) {
        if (pattern.test(source)) violations.push(`${path.relative(process.cwd(), file)} matched ${pattern}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("creates Resume Profile and Resume through app-chat route launch, app document APIs, and descriptor tools", async () => {
    const resumeWriteResult = { definition: { metadata: { revision_id: randomUUID() } }, reused: false };
    const workspaceReadResult = emptyResumeWorkspaceResult();
    const router = fakeResumeRouter(async (capability: string, input: unknown) => capability === "resume.definitions.read" && (input as { view?: string }).view === "workspace"
      ? workspaceReadResult
      : resumeWriteResult);
    const host = await resumeProofHost(router);
    const app = routeApp(host);
    try {
      const launchResponse = await app.inject({ method: "POST", url: "/apps/resume-builder/chat-workspaces/launch", payload: {} });
      expect(launchResponse.statusCode).toBe(200);
      const launch = launchResponse.json() as AppChatWorkspaceLaunch;
      expect(launch).toMatchObject({
        kind: "chat_workspace",
        presentation: { type: "chat_workspace" },
        workspace: { workspace_id: "resume.chat" },
      });
      expect((launch.workspace.actions as Array<{ action_id: string }>).map((action) => action.action_id)).toContain("resume.create");
      expect(JSON.stringify(launch)).not.toMatch(/Bearer|authorization|secret|\/home\//i);

      const profileReadBefore = await app.inject({
        method: "GET",
        url: `/apps/resume-builder/chat-workspaces/sessions/${launch.session.session_id}/documents/resume.profile`,
      });
      expect(profileReadBefore.statusCode).toBe(200);
      expect(profileReadBefore.json()).toMatchObject({
        state: "current",
        document_id: "resume.profile",
        document_binding_id: "resume.profile.current",
        record: {
          revision: 1,
          media_type: "text/markdown",
          content: expect.stringContaining("# Resume Profile"),
        },
      });

      const documentOperationId = randomUUID();
      const profileWrite = await app.inject({
        method: "PUT",
        url: `/apps/resume-builder/chat-workspaces/sessions/${launch.session.session_id}/documents/resume.profile`,
        payload: {
          operation_id: documentOperationId,
          idempotency_key: `scaf-007-profile-doc-${documentOperationId}`,
          expected_revision: 1,
          media_type: "text/markdown",
          content: "# Maya Torres\nDirector of Product Operations.",
        },
      });
      expect(profileWrite.statusCode).toBe(200);
      expect(profileWrite.json()).toMatchObject({
        state: "current",
        document_id: "resume.profile",
        record: { revision: 2, content: "# Maya Torres\nDirector of Product Operations." },
      });

      const resumeDocument = await app.inject({
        method: "GET",
        url: `/apps/resume-builder/chat-workspaces/sessions/${launch.session.session_id}/documents/resume.document`,
      });
      expect(resumeDocument.statusCode).toBe(200);
      expect(resumeDocument.json()).toMatchObject({
        state: "current",
        document_id: "resume.document",
        document_binding_id: "resume.definition.current.general",
        record: {
          revision: 1,
          media_type: "text/markdown",
          content: expect.stringContaining("# Resume"),
        },
      });

      const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
      expect(model.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "app_action_resume_profile_read",
        "app_action_career_fact_propose",
        "app_action_career_fact_confirm",
        "app_action_resume_profile_update",
        "app_action_resume_create",
      ]));
      expect(model.tools.find((tool) => tool.name === "app_action_resume_profile_read")?.inputSchema).toMatchObject({
        properties: {
          action_input: {
            required: [],
            properties: {},
          },
        },
      });
      expect(model.prompt_context).toContain("resume.create");
      expect(model.prompt_context).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+|\/home\/|[A-Za-z]:\\/i);
      const executor = new ToolExecutor(model.tools);
      const readOperationId = randomUUID();
      const profileOperationId = randomUUID();
      const profileActionInput = {
        profile_markdown: "# Maya Torres\n\nProduct operations leader with launch and process improvement experience.",
        completed_topics: ["direction", "experience"],
        skipped_topics: [],
        current_topic: null,
      };
      const createOperationId = randomUUID();
      const resumeCreateTool = model.tools.find((tool) => tool.name === "app_action_resume_create");
      expect(resumeCreateTool?.inputSchema).toMatchObject({
        properties: {
          action_input: {
            required: [],
            properties: {
              locale: { type: "string" },
              page_intent: { type: "string" },
            },
          },
        },
      });
      expect(JSON.stringify(resumeCreateTool?.inputSchema)).not.toContain("resume_markdown");

      await expect(executor.execute(ownerAuth, toolContext(), "app_action_resume_profile_read", {
        action_input: {},
        operation_id: readOperationId,
        idempotency_key: `scaf-007-profile-read-${readOperationId}`,
      })).resolves.toMatchObject({
        status: "ok",
        output: {
          action_id: "resume.profile.read",
          operation_id: readOperationId,
          result: {
            result_version: 1,
            state: "current",
            document_id: "resume.profile",
            document_binding_id: "resume.profile.current",
            record: {
              revision: 2,
              content: "# Maya Torres\nDirector of Product Operations.",
            },
          },
        },
      });
      await expect(executor.execute(ownerAuth, toolContext(), "app_action_resume_profile_update", {
        action_input: profileActionInput,
        operation_id: profileOperationId,
        idempotency_key: `scaf-007-profile-action-${profileOperationId}`,
      })).resolves.toMatchObject({ status: "ok" });
      await expect(executor.execute(ownerAuth, toolContext(), "app_action_resume_create", {
        action_input: {},
        operation_id: createOperationId,
        idempotency_key: `scaf-007-resume-create-${createOperationId}`,
      })).resolves.toMatchObject({
        status: "ok",
        output: { action_id: "resume.create", operation_id: createOperationId },
      });

      const calls = vi.mocked(router.execute).mock.calls;
      expect(calls.at(-2)).toEqual([
        "resume.definitions.write",
        expect.objectContaining({
          kind: "interview_progress",
          progress: expect.objectContaining({
            expected_revision: null,
            status: "review_needed",
            current_topic: null,
            completed_topics: ["direction", "experience"],
            skipped_topics: [],
            draft_state: "owner_reviewed",
            session_id: launch.session.session_id,
            audit_turn: expect.objectContaining({
              transcript_version: 1,
              turn_id: profileOperationId,
              session_id: launch.session.session_id,
              answer: profileActionInput.profile_markdown,
            }),
          }),
        }),
        expect.objectContaining({ viewId: launch.session.view_id }),
      ]);
      expect(calls.at(-1)).toEqual([
        "resume.definitions.write",
        expect.objectContaining({
          definition_kind: "general",
          status: "proposed",
          title: "Maya Torres",
          statements: expect.arrayContaining([
            expect.objectContaining({
              section_id: "summary",
              kind: "presentation",
              display_role: "line",
              text: "Product operations leader with launch and process improvement experience.",
              supporting_confirmed_fact_revision_ids: [],
            }),
          ]),
          section_order: ["summary"],
          presentation_preferences: {},
          locale: "en-US",
          page_intent: "one_page",
          template_id: "resume.single-column",
          template_version: "1",
          parent_definition_revision_id: null,
          job_revision_id: null,
          policy_version: "owner-authored-v1",
          prompt_policy_version: null,
          variant: null,
        }),
        expect.objectContaining({ viewId: launch.session.view_id, hostOwnerConfirmed: true }),
      ]);
    } finally {
      await app.close();
      await host.closeAll();
    }
  });

  it("opens Brief Builder through the same chat, tool, document, artifact, and retention path", async () => {
    const { host, source, harness } = await briefProofHost();
    const app = routeApp(host);
    try {
      const launchResponse = await app.inject({ method: "POST", url: "/apps/brief-builder/chat-workspaces/launch", payload: {} });
      expect(launchResponse.statusCode).toBe(200);
      const launch = launchResponse.json() as AppChatWorkspaceLaunch;
      expect(launch).toMatchObject({
        kind: "chat_workspace",
        presentation: { type: "chat_workspace" },
        workspace: { workspace_id: "brief.chat" },
      });
      expect((launch.workspace.actions as Array<{ action_id: string }>).map((action) => action.action_id)).toEqual([
        "brief.proof.read",
        "brief.proof.write",
      ]);
      expect((launch.workspace.documents as Array<{ document_id: string; data_binding_id: string | null }>).map((document) => document.document_id)).toEqual([
        "brief.source",
        "brief.draft",
        "brief.preview",
      ]);

      const sourceReadBefore = await app.inject({
        method: "GET",
        url: `/apps/brief-builder/chat-workspaces/sessions/${launch.session.session_id}/documents/brief.source`,
      });
      expect(sourceReadBefore.statusCode).toBe(200);
      expect(sourceReadBefore.json()).toMatchObject({
        state: "missing",
        document_id: "brief.source",
        document_binding_id: "brief.source.current",
        record: null,
      });

      const sourceDocumentOperationId = randomUUID();
      const sourceWrite = await app.inject({
        method: "PUT",
        url: `/apps/brief-builder/chat-workspaces/sessions/${launch.session.session_id}/documents/brief.source`,
        payload: {
          operation_id: sourceDocumentOperationId,
          idempotency_key: `scaf-007-brief-source-doc-${sourceDocumentOperationId}`,
          expected_revision: null,
          media_type: "text/markdown",
          content: "BrainDrive records self-contained installed-app proof using generic installed-app routes.",
        },
      });
      expect(sourceWrite.statusCode).toBe(200);
      expect(sourceWrite.json()).toMatchObject({
        state: "current",
        document_id: "brief.source",
        record: {
          revision: 1,
          retention_class: "durable_owner_data",
          content: "BrainDrive records self-contained installed-app proof using generic installed-app routes.",
        },
      });

      const previewOperationId = randomUUID();
      const previewWrite = await app.inject({
        method: "PUT",
        url: `/apps/brief-builder/chat-workspaces/sessions/${launch.session.session_id}/documents/brief.preview`,
        payload: {
          operation_id: previewOperationId,
          idempotency_key: `scaf-007-brief-preview-doc-${previewOperationId}`,
          expected_revision: null,
          media_type: "application/json",
          retention_class: "transient_abandoned_operation",
          content: { preview: "discarded draft preview" },
        },
      });
      expect(previewWrite.statusCode).toBe(200);
      expect(previewWrite.json()).toMatchObject({
        state: "current",
        document_id: "brief.preview",
        record: {
          revision: 1,
          retention_class: "transient_abandoned_operation",
          content: { preview: "discarded draft preview" },
        },
      });
      const previewDeleteOperationId = randomUUID();
      const previewDelete = await app.inject({
        method: "DELETE",
        url: `/apps/brief-builder/chat-workspaces/sessions/${launch.session.session_id}/documents/brief.preview`,
        payload: {
          operation_id: previewDeleteOperationId,
          idempotency_key: `scaf-007-brief-preview-delete-${previewDeleteOperationId}`,
          expected_revision: 1,
          delete_mode: "physical",
        },
      });
      expect(previewDelete.statusCode).toBe(200);
      expect(previewDelete.json()).toMatchObject({
        state: "deleted",
        delete_mode: "physical",
        tombstone: { document_id: "brief.preview", retention_class: "transient_abandoned_operation" },
      });

      const documents = await app.inject({
        method: "GET",
        url: `/apps/brief-builder/chat-workspaces/sessions/${launch.session.session_id}/documents`,
      });
      expect(documents.statusCode).toBe(200);
      expect(documents.json()).toMatchObject({
        result_version: 1,
        app_id: "ai.braindrive.brief-builder",
        records: [expect.objectContaining({ document_id: "brief.source", retention_class: "durable_owner_data" })],
      });

      const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
      expect(model.tools.map((tool) => tool.name)).toEqual(["app_action_brief_proof_read", "app_action_brief_proof_write"]);
      expect(model.tools.map((tool) => tool.inputSchema)).toEqual([
        expect.objectContaining({
          properties: expect.objectContaining({
            action_input: expect.objectContaining({ properties: expect.objectContaining({ action: expect.objectContaining({ const: "reopen" }) }) }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            action_input: expect.objectContaining({ properties: expect.objectContaining({ title: expect.objectContaining({ maxLength: 160 }) }) }),
          }),
        }),
      ]);
      expect(model.prompt_context).toContain("brief.proof.write");
      expect(model.prompt_context).toContain("brief.proof.read");
      expect(model.prompt_context).not.toMatch(/resume|Bearer|authorization|credential|secret|\/home\//i);

      const executor = new ToolExecutor(model.tools);
      await expect(executor.execute(ownerAuth, toolContext(), "app_action_brief_proof_read", {
        action_input: { action: "reopen" },
      })).resolves.toMatchObject({
        status: "ok",
        output: {
          action_id: "brief.proof.read",
          result: {
            source: { source_revision_id: source.source_revision_id },
            catalog_revision: 1,
          },
        },
      });
      const operationId = randomUUID();
      await expect(executor.execute(ownerAuth, toolContext(), "app_action_brief_proof_write", {
        action_input: briefProofWriteActionInput({
          sourceRevisionId: source.source_revision_id,
          expectedCatalogRevision: 1,
          title: "Launch readiness proof",
          statementText: "The self-contained foundation proof uses generic installed-app routes.",
          supportContext: "SCAF-007 synthetic owner context",
          statementId: randomUUID(),
        }),
        operation_id: operationId,
        idempotency_key: `scaf-007-brief-write-${operationId}`,
      })).resolves.toMatchObject({
        status: "ok",
        output: {
          action_id: "brief.proof.write",
          operation_id: operationId,
          result: {
            draft: {
              source_revision_id: source.source_revision_id,
              title: "Launch readiness proof",
              generated_by: "owner_edit",
            },
            catalog_revision: 2,
          },
        },
      });

      const exportedText = "Launch readiness proof\n";
      const exportedBytes = Buffer.from(exportedText, "utf8");
      const exportedDigest = digestBytes(exportedBytes);
      const artifactOperationId = randomUUID();
      const artifact = await app.inject({
        method: "POST",
        url: "/apps/brief-builder/artifacts/register",
        payload: {
          request_version: 1,
          operation_id: artifactOperationId,
          idempotency_key: `scaf-007-brief-artifact-${artifactOperationId}`,
          source: { kind: "app_document", source_id: "brief.draft" },
          content_digest: exportedDigest,
          content_size_bytes: exportedBytes.length,
          retention_class: "durable_owner_data",
          media_type: "text/plain",
          owner_visible_label: "launch-readiness.txt",
        },
      });
      expect(artifact.statusCode).toBe(200);
      expect(artifact.json()).toMatchObject({
        result_version: 1,
        replayed: false,
        artifact: {
          app_id: "ai.braindrive.brief-builder",
          source: { kind: "app_document", source_id: "brief.draft" },
          media_type: "text/plain",
          retention_class: "durable_owner_data",
          owner_visible_label: "launch-readiness.txt",
        },
      });

      const exportOperationId = randomUUID();
      const preparedExport = await app.inject({
        method: "POST",
        url: "/apps/brief-builder/exports/request",
        payload: {
          request_version: 1,
          operation_id: exportOperationId,
          idempotency_key: `scaf-007-brief-export-${exportOperationId}`,
          source: { kind: "app_document", source_id: "brief.draft" },
          content_digest: exportedDigest,
          content_size_bytes: exportedBytes.length,
          retention_class: "durable_owner_data",
          media_type: "text/plain",
          filename: "launch-readiness.txt",
          destination_intent: "new_download",
          overwrite_confirmed: false,
          owner_confirmed: true,
          bytes_base64: exportedBytes.toString("base64"),
        },
      });
      expect(preparedExport.statusCode).toBe(200);
      expect(preparedExport.json()).toMatchObject({
        result_version: 1,
        status: "prepared",
        artifact: {
          app_id: "ai.braindrive.brief-builder",
          source: { kind: "app_document", source_id: "brief.draft" },
          media_type: "text/plain",
        },
        filename: "launch-readiness.txt",
        safe_destination_label: "launch-readiness.txt",
      });

      await host.closeAll();
      const uninstallOperationId = randomUUID();
      const uninstall = await harness.service.uninstall({
        operationId: uninstallOperationId,
        idempotencyKey: `scaf-007-brief-uninstall-${uninstallOperationId}`,
      });
      expect(uninstall.record.state).toBe("not_installed");
      expect(uninstall.operation.result).toMatchObject({
        owner_data_preserved: true,
        runtime_authority_removed: true,
      });
      const journal = await harness.store.readUninstallJournal(uninstall.operation.operation_id);
      expect(journal).toMatchObject({
        owner_data_preserved: true,
        retained_classes: expect.arrayContaining(["app_storage", "artifact_records", "export_receipts", "lifecycle_tombstone"]),
        removed_classes: expect.arrayContaining(["runtime_registration", "capability_grant", "package_reference", "package_bytes", "disposable_cache"]),
      });
      const retainedExportOperationId = randomUUID();
      await expect(harness.service.exportRetainedData({
        operationId: retainedExportOperationId,
        idempotencyKey: `scaf-007-brief-retained-export-${retainedExportOperationId}`,
        ownerActorId: "owner",
        confirmAppId: "ai.braindrive.brief-builder",
        trustedOwnerConfirmation: true,
      })).resolves.toMatchObject({
        operation_id: retainedExportOperationId,
        app_id: "ai.braindrive.brief-builder",
        action: "export",
        retained: true,
      });
    } finally {
      await app.close();
      await host.closeAll();
    }
  });
});

async function resumeProofHost(router: ResumeCapabilityRouter): Promise<AppMcpHost> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-scaf-007-resume-"));
  roots.push(root);
  const harness = await createLifecycleHarness(root);
  await harness.service.install({
    version: MODERN_FIXTURE_VERSION,
    idempotencyKey: "scaf-007-resume-install-0001",
    approveCapabilities: true,
  });
  return new AppMcpHost(new ResumeAppHostAdapter(harness.service, {
    capabilityRouter: router,
    clientFactory: () => ({
      negotiate: async () => ({
        connectionId: randomUUID(),
        tools: [{ name: "app.actions.plan" }],
      } as never),
      readAppResource: vi.fn(),
      callTool: async (_mcp: unknown, toolName: string, args: unknown, operationId: string) => {
        if (toolName !== "app.actions.plan") throw new Error("unexpected_tool");
        return preserveMcpResult({
          _meta: { ui: { visibility: ["model"] } },
          isError: false,
          structuredContent: await planResumeActionForTest(args),
        }, {
          protocolVersion: "2026-07-28",
          connectionId: randomUUID(),
          requestId: operationId,
          operationId,
          toolVisibility: ["model"],
        });
      },
      cancel: vi.fn(),
    }),
  }));
}

async function planResumeActionForTest(args: unknown): Promise<Record<string, unknown>> {
  const runtimePath = path.resolve(process.cwd(), "../resume_builder/resources/inference-program.js");
  const module = await import(pathToFileURL(runtimePath).href) as { planResumeAction: (input: unknown) => Record<string, unknown> };
  return module.planResumeAction(args);
}

async function briefProofHost() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-scaf-007-brief-"));
  roots.push(root);
  const harness = await createLifecycleHarness(root, {
    appId: "ai.braindrive.brief-builder",
    routeKey: "brief-builder",
    displayName: "Brief Builder",
  });
  const memoryRoot = path.join(root, "memory");
  const ownerDataRoot = path.join(memoryRoot, "apps", "brief-builder");
  const dataAdapter = new BriefDataLifecycleAdapter(memoryRoot, ownerDataRoot);
  harness.dependencies.ownerDataRoot = ownerDataRoot;
  harness.dependencies.ownerDataLifecycle = dataAdapter;
  harness.dependencies.dataAdapter = dataAdapter;
  await rm(path.join(root, "source"), { recursive: true, force: true });
  harness.dependencies.repository = await createSyntheticFirstPartyFixtureRepository(path.join(root, "source"), [{
    appId: "ai.braindrive.brief-builder",
    routeKey: "brief-builder",
    displayName: "Brief Builder",
    version: "1.0.0",
    requestedCapabilities: ["brief.records.read", "brief.records.write"],
    presentations: briefProofPresentations(),
  }]);
  await harness.service.install({
    version: "1.0.0",
    idempotencyKey: "scaf-007-brief-install-0001",
    approveCapabilities: true,
  });
  const store = new BriefDataStore(memoryRoot, ownerDataRoot);
  await store.initialize(harness.service.ownerId);
  const source = await store.saveSource({
    source_revision_id: randomUUID(),
    text: "BrainDrive records self-contained installed-app proof using generic installed-app routes.",
    expected_catalog_revision: 0,
    idempotency_key: "scaf-007-brief-source-0001",
  });
  const domain = new BriefDomainService(store);
  const inference = { authorize: vi.fn(), execute: vi.fn() } as unknown as AppInferenceDispatcher;
  const host = new AppMcpHost(BriefAppHostAdapter.create(
    harness.service,
    createBriefCapabilityRegistrations(domain, inference),
  ));
  return { host, source, harness };
}

function briefProofPresentations(): NonNullable<GenericPackageManifest["presentations"]> {
  const readInputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", const: "reopen" },
    },
    required: ["action"],
  };
  const readResultSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      source: { type: ["object", "null"], additionalProperties: true, properties: {}, required: [] },
      draft: { type: ["object", "null"], additionalProperties: true, properties: {}, required: [] },
      approved: { type: ["object", "null"], additionalProperties: true, properties: {}, required: [] },
      catalog_revision: { type: "integer" },
    },
    required: ["source", "draft", "approved", "catalog_revision"],
  };
  return {
    presentation_set_version: 1,
    default_presentation_id: "brief.chat",
    profiles: [{
      profile_version: 1,
      presentation_id: "brief.chat",
      type: "chat_workspace",
      label: "Brief Chat",
      description: "Create a grounded brief through model-visible app actions.",
      workspace_id: "brief.chat",
      owner_visibility: "primary",
    }],
    workspaces: [{
      workspace_version: 1,
      workspace_id: "brief.chat",
      title: "Brief Chat",
      description: "Draft concise owner-controlled briefs.",
      default_document_id: "brief.draft",
      documents: [
        {
          document_version: 1,
          document_id: "brief.source",
          role: "source_document",
          title: "Brief Source",
          description: "Owner source material for the brief.",
          editable: true,
          default_visibility: "primary",
          model_access: "read_reference",
          resource_id: null,
          data_binding_id: "brief.source.current",
        },
        {
          document_version: 1,
          document_id: "brief.draft",
          role: "derived_document",
          title: "Brief Draft",
          description: "Generated or edited brief draft.",
          editable: true,
          default_visibility: "primary",
          model_access: "action_result",
          resource_id: null,
          data_binding_id: "brief.draft.current",
        },
        {
          document_version: 1,
          document_id: "brief.preview",
          role: "action_result_document",
          title: "Brief Preview",
          description: "Transient preview state for an abandoned draft operation.",
          editable: true,
          default_visibility: "secondary",
          model_access: "action_result",
          resource_id: null,
          data_binding_id: "brief.preview.cache",
        },
      ],
      resources: [],
      context_requests: [],
      actions: [{
        action_version: 1,
        action_id: "brief.proof.read",
        kind: "read",
        title: "Read Brief",
        description: "Read the current source, draft, and approval state.",
        input_schema: briefActionSchema("brief.proof.read.input.v1", readInputSchema),
        result_schema: briefActionSchema("brief.proof.read.result.v1", readResultSchema),
        confirmation: "none",
        idempotency_policy: "optional",
        model_exposure: "available",
        required_capabilities: [{ name: "brief.records.read", version: 1 }],
        required_inference_purposes: [],
      }, {
        action_version: 1,
        action_id: "brief.proof.write",
        kind: "write",
        title: "Write Brief",
        description: "Write a reviewed brief draft.",
        input_schema: {
          schema_version: 1,
          schema_id: "brief.proof.write.input.v1",
          content_digest: canonicalInputDigest({
            type: "object",
            additionalProperties: false,
            properties: {
              action: { type: "string", const: "edit" },
              source_revision_id: { type: "string", format: "uuid" },
              expected_catalog_revision: { type: "integer" },
              title: { type: "string", minLength: 1, maxLength: 160 },
              statements: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    statement_id: { type: "string", format: "uuid" },
                    text: { type: "string", minLength: 1, maxLength: 2048 },
                    support: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        kind: { type: "string", const: "owner_context" },
                        context: { type: "string", minLength: 1, maxLength: 2048 },
                      },
                      required: ["kind", "context"],
                    },
                  },
                  required: ["statement_id", "text", "support"],
                },
              },
            },
            required: ["action", "source_revision_id", "expected_catalog_revision", "title", "statements"],
          }),
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              action: { type: "string", const: "edit" },
              source_revision_id: { type: "string", format: "uuid" },
              expected_catalog_revision: { type: "integer" },
              title: { type: "string", minLength: 1, maxLength: 160 },
              statements: {
                type: "array",
                minItems: 1,
                maxItems: 8,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    statement_id: { type: "string", format: "uuid" },
                    text: { type: "string", minLength: 1, maxLength: 2048 },
                    support: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        kind: { type: "string", const: "owner_context" },
                        context: { type: "string", minLength: 1, maxLength: 2048 },
                      },
                      required: ["kind", "context"],
                    },
                  },
                  required: ["statement_id", "text", "support"],
                },
              },
            },
            required: ["action", "source_revision_id", "expected_catalog_revision", "title", "statements"],
          },
        },
        result_schema: {
          schema_version: 1,
          schema_id: "brief.proof.write.result.v1",
          content_digest: canonicalInputDigest({
            type: "object",
            additionalProperties: false,
            properties: {
              draft: { type: "object", additionalProperties: true, properties: {}, required: [] },
              catalog_revision: { type: "integer" },
            },
            required: ["draft", "catalog_revision"],
          }),
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              draft: { type: "object", additionalProperties: true, properties: {}, required: [] },
              catalog_revision: { type: "integer" },
            },
            required: ["draft", "catalog_revision"],
          },
        },
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "brief.records.write", version: 1 }],
        required_inference_purposes: [],
      }],
    }],
  };
}

function briefActionSchema(schemaId: string, schema: Record<string, unknown>) {
  return {
    schema_version: 1 as const,
    schema_id: schemaId,
    content_digest: canonicalInputDigest(schema),
    schema,
  };
}

function routeApp(host: AppMcpHost) {
  const app = Fastify();
  app.addHook("preHandler", async (request) => {
    request.authContext = {
      actorId: "owner",
      actorType: "owner",
      mode: "local-owner",
      permissions,
    };
  });
  registerAppMcpHostRoutes(app, host);
  return app;
}

function metadataFor(launch: AppChatWorkspaceLaunch) {
  return {
    metadata_version: 1 as const,
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
  };
}

function emptyResumeWorkspaceResult() {
  return {
    workspace_version: 4,
    definitions: [],
    definition_history: [],
    variants: [],
    artifacts: [],
    exports: [],
    interview: [],
    jobs: [],
    job_history: [],
    revision_requests: [],
    coverage: [],
    strategies: [],
    target_fit_analyses: [],
    craft_quality_reports: [],
    craft_repair_operations: [],
    artifact_parity_reports: [],
    quality_reviews: [],
  };
}

function fakeResumeRouter(result: unknown | ((capability: unknown, input: unknown) => unknown | Promise<unknown>)): ResumeCapabilityRouter {
  return {
    domain: { store: { recoveryLifecycleEvidence: () => null } },
    execute: vi.fn(async (capability: unknown, input: unknown) => typeof result === "function" ? result(capability, input) : result),
  } as unknown as ResumeCapabilityRouter;
}

function toolContext() {
  return {
    memoryRoot: "/tmp/braindrive-scaf-007",
    auth: ownerAuth,
    correlationId: "scaf-007",
  };
}

function briefProofWriteActionInput(input: {
  sourceRevisionId: string;
  expectedCatalogRevision: number;
  title: string;
  statementText: string;
  supportContext: string;
  statementId: string;
}) {
  return {
    action: "edit",
    source_revision_id: input.sourceRevisionId,
    expected_catalog_revision: input.expectedCatalogRevision,
    title: input.title,
    statements: [{
      statement_id: input.statementId,
      text: input.statementText,
      support: { kind: "owner_context", context: input.supportContext },
    }],
  };
}

function digestBytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function productionTypeScriptFiles(relativeRoots: readonly string[]): Promise<string[]> {
  const files = await Promise.all(relativeRoots.map((root) => collectTypeScriptFiles(path.join(process.cwd(), root))));
  return files.flat().filter((file) => !file.endsWith(".test.ts"));
}

async function collectTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    if (entry.isFile() && entry.name.endsWith(".ts")) return [entryPath];
    return [];
  }));
  return files.flat();
}
