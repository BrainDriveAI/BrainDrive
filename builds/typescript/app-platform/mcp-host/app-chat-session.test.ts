import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSyntheticFirstPartyFixtureRepository } from "../lifecycle/fixture-repository.js";
import { createLifecycleHarness } from "../lifecycle/test-helpers.js";
import { ResumeAppHostAdapter } from "./resume-host-adapter.js";
import type { AppChatWorkspaceLaunch } from "./app-host-types.js";
import { buildAppChatModelContext, parseAppChatModelMetadata, type AppChatModelMetadata } from "./app-chat-model.js";
import type { ChatWorkspaceDescriptor } from "../contracts/app-registry.js";
import type { ResumeCapabilityRouter } from "../../resume-domain/capabilities.js";
import { ToolExecutor } from "../../engine/tool-executor.js";
import type { AuthContext } from "../../contracts.js";

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

function workspace(
  contextRequests: ChatWorkspaceDescriptor["context_requests"] = [],
  overrides: Partial<Pick<ChatWorkspaceDescriptor, "resources" | "actions">> = {},
): ChatWorkspaceDescriptor {
  return {
    workspace_version: 1,
    workspace_id: "resume.chat",
    title: "Resume Workspace",
    description: "Native app-chat workspace fixture.",
    default_document_id: "conversation",
    documents: [{
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
  actions?: ChatWorkspaceDescriptor["actions"];
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
  const chatWorkspace = workspace(input.contextRequests, { actions: input.actions });
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
      clientFactory: input.clientFactory,
      installedAppInference: input.installedAppInference,
    }),
  };
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
        input_schema_id: "resume.profile.inspect.input.v1",
        result_schema_id: "resume.profile.inspect.result.v1",
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
          input_schema_id: "resume.profile.read.input.v1",
          result_schema_id: "resume.profile.read.result.v1",
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
          input_schema_id: "resume.hidden.write.input.v1",
          result_schema_id: "resume.hidden.write.result.v1",
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
      output: { result: { reused: true } },
    });
    expect(vi.mocked(router.execute)).toHaveBeenCalledTimes(1);
  });

  it("translates Resume Builder chat profile and create actions into owner-authored domain writes", async () => {
    const router = fakeRouter({ definition: { metadata: { revision_id: randomUUID() } }, reused: false });
    const { host } = await setup({
      router,
      requestedCapabilities: ["resume.definitions.read", "resume.definitions.write"],
      actions: [
        {
          action_version: 1,
          action_id: "resume.profile.read",
          kind: "read",
          title: "Read Resume Profile",
          description: "Read profile.",
          input_schema_id: "resume.profile.read.input.v1",
          result_schema_id: "resume.profile.read.result.v1",
          confirmation: "none",
          idempotency_policy: "not_applicable",
          model_exposure: "available",
          required_capabilities: [{ name: "resume.definitions.read", version: 1 }],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "resume.profile.update",
          kind: "write",
          title: "Update Resume Profile",
          description: "Update profile.",
          input_schema_id: "resume.profile.update.input.v1",
          result_schema_id: "resume.profile.update.result.v1",
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
          input_schema_id: "resume.create.input.v1",
          result_schema_id: "resume.create.result.v1",
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

    expect(model.prompt_context).toContain("profile_markdown");
    expect(model.prompt_context).toContain("resume_markdown");

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-translate",
    }, "app_action_resume_profile_read", {
      action_input: {},
    })).resolves.toMatchObject({ status: "ok" });

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-translate",
    }, "app_action_resume_profile_update", {
      action_input: { profile_markdown: "Maya Torres profile", completed_topics: ["direction", "experience"], current_topic: null },
      operation_id: profileOperationId,
      idempotency_key: `rbjc-translate-${profileOperationId}`,
    })).resolves.toMatchObject({ status: "ok" });

    await expect(executor.execute(ownerAuth, {
      memoryRoot: "/tmp/brain",
      auth: ownerAuth,
      correlationId: "rbjc-translate",
    }, "app_action_resume_create", {
      action_input: {
        title: "Maya Torres - Director of Product Operations",
        resume_markdown: [
          "# Maya Torres",
          "## Summary",
          "Director of Product Operations candidate with 9 years in SaaS operations.",
          "## Experience",
          "- Reduced launch slips by 38% across six product squads.",
        ].join("\n"),
      },
      operation_id: createOperationId,
      idempotency_key: `rbjc-translate-${createOperationId}`,
    })).resolves.toMatchObject({ status: "ok" });

    expect(vi.mocked(router.execute)).toHaveBeenNthCalledWith(
      1,
      "resume.definitions.read",
      { view: "workspace" },
      expect.objectContaining({ viewId: launch.session.view_id }),
    );
    expect(vi.mocked(router.execute)).toHaveBeenNthCalledWith(
      2,
      "resume.definitions.write",
      expect.objectContaining({
        kind: "interview_progress",
        progress: expect.objectContaining({
          status: "review_needed",
          draft_state: "owner_reviewed",
          audit_turn: expect.objectContaining({ answer: "Maya Torres profile" }),
        }),
      }),
      expect.objectContaining({ viewId: launch.session.view_id }),
    );
    expect(vi.mocked(router.execute)).toHaveBeenNthCalledWith(
      3,
      "resume.definitions.write",
      expect.objectContaining({
        definition_kind: "general",
        status: "proposed",
        title: "Maya Torres - Director of Product Operations",
        statements: expect.arrayContaining([
          expect.objectContaining({ section_id: "summary", text: "Summary", display_role: "heading" }),
          expect.objectContaining({ section_id: "experience", text: "Reduced launch slips by 38% across six product squads.", display_role: "bullet" }),
        ]),
        section_order: ["summary", "experience"],
        prompt_policy_version: null,
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
        input_schema_id: "resume.draft.input.v1",
        result_schema_id: "resume.draft.result.v1",
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
        input_schema_id: "resume.profile.read.input.v1",
        result_schema_id: "resume.profile.read.result.v1",
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
      status: "ok",
      output: { result: { cancelled: true } },
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
        input_schema_id: "resume.profile.read.input.v1",
        result_schema_id: "resume.profile.read.result.v1",
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
      status: "ok",
      output: { result: { cancelled: true } },
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
        input_schema_id: "resume.profile.read.input.v1",
        result_schema_id: "resume.profile.read.result.v1",
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
        input_schema_id: "resume.profile.read.input.v1",
        result_schema_id: "resume.profile.read.result.v1",
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
