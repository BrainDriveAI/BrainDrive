import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSyntheticFirstPartyFixtureRepository } from "../lifecycle/fixture-repository.js";
import { createLifecycleHarness } from "../lifecycle/test-helpers.js";
import { AppPlatformError } from "../lifecycle/errors.js";
import { ResumeAppHostAdapter } from "./resume-host-adapter.js";
import type { AppChatWorkspaceLaunch } from "./app-host-types.js";
import { buildAppChatModelContext, parseAppChatModelMetadata, type AppChatModelMetadata } from "./app-chat-model.js";
import { AppChatSessionRegistry } from "./app-chat-session.js";
import type { ChatWorkspaceDescriptor } from "../contracts/app-registry.js";
import { canonicalInputDigest } from "../contracts/common.js";
import type { ResumeCapabilityRouter } from "../../resume-domain/capabilities.js";
import { ToolExecutor } from "../../engine/tool-executor.js";
import type { AuthContext } from "../../contracts.js";
import { preserveMcpResult } from "../../mcp/result-envelope.js";

type HostOptions = NonNullable<ConstructorParameters<typeof ResumeAppHostAdapter>[1]>;

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const digestText = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sensitiveMetadataPattern = () => new RegExp([
  "Bear" + "er",
  "author" + "ization",
  "cred" + "ential",
  "permis" + "sion",
  "sec" + "ret",
  "\\/home\\/",
  "[A-Za-z]:\\\\",
].join("|"), "i");
const ownerAuth: AuthContext = {
  actorId: "owner",
  actorType: "owner",
  mode: "local",
  permissions: {
    memory_access: true,
    tool_access: true,
    system_actions: true,
    delegation: true,
    approval_authority: true,
    administration: true,
  },
};

function actionSchema(schemaId: string, schema: Record<string, unknown>) {
  return {
    schema_id: schemaId,
    schema_version: 1 as const,
    content_digest: canonicalInputDigest(schema),
    schema,
  };
}

function actionSchemas(
  inputSchemaId: string,
  resultSchemaId: string,
  inputSchema: Record<string, unknown> = emptyObjectSchema(),
  resultSchema: Record<string, unknown> = capabilityResultSchema(),
) {
  return {
    input_schema: actionSchema(inputSchemaId, inputSchema),
    result_schema: actionSchema(resultSchemaId, resultSchema),
  };
}

function emptyObjectSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: [],
  };
}

function capabilityResultSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      cancelled: { type: "boolean" },
      context: { type: "object", additionalProperties: true, properties: {}, required: [] },
      definition: { type: "object", additionalProperties: true, properties: {}, required: [] },
      inference_contract_version: { type: "number" },
      raw: { type: "object", additionalProperties: true, properties: {}, required: [] },
      record: { type: ["object", "null"], additionalProperties: true, properties: {}, required: [] },
      result: { type: "object", additionalProperties: true, properties: {}, required: [] },
      results: { type: "array", items: {}, maxItems: 1024 },
      reused: { type: "boolean" },
      status: { type: "string", minLength: 1, maxLength: 64 },
    },
    required: [],
  };
}

function profileReadInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      view: { type: "string", enum: ["workspace"], description: "Workspace projection to read." },
    },
    required: [],
  };
}

function profileDocumentReadResultSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      result_version: { type: "number", enum: [1] },
      state: { type: "string", enum: ["current", "missing"] },
      document_id: { type: "string", enum: ["resume.profile"] },
      document_binding_id: { type: "string", enum: ["resume.profile.current"] },
      record: {
        type: ["object", "null"],
        additionalProperties: true,
        properties: {},
        required: [],
      },
    },
    required: ["result_version", "state", "document_id", "document_binding_id", "record"],
  };
}

function profileUpdateInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      profile_markdown: { type: "string", minLength: 1, maxLength: 65536 },
      completed_topics: { type: "array", items: { type: "string", minLength: 1, maxLength: 64 }, maxItems: 32 },
      current_topic: { type: ["string", "null"], maxLength: 64 },
    },
    required: ["profile_markdown", "completed_topics", "current_topic"],
  };
}

function resumeCreateInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 160 },
      resume_markdown: { type: "string", minLength: 1, maxLength: 65536 },
      sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            section_id: { type: "string", minLength: 1, maxLength: 64 },
            statements: { type: "array", items: { type: "string", minLength: 1, maxLength: 2048 }, maxItems: 24 },
          },
          required: ["section_id", "statements"],
        },
        maxItems: 16,
      },
    },
    required: ["title"],
  };
}

function acceptedActionJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", const: "draft", enum: ["draft"], description: "Scalar const and enum are runtime-enforced." },
      reference_id: { type: "string", format: "uuid" },
      nickname: { type: ["string", "null"], minLength: 2, maxLength: 5 },
      tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", minLength: 2, maxLength: 4 } },
      details: {
        type: "object",
        additionalProperties: false,
        properties: {
          nested: { type: "string", enum: ["ready"] },
        },
        required: ["nested"],
      },
      revision: { type: "integer" },
    },
    required: ["mode", "reference_id", "nickname", "tags", "details", "revision"],
  };
}

function validAcceptedActionPayload(): Record<string, unknown> {
  return {
    mode: "draft",
    reference_id: randomUUID(),
    nickname: "Maya",
    tags: ["cv"],
    details: { nested: "ready" },
    revision: 1,
  };
}

function workspace(
  contextRequests: ChatWorkspaceDescriptor["context_requests"] = [],
  overrides: Partial<Pick<ChatWorkspaceDescriptor, "empty_state" | "documents" | "resources" | "actions">> = {},
): ChatWorkspaceDescriptor {
  return {
    workspace_version: 1,
    workspace_id: "resume.chat",
    title: "Resume Workspace",
    description: "Native app-chat workspace fixture.",
    default_document_id: "conversation",
    ...(overrides.empty_state !== undefined ? { empty_state: overrides.empty_state } : {}),
    documents: overrides.documents ?? [{
      document_version: 1,
      document_id: "conversation",
      role: "conversation",
      title: "Conversation",
      description: "Native app conversation.",
      editable: false,
      default_visibility: "primary",
      model_access: "read_write_draft",
      resource_id: null,
      data_binding_id: null,
    }],
    resources: overrides.resources ?? [],
    context_requests: contextRequests,
    actions: overrides.actions ?? [],
  };
}

function resumePlannerDocuments(): ChatWorkspaceDescriptor["documents"] {
  return [
    {
      document_version: 1,
      document_id: "conversation",
      role: "conversation",
      title: "Conversation",
      description: "Native app conversation.",
      editable: false,
      default_visibility: "primary",
      model_access: "read_write_draft",
      resource_id: null,
      data_binding_id: null,
      presentation: null,
    },
    {
      document_version: 1,
      document_id: "resume.profile",
      role: "source_document",
      title: "Resume Profile",
      description: "App-owned resume profile.",
      editable: true,
      default_visibility: "primary",
      model_access: "read_write_draft",
      resource_id: null,
      data_binding_id: "resume.profile.current",
      presentation: null,
    },
    {
      document_version: 1,
      document_id: "resume.document",
      role: "derived_document",
      title: "Resume",
      description: "App-owned resume document.",
      editable: false,
      default_visibility: "primary",
      model_access: "action_result",
      resource_id: null,
      data_binding_id: "resume.definition.current.general",
      presentation: null,
    },
  ];
}

function presentations(chatWorkspace: ChatWorkspaceDescriptor) {
  return {
    presentation_set_version: 1 as const,
    default_presentation_id: "chat",
    profiles: [
      {
        profile_version: 1 as const,
        presentation_id: "chat",
        type: "chat_workspace" as const,
        label: "Just Chat With It",
        description: "Open the native chat workspace.",
        workspace_id: chatWorkspace.workspace_id,
        owner_visibility: "primary" as const,
      },
      {
        profile_version: 1 as const,
        presentation_id: "surface",
        type: "surface" as const,
        label: "Open App",
        description: "Open the sandboxed app surface.",
        resource_uri: "ui://resume-builder/main",
        owner_visibility: "internal" as const,
      },
    ],
    workspaces: [chatWorkspace],
  };
}

async function setup(input: {
  requestedCapabilities?: readonly string[];
  requestedInferencePurposes?: readonly { purpose_id: string; version: number }[];
  contextRequests?: ChatWorkspaceDescriptor["context_requests"];
  emptyState?: ChatWorkspaceDescriptor["empty_state"];
  actions?: ChatWorkspaceDescriptor["actions"];
  documents?: ChatWorkspaceDescriptor["documents"];
  router?: ResumeCapabilityRouter;
  clientFactory?: HostOptions["clientFactory"];
  installedAppInference?: HostOptions["installedAppInference"];
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-chat-"));
  roots.push(root);
  const harness = await createLifecycleHarness(root, {
    appId: "ai.braindrive.resume-builder",
    routeKey: "resume-builder",
    displayName: "Resume Builder",
  });
  const chatWorkspace = workspace(input.contextRequests, { actions: input.actions, documents: input.documents, empty_state: input.emptyState });
  await rm(path.join(root, "source"), { recursive: true, force: true });
  harness.dependencies.repository = await createSyntheticFirstPartyFixtureRepository(path.join(root, "source"), [{
    appId: "ai.braindrive.resume-builder",
    routeKey: "resume-builder",
    displayName: "Resume Builder",
    version: "1.0.0",
    requestedCapabilities: input.requestedCapabilities ?? ["career.context.read"],
    requestedInferencePurposes: input.requestedInferencePurposes,
    presentations: presentations(chatWorkspace),
  }]);
  await harness.service.install({ version: "1.0.0", idempotencyKey: "rbjc-002-install-fixture", approveCapabilities: true });
  return {
    harness,
    host: new ResumeAppHostAdapter(harness.service, {
      capabilityRouter: input.router,
      clientFactory: input.clientFactory ?? noPlannerClientFactory,
      installedAppInference: input.installedAppInference,
    }),
  };
}

const noPlannerClientFactory: HostOptions["clientFactory"] = () => ({
  negotiate: async () => ({ connectionId: randomUUID(), tools: [] } as never),
  readAppResource: vi.fn(),
  callTool: vi.fn(),
  cancel: vi.fn(),
});

const resumePlannerClientFactory: HostOptions["clientFactory"] = () => ({
  negotiate: async () => ({ connectionId: randomUUID(), tools: [{ name: "app.actions.plan" }] } as never),
  readAppResource: vi.fn(),
  callTool: async (_mcp: unknown, toolName: string, args: unknown, operationId: string) => {
    if (toolName !== "app.actions.plan") throw new Error("unexpected_tool");
    return preserveMcpResult({
      structuredContent: await planResumeActionForTest(args),
      _meta: { ui: { visibility: ["model"] } },
      isError: false,
    }, {
      protocolVersion: "2026-07-28",
      connectionId: randomUUID(),
      requestId: operationId,
      operationId,
      toolVisibility: ["model"],
    });
  },
  cancel: vi.fn(),
});

async function planResumeActionForTest(args: unknown): Promise<Record<string, unknown>> {
  const runtimePath = path.resolve(process.cwd(), "../resume_builder/resources/inference-program.js");
  const module = await import(pathToFileURL(runtimePath).href) as { planResumeAction: (input: unknown) => Record<string, unknown> };
  return module.planResumeAction(args);
}

function fakeRouter(result: unknown = { sources: [{ reference: "career-context", state: "present" }] }): ResumeCapabilityRouter {
  return {
    domain: { store: { recoveryLifecycleEvidence: () => null } },
    execute: vi.fn(async () => result),
  } as unknown as ResumeCapabilityRouter;
}

function metadataFor(launch: AppChatWorkspaceLaunch): AppChatModelMetadata {
  return {
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
  };
}

async function buildSyntheticActionExecutor(input: {
  inputSchema: Record<string, unknown>;
  resultSchema: Record<string, unknown>;
  executeAction: (request: unknown) => Promise<unknown>;
}) {
  const session = {
    ownerId: randomUUID(),
    accountId: randomUUID(),
    actorId: "owner",
    appId: "ai.braindrive.resume-builder",
    publisherId: "ai.braindrive",
    installationId: randomUUID(),
    packageDigest: digest("a"),
    lifecycleGeneration: 2,
    grantId: randomUUID(),
    grantRevision: 1,
    revocationGeneration: 0,
    presentationId: "chat",
    workspaceId: "resume.chat",
    contextGrantSetDigest: digest("b"),
    sessionId: randomUUID(),
    viewId: randomUUID(),
    operationId: randomUUID(),
    sessionGeneration: 1,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const metadata: AppChatModelMetadata = {
    metadata_version: 1,
    app_id: session.appId,
    installation_id: session.installationId,
    package_digest: session.packageDigest,
    session_id: session.sessionId,
    view_id: session.viewId,
    operation_id: session.operationId,
    session_generation: session.sessionGeneration,
    presentation_id: session.presentationId,
    workspace_id: session.workspaceId,
    context_grant_set_digest: session.contextGrantSetDigest,
  };
  const model = await buildAppChatModelContext({
    metadata,
    session,
    workspace: workspace([], {
      actions: [{
        action_version: 1,
        action_id: "validate.schema",
        kind: "inspect",
        title: "Validate Schema",
        description: "Exercise the app action JSON Schema runtime subset.",
        ...actionSchemas("validate.schema.input.v1", "validate.schema.result.v1", input.inputSchema, input.resultSchema),
        confirmation: "none",
        idempotency_policy: "optional",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
        required_inference_purposes: [],
      }],
    }),
    storedPackage: {
      store_version: 1,
      package_digest: session.packageDigest,
      package_version: "1.0.0",
      package_root: os.tmpdir(),
      entrypoint: path.join(os.tmpdir(), "index.js"),
      manifest: {} as never,
      trust: {} as never,
    },
    executeAction: input.executeAction,
  });
  return new ToolExecutor(model.tools);
}

describe("app-chat workspace session authority", () => {
  it("rejects malformed model metadata before prompt or action assembly", () => {
    expect(() => parseAppChatModelMetadata({ app_chat: {
      metadata_version: 1,
      app_id: "ai.braindrive.resume-builder",
      installation_id: randomUUID(),
      package_digest: "sha1:not-a-package-digest",
      session_id: randomUUID(),
      view_id: randomUUID(),
      operation_id: randomUUID(),
      session_generation: 1,
      presentation_id: "chat",
      workspace_id: "resume.chat",
      context_grant_set_digest: digest("b"),
    } })).toThrow();
  });

  it("opens a chat workspace session bound to package, presentation, workspace, grant, lifecycle, and declared context", async () => {
    const router = fakeRouter();
    const { host } = await setup({
      router,
      requestedCapabilities: ["career.context.read"],
      contextRequests: [
        {
          context_version: 1,
          context_id: "career.resume",
          kind: "career_context",
          title: "Career Context",
          description: "Bounded career context for resume work.",
          required: false,
          max_bytes: 65_536,
          freshness_policy: "session_snapshot",
          required_capabilities: [{ name: "career.context.read", version: 1 }],
        },
        {
          context_version: 1,
          context_id: "owner.profile",
          kind: "owner_profile",
          title: "Owner Profile",
          description: "Optional owner profile context.",
          required: false,
          max_bytes: 16_384,
          freshness_policy: "latest_available",
          required_capabilities: [],
        },
      ],
    });

    const launch = await host.launchChatWorkspace();

    expect(launch).toMatchObject({
      launch_version: 1,
      kind: "chat_workspace",
      resumed: false,
      presentation: { presentation_id: "chat", type: "chat_workspace", workspace_id: "resume.chat" },
      workspace: { workspace_id: "resume.chat", default_document_id: "conversation" },
      session: {
        app_id: "ai.braindrive.resume-builder",
        publisher_id: "ai.braindrive",
        presentation_id: "chat",
        workspace_id: "resume.chat",
        grant_revision: 1,
        revocation_generation: 0,
      },
    });
    expect(launch.session.context_grant_set_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(launch.context.items).toEqual([
      expect.objectContaining({ context_id: "career.resume", kind: "career_context", state: "available" }),
      expect.objectContaining({ context_id: "owner.profile", kind: "owner_profile", state: "unavailable", reason: "unsupported" }),
    ]);
    expect(JSON.stringify(launch)).not.toMatch(sensitiveMetadataPattern());
    expect(vi.mocked(router.execute)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(router.execute)).toHaveBeenCalledWith(
      "career.context.read",
      { entry_point: "direct" },
      expect.objectContaining({ viewId: launch.session.view_id }),
    );
  });

  it("projects app-declared empty-state metadata in the workspace launch DTO", async () => {
    const empty_state = {
      empty_state_version: 1 as const,
      heading: "App-authored start",
      description: "The app owns this empty state.",
      cta_label: "Let's get started",
      cta_message: "Begin this app workflow.",
    };
    const { host } = await setup({ emptyState: empty_state });

    await expect(host.launchChatWorkspace()).resolves.toMatchObject({
      workspace: { empty_state },
    });
  });

  it("reads and writes app-owned documents through app-chat session authority", async () => {
    const { host } = await setup({
      requestedCapabilities: ["resume.definitions.read", "resume.definitions.write"],
      documents: [
        {
          document_version: 1,
          document_id: "conversation",
          role: "conversation",
          title: "Conversation",
          description: "Native app conversation.",
          editable: false,
          default_visibility: "primary",
          model_access: "read_write_draft",
          resource_id: null,
          data_binding_id: null,
        },
        {
          document_version: 1,
          document_id: "resume.profile",
          role: "source_document",
          title: "Your Resume Profile",
          description: "App-owned profile document.",
          editable: true,
          default_visibility: "primary",
          model_access: "read_write_draft",
          resource_id: null,
          data_binding_id: "resume.profile.current",
        },
      ],
    });
    const launch = await host.launchChatWorkspace();

    await expect(host.readAppDocument(launch.session.session_id, "resume.profile")).resolves.toMatchObject({
      state: "missing",
      document_id: "resume.profile",
      document_binding_id: "resume.profile.current",
      record: null,
    });
    const written = await host.writeAppDocument(launch.session.session_id, "resume.profile", {
      operation_id: randomUUID(),
      idempotency_key: "app-chat-profile-write-0001",
      expected_revision: null,
      content: "# Profile",
    });
    expect(written).toMatchObject({
      state: "current",
      document_id: "resume.profile",
      record: {
        app_id: "ai.braindrive.resume-builder",
        document_binding_id: "resume.profile.current",
        role: "source_document",
        revision: 1,
        content: "# Profile",
      },
    });
    await expect(host.readAppDocument(launch.session.session_id, "resume.profile")).resolves.toMatchObject({
      state: "current",
      record: { revision: 1, content: "# Profile" },
    });
    await expect(host.writeAppDocument(launch.session.session_id, "conversation", {
      operation_id: randomUUID(),
      idempotency_key: "app-chat-conversation-write-0001",
      expected_revision: null,
      content: "not a durable app document",
    })).rejects.toMatchObject({ code: "denied" });
  });

  it("does not project Resume-domain records into app documents when generic storage is empty", async () => {
    const router = fakeRouter({
      workspace_version: 4,
      definitions: [{
        record_type: "resume_definition",
        definition_kind: "general",
        lifecycle_state: "active",
        title: "Maya Chen Resume",
        updated_at: "2026-08-27T20:31:20.510Z",
        metadata: {
          record_id: randomUUID(),
          revision_id: randomUUID(),
          revision: 2,
          created_at: "2026-08-27T20:31:20.510Z",
          prior_revision_id: null,
        },
        section_order: ["header", "experience"],
        statements: [
          { section_id: "header", display_role: "heading", text: "Maya Chen" },
          { section_id: "experience", display_role: "bullet", text: "Built product operations for a B2B SaaS team." },
        ],
      }],
      interview: [{
        record_type: "interview_progress",
        lifecycle_state: "active",
        status: "review_needed",
        current_topic: null,
        completed_topics: ["contact_and_identity", "employment_history"],
        updated_at: "2026-08-27T20:29:20.510Z",
        metadata: {
          record_id: randomUUID(),
          revision_id: randomUUID(),
          revision: 1,
          created_at: "2026-08-27T20:29:20.510Z",
          prior_revision_id: null,
        },
      }],
    });
    const { host } = await setup({
      router,
      requestedCapabilities: ["resume.definitions.read"],
      documents: [
        {
          document_version: 1,
          document_id: "conversation",
          role: "conversation",
          title: "Conversation",
          description: "Native app conversation.",
          editable: false,
          default_visibility: "primary",
          model_access: "read_write_draft",
          resource_id: null,
          data_binding_id: null,
        },
        {
          document_version: 1,
          document_id: "resume.profile",
          role: "source_document",
          title: "Your Resume Profile",
          description: "App-owned profile document.",
          editable: true,
          default_visibility: "primary",
          model_access: "read_write_draft",
          resource_id: null,
          data_binding_id: "resume.profile.current",
        },
        {
          document_version: 1,
          document_id: "resume.document",
          role: "derived_document",
          title: "Your Resume",
          description: "App-owned resume document.",
          editable: false,
          default_visibility: "primary",
          model_access: "action_result",
          resource_id: null,
          data_binding_id: "resume.definition.current.general",
        },
      ],
    });
    const launch = await host.launchChatWorkspace();

    await expect(host.readAppDocument(launch.session.session_id, "resume.document")).resolves.toMatchObject({
      state: "missing",
      document_id: "resume.document",
      document_binding_id: "resume.definition.current.general",
      record: null,
    });
    await expect(host.readAppDocument(launch.session.session_id, "resume.profile")).resolves.toMatchObject({
      state: "missing",
      document_id: "resume.profile",
      document_binding_id: "resume.profile.current",
      record: null,
    });
    expect(vi.mocked(router.execute)).not.toHaveBeenCalled();
  });

  it("rejects disabled launch, surface presentation launch, and required ungranted context", async () => {
    const disabled = await setup();
    const disableBeforeLaunchKey = ["rbjc-002-disable", "before-launch"].join("-");
    await disabled.harness.service.disable({ idempotencyKey: disableBeforeLaunchKey });
    await expect(disabled.host.launchChatWorkspace()).rejects.toMatchObject({ code: "invalid_state_transition" });

    const surface = await setup();
    await expect(surface.host.launchChatWorkspace({ presentationId: "surface" })).rejects.toMatchObject({ code: "incompatible_schema" });

    const required = await setup({
      requestedCapabilities: ["career.context.read", "resume.definitions.read"],
      contextRequests: [{
        context_version: 1,
        context_id: "resume.profile",
        kind: "app_state",
        title: "Resume Profile",
        description: "Required app state fixture.",
        required: true,
        max_bytes: 16_384,
        freshness_policy: "session_snapshot",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
      }],
    });
    const status = await required.harness.service.status();
    const grant = await required.harness.store.readGrant(status.grant_id!);
    await required.harness.store.saveGrant({ ...grant!, capabilities: ["career.context.read"] });
    await expect(required.host.launchChatWorkspace()).rejects.toMatchObject({ code: "grant_missing" });
  });

  it("rejects revoked, digest-mismatched, and lifecycle-stale sessions", async () => {
    const { harness, host } = await setup();
    const launch = await host.launchChatWorkspace();
    const status = await harness.service.status();
    await harness.store.revokeGrant(status.grant_id!);
    await expect(host.readChatWorkspaceSession(launch.session.session_id)).rejects.toMatchObject({ code: "session_closed" });

    const digestCase = await setup();
    const digestLaunch = await digestCase.host.launchChatWorkspace();
    const record = await digestCase.harness.store.readLifecycle();
    await digestCase.harness.store.compareAndSwapLifecycle(record.generation, {
      ...record,
      generation: record.generation + 1,
      active_package_digest: digest("f"),
      updated_at: new Date().toISOString(),
    });
    await expect(digestCase.host.readChatWorkspaceSession(digestLaunch.session.session_id)).rejects.toMatchObject({ code: "session_closed" });

    const stale = await setup();
    const staleLaunch = await stale.host.launchChatWorkspace();
    await stale.harness.service.disable({ idempotencyKey: "rbjc-002-disable-stale-session" });
    await expect(stale.host.readChatWorkspaceSession(staleLaunch.session.session_id)).rejects.toMatchObject({ code: "session_closed" });
  });

  it("resumes exact authority while rejecting stale session authority", async () => {
    const { host } = await setup();
    const first = await host.launchChatWorkspace();
    const resumed = await host.launchChatWorkspace({
      resume: {
        sessionId: first.session.session_id,
        viewId: first.session.view_id,
        operationId: first.session.operation_id,
        sessionGeneration: first.session.session_generation,
      },
    });

    expect(resumed).toMatchObject({
      resumed: true,
      session: {
        view_id: first.session.view_id,
        operation_id: first.session.operation_id,
        session_generation: first.session.session_generation + 1,
      },
    });
    await expect(host.readChatWorkspaceSession(first.session.session_id)).rejects.toMatchObject({ code: "session_closed" });
    await expect(host.readChatWorkspaceSession(resumed.session.session_id)).resolves.toMatchObject({
      session_id: resumed.session.session_id,
      context_grant_set_digest: first.session.context_grant_set_digest,
    });
    await expect(host.launchChatWorkspace({
      resume: {
        sessionId: first.session.session_id,
        viewId: first.session.view_id,
        operationId: first.session.operation_id,
        sessionGeneration: first.session.session_generation,
      },
    })).rejects.toMatchObject({ code: "session_closed" });
  });

  it("renews active app-chat session authority without rotating session identity", () => {
    let now = Date.parse("2026-08-26T12:00:00.000Z");
    const registry = new AppChatSessionRegistry({ now: () => now });
    const authority = {
      ownerId: randomUUID(),
      accountId: randomUUID(),
      actorId: randomUUID(),
      appId: "ai.braindrive.resume-builder",
      publisherId: "ai.braindrive",
      installationId: randomUUID(),
      packageDigest: digest("a"),
      lifecycleGeneration: 2,
      grantId: randomUUID(),
      grantRevision: 1,
      revocationGeneration: 0,
      presentationId: "chat",
      workspaceId: "resume.chat",
      contextGrantSetDigest: digest("b"),
    };
    const committed = registry.commit(registry.plan(authority));

    expect(committed.expiresAt).toBe("2026-08-26T12:05:00.000Z");

    now = Date.parse("2026-08-26T12:04:00.000Z");
    const renewed = registry.renew(authority.appId, committed.sessionId);

    expect(renewed).toMatchObject({
      sessionId: committed.sessionId,
      viewId: committed.viewId,
      operationId: committed.operationId,
      sessionGeneration: committed.sessionGeneration,
      expiresAt: "2026-08-26T12:09:00.000Z",
    });

    now = Date.parse("2026-08-26T12:08:30.000Z");
    expect(registry.read(authority.appId, committed.sessionId).sessionId).toBe(committed.sessionId);

    now = Date.parse("2026-08-26T12:09:00.001Z");
    expect(() => registry.read(authority.appId, committed.sessionId)).toThrow(AppPlatformError);
  });

  it("fails closed when a required context projection exceeds its descriptor bound", async () => {
    const { host } = await setup({
      router: fakeRouter({ content: "x".repeat(256) }),
      requestedCapabilities: ["career.context.read"],
      contextRequests: [{
        context_version: 1,
        context_id: "career.required",
        kind: "career_context",
        title: "Career Context",
        description: "Required bounded context.",
        required: true,
        max_bytes: 32,
        freshness_policy: "session_snapshot",
        required_capabilities: [{ name: "career.context.read", version: 1 }],
      }],
    });

    await expect(host.launchChatWorkspace()).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("assembles digest-bound package resources without host-private metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-chat-model-"));
    roots.push(root);
    await mkdir(path.join(root, "payload", "resources"), { recursive: true });
    const resourceText = "# Agent Instructions\nUse package-owned instructions only.";
    await writeFile(path.join(root, "payload", "resources", "agent.md"), resourceText);
    const resourceDigest = digestText(resourceText);
    const chatWorkspace = workspace([], {
      resources: [{
        resource_version: 1,
        resource_id: "agent.instructions",
        role: "agent_instructions",
        title: "Agent Instructions",
        description: "Package-owned model guidance.",
        package_path: "payload/resources/agent.md",
        media_type: "text/markdown",
        content_digest: resourceDigest,
        owner_editable: false,
        prompt_inclusion: "workspace_start",
      }],
      actions: [{
        action_version: 1,
        action_id: "inspect.profile",
        kind: "inspect",
        title: "Inspect Profile",
        description: "Read the current app-owned profile.",
        ...actionSchemas("resume.profile.inspect.input.v1", "resume.profile.inspect.result.v1"),
        confirmation: "none",
        idempotency_policy: "optional",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
        required_inference_purposes: [],
      }],
    });
    const session = {
      ownerId: randomUUID(),
      accountId: randomUUID(),
      actorId: "owner",
      appId: "ai.braindrive.resume-builder",
      publisherId: "ai.braindrive",
      installationId: randomUUID(),
      packageDigest: digest("a"),
      lifecycleGeneration: 2,
      grantId: randomUUID(),
      grantRevision: 1,
      revocationGeneration: 0,
      presentationId: "chat",
      workspaceId: "resume.chat",
      contextGrantSetDigest: digest("b"),
      sessionId: randomUUID(),
      viewId: randomUUID(),
      operationId: randomUUID(),
      sessionGeneration: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const metadata: AppChatModelMetadata = {
      metadata_version: 1,
      app_id: session.appId,
      installation_id: session.installationId,
      package_digest: session.packageDigest,
      session_id: session.sessionId,
      view_id: session.viewId,
      operation_id: session.operationId,
      session_generation: session.sessionGeneration,
      presentation_id: session.presentationId,
      workspace_id: session.workspaceId,
      context_grant_set_digest: session.contextGrantSetDigest,
    };

    const model = await buildAppChatModelContext({
      metadata,
      session,
      workspace: chatWorkspace,
      storedPackage: {
        store_version: 1,
        package_digest: session.packageDigest,
        package_version: "1.0.0",
        package_root: root,
        entrypoint: path.join(root, "payload/docker/index.js"),
        manifest: {} as never,
        trust: {} as never,
      },
      executeAction: async () => ({ ok: true }),
    });

    expect(model.promptContext).toContain(resourceText);
    expect(model.promptContext).toContain(resourceDigest);
    expect(model.promptContext).toContain("app_action_inspect_profile");
    expect(JSON.stringify(model)).not.toMatch(sensitiveMetadataPattern());
    expect(model.evidence.resources).toEqual([expect.objectContaining({
      resource_id: "agent.instructions",
      package_path: "payload/resources/agent.md",
      content_digest: resourceDigest,
      included: true,
      byte_length: Buffer.byteLength(resourceText, "utf8"),
    })]);
  });

  it("uses owner overrides for owner-editable package resources in app-chat model context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-chat-owner-resource-"));
    roots.push(root);
    await mkdir(path.join(root, "payload", "resources"), { recursive: true });
    const packageText = "# Agent Instructions\nUse the packaged default.";
    const ownerText = "# Agent Instructions\nUse the owner override.";
    await writeFile(path.join(root, "payload", "resources", "agent.md"), packageText);
    const packageDigest = digestText(packageText);
    const ownerDigest = digestText(ownerText);
    const session = {
      ownerId: randomUUID(),
      accountId: randomUUID(),
      actorId: "owner",
      appId: "ai.braindrive.resume-builder",
      publisherId: "ai.braindrive",
      installationId: randomUUID(),
      packageDigest: digest("a"),
      lifecycleGeneration: 2,
      grantId: randomUUID(),
      grantRevision: 1,
      revocationGeneration: 0,
      presentationId: "chat",
      workspaceId: "resume.chat",
      contextGrantSetDigest: digest("b"),
      sessionId: randomUUID(),
      viewId: randomUUID(),
      operationId: randomUUID(),
      sessionGeneration: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const metadata: AppChatModelMetadata = {
      metadata_version: 1,
      app_id: session.appId,
      installation_id: session.installationId,
      package_digest: session.packageDigest,
      session_id: session.sessionId,
      view_id: session.viewId,
      operation_id: session.operationId,
      session_generation: session.sessionGeneration,
      presentation_id: session.presentationId,
      workspace_id: session.workspaceId,
      context_grant_set_digest: session.contextGrantSetDigest,
    };
    const chatWorkspace = workspace([], {
      documents: [
        {
          document_version: 1,
          document_id: "conversation",
          role: "conversation",
          title: "Conversation",
          description: "Native app conversation.",
          editable: false,
          default_visibility: "primary",
          model_access: "read_write_draft",
          resource_id: null,
          data_binding_id: null,
        },
        {
          document_version: 1,
          document_id: "agent.instructions",
          role: "advanced_resource",
          title: "Agent Instructions",
          description: "Owner-editable app instructions.",
          editable: true,
          default_visibility: "advanced",
          model_access: "read_write_draft",
          resource_id: "agent.instructions",
          data_binding_id: "agent.instructions.owner",
          initial_content: {
            initial_content_version: 1,
            source: "package_file",
            package_path: "payload/resources/agent.md",
            media_type: "text/markdown",
            content_digest: packageDigest,
            seed_policy: "when_missing",
          },
        },
      ],
      resources: [{
        resource_version: 1,
        resource_id: "agent.instructions",
        role: "agent_instructions",
        title: "Agent Instructions",
        description: "Owner-editable model guidance.",
        package_path: "payload/resources/agent.md",
        media_type: "text/markdown",
        content_digest: packageDigest,
        owner_editable: true,
        prompt_inclusion: "workspace_start",
      }],
    });

    const model = await buildAppChatModelContext({
      metadata,
      session,
      workspace: chatWorkspace,
      storedPackage: {
        store_version: 1,
        package_digest: session.packageDigest,
        package_version: "1.0.0",
        package_root: root,
        entrypoint: path.join(root, "payload/docker/index.js"),
        manifest: {} as never,
        trust: {} as never,
      },
      resolveResourcePromptContent: async () => ({
        content: ownerText,
        contentDigest: ownerDigest,
        source: "owner_override",
        ownerRevision: 3,
      }),
      executeAction: async () => ({ ok: true }),
    });

    expect(model.promptContext).toContain(ownerText);
    expect(model.promptContext).not.toContain("Use the packaged default.");
    expect(model.evidence.resources).toEqual([expect.objectContaining({
      resource_id: "agent.instructions",
      content_digest: ownerDigest,
      content_source: "owner_override",
      owner_revision: 3,
    })]);
  });

  it("rejects opaque schema-id-only model actions during app-chat tool assembly", async () => {
    const chatWorkspace = workspace([], {
      actions: [{
        action_version: 1,
        action_id: "read.profile",
        kind: "read",
        title: "Read Profile",
        description: "Read app-owned profile state.",
        input_schema_id: "resume.profile.read.input.v1",
        result_schema_id: "resume.profile.read.result.v1",
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
        required_inference_purposes: [],
      } as never],
    });
    const session = {
      ownerId: randomUUID(),
      accountId: randomUUID(),
      actorId: "owner",
      appId: "ai.braindrive.resume-builder",
      publisherId: "ai.braindrive",
      installationId: randomUUID(),
      packageDigest: digest("a"),
      lifecycleGeneration: 2,
      grantId: randomUUID(),
      grantRevision: 1,
      revocationGeneration: 0,
      presentationId: "chat",
      workspaceId: "resume.chat",
      contextGrantSetDigest: digest("b"),
      sessionId: randomUUID(),
      viewId: randomUUID(),
      operationId: randomUUID(),
      sessionGeneration: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const metadata: AppChatModelMetadata = {
      metadata_version: 1,
      app_id: session.appId,
      installation_id: session.installationId,
      package_digest: session.packageDigest,
      session_id: session.sessionId,
      view_id: session.viewId,
      operation_id: session.operationId,
      session_generation: session.sessionGeneration,
      presentation_id: session.presentationId,
      workspace_id: session.workspaceId,
      context_grant_set_digest: session.contextGrantSetDigest,
    };

    await expect(buildAppChatModelContext({
      metadata,
      session,
      workspace: chatWorkspace,
      storedPackage: {
        store_version: 1,
        package_digest: session.packageDigest,
        package_version: "1.0.0",
        package_root: os.tmpdir(),
        entrypoint: path.join(os.tmpdir(), "index.js"),
        manifest: {} as never,
        trust: {} as never,
      },
      executeAction: async () => ({ ok: true }),
    })).rejects.toMatchObject({ code: "descriptor_invalid" });
  });

  it("exposes only declared model-visible app actions and routes execution through scoped capabilities", async () => {
    const router = fakeRouter({ record: null, results: [], reused: false });
    const { host } = await setup({
      router,
      requestedCapabilities: ["resume.definitions.read", "resume.definitions.write"],
      actions: [
        {
          action_version: 1,
          action_id: "read.profile",
          kind: "read",
          title: "Read Profile",
          description: "Read app-owned profile state.",
          ...actionSchemas("resume.profile.read.input.v1", "resume.profile.read.result.v1", profileReadInputSchema()),
          confirmation: "none",
          idempotency_policy: "required",
          model_exposure: "available",
          required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "hidden.write",
          kind: "write",
          title: "Hidden Write",
          description: "Hidden action.",
          ...actionSchemas("resume.hidden.write.input.v1", "resume.hidden.write.result.v1"),
          confirmation: "owner_confirmation",
          idempotency_policy: "required",
          model_exposure: "hidden",
          required_capabilities: [{ name: "resume.definitions.write", version: 1 }],
          required_inference_purposes: [],
        },
      ],
    });
    const launch = await host.launchChatWorkspace();
    const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
    const executor = new ToolExecutor(model.tools);
    const operationId = randomUUID();
    const idempotencyKey = `rbjc-004-${operationId}`;

    expect(model.tools.map((tool) => tool.name)).toEqual(["app_action_read_profile"]);
    expect(model.tools[0].inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        action_input: {
          type: "object",
          additionalProperties: false,
          properties: {
            view: { type: "string", enum: ["workspace"] },
          },
          required: [],
        },
        operation_id: { type: "string", format: "uuid" },
        idempotency_key: { type: "string", minLength: 16, maxLength: 256 },
      },
      required: ["action_input", "operation_id", "idempotency_key"],
    });
    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-004",
    }, "app_action_read_profile", {
      action_input: { view: "wrong" },
      operation_id: randomUUID(),
      idempotency_key: `rbjc-004-${randomUUID()}`,
    })).resolves.toMatchObject({
      status: "error",
      output: {
        code: "invalid_input",
        message: "App action input failed schema validation",
        recoverable: true,
      },
    });
    expect(vi.mocked(router.execute)).not.toHaveBeenCalled();
    expect(model.evidence.action_exposure).toEqual([
      { action_id: "read.profile", tool_name: "app_action_read_profile", model_exposure: "available", exposed: true },
      { action_id: "hidden.write", tool_name: null, model_exposure: "hidden", exposed: false },
    ]);
    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-004",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: operationId,
      idempotency_key: idempotencyKey,
    })).resolves.toMatchObject({
      status: "ok",
      output: {
        action_id: "read.profile",
        operation_id: operationId,
        idempotency_key: idempotencyKey,
        result: { record: null, results: [], reused: false },
      },
    });
    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-004",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: operationId,
      idempotency_key: idempotencyKey,
    })).resolves.toMatchObject({
      status: "ok",
      output: { result: { reused: false } },
    });
    expect(vi.mocked(router.execute)).toHaveBeenCalledTimes(1);
  });

  it("rejects app action results that do not match the declared result schema", async () => {
    const router = fakeRouter({ unexpected: "result" });
    const { host } = await setup({
      router,
      requestedCapabilities: ["resume.definitions.read"],
      actions: [{
        action_version: 1,
        action_id: "read.profile",
        kind: "read",
        title: "Read Profile",
        description: "Read app-owned profile state.",
        ...actionSchemas("resume.profile.read.input.v1", "resume.profile.read.result.v1", profileReadInputSchema(), emptyObjectSchema()),
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
        required_inference_purposes: [],
      }],
    });
    const launch = await host.launchChatWorkspace();
    const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
    const executor = new ToolExecutor(model.tools);
    const operationId = randomUUID();

    const result = await executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-result-schema",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: operationId,
      idempotency_key: `rbjc-result-schema-${operationId}`,
    });

    expect(result).toMatchObject({
      status: "error",
      output: {
        code: "execution_failed",
        message: "App action result failed schema validation",
        recoverable: false,
      },
    });
    expect(JSON.stringify(result.output)).not.toContain("unexpected");
  });

  it("enforces every accepted app action schema keyword on model input before app invocation", async () => {
    const executeAction = vi.fn(async () => validAcceptedActionPayload());
    const executor = await buildSyntheticActionExecutor({
      inputSchema: acceptedActionJsonSchema(),
      resultSchema: acceptedActionJsonSchema(),
      executeAction,
    });
    const valid = validAcceptedActionPayload();
    const invalidInputs: Array<[string, Record<string, unknown>]> = [
      ["required", (() => { const input = { ...valid }; delete input.mode; return input; })()],
      ["additionalProperties", { ...valid, owner_secret: "Authorization: Bearer should-not-leak" }],
      ["type union", { ...valid, nickname: 42 }],
      ["const enum", { ...valid, mode: "publish" }],
      ["format", { ...valid, reference_id: "not-a-uuid" }],
      ["minLength", { ...valid, nickname: "x" }],
      ["maxLength", { ...valid, nickname: "toolong" }],
      ["minItems", { ...valid, tags: [] }],
      ["maxItems", { ...valid, tags: ["aa", "bb", "cc"] }],
      ["items", { ...valid, tags: ["x"] }],
      ["nested required", { ...valid, details: {} }],
      ["closed nested object", { ...valid, details: { nested: "ready", host_path: "/home/owner/private" } }],
      ["integer type", { ...valid, revision: 1.5 }],
    ];

    for (const [keyword, actionInput] of invalidInputs) {
      const result = await executor.execute(ownerAuth, {
        memoryRoot: "/tmp/brain",
        auth: ownerAuth,
        correlationId: `schema-input-${keyword}`,
      }, "app_action_validate_schema", {
        action_input: actionInput,
      });

      expect(result, keyword).toMatchObject({
        status: "error",
        output: {
          code: "invalid_input",
          message: "App action input failed schema validation",
          recoverable: true,
        },
      });
      expect(JSON.stringify(result.output), keyword).not.toMatch(sensitiveMetadataPattern());
    }
    expect(executeAction).not.toHaveBeenCalled();

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "schema-input-valid",
    }, "app_action_validate_schema", {
      action_input: validAcceptedActionPayload(),
    })).resolves.toMatchObject({ status: "ok" });
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it("enforces every accepted app action schema keyword on app results before returning to the model", async () => {
    let appResult: unknown = validAcceptedActionPayload();
    const executeAction = vi.fn(async () => appResult);
    const executor = await buildSyntheticActionExecutor({
      inputSchema: acceptedActionJsonSchema(),
      resultSchema: acceptedActionJsonSchema(),
      executeAction,
    });
    const valid = validAcceptedActionPayload();
    const invalidResults: Array<[string, Record<string, unknown>]> = [
      ["required", (() => { const output = { ...valid }; delete output.mode; return output; })()],
      ["additionalProperties", { ...valid, provider_secret: "Authorization: Bearer should-not-leak" }],
      ["type union", { ...valid, nickname: 42 }],
      ["const enum", { ...valid, mode: "publish" }],
      ["format", { ...valid, reference_id: "not-a-uuid" }],
      ["minLength", { ...valid, nickname: "x" }],
      ["maxLength", { ...valid, nickname: "toolong" }],
      ["minItems", { ...valid, tags: [] }],
      ["maxItems", { ...valid, tags: ["aa", "bb", "cc"] }],
      ["items", { ...valid, tags: ["x"] }],
      ["nested required", { ...valid, details: {} }],
      ["closed nested object", { ...valid, details: { nested: "ready", host_path: "/home/owner/private" } }],
      ["integer type", { ...valid, revision: 1.5 }],
    ];

    for (const [keyword, resultPayload] of invalidResults) {
      appResult = resultPayload;
      const result = await executor.execute(ownerAuth, {
        memoryRoot: "/tmp/brain",
        auth: ownerAuth,
        correlationId: `schema-result-${keyword}`,
      }, "app_action_validate_schema", {
        action_input: validAcceptedActionPayload(),
      });

      expect(result, keyword).toMatchObject({
        status: "error",
        output: {
          code: "execution_failed",
          message: "App action result failed schema validation",
          recoverable: false,
        },
      });
      expect(JSON.stringify(result.output), keyword).not.toMatch(sensitiveMetadataPattern());
    }
    expect(executeAction).toHaveBeenCalledTimes(invalidResults.length);

    appResult = validAcceptedActionPayload();
    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "schema-result-valid",
    }, "app_action_validate_schema", {
      action_input: validAcceptedActionPayload(),
    })).resolves.toMatchObject({ status: "ok" });
  });

  it("denies model-visible actions whose capability is requested by the manifest but not granted", async () => {
    const router = fakeRouter({ record: null, results: [], reused: false });
    const { harness, host } = await setup({
      router,
      requestedCapabilities: ["career.context.read", "resume.definitions.read"],
      actions: [{
        action_version: 1,
        action_id: "read.profile",
        kind: "read",
        title: "Read Profile",
        description: "Read app-owned profile state.",
        ...actionSchemas("resume.profile.read.input.v1", "resume.profile.read.result.v1", profileReadInputSchema()),
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
        required_inference_purposes: [],
      }],
    });
    const launch = await host.launchChatWorkspace();
    const status = await harness.service.status();
    const grant = await harness.store.readGrant(status.grant_id!);
    await harness.store.saveGrant({ ...grant!, capabilities: ["career.context.read"] });
    const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
    const executor = new ToolExecutor(model.tools);
    const operationId = randomUUID();

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-action-grant",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: operationId,
      idempotency_key: `rbjc-action-grant-${operationId}`,
    })).resolves.toMatchObject({
      status: "error",
      output: { code: "permission_denied", message: "App action authority is unavailable" },
    });
    expect(vi.mocked(router.execute)).not.toHaveBeenCalled();
  });

  it("denies model-visible actions whose capability has no reviewed host registration", async () => {
    const router = fakeRouter({ record: null, results: [], reused: false });
    const { host } = await setup({
      router,
      requestedCapabilities: ["third.party.records.write"],
      actions: [{
        action_version: 1,
        action_id: "third.party.write",
        kind: "write",
        title: "Write Third Party Record",
        description: "Write through a capability that the host has not reviewed.",
        ...actionSchemas("third.party.write.input.v1", "third.party.write.result.v1"),
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "third.party.records.write", version: 1 }],
        required_inference_purposes: [],
      }],
    });
    const launch = await host.launchChatWorkspace();
    const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
    const executor = new ToolExecutor(model.tools);
    const operationId = randomUUID();

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-unregistered-capability",
    }, "app_action_third_party_write", {
      action_input: {},
      operation_id: operationId,
      idempotency_key: `rbjc-unregistered-capability-${operationId}`,
    })).resolves.toMatchObject({
      status: "error",
      output: { code: "permission_denied", message: "App action authority is unavailable" },
    });
    expect(vi.mocked(router.execute)).not.toHaveBeenCalled();
  });

  it("forwards Resume Builder chat profile and create actions as app-owned capability inputs", async () => {
    const router = fakeRouter({ definition: { metadata: { revision_id: randomUUID() } }, reused: false });
    const { host } = await setup({
      router,
      clientFactory: resumePlannerClientFactory,
      requestedCapabilities: ["resume.definitions.read", "resume.definitions.write"],
      documents: resumePlannerDocuments(),
      actions: [
        {
          action_version: 1,
          action_id: "resume.profile.read",
          kind: "read",
          title: "Read Resume Profile",
          description: "Read profile.",
          ...actionSchemas("resume.profile.read.input.v1", "resume.profile.read.result.v1", emptyObjectSchema(), profileDocumentReadResultSchema()),
          confirmation: "none",
          idempotency_policy: "not_applicable",
          model_exposure: "available",
          required_capabilities: [],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "resume.profile.update",
          kind: "write",
          title: "Update Resume Profile",
          description: "Update profile.",
          ...actionSchemas("resume.profile.update.input.v1", "resume.profile.update.result.v1", profileUpdateInputSchema()),
          confirmation: "none",
          idempotency_policy: "required",
          model_exposure: "available",
          required_capabilities: [{ name: "resume.definitions.write", version: 1 }],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "resume.create",
          kind: "render",
          title: "Create Resume",
          description: "Create resume.",
          ...actionSchemas("resume.create.input.v1", "resume.create.result.v1", resumeCreateInputSchema()),
          confirmation: "owner_confirmation",
          idempotency_policy: "required",
          model_exposure: "available",
          required_capabilities: [{ name: "resume.definitions.write", version: 1 }],
          required_inference_purposes: [],
        },
      ],
    });
    const launch = await host.launchChatWorkspace();
    const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
    const executor = new ToolExecutor(model.tools);
    const profileOperationId = randomUUID();
    const createOperationId = randomUUID();
    const profileInput = {
      profile_markdown: "# Resume Profile\n\nMaya Torres profile",
      completed_topics: ["direction", "experience"],
      current_topic: null,
    };
    const createInput = {
      title: "Maya Torres - Director of Product Operations",
      resume_markdown: [
        "# Maya Torres - Director of Product Operations",
        "",
        "## Summary",
        "Product operations leader for scaling SaaS teams.",
        "",
        "## Experience",
        "- Reduced launch slips by 38% across six product squads.",
      ].join("\n"),
    };

    expect(model.prompt_context).toContain("profile_markdown");
    expect(model.prompt_context).toContain("resume_markdown");

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-dispatch",
    }, "app_action_resume_profile_read", {
      action_input: {},
    })).resolves.toMatchObject({ status: "ok" });

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-dispatch",
    }, "app_action_resume_profile_update", {
      action_input: profileInput,
      operation_id: profileOperationId,
      idempotency_key: `rbjc-dispatch-${profileOperationId}`,
    })).resolves.toMatchObject({ status: "ok" });

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-dispatch",
    }, "app_action_resume_create", {
      action_input: createInput,
      operation_id: createOperationId,
      idempotency_key: `rbjc-dispatch-${createOperationId}`,
    })).resolves.toMatchObject({ status: "ok" });

    expect(vi.mocked(router.execute)).toHaveBeenNthCalledWith(
      1,
      "resume.definitions.write",
      expect.objectContaining({
        kind: "interview_progress",
        progress: expect.objectContaining({
          completed_topics: ["direction", "experience"],
          audit_turn: expect.objectContaining({ answer: "# Resume Profile\n\nMaya Torres profile" }),
        }),
      }),
      expect.objectContaining({ viewId: launch.session.view_id }),
    );
    expect(vi.mocked(router.execute)).toHaveBeenNthCalledWith(
      2,
      "resume.definitions.write",
      expect.objectContaining({
        definition_kind: "general",
        status: "proposed",
        template_id: "resume.single-column",
        statements: expect.arrayContaining([
          expect.objectContaining({ section_id: "experience", display_role: "bullet", text: "Reduced launch slips by 38% across six product squads." }),
        ]),
      }),
      expect.objectContaining({ viewId: launch.session.view_id, hostOwnerConfirmed: true }),
    );
  });

  it("routes model-visible inference actions through the installed-app inference executor", async () => {
    const inferenceExecute = vi.fn(async (raw: unknown, context: { appId: string; installationId: string; packageDigest: string; signal?: AbortSignal }) => ({
      inference_contract_version: 2,
      status: "completed",
      raw,
      context: {
        appId: context.appId,
        installationId: context.installationId,
        packageDigest: context.packageDigest,
        signalBound: context.signal instanceof AbortSignal,
      },
      result: { draft: "synthetic" },
    }));
    const { host } = await setup({
      requestedCapabilities: ["app.inference.request"],
      requestedInferencePurposes: [{ purpose_id: "resume.general-draft", version: 1 }],
      clientFactory: () => ({
        negotiate: async () => ({ connectionId: randomUUID() } as never),
        readAppResource: vi.fn(),
        callTool: vi.fn(),
        cancel: vi.fn(),
      }),
      installedAppInference: { execute: inferenceExecute } as unknown as HostOptions["installedAppInference"],
      actions: [{
        action_version: 1,
        action_id: "draft.resume",
        kind: "inspect",
        title: "Draft Resume",
        description: "Run an app-declared inference program.",
        ...actionSchemas("resume.draft.input.v1", "resume.draft.result.v1", {
          type: "object",
          additionalProperties: false,
          properties: {
            inference_contract_version: { type: "number", const: 2 },
            operation_id: { type: "string", format: "uuid" },
            program: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", minLength: 1, maxLength: 128 },
                version: { type: "number" },
              },
              required: ["id", "version"],
            },
            input: { type: "object", additionalProperties: true, properties: {}, required: [] },
          },
          required: ["inference_contract_version", "operation_id", "program", "input"],
        }),
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "app.inference.request", version: 1 }],
        required_inference_purposes: [{ purpose_id: "resume.general-draft", version: 1 }],
      }],
    });
    const launch = await host.launchChatWorkspace();
    const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
    const executor = new ToolExecutor(model.tools);
    const operationId = randomUUID();
    const actionInput = {
      inference_contract_version: 2,
      operation_id: operationId,
      program: { id: "resume.general-draft", version: 1 },
      input: { prompt: "synthetic" },
    };

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-004",
    }, "app_action_draft_resume", {
      action_input: actionInput,
      operation_id: operationId,
      idempotency_key: `rbjc-004-${operationId}`,
    })).resolves.toMatchObject({
      status: "ok",
      output: {
        action_id: "draft.resume",
        operation_id: operationId,
        result: {
          status: "completed",
          raw: actionInput,
          context: {
            appId: "ai.braindrive.resume-builder",
            installationId: launch.session.installation_id,
            packageDigest: launch.session.package_digest,
            signalBound: true,
          },
          result: { draft: "synthetic" },
        },
      },
    });
    expect(inferenceExecute).toHaveBeenCalledTimes(1);
  });

  it("propagates cancellation to in-flight session-scoped app actions when the chat session closes", async () => {
    let releaseAction!: () => void;
    let startedAction!: () => void;
    const started = new Promise<void>((resolve) => { startedAction = resolve; });
    const release = new Promise<void>((resolve) => { releaseAction = resolve; });
    const router = {
      domain: { store: { recoveryLifecycleEvidence: () => null } },
      execute: vi.fn(async (_capability: unknown, _input: unknown, context: { isCancelled?: () => boolean }) => {
        startedAction();
        await release;
        return { cancelled: context.isCancelled?.() === true };
      }),
    } as unknown as ResumeCapabilityRouter;
    const { host } = await setup({
      router,
      requestedCapabilities: ["resume.definitions.read"],
      actions: [{
        action_version: 1,
        action_id: "read.profile",
        kind: "read",
        title: "Read Profile",
        description: "Read app-owned profile state.",
        ...actionSchemas("resume.profile.read.input.v1", "resume.profile.read.result.v1", profileReadInputSchema()),
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
        required_inference_purposes: [],
      }],
    });
    const launch = await host.launchChatWorkspace();
    const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
    const executor = new ToolExecutor(model.tools);
    const operationId = randomUUID();
    const pending = executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-004",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: operationId,
      idempotency_key: `rbjc-004-${operationId}`,
    });

    await started;
    expect(host.close(launch.session.session_id)).toBe(true);
    releaseAction();
    await expect(pending).resolves.toMatchObject({
      status: "error",
      output: { code: "execution_failed", message: "App action was cancelled", recoverable: true },
    });
  });

  it("propagates cancellation to in-flight app-chat actions on host shutdown", async () => {
    let releaseAction!: () => void;
    let startedAction!: () => void;
    const started = new Promise<void>((resolve) => { startedAction = resolve; });
    const release = new Promise<void>((resolve) => { releaseAction = resolve; });
    const router = {
      domain: { store: { recoveryLifecycleEvidence: () => null } },
      execute: vi.fn(async (_capability: unknown, _input: unknown, context: { isCancelled?: () => boolean }) => {
        startedAction();
        await release;
        return { cancelled: context.isCancelled?.() === true };
      }),
    } as unknown as ResumeCapabilityRouter;
    const { host } = await setup({
      router,
      requestedCapabilities: ["resume.definitions.read"],
      actions: [{
        action_version: 1,
        action_id: "read.profile",
        kind: "read",
        title: "Read Profile",
        description: "Read app-owned profile state.",
        ...actionSchemas("resume.profile.read.input.v1", "resume.profile.read.result.v1", profileReadInputSchema()),
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
        required_inference_purposes: [],
      }],
    });
    const launch = await host.launchChatWorkspace();
    const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
    const executor = new ToolExecutor(model.tools);
    const operationId = randomUUID();
    const pending = executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-006",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: operationId,
      idempotency_key: `rbjc-006-${operationId}`,
    });

    await started;
    await host.closeAll();
    releaseAction();
    await expect(pending).resolves.toMatchObject({
      status: "error",
      output: { code: "execution_failed", message: "App action was cancelled", recoverable: true },
    });
    await expect(host.buildChatWorkspaceModelContext(metadataFor(launch))).rejects.toMatchObject({ code: "session_closed" });
  });

  it("denies stale, wrong-scope, and idempotency-conflicting model app action calls", async () => {
    const router = fakeRouter({ record: null, results: [], reused: false });
    const { harness, host } = await setup({
      router,
      requestedCapabilities: ["resume.definitions.read"],
      actions: [{
        action_version: 1,
        action_id: "read.profile",
        kind: "read",
        title: "Read Profile",
        description: "Read app-owned profile state.",
        ...actionSchemas("resume.profile.read.input.v1", "resume.profile.read.result.v1", profileReadInputSchema()),
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
        required_inference_purposes: [],
      }],
    });
    const launch = await host.launchChatWorkspace();
    await expect(host.buildChatWorkspaceModelContext({
      ...metadataFor(launch),
      workspace_id: "wrong.workspace",
    })).rejects.toMatchObject({ code: "denied" });

    const model = await host.buildChatWorkspaceModelContext(metadataFor(launch));
    const executor = new ToolExecutor(model.tools);
    const operationId = randomUUID();
    const idempotencyKey = `rbjc-004-${operationId}`;
    await executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-004",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: operationId,
      idempotency_key: idempotencyKey,
    });
    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-004",
    }, "app_action_read_profile", {
      action_input: { view: "workspace" },
      operation_id: operationId,
      idempotency_key: idempotencyKey,
    })).resolves.toMatchObject({
      status: "error",
      output: {
        code: "invalid_input",
        message: "App action operation identity was already used with different input",
        recoverable: true,
      },
    });

    await harness.service.disable({ idempotencyKey: "rbjc-004-disable-stale-model-session" });
    await expect(host.buildChatWorkspaceModelContext(metadataFor(launch))).rejects.toMatchObject({ code: "session_closed" });
  });

  it("denies closed and superseded reload session action authority without durable router work", async () => {
    const router = fakeRouter({ record: null, results: [], reused: false });
    const { host } = await setup({
      router,
      requestedCapabilities: ["resume.definitions.read"],
      actions: [{
        action_version: 1,
        action_id: "read.profile",
        kind: "read",
        title: "Read Profile",
        description: "Read app-owned profile state.",
        ...actionSchemas("resume.profile.read.input.v1", "resume.profile.read.result.v1", profileReadInputSchema()),
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
        required_inference_purposes: [],
      }],
    });
    const first = await host.launchChatWorkspace();
    const firstModel = await host.buildChatWorkspaceModelContext(metadataFor(first));
    const firstExecutor = new ToolExecutor(firstModel.tools);
    const closedOperationId = randomUUID();

    expect(host.close(first.session.session_id)).toBe(true);
    await expect(firstExecutor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-006",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: closedOperationId,
      idempotency_key: `rbjc-006-${closedOperationId}`,
    })).resolves.toMatchObject({
      status: "error",
      output: {
        code: "permission_denied",
        message: "App-chat session authority is no longer current",
        recoverable: true,
      },
    });

    const active = await host.launchChatWorkspace();
    const oldModel = await host.buildChatWorkspaceModelContext(metadataFor(active));
    const oldExecutor = new ToolExecutor(oldModel.tools);
    const resumed = await host.launchChatWorkspace({
      resume: {
        sessionId: active.session.session_id,
        viewId: active.session.view_id,
        operationId: active.session.operation_id,
        sessionGeneration: active.session.session_generation,
      },
    });
    const staleOperationId = randomUUID();
    await expect(oldExecutor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-006",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: staleOperationId,
      idempotency_key: `rbjc-006-${staleOperationId}`,
    })).resolves.toMatchObject({
      status: "error",
      output: { code: "permission_denied" },
    });

    const currentModel = await host.buildChatWorkspaceModelContext(metadataFor(resumed));
    const currentExecutor = new ToolExecutor(currentModel.tools);
    const currentOperationId = randomUUID();
    await expect(currentExecutor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-006",
    }, "app_action_read_profile", {
      action_input: {},
      operation_id: currentOperationId,
      idempotency_key: `rbjc-006-${currentOperationId}`,
    })).resolves.toMatchObject({ status: "ok" });
    expect(vi.mocked(router.execute)).toHaveBeenCalledTimes(1);
  });
});
