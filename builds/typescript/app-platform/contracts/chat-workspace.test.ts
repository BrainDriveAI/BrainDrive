import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AppPresentationSetSchema,
  ChatWorkspaceDescriptorSchema,
  GenericPackageManifestSchema,
  type GenericPackageManifest,
} from "./app-registry.js";

const directory = dirname(fileURLToPath(import.meta.url));
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(directory, "fixtures", path), "utf8"));
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
    retention_policy: "retain_owner_data_remove_runtime_authority",
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
        input_schema_id: "resume.profile.update.input.v1",
        result_schema_id: "resume.profile.update.result.v1",
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
