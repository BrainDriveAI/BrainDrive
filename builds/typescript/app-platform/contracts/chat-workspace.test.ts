import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AppActionJsonSchemaBodySchema,
  AppPresentationSetSchema,
  ChatWorkspaceDescriptorSchema,
  DEFAULT_APP_RETENTION_POLICY,
  GenericPackageManifestSchema,
  type GenericPackageManifest,
} from "./app-registry.js";
import { canonicalInputDigest } from "./common.js";

const directory = dirname(fileURLToPath(import.meta.url));
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(directory, "fixtures", path), "utf8"));
}

function actionSchema(schemaId: string, schema: Record<string, unknown>) {
  return {
    schema_id: schemaId,
    schema_version: 1,
    content_digest: canonicalInputDigest(schema),
    schema,
  };
}

function actionSchemas(inputSchemaId: string, resultSchemaId: string, inputSchema: Record<string, unknown> = emptyObjectSchema()) {
  return {
    input_schema: actionSchema(inputSchemaId, inputSchema),
    result_schema: actionSchema(resultSchemaId, emptyObjectSchema()),
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

function manifest(overrides: Partial<GenericPackageManifest> = {}): GenericPackageManifest {
  return GenericPackageManifestSchema.parse({
    manifest_version: 2,
    app_id: "ai.braindrive.resume-builder",
    publisher_id: "ai.braindrive",
    package_version: "1.0.0",
    catalog: {
      display_name: "Resume Builder",
      summary: "Synthetic app-chat contract fixture",
      icon: null,
      retention_summary: "Owner data is retained when app runtime authority is removed.",
    },
    archive: {
      format: "zip",
      profile: "braindrive-zip-v1",
      compression: "store",
      layout_version: 1,
      manifest_path: "manifest.json",
      undeclared_entries: "reject",
      links_and_device_nodes: "reject",
      max_file_count: 256,
      max_compressed_bytes: 67_108_864,
      max_uncompressed_bytes: 268_435_456,
    },
    files: [
      { path: "payload/resources/agent-instructions.md", kind: "file", mode: "read_only", size_bytes: 321, digest: digest("f") },
      { path: "payload/resources/profile-template.md", kind: "file", mode: "read_only", size_bytes: 654, digest: digest("d") },
      { path: "payload/server/dist/index.js", kind: "file", mode: "executable", size_bytes: 123, digest: digest("a") },
      { path: "payload/ui/main.html", kind: "file", mode: "read_only", size_bytes: 789, digest: digest("e") },
      { path: "provenance/intoto.jsonl", kind: "file", mode: "read_only", size_bytes: 456, digest: digest("b") },
      { path: "sbom/cyclonedx.json", kind: "file", mode: "read_only", size_bytes: 789, digest: digest("c") },
    ],
    platform_artifacts: [
      { target: "docker_linux_x64", os: "linux", architecture: "x64", runtime_kind: "packaged_node", entrypoint: "payload/server/dist/index.js" },
      { target: "desktop_windows_x64", os: "windows", architecture: "x64", runtime_kind: "packaged_node", entrypoint: "payload/server/dist/index.js" },
    ],
    compatibility: {
      app_contract: 1,
      host_min_version: "26.7.23",
      mcp_protocol: "2026-07-28",
      mcp_apps: { extension_id: "io.modelcontextprotocol/ui", version: "2026-01-26" },
      data_contract_version: 4,
    },
    primary_resource: {
      resource_version: 1,
      uri: "ui://resume-builder/main",
      package_path: "payload/ui/main.html",
      mime_type: "text/html;profile=mcp-app",
      content_digest: digest("e"),
    },
    requested_capabilities: [
      { name: "career.context.read", version: 1 },
      { name: "resume.definitions.read", version: 1 },
      { name: "resume.definitions.write", version: 1 },
      { name: "resume.export.request", version: 1 },
    ],
    requested_inference_purposes: [{ purpose_id: "resume.generate", version: 1 }],
    provenance_path: "provenance/intoto.jsonl",
    sbom_path: "sbom/cyclonedx.json",
    retention_policy: DEFAULT_APP_RETENTION_POLICY,
    presentations: {
      presentation_set_version: 1,
      default_presentation_id: "chat",
      profiles: [
        {
          profile_version: 1,
          presentation_id: "chat",
          type: "chat_workspace",
          label: "Just Chat With It",
          description: "Open the app in a native BrainDrive chat workspace.",
          workspace_id: "resume.chat",
          owner_visibility: "primary",
        },
        {
          profile_version: 1,
          presentation_id: "surface",
          type: "surface",
          label: "Open App",
          description: "Open the packaged sandboxed app surface.",
          resource_uri: "ui://resume-builder/main",
          owner_visibility: "internal",
        },
      ],
      workspaces: [ChatWorkspaceDescriptorSchema.parse(awaitedWorkspace())],
    },
    ...overrides,
  });
}

function awaitedWorkspace(): unknown {
  return {
    workspace_version: 1,
    workspace_id: "resume.chat",
    title: "Resume Workspace",
    description: "Chat with the app and inspect app-owned documents.",
    default_document_id: "conversation",
    empty_state: {
      empty_state_version: 1,
      heading: "Let's build your resume",
      description: "Tell me the role you want, paste an existing resume, or describe your experience.",
      cta_label: "Let's get started",
      cta_message: "I want to build my resume.",
    },
    documents: [
      {
        document_version: 1,
        document_id: "conversation",
        role: "conversation",
        title: "Conversation",
        description: "Native BrainDrive conversation for the app workspace.",
        editable: false,
        default_visibility: "primary",
        model_access: "read_write_draft",
        resource_id: null,
        data_binding_id: null,
      },
      {
        document_version: 1,
        document_id: "profile",
        role: "source_document",
        title: "Your Resume Profile",
        description: "Editable owner-reviewed source document.",
        editable: true,
        default_visibility: "primary",
        model_access: "read_write_draft",
        resource_id: null,
        data_binding_id: "resume.profile",
        initial_content: {
          initial_content_version: 1,
          source: "package_file",
          package_path: "payload/resources/profile-template.md",
          media_type: "text/markdown",
          content_digest: digest("d"),
          seed_policy: "when_missing",
        },
      },
      {
        document_version: 1,
        document_id: "instructions",
        role: "advanced_resource",
        title: "Agent Instructions",
        description: "Package-owned app instructions exposed for inspection.",
        editable: false,
        default_visibility: "advanced",
        model_access: "read_reference",
        resource_id: "agent.instructions",
        data_binding_id: null,
      },
    ],
    resources: [
      {
        resource_version: 1,
        resource_id: "agent.instructions",
        role: "agent_instructions",
        title: "Agent Instructions",
        description: "Digest-bound package instructions.",
        package_path: "payload/resources/agent-instructions.md",
        media_type: "text/markdown",
        content_digest: digest("f"),
        owner_editable: false,
        prompt_inclusion: "workspace_start",
      },
    ],
    context_requests: [
      {
        context_version: 1,
        context_id: "career.summary",
        kind: "career_context",
        title: "Career Context",
        description: "Purpose-limited career summary when the owner grants access.",
        required: false,
        max_bytes: 65_536,
        freshness_policy: "latest_available",
        required_capabilities: [{ name: "career.context.read", version: 1 }],
      },
    ],
    actions: [
      {
        action_version: 1,
        action_id: "resume.profile.update",
        kind: "write",
        title: "Update Profile",
        description: "Request an app-owned source document update.",
        ...actionSchemas("resume.profile.update.input.v1", "resume.profile.update.result.v1", {
          type: "object",
          additionalProperties: false,
          properties: {
            profile_markdown: { type: "string", minLength: 1, maxLength: 65536 },
            completed_topics: { type: "array", items: { type: "string", minLength: 1, maxLength: 64 }, maxItems: 32 },
            current_topic: { type: ["string", "null"], maxLength: 64 },
          },
          required: ["profile_markdown", "completed_topics", "current_topic"],
        }),
        confirmation: "none",
        idempotency_policy: "required",
        model_exposure: "available",
        required_capabilities: [{ name: "resume.definitions.write", version: 1 }],
        required_inference_purposes: [],
      },
    ],
  };
}

describe("chat workspace descriptor contracts", () => {
  it("accepts app actions with concrete digest-bound input and result schemas", () => {
    const parsed = ChatWorkspaceDescriptorSchema.parse(awaitedWorkspace());
    expect(parsed.empty_state).toMatchObject({ cta_label: "Let's get started" });
    expect(parsed.documents.find((document) => document.document_id === "profile")?.initial_content).toMatchObject({
      package_path: "payload/resources/profile-template.md",
      content_digest: digest("d"),
    });
    expect(parsed.actions[0].input_schema.schema.properties).toHaveProperty("profile_markdown");
    expect(parsed.actions[0].input_schema.content_digest).toBe(canonicalInputDigest(parsed.actions[0].input_schema.schema));
    expect(parsed.actions[0].result_schema.schema).toEqual(emptyObjectSchema());
  });

  it("accepts owner-editable package resources only through bound seeded app documents", () => {
    const workspace = awaitedWorkspace() as {
      documents: Array<Record<string, unknown>>;
      resources: Array<Record<string, unknown>>;
    };
    workspace.resources[0] = { ...workspace.resources[0]!, owner_editable: true };
    workspace.documents[2] = {
      ...workspace.documents[2]!,
      editable: true,
      model_access: "read_write_draft",
      data_binding_id: "agent.instructions.owner",
      initial_content: {
        initial_content_version: 1,
        source: "package_file",
        package_path: "payload/resources/agent-instructions.md",
        media_type: "text/markdown",
        content_digest: digest("f"),
        seed_policy: "when_missing",
      },
      presentation: {
        presentation_version: 1,
        renderer: "markdown_document",
        chrome: "document",
        title: "Agent Instructions.md",
        subtitle: "Owner editable app instructions",
        header_actions: [
          { type: "back_to_chat", label: "Back to chat" },
          { type: "edit_document", label: "Edit" },
        ],
      },
    };

    const parsed = ChatWorkspaceDescriptorSchema.parse(workspace);

    expect(parsed.resources[0].owner_editable).toBe(true);
    expect(parsed.documents.find((document) => document.document_id === "instructions")).toMatchObject({
      editable: true,
      resource_id: "agent.instructions",
      data_binding_id: "agent.instructions.owner",
    });
  });

  it("rejects owner-editable resources that do not declare an editable seeded override document", () => {
    const workspace = ChatWorkspaceDescriptorSchema.parse(awaitedWorkspace());

    expect(ChatWorkspaceDescriptorSchema.safeParse({
      ...workspace,
      resources: [{ ...workspace.resources[0]!, owner_editable: true }],
    }).success).toBe(false);
  });

  it("rejects initial document content that does not bind a declared immutable package file", () => {
    const parsed = manifest();
    const workspace = parsed.presentations!.workspaces[0]!;
    const documents = workspace.documents.map((document) => document.document_id === "profile"
      ? { ...document, initial_content: { ...document.initial_content!, content_digest: digest("0") } }
      : document);

    expect(GenericPackageManifestSchema.safeParse({
      ...parsed,
      presentations: {
        ...parsed.presentations!,
        workspaces: [{ ...workspace, documents }],
      },
    }).success).toBe(false);
  });

  it("rejects unsafe app-declared empty-state copy before it reaches the client", () => {
    const workspace = ChatWorkspaceDescriptorSchema.parse(awaitedWorkspace());

    expect(ChatWorkspaceDescriptorSchema.safeParse({
      ...workspace,
      empty_state: {
        ...workspace.empty_state!,
        cta_message: "https://example.invalid/start",
      },
    }).success).toBe(false);
  });

  it("rejects model-visible actions that keep only opaque input/result schema ids", () => {
    const workspace = awaitedWorkspace() as { actions: Array<Record<string, unknown>> };
    workspace.actions = [{
      ...workspace.actions[0],
      input_schema: undefined,
      result_schema: undefined,
      input_schema_id: "resume.profile.update.input.v1",
      result_schema_id: "resume.profile.update.result.v1",
    }];
    expect(ChatWorkspaceDescriptorSchema.safeParse(workspace).success).toBe(false);
  });

  it("rejects missing schemas, duplicate schema ids, digest mismatches, and unsafe schema bodies", () => {
    const workspace = ChatWorkspaceDescriptorSchema.parse(awaitedWorkspace());
    const action = workspace.actions[0];

    expect(ChatWorkspaceDescriptorSchema.safeParse({
      ...workspace,
      actions: [{ ...action, result_schema: undefined }],
    }).success).toBe(false);

    expect(ChatWorkspaceDescriptorSchema.safeParse({
      ...workspace,
      actions: [{ ...action, result_schema: { ...action.result_schema, schema_id: action.input_schema.schema_id } }],
    }).success).toBe(false);

    expect(ChatWorkspaceDescriptorSchema.safeParse({
      ...workspace,
      actions: [{ ...action, input_schema: { ...action.input_schema, content_digest: digest("1") } }],
    }).success).toBe(false);

    expect(ChatWorkspaceDescriptorSchema.safeParse({
      ...workspace,
      actions: [{
        ...action,
        input_schema: actionSchema("resume.profile.unsafe.input.v1", {
          type: "object",
          additionalProperties: false,
          properties: { payload: { $ref: "https://example.invalid/schema.json" } },
          required: ["payload"],
        }),
      }],
    }).success).toBe(false);

    const oversizedDescription = "x".repeat(20_000);
    expect(ChatWorkspaceDescriptorSchema.safeParse({
      ...workspace,
      actions: [{
        ...action,
        input_schema: actionSchema("resume.profile.oversized.input.v1", {
          type: "object",
          additionalProperties: false,
          properties: { payload: { type: "string", description: oversizedDescription } },
          required: ["payload"],
        }),
      }],
    }).success).toBe(false);
  });

  it("rejects app action JSON Schema keywords outside the runtime-enforced subset", () => {
    const base = {
      type: "object",
      additionalProperties: false,
      properties: {
        value: { type: "string", minLength: 1, maxLength: 64 },
      },
      required: ["value"],
    };
    const unsupportedSchemas: Array<[string, Record<string, unknown>]> = [
      ["minimum", { ...base, properties: { count: { type: "number", minimum: 1 } }, required: ["count"] }],
      ["maximum", { ...base, properties: { count: { type: "number", maximum: 5 } }, required: ["count"] }],
      ["pattern", { ...base, properties: { value: { type: "string", pattern: "^[a-z]+$" } } }],
      ["oneOf", { ...base, oneOf: [{ required: ["value"] }] }],
      ["anyOf", { ...base, anyOf: [{ required: ["value"] }] }],
      ["allOf", { ...base, allOf: [{ required: ["value"] }] }],
      ["not", { ...base, not: { required: ["blocked"] } }],
      ["uniqueItems", { ...base, properties: { values: { type: "array", uniqueItems: true } }, required: ["values"] }],
      ["unsupported format", { ...base, properties: { value: { type: "string", format: "email" } } }],
      ["remote ref", { ...base, properties: { value: { $ref: "https://example.invalid/action.schema.json" } } }],
    ];

    for (const [keyword, schema] of unsupportedSchemas) {
      expect(AppActionJsonSchemaBodySchema.safeParse(schema).success, keyword).toBe(false);
    }
  });

  it("accepts the positive descriptor fixture and rejects duplicate workspace document ids", async () => {
    expect(ChatWorkspaceDescriptorSchema.safeParse(await fixture("valid/chat-workspace-descriptor.json")).success).toBe(true);
    expect(ChatWorkspaceDescriptorSchema.safeParse(await fixture("invalid/chat-workspace-duplicate-document.json")).success).toBe(false);
  });

  it("accepts optional chat presentations while preserving surface-only manifest compatibility", () => {
    expect(manifest().presentations?.default_presentation_id).toBe("chat");
    const surfaceOnly = GenericPackageManifestSchema.parse({ ...manifest(), presentations: undefined });
    expect(surfaceOnly.presentations).toBeUndefined();
  });

  it("rejects malformed descriptor references and unsafe widening attempts", () => {
    expect(GenericPackageManifestSchema.safeParse({
      ...manifest(),
      presentations: {
        ...manifest().presentations!,
        profiles: [{ ...manifest().presentations!.profiles[0], workspace_id: "missing.workspace" }],
      },
    }).success).toBe(false);

    expect(GenericPackageManifestSchema.safeParse({
      ...manifest(),
      presentations: {
        ...manifest().presentations!,
        default_presentation_id: "missing.presentation",
      },
    }).success).toBe(false);

    expect(GenericPackageManifestSchema.safeParse({
      ...manifest(),
      presentations: {
        ...manifest().presentations!,
        profiles: [{ ...manifest().presentations!.profiles[1], resource_uri: "ui://other-app/main" }],
      },
    }).success).toBe(false);

    const workspace = manifest().presentations!.workspaces[0];
    expect(GenericPackageManifestSchema.safeParse({
      ...manifest(),
      presentations: {
        ...manifest().presentations!,
        workspaces: [{ ...workspace, default_document_id: "missing.document" }],
      },
    }).success).toBe(false);

    expect(GenericPackageManifestSchema.safeParse({
      ...manifest(),
      presentations: {
        ...manifest().presentations!,
        workspaces: [{
          ...workspace,
          documents: workspace.documents.map((document) => document.document_id === "instructions" ? { ...document, resource_id: "missing.resource" } : document),
        }],
      },
    }).success).toBe(false);

    expect(GenericPackageManifestSchema.safeParse({
      ...manifest(),
      presentations: {
        ...manifest().presentations!,
        workspaces: [{
          ...workspace,
          resources: [{ ...workspace.resources[0], content_digest: digest("0") }],
        }],
      },
    }).success).toBe(false);

    expect(GenericPackageManifestSchema.safeParse({
      ...manifest(),
      presentations: {
        ...manifest().presentations!,
        workspaces: [{
          ...workspace,
          context_requests: [{
            ...workspace.context_requests[0],
            required_capabilities: [{ name: "career.files.read", version: 1 }],
          }],
        }],
      },
    }).success).toBe(false);

    expect(GenericPackageManifestSchema.safeParse({
      ...manifest(),
      presentations: {
        ...manifest().presentations!,
        workspaces: [{
          ...workspace,
          actions: [{
            ...workspace.actions[0],
            required_inference_purposes: [{ purpose_id: "resume.unreviewed", version: 1 }],
          }],
        }],
      },
    }).success).toBe(false);
  });

  it("keeps presentation set parsing declarative and strict", () => {
    const parsed = AppPresentationSetSchema.parse(manifest().presentations);
    expect(parsed.workspaces[0].actions[0]).not.toHaveProperty("handler");
    expect(AppPresentationSetSchema.safeParse({ ...parsed, handler: "host.internal.execute" }).success).toBe(false);
    expect(AppPresentationSetSchema.safeParse({
      ...parsed,
      profiles: [{ ...parsed.profiles[0], label: "Open [unsafe](https://example.com)" }],
    }).success).toBe(false);
  });
});
