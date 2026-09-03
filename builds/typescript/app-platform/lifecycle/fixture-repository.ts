import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalInputDigest, canonicalJson, canonicalJsonDocumentDigest, canonicalSignedBytes } from "../contracts/common.js";
import { DEFAULT_APP_RETENTION_POLICY, GenericPackageManifestSchema, type GenericPackageManifest } from "../contracts/app-registry.js";
import { z } from "zod";
import {
  PackageDescriptorSchema,
  PackageManifestSchema,
  PackageSourceIndexSchema,
  releaseKeyAuthorizationPayload,
  RevocationListSchema,
  TrustRootSchema,
} from "../contracts/package.js";
import { AppPlatformError } from "./errors.js";
import { createStoredZip } from "./zip.js";

type Descriptor = z.infer<typeof PackageDescriptorSchema>;
type SourceIndex = z.infer<typeof PackageSourceIndexSchema>;
type Revocations = z.infer<typeof RevocationListSchema>;
type ModernPresentations = NonNullable<GenericPackageManifest["presentations"]>;
type ModernResourceRole = ModernPresentations["workspaces"][number]["resources"][number]["role"];
type ModernPromptInclusion = ModernPresentations["workspaces"][number]["resources"][number]["prompt_inclusion"];
type ModernActionSchemaResource = ModernPresentations["workspaces"][number]["actions"][number]["input_schema"];

const PersistedGenericSourceIndexSchema = z.object({
  payload: z.object({
    index_version: z.literal(2),
    entries: z.array(z.object({ app_id: z.string().min(1), package_version: z.string().min(1) }).passthrough()).min(1),
  }).passthrough(),
}).passthrough();

export type FixtureRepository = {
  root: string;
  trustRootPath: string;
  sourceIndexPath: string;
  revocationListPath: string;
  packages: Record<string, { archivePath: string; descriptorPath: string }>;
  packagesByAppVersion?: Record<string, { archivePath: string; descriptorPath: string }>;
  authoritiesByVersion?: Record<string, {
    trustRootPath: string;
    sourceIndexPath: string;
    revocationListPath: string;
  }>;
  authoritiesByAppVersion?: Record<string, {
    trustRootPath: string;
    sourceIndexPath: string;
    revocationListPath: string;
  }>;
  signer?: (domain: string, payload: unknown) => string;
  releaseKeyId?: string;
  signersByAppVersion?: Record<string, (domain: string, payload: unknown) => string>;
  releaseKeyIdsByAppVersion?: Record<string, string>;
};

export type SyntheticFirstPartyFixture = {
  appId: string;
  routeKey: string;
  displayName: string;
  summary?: string;
  version: string;
  resourceHtml?: string;
  requestedCapabilities?: readonly string[];
  requestedInferencePurposes?: readonly { purpose_id: string; version: number }[];
  presentations?: GenericPackageManifest["presentations"];
};

function appVersionKey(appId: string, version: string): string {
  return `${appId}@${version}`;
}

/** Creates task-owned signed generic fixtures; it is not a public package source. */
export async function createSyntheticFirstPartyFixtureRepository(
  root: string,
  apps: readonly SyntheticFirstPartyFixture[],
): Promise<FixtureRepository> {
  const retained = await loadPersistedSyntheticFirstPartySources(root, new Set(apps.map((app) => appVersionKey(app.appId, app.version))));
  const packagesByAppVersion: NonNullable<FixtureRepository["packagesByAppVersion"]> = { ...retained.packages };
  const authoritiesByAppVersion: NonNullable<FixtureRepository["authoritiesByAppVersion"]> = { ...retained.authorities };
  const signersByAppVersion: NonNullable<FixtureRepository["signersByAppVersion"]> = {};
  const releaseKeyIdsByAppVersion: NonNullable<FixtureRepository["releaseKeyIdsByAppVersion"]> = {};
  for (const app of apps) {
    const appRoot = path.join(root, app.routeKey, app.version);
    await mkdir(appRoot, { recursive: true });
    const rootPair = generateKeyPairSync("ed25519");
    const releasePair = generateKeyPairSync("ed25519");
    const rootKeyId = `braindrive-app-root-${app.routeKey}-2026`;
    const releaseKeyId = `braindrive-app-release-${app.routeKey}-2026`;
    const signWith = (privateKey: typeof rootPair.privateKey, domain: string, payload: unknown) =>
      sign(null, Buffer.from(canonicalSignedBytes(domain, payload), "utf8"), privateKey).toString("base64");
    const releaseSigner = (domain: string, payload: unknown) => signWith(releasePair.privateKey, domain, payload);
    const releaseKey = {
      key_version: 1 as const, key_id: releaseKeyId, algorithm: "ed25519" as const,
      public_key: rawPublicKey(releasePair.publicKey), not_before: "2026-01-01T00:00:00.000Z",
      not_after: "2036-01-01T00:00:00.000Z", status: "active" as const,
      authorization: { signature_version: 1 as const, domain_separator: "BrainDrive-App-Release-Key-v1" as const, canonicalization: "braindrive-canonical-json-v1" as const, signature_algorithm: "ed25519" as const, signing_key_id: rootKeyId, signature: "" },
    };
    releaseKey.authorization.signature = signWith(rootPair.privateKey, releaseKey.authorization.domain_separator, releaseKeyAuthorizationPayload(releaseKey));
    const trustRoot = TrustRootSchema.parse({ trust_root_version: 1, trust_domain: "braindrive-app-release", root_key: { key_id: rootKeyId, algorithm: "ed25519", public_key: rawPublicKey(rootPair.publicKey), status: "active" }, threshold: 1, release_keys: [releaseKey] });
    const trustRootPath = path.join(appRoot, "trust-root.json");
    await writeJson(trustRootPath, trustRoot);

    const uiHtml = app.resourceHtml ?? `<main>${app.displayName}</main>`;
    const ui = Buffer.from(uiHtml, "utf8");
    const files = new Map<string, Buffer>([
      ["payload/docker/index.js", Buffer.from(syntheticFirstPartyServer(app, uiHtml), "utf8")],
      ["payload/ui/main.html", ui],
      ["provenance/build.jsonl", Buffer.from(`${canonicalJson({ builder: "braindrive-synthetic-fixture", version: app.version, source: "repository" })}\n`, "utf8")],
      ["sbom/cyclonedx.json", Buffer.from(`${canonicalJson({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1, components: [] })}\n`, "utf8")],
    ]);
    const manifest = GenericPackageManifestSchema.parse({
      manifest_version: 2, app_id: app.appId, publisher_id: "ai.braindrive", package_version: app.version,
      catalog: { display_name: app.displayName, summary: app.summary ?? `Create owner-controlled ${app.displayName.toLowerCase()} content.`, icon: null, retention_summary: `${app.displayName} owner data is retained after uninstall.` },
      archive: { format: "zip", profile: "braindrive-zip-v1", compression: "store", layout_version: 1, manifest_path: "manifest.json", undeclared_entries: "reject", links_and_device_nodes: "reject", max_file_count: 256, max_compressed_bytes: 67_108_864, max_uncompressed_bytes: 268_435_456 },
      files: [...files].map(([filePath, bytes]) => ({ path: filePath, kind: "file", mode: filePath.endsWith("/index.js") ? "executable" : "read_only", size_bytes: bytes.length, digest: digest(bytes) })).sort((a, b) => a.path.localeCompare(b.path)),
      platform_artifacts: [
        { target: "docker_linux_x64", os: "linux", architecture: "x64", runtime_kind: "packaged_node", entrypoint: "payload/docker/index.js" },
        { target: "desktop_windows_x64", os: "windows", architecture: "x64", runtime_kind: "packaged_node", entrypoint: "payload/docker/index.js" },
        { target: "desktop_macos_universal", os: "macos", architecture: "universal", runtime_kind: "packaged_node", entrypoint: "payload/docker/index.js" },
      ],
      compatibility: { app_contract: 1, host_min_version: "26.7.23", mcp_protocol: "2026-07-28", mcp_apps: { extension_id: "io.modelcontextprotocol/ui", version: "2026-01-26" }, data_contract_version: 1 },
      primary_resource: { resource_version: 1, uri: `ui://${app.routeKey}/main`, package_path: "payload/ui/main.html", mime_type: "text/html;profile=mcp-app", content_digest: digest(ui) },
      ...(app.presentations ? { presentations: app.presentations } : {}),
      requested_capabilities: (app.requestedCapabilities ?? ["career.context.read"]).map((name) => ({ name, version: 1 })),
      requested_inference_purposes: app.requestedInferencePurposes ?? [], provenance_path: "provenance/build.jsonl", sbom_path: "sbom/cyclonedx.json", retention_policy: DEFAULT_APP_RETENTION_POLICY,
    });
    const archive = createStoredZip([{ name: "manifest.json", bytes: Buffer.from(`${canonicalJson(manifest)}\n`), executable: false }, ...[...files].map(([name, bytes]) => ({ name, bytes, executable: name.endsWith("/index.js") }))]);
    const archivePath = path.join(appRoot, `${app.version}.bdapp`);
    await writeFile(archivePath, archive, { mode: 0o644 });
    const publishedAt = new Date().toISOString();
    const descriptorPayload = { descriptor_version: 2 as const, manifest, manifest_digest: canonicalJsonDocumentDigest(manifest), archive: { media_type: "application/vnd.braindrive.app+zip" as const, byte_length: archive.length, digest: digest(archive) }, published_at: publishedAt };
    const descriptor = { payload: descriptorPayload, signature: { signature_version: 1 as const, domain_separator: "BrainDrive-App-Package-v1" as const, canonicalization: "braindrive-canonical-json-v1" as const, signature_algorithm: "ed25519" as const, signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Package-v1", descriptorPayload) } };
    const descriptorPath = path.join(appRoot, `${app.version}.descriptor.json`);
    await writeJson(descriptorPath, descriptor);
    const sourcePayload = { index_version: 2 as const, sequence: 1, prior_index_digest: null, published_at: publishedAt, entries: [{ app_id: app.appId, publisher_id: "ai.braindrive", package_version: app.version, descriptor_digest: canonicalJsonDocumentDigest(descriptor), archive_digest: digest(archive), targets: ["docker_linux_x64", "desktop_windows_x64", "desktop_macos_universal"], sources: [{ environment: "docker_dev", kind: "repository_fixture", descriptor_fixture_id: `${app.routeKey}-${app.version}-descriptor`, archive_fixture_id: `${app.routeKey}-${app.version}-archive` }, { environment: "desktop_windows", kind: "release_https", descriptor_url: `https://releases.braindrive.ai/apps/${app.routeKey}/${app.version}.descriptor.json`, archive_url: `https://releases.braindrive.ai/apps/${app.routeKey}/${app.version}.bdapp` }, { environment: "desktop_macos", kind: "release_https", descriptor_url: `https://releases.braindrive.ai/apps/${app.routeKey}/${app.version}.descriptor.json`, archive_url: `https://releases.braindrive.ai/apps/${app.routeKey}/${app.version}.bdapp` }] }] };
    const sourceIndex = { payload: sourcePayload, signature: { signature_version: 1 as const, domain_separator: "BrainDrive-App-Source-Index-v1" as const, canonicalization: "braindrive-canonical-json-v1" as const, signature_algorithm: "ed25519" as const, signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Source-Index-v1", sourcePayload) } };
    const sourceIndexPath = path.join(appRoot, "source-index.json");
    await writeJson(sourceIndexPath, sourceIndex);
    const revocationPayload = { revocation_version: 2 as const, sequence: 1, prior_list_digest: null, issued_at: publishedAt, next_update_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), entries: [] };
    const revocations = { payload: revocationPayload, signature: { signature_version: 1 as const, domain_separator: "BrainDrive-App-Revocations-v1" as const, canonicalization: "braindrive-canonical-json-v1" as const, signature_algorithm: "ed25519" as const, signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Revocations-v1", revocationPayload) } };
    const revocationListPath = path.join(appRoot, "revocations.json");
    await writeJson(revocationListPath, revocations);
    const key = appVersionKey(app.appId, app.version);
    packagesByAppVersion[key] = { archivePath, descriptorPath };
    authoritiesByAppVersion[key] = { trustRootPath, sourceIndexPath, revocationListPath };
    signersByAppVersion[key] = releaseSigner;
    releaseKeyIdsByAppVersion[key] = releaseKeyId;
  }
  const first = apps[0];
  if (!first) throw new AppPlatformError("package_not_found", "Synthetic first-party fixture catalog is empty");
  const firstKey = appVersionKey(first.appId, first.version);
  const firstAuthority = authoritiesByAppVersion[firstKey]!;
  return { root, ...firstAuthority, packages: {}, packagesByAppVersion, authoritiesByAppVersion, signersByAppVersion, releaseKeyIdsByAppVersion };
}

async function loadPersistedSyntheticFirstPartySources(root: string, currentKeys: ReadonlySet<string>): Promise<{
  packages: NonNullable<FixtureRepository["packagesByAppVersion"]>;
  authorities: NonNullable<FixtureRepository["authoritiesByAppVersion"]>;
}> {
  const packages: NonNullable<FixtureRepository["packagesByAppVersion"]> = {};
  const authorities: NonNullable<FixtureRepository["authoritiesByAppVersion"]> = {};
  let routes;
  try { routes = await readdir(root, { withFileTypes: true }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { packages, authorities };
    throw error;
  }
  for (const route of routes.filter((entry) => entry.isDirectory())) {
    const routeRoot = path.join(root, route.name);
    const versions = await readdir(routeRoot, { withFileTypes: true });
    for (const version of versions.filter((entry) => entry.isDirectory())) {
      const authorityRoot = path.join(routeRoot, version.name);
      try {
        const sourceIndexPath = path.join(authorityRoot, "source-index.json");
        const sourceIndex = PersistedGenericSourceIndexSchema.parse(JSON.parse(await readFile(sourceIndexPath, "utf8")));
        for (const entry of sourceIndex.payload.entries) {
          const key = appVersionKey(entry.app_id, entry.package_version);
          if (currentKeys.has(key)) continue;
          if (packages[key]) throw new AppPlatformError("source_index_signature_invalid", `Duplicate persisted fixture authority for ${key}`);
          packages[key] = { archivePath: path.join(authorityRoot, `${entry.package_version}.bdapp`), descriptorPath: path.join(authorityRoot, `${entry.package_version}.descriptor.json`) };
          authorities[key] = { trustRootPath: path.join(authorityRoot, "trust-root.json"), sourceIndexPath, revocationListPath: path.join(authorityRoot, "revocations.json") };
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        if (error instanceof AppPlatformError) throw error;
        throw new AppPlatformError("source_index_signature_invalid", "Persisted first-party fixture source is malformed or unreadable");
      }
    }
  }
  return { packages, authorities };
}

export const MODERN_FIXTURE_VERSION = "4.2.15" as const;
export const MODERN_FIXTURE_CAPABILITIES = [
  "career.context.read", "career.facts.read", "career.facts.propose", "career.facts.confirm",
  "resume.definitions.read", "resume.definitions.write", "resume.jobs.read", "resume.jobs.write",
  "resume.artifacts.register", "resume.export.request", "resume.operations.read", "app.inference.request",
] as const;

function loadResumeBuilderUi(): string {
  const candidates = [
    path.resolve(process.cwd(), "../resume_builder/resources/main.html"),
    fileURLToPath(new URL("../../../resume_builder/resources/main.html", import.meta.url)),
    fileURLToPath(new URL("../../../../resume_builder/resources/main.html", import.meta.url)),
  ];
  const resourcePath = candidates.find((candidate) => existsSync(candidate));
  if (!resourcePath) throw new Error("Resume Builder UI package resource is missing");
  return readFileSync(resourcePath, "utf8");
}

function loadResumeBuilderInferenceProgram(): string {
  const candidates = [
    path.resolve(process.cwd(), "../resume_builder/resources/inference-program.js"),
    fileURLToPath(new URL("../../../resume_builder/resources/inference-program.js", import.meta.url)),
    fileURLToPath(new URL("../../../../resume_builder/resources/inference-program.js", import.meta.url)),
  ];
  const resourcePath = candidates.find((candidate) => existsSync(candidate));
  if (!resourcePath) throw new Error("Resume Builder inference program is missing");
  return readFileSync(resourcePath, "utf8");
}

const RESUME_INFERENCE_PURPOSE_REQUESTS = [
  { purpose_id: "resume.interview-assist", version: 1 },
  { purpose_id: "resume.general-draft", version: 1 },
  { purpose_id: "resume.job-description-analyze", version: 1 },
  { purpose_id: "resume.requirement-evidence-match", version: 1 },
  { purpose_id: "resume.tailoring-plan", version: 1 },
  { purpose_id: "resume.targeted-draft", version: 1 },
  { purpose_id: "resume.revision-classify", version: 1 },
  { purpose_id: "resume.revision-draft", version: 1 },
  { purpose_id: "resume.guidance", version: 1 },
  { purpose_id: "resume.strategy", version: 2 },
  { purpose_id: "resume.craft-evaluate", version: 1 },
  { purpose_id: "resume.craft-repair", version: 1 },
] as const;

const RESUME_CHAT_RESOURCE_FILES = [
  {
    resourceId: "agent.instructions",
    role: "agent_instructions" as const,
    title: "Agent Instructions",
    description: "Resume Builder operating rules for the chat workspace.",
    packagePath: "payload/resources/agent-instructions.md",
    fileName: "agent-instructions.md",
    ownerEditable: true,
    promptInclusion: "workspace_start" as const,
  },
  {
    resourceId: "interview.guide",
    role: "interview_guide" as const,
    title: "Interview Guide",
    description: "Topic order and question guidance for building the Resume Profile.",
    packagePath: "payload/resources/interview-guide.md",
    fileName: "interview-guide.md",
    ownerEditable: true,
    promptInclusion: "workspace_start" as const,
  },
  {
    resourceId: "quality.standard",
    role: "quality_standard" as const,
    title: "Resume Quality Standard",
    description: "Rules for supported claims, review, and factual safety.",
    packagePath: "payload/resources/resume-quality-standard.md",
    fileName: "resume-quality-standard.md",
    ownerEditable: true,
    promptInclusion: "action_request" as const,
  },
  {
    resourceId: "template.standard",
    role: "template_standard" as const,
    title: "Resume Template Standard",
    description: "Default renderer binding and template-scope limits for this release.",
    packagePath: "payload/resources/resume-template-standard.md",
    fileName: "resume-template-standard.md",
    ownerEditable: true,
    promptInclusion: "action_request" as const,
  },
  {
    resourceId: "recovery.guidance",
    role: "recovery_guidance" as const,
    title: "Recovery Guidance",
    description: "Resume session recovery and draft reconciliation behavior.",
    packagePath: "payload/resources/recovery-guidance.md",
    fileName: "recovery-guidance.md",
    ownerEditable: true,
    promptInclusion: "document_open" as const,
  },
] as const;

const RESUME_CHAT_INITIAL_DOCUMENT_FILES = {
  profile: {
    packagePath: "payload/resources/resume-profile-template.md",
    fileName: "resume-profile-template.md",
  },
  resume: {
    packagePath: "payload/resources/resume-template.md",
    fileName: "resume-template.md",
  },
} as const;

function loadResumeBuilderResource(fileName: string): Buffer {
  const candidates = [
    path.resolve(process.cwd(), "../resume_builder/resources", fileName),
    fileURLToPath(new URL(`../../../resume_builder/resources/${fileName}`, import.meta.url)),
    fileURLToPath(new URL(`../../../../resume_builder/resources/${fileName}`, import.meta.url)),
  ];
  const resourcePath = candidates.find((candidate) => existsSync(candidate));
  if (!resourcePath) throw new Error(`Resume Builder package resource is missing: ${fileName}`);
  return Buffer.from(readFileSync(resourcePath, "utf8"), "utf8");
}

function emptyActionSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: [],
  };
}

function actionSchema(schemaId: string, schema: Record<string, unknown>): ModernActionSchemaResource {
  return {
    schema_id: schemaId,
    schema_version: 1,
    content_digest: canonicalInputDigest(schema),
    schema,
  };
}

function actionSchemas(
  inputSchemaId: string,
  resultSchemaId: string,
  inputSchema: Record<string, unknown> = emptyActionSchema(),
  resultSchema: Record<string, unknown> = capabilityResultSchema(),
) {
  return {
    input_schema: actionSchema(inputSchemaId, inputSchema),
    result_schema: actionSchema(resultSchemaId, resultSchema),
  };
}

function profileReadInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: [],
  };
}

function profileReadResultSchema(): Record<string, unknown> {
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
        properties: {
          document_id: { type: "string", enum: ["resume.profile"] },
          document_binding_id: { type: "string", enum: ["resume.profile.current"] },
          media_type: { type: "string", enum: ["text/markdown"] },
          content: { type: "string" },
          revision: { type: "number" },
        },
        required: [],
      },
    },
    required: ["result_version", "state", "document_id", "document_binding_id", "record"],
  };
}

function careerFactProposeInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      source: {
        type: "object",
        additionalProperties: false,
        properties: {
          source_kind: { type: "string", enum: ["owner_interview", "accepted_import", "career_handoff", "owner_edit"] },
          safe_label: { type: "string", minLength: 1, maxLength: 256 },
          content_digest: { type: "string", minLength: 71, maxLength: 71 },
          captured_at: { type: "string", minLength: 20, maxLength: 35 },
        },
        required: ["source_kind", "safe_label", "content_digest", "captured_at"],
      },
      fact: {
        type: "object",
        additionalProperties: false,
        properties: {
          fact_kind: { type: "string", enum: ["identity", "contact", "employment", "education", "skill", "credential", "accomplishment", "project", "preference", "job_evidence"] },
          state: { type: "string", enum: ["imported", "suggested"] },
          value: { type: "string", minLength: 1, maxLength: 16384 },
          sensitivity: { type: "string", enum: ["standard", "sensitive", "highly_sensitive"] },
        },
        required: ["fact_kind", "state", "value", "sensitivity"],
      },
    },
    required: ["source", "fact"],
  };
}

function careerFactProposeResultSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      source: { type: "object", additionalProperties: true, properties: {}, required: [] },
      fact: { type: "object", additionalProperties: true, properties: {}, required: [] },
      classification: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["new", "duplicate", "conflict"] },
          related_fact_revision_ids: { type: "array", items: { type: "string", format: "uuid" }, maxItems: 128 },
        },
        required: ["kind", "related_fact_revision_ids"],
      },
      reused: { type: "boolean" },
    },
    required: ["source", "fact", "classification", "reused"],
  };
}

function careerFactConfirmInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decisions: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            fact_record_id: { type: "string", format: "uuid" },
            fact_revision_id: { type: "string", format: "uuid" },
            expected_revision: { type: "integer" },
            decision: { type: "string", enum: ["accept", "edit_and_accept", "reject"] },
            edited_value: { type: ["string", "null"], minLength: 1, maxLength: 16384 },
            review_note: { type: ["string", "null"], maxLength: 512 },
          },
          required: ["fact_record_id", "fact_revision_id", "expected_revision", "decision", "edited_value", "review_note"],
        },
      },
    },
    required: ["decisions"],
  };
}

function careerFactConfirmResultSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      facts: { type: "array", items: { type: "object", additionalProperties: true, properties: {}, required: [] }, maxItems: 100 },
      reused: { type: "boolean" },
    },
    required: ["facts", "reused"],
  };
}

function profileUpdateInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      profile_markdown: { type: "string", minLength: 1, maxLength: 131072 },
      completed_topics: { type: "array", items: { type: "string", minLength: 1, maxLength: 64 }, maxItems: 32 },
      skipped_topics: { type: "array", items: { type: "string", minLength: 1, maxLength: 64 }, maxItems: 32 },
      current_topic: { type: ["string", "null"], maxLength: 64 },
    },
    required: ["profile_markdown"],
  };
}

function resumeCreateInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", minLength: 1, maxLength: 256 },
      resume_markdown: { type: "string", minLength: 1, maxLength: 262144 },
      sections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            section_id: { type: "string", minLength: 1, maxLength: 128 },
            title: { type: "string", minLength: 1, maxLength: 128 },
            statements: { type: "array", items: { type: "string", minLength: 1, maxLength: 8192 }, minItems: 1, maxItems: 64 },
          },
          required: ["statements"],
        },
        minItems: 1,
        maxItems: 64,
      },
      locale: { type: "string", minLength: 2, maxLength: 35 },
      page_intent: { type: "string", enum: ["one_page", "two_pages", "concise", "detailed"] },
    },
    required: ["resume_markdown"],
  };
}

function exportRequestInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      format: { type: "string", enum: ["pdf"] },
      definition_revision_id: { type: "string", format: "uuid" },
      safe_filename: { type: "string", minLength: 1, maxLength: 128 },
      destination_intent: { type: "string", enum: ["new_download", "replace_existing"] },
      overwrite_confirmed: { type: "boolean" },
    },
    required: ["format"],
  };
}

function exportPreparedResultSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      result_version: { type: "number", enum: [1] },
      status: { type: "string", enum: ["prepared"] },
      artifact: {
        type: "object",
        additionalProperties: true,
        properties: {
          artifact_revision_id: { type: "string", format: "uuid" },
          content_digest: { type: "string", minLength: 71, maxLength: 71 },
          content_size_bytes: { type: "number" },
          media_type: { type: "string", enum: ["application/pdf"] },
          owner_visible_label: { type: "string", minLength: 1, maxLength: 256 },
        },
        required: ["artifact_revision_id", "content_digest", "content_size_bytes", "media_type", "owner_visible_label"],
      },
      filename: { type: "string", minLength: 1, maxLength: 256 },
      media_type: { type: "string", enum: ["application/pdf"] },
      bytes_base64: { type: "string", minLength: 1 },
      safe_destination_label: { type: "string", minLength: 1, maxLength: 256 },
      replayed: { type: "boolean" },
    },
    required: ["result_version", "status", "artifact", "filename", "media_type", "bytes_base64", "safe_destination_label", "replayed"],
  };
}

function stateReadInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      queried_operation_id: { type: "string", format: "uuid" },
    },
    required: ["queried_operation_id"],
  };
}

function capabilityResultSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      approved_revision_id: { type: "string", format: "uuid" },
      cancelled: { type: "boolean" },
      catalog_revision: { type: "number" },
      definition: { type: "object", additionalProperties: true, properties: {}, required: [] },
      draft: { type: "object", additionalProperties: true, properties: {}, required: [] },
      progress: { type: "object", additionalProperties: true, properties: {}, required: [] },
      record: { type: ["object", "null"], additionalProperties: true, properties: {}, required: [] },
      recovery_reconciliation: { type: "object", additionalProperties: true, properties: {}, required: [] },
      result: { type: "object", additionalProperties: true, properties: {}, required: [] },
      results: { type: "array", items: {}, maxItems: 1024 },
      reused: { type: "boolean" },
      source: { type: "object", additionalProperties: true, properties: {}, required: [] },
      status: { type: "string", minLength: 1, maxLength: 64 },
      variant: { type: ["object", "null"], additionalProperties: true, properties: {}, required: [] },
    },
    required: [],
  };
}

function buildModernResumePresentations(files: Map<string, Buffer>): GenericPackageManifest["presentations"] {
  const cap = (name: typeof MODERN_FIXTURE_CAPABILITIES[number]) => ({ name, version: 1 });
  const appResource = (resource: typeof RESUME_CHAT_RESOURCE_FILES[number]) => ({
    resource_version: 1 as const,
    resource_id: resource.resourceId,
    role: resource.role as ModernResourceRole,
    title: resource.title,
    description: resource.description,
    package_path: resource.packagePath,
    media_type: "text/markdown" as const,
    content_digest: digest(files.get(resource.packagePath)!),
    owner_editable: resource.ownerEditable,
    prompt_inclusion: resource.promptInclusion as ModernPromptInclusion,
  });
  return {
    presentation_set_version: 1,
    default_presentation_id: "just.chat",
    profiles: [
      {
        profile_version: 1,
        presentation_id: "just.chat",
        type: "chat_workspace",
        label: "Launch",
        description: "Build your Resume Profile and Resume in a native chat workspace.",
        workspace_id: "resume.chat",
        owner_visibility: "primary",
      },
      {
        profile_version: 1,
        presentation_id: "structured.internal",
        type: "surface",
        label: "Structured Resume Builder",
        description: "Internal structured Resume Builder surface retained for compatibility.",
        resource_uri: "ui://resume-builder/main",
        owner_visibility: "internal",
      },
    ],
    workspaces: [{
      workspace_version: 1,
      workspace_id: "resume.chat",
      title: "Resume Builder",
      description: "Chat-first Resume Builder workspace with Profile and Resume documents.",
      default_document_id: "conversation",
      empty_state: {
        empty_state_version: 1,
        heading: "Let's build your resume",
        description: "Tell me the role you want, paste an existing resume, or describe your experience. I'll help shape it into a focused resume profile and draft.",
        cta_label: "Let's get started",
        cta_message: "I want to build my resume.",
      },
      documents: [
        {
          document_version: 1,
          document_id: "conversation",
          role: "conversation",
          title: "Conversation",
          description: "Resume Builder chat.",
          editable: true,
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
          title: "Your Resume Profile",
          description: "Reviewed resume source profile built from Resume-domain records.",
          editable: true,
          default_visibility: "primary",
          model_access: "read_write_draft",
          resource_id: null,
          data_binding_id: "resume.profile.current",
          initial_content: {
            initial_content_version: 1,
            source: "package_file",
            package_path: RESUME_CHAT_INITIAL_DOCUMENT_FILES.profile.packagePath,
            media_type: "text/markdown",
            content_digest: digest(files.get(RESUME_CHAT_INITIAL_DOCUMENT_FILES.profile.packagePath)!),
            seed_policy: "when_missing",
          },
          presentation: {
            presentation_version: 1,
            renderer: "markdown_document",
            chrome: "document",
            title: "resume-profile.md",
            subtitle: "Resume Profile",
            header_actions: [
              { type: "back_to_chat", label: "Back to chat" },
              { type: "app_action", action_id: "resume.create", label: "Create resume", delivery: "direct_action" },
              { type: "edit_document", label: "Edit" },
            ],
          },
        },
        {
          document_version: 1,
          document_id: "resume.document",
          role: "derived_document",
          title: "Your Resume",
          description: "Formatted Resume derived from the current general Resume definition.",
          editable: false,
          default_visibility: "primary",
          model_access: "action_result",
          resource_id: null,
          data_binding_id: "resume.definition.current.general",
          initial_content: {
            initial_content_version: 1,
            source: "package_file",
            package_path: RESUME_CHAT_INITIAL_DOCUMENT_FILES.resume.packagePath,
            media_type: "text/markdown",
            content_digest: digest(files.get(RESUME_CHAT_INITIAL_DOCUMENT_FILES.resume.packagePath)!),
            seed_policy: "when_missing",
          },
          presentation: {
            presentation_version: 1,
            renderer: "paper_document",
            chrome: "document",
            title: "resume.md",
            subtitle: "Resume",
            header_actions: [
              { type: "back_to_chat", label: "Back to chat" },
              { type: "app_action", action_id: "resume.export.pdf.request", label: "Export PDF", delivery: "direct_action", action_input: { format: "pdf", destination_intent: "new_download" } },
            ],
          },
        },
        ...RESUME_CHAT_RESOURCE_FILES.map((resource) => ({
          document_version: 1 as const,
          document_id: resource.resourceId,
          role: "advanced_resource" as const,
          title: resource.title,
          description: resource.ownerEditable ? "Owner-editable override seeded from the package default." : resource.description,
          editable: resource.ownerEditable,
          default_visibility: "advanced" as const,
          model_access: "read_reference" as const,
          resource_id: resource.resourceId,
          data_binding_id: resource.ownerEditable ? `${resource.resourceId}.owner` : null,
          ...(resource.ownerEditable ? {
            initial_content: {
              initial_content_version: 1 as const,
              source: "package_file" as const,
              package_path: resource.packagePath,
              media_type: "text/markdown" as const,
              content_digest: digest(files.get(resource.packagePath)!),
              seed_policy: "when_missing" as const,
            },
            presentation: {
              presentation_version: 1 as const,
              renderer: "markdown_document" as const,
              chrome: "document" as const,
              title: `${resource.title}.md`,
              subtitle: "Owner editable app instructions",
              header_actions: [
                { type: "back_to_chat" as const, label: "Back to chat" },
                { type: "edit_document" as const, label: "Edit" },
              ],
            },
          } : {
            presentation: null,
          }),
        })),
      ],
      resources: RESUME_CHAT_RESOURCE_FILES.map(appResource),
      context_requests: [
        {
          context_version: 1,
          context_id: "career.resume_context",
          kind: "career_context",
          title: "Career Context",
          description: "Owner career context available to Resume Builder for profile setup.",
          required: false,
          max_bytes: 65_536,
          freshness_policy: "session_snapshot",
          required_capabilities: [cap("career.context.read")],
        },
        {
          context_version: 1,
          context_id: "resume.workspace_state",
          kind: "app_state",
          title: "Resume Workspace State",
          description: "Resume Builder state projected through app-owned Resume-domain records.",
          required: false,
          max_bytes: 65_536,
          freshness_policy: "latest_available",
          required_capabilities: [cap("resume.definitions.read")],
        },
      ],
      actions: [
        {
          action_version: 1,
          action_id: "resume.profile.read",
          kind: "read",
          title: "Read Resume Profile",
          description: "Read the current app-owned Resume Profile document.",
          ...actionSchemas("resume.profile.read.input.v1", "resume.profile.read.result.v1", profileReadInputSchema(), profileReadResultSchema()),
          confirmation: "none",
          idempotency_policy: "not_applicable",
          model_exposure: "available",
          required_capabilities: [],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "career.fact.propose",
          kind: "write",
          title: "Propose Career Fact",
          description: "Propose a durable Career memory fact from owner-provided resume interview information.",
          ...actionSchemas("career.fact.propose.input.v1", "career.fact.propose.result.v1", careerFactProposeInputSchema(), careerFactProposeResultSchema()),
          confirmation: "none",
          idempotency_policy: "required",
          model_exposure: "available",
          required_capabilities: [cap("career.facts.propose")],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "career.fact.confirm",
          kind: "write",
          title: "Confirm Career Facts",
          description: "Apply owner-confirmed Career memory fact decisions gathered during the resume interview.",
          ...actionSchemas("career.fact.confirm.input.v1", "career.fact.confirm.result.v1", careerFactConfirmInputSchema(), careerFactConfirmResultSchema()),
          confirmation: "owner_confirmation",
          idempotency_policy: "required",
          model_exposure: "available",
          required_capabilities: [cap("career.facts.confirm")],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "resume.profile.update",
          kind: "write",
          title: "Update Resume Profile",
          description: "Write app-owned Resume Profile progress through Resume-domain records.",
          ...actionSchemas("resume.profile.update.input.v1", "resume.profile.update.result.v1", profileUpdateInputSchema()),
          confirmation: "none",
          idempotency_policy: "required",
          model_exposure: "available",
          required_capabilities: [cap("resume.definitions.write")],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "resume.create",
          kind: "render",
          title: "Create Resume",
          description: "Create the current general Resume from the reviewed Resume Profile state.",
          ...actionSchemas("resume.create.input.v1", "resume.create.result.v1", resumeCreateInputSchema()),
          confirmation: "owner_confirmation",
          idempotency_policy: "required",
          model_exposure: "available",
          required_capabilities: [cap("resume.definitions.write")],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "resume.export.pdf.request",
          kind: "export",
          title: "Request PDF Export",
          description: "Request a PDF export for the current Resume through the host export broker.",
          ...actionSchemas("resume.export.pdf.request.input.v1", "resume.export.pdf.request.result.v1", exportRequestInputSchema(), exportPreparedResultSchema()),
          confirmation: "trusted_owner_confirmation",
          idempotency_policy: "required",
          model_exposure: "available",
          required_capabilities: [cap("resume.export.request")],
          required_inference_purposes: [],
        },
        {
          action_version: 1,
          action_id: "resume.state.read",
          kind: "inspect",
          title: "Read Resume Operation State",
          description: "Read Resume Builder operation state for recovery and convergence checks.",
          ...actionSchemas("resume.state.read.input.v1", "resume.state.read.result.v1", stateReadInputSchema()),
          confirmation: "none",
          idempotency_policy: "not_applicable",
          model_exposure: "available",
          required_capabilities: [cap("resume.operations.read")],
          required_inference_purposes: [],
        },
      ],
    }],
  };
}

const FIXTURE_SERVER = `import http from "node:http";
const token = process.env.BRAINDRIVE_APP_CONNECTION_TOKEN;
const host = "127.0.0.1";
const port = Number((process.env.BRAINDRIVE_ENDPOINT_BIND || "127.0.0.1:0").split(":").at(-1));
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== "Bearer " + token) { response.writeHead(401).end(); return; }
  if (request.url === "/healthz") { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({status:"ok", service:"fixture-mcp", app_id:process.env.BRAINDRIVE_APP_ID})); return; }
  if (request.url === "/mcp" && request.method === "POST") { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id:1,result:{protocolVersion:"2026-07-28",capabilities:{},serverInfo:{name:"fixture-mcp",version:"1.0.0"}}})); return; }
  response.writeHead(404).end();
});
server.listen(port, host, () => process.stdout.write(JSON.stringify({event:"fixture.ready"}) + "\\n"));
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
`;

function syntheticFirstPartyServer(app: SyntheticFirstPartyFixture, appHtml: string): string {
  const uri = `ui://${app.routeKey}/main`;
  return `import http from "node:http";
const token = process.env.BRAINDRIVE_APP_CONNECTION_TOKEN;
const host = "127.0.0.1";
const port = Number((process.env.BRAINDRIVE_ENDPOINT_BIND || "127.0.0.1:0").split(":").at(-1));
const appHtml = ${JSON.stringify(appHtml)};
const uri = ${JSON.stringify(uri)};
const send = (response, id, result) => { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id,result})); };
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== "Bearer " + token) { response.writeHead(401).end(); return; }
  if (request.url === "/healthz") { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({status:"ok",service:"fixture-mcp",app_id:process.env.BRAINDRIVE_APP_ID})); return; }
  if (request.url !== "/mcp" || request.method !== "POST") { response.writeHead(404).end(); return; }
  let body = "";
  request.on("data", (chunk) => { body += chunk; if (body.length > 262144) request.destroy(); });
  request.on("end", () => {
    let message; try { message = JSON.parse(body); } catch { response.writeHead(400).end(); return; }
    if (message.method === "server/discover") { send(response, message.id, {supportedVersions:["2026-07-28"],capabilities:{tools:{listChanged:false},resources:{listChanged:false},extensions:{"io.modelcontextprotocol/ui":{mimeTypes:["text/html;profile=mcp-app"]}}},_meta:{"io.modelcontextprotocol/ui":{version:"2026-01-26"},"io.modelcontextprotocol/serverInfo":{name:${JSON.stringify(`${app.routeKey}-fixture`)},version:${JSON.stringify(app.version)}}}}); return; }
    if (message.method === "resources/list") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",resources:[{uri,name:${JSON.stringify(app.displayName)},title:${JSON.stringify(app.displayName)},description:${JSON.stringify(`Sandboxed owner ${app.displayName} workflow`)},mimeType:"text/html;profile=mcp-app",size:Buffer.byteLength(appHtml),_meta:{"io.modelcontextprotocol/ui":{version:"2026-01-26"},cachePolicy:"immutable_package_digest"}}]}); return; }
    if (message.method === "resources/templates/list") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",resourceTemplates:[]}); return; }
    if (message.method === "resources/read" && message.params?.uri === uri) { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",contents:[{uri,mimeType:"text/html;profile=mcp-app",text:appHtml,_meta:{"io.modelcontextprotocol/ui":{version:"2026-01-26"},cachePolicy:"immutable_package_digest"}}]}); return; }
    if (message.method === "tools/list") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",tools:[{name:"fixture.status",description:"Return the fixture host status",inputSchema:{type:"object",properties:{},additionalProperties:false},_meta:{ui:{visibility:["app"]}}}]}); return; }
    if (message.method === "tools/call" && message.params?.name === "fixture.status") { send(response, message.id, {resultType:"complete",content:[{type:"text",text:"Fixture ready",annotations:{audience:["user"],priority:1}},{type:"resource_link",name:${JSON.stringify(`${app.routeKey}-ui`)},uri,mimeType:"text/html;profile=mcp-app",size:Buffer.byteLength(appHtml),_meta:{visibility:"app"}}],structuredContent:{ready:true,version:${JSON.stringify(app.version)}},_meta:{"io.modelcontextprotocol/ui":{resourceUri:uri,visibility:["app"]}},isError:false}); return; }
    response.writeHead(404, {"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id:message.id,error:{code:-32601,message:"Method not found"}}));
  });
});
server.listen(port, host, () => process.stdout.write(JSON.stringify({event:"fixture.ready"}) + "\\n"));
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
`;
}

function modernFixtureServer(appHtml: string, version: string): string {
  return `import http from "node:http";
import { adjudicateResumeInference, planResumeAction, prepareResumeInference } from "./inference-program.js";
const token = process.env.BRAINDRIVE_APP_CONNECTION_TOKEN;
const host = "127.0.0.1";
const port = Number((process.env.BRAINDRIVE_ENDPOINT_BIND || "127.0.0.1:0").split(":").at(-1));
const appHtml = ${JSON.stringify(appHtml)};
const send = (response, id, result) => { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id,result})); };
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== "Bearer " + token) { response.writeHead(401).end(); return; }
  if (request.url === "/healthz") { response.writeHead(200, {"content-type":"application/json"}); response.end(JSON.stringify({status:"ok",service:"fixture-mcp",app_id:process.env.BRAINDRIVE_APP_ID})); return; }
  if (request.url !== "/mcp" || request.method !== "POST") { response.writeHead(404).end(); return; }
  let body = "";
  request.on("data", (chunk) => { body += chunk; if (body.length > 262144) request.destroy(); });
  request.on("end", () => {
    let message;
    try { message = JSON.parse(body); } catch { response.writeHead(400).end(); return; }
    if (message.method === "server/discover") { send(response, message.id, {supportedVersions:["2026-07-28"],capabilities:{tools:{listChanged:false},resources:{listChanged:false},extensions:{"io.modelcontextprotocol/ui":{mimeTypes:["text/html;profile=mcp-app"]}}},_meta:{"io.modelcontextprotocol/ui":{version:"2026-01-26"},"io.modelcontextprotocol/serverInfo":{name:"resume-builder-fixture",version:${JSON.stringify(version)}}}}); return; }
    if (message.method === "resources/list") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",resources:[{uri:"ui://resume-builder/main",name:"Resume Builder",title:"Resume Builder",description:"Sandboxed owner resume workflow",mimeType:"text/html;profile=mcp-app",size:Buffer.byteLength(appHtml),_meta:{"io.modelcontextprotocol/ui":{version:"2026-01-26"},cachePolicy:"immutable_package_digest"}}]}); return; }
    if (message.method === "resources/templates/list") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",resourceTemplates:[]}); return; }
    if (message.method === "resources/read" && message.params?.uri === "ui://resume-builder/main") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",contents:[{uri:"ui://resume-builder/main",mimeType:"text/html;profile=mcp-app",text:appHtml,_meta:{"io.modelcontextprotocol/ui":{version:"2026-01-26"},cachePolicy:"immutable_package_digest"}}]}); return; }
    if (message.method === "tools/list") { send(response, message.id, {resultType:"complete",ttlMs:0,cacheScope:"private",tools:[{name:"fixture.status",description:"Return the fixture host status",inputSchema:{type:"object",properties:{},additionalProperties:false},_meta:{ui:{visibility:["app"]}}},{name:"app.actions.plan",description:"Plan an installed app-owned chat action for generic host execution",inputSchema:{type:"object",additionalProperties:true},_meta:{ui:{visibility:["model"]}}},{name:"app.inference.prepare",description:"Prepare an installed app-owned inference plan",inputSchema:{type:"object",additionalProperties:true},_meta:{ui:{visibility:["model"]}}},{name:"app.inference.adjudicate",description:"Adjudicate an installed app-owned inference candidate",inputSchema:{type:"object",additionalProperties:true},_meta:{ui:{visibility:["model"]}}}]}); return; }
    if (message.method === "tools/call" && message.params?.name === "fixture.status") { send(response, message.id, {resultType:"complete",content:[{type:"text",text:"Fixture ready",annotations:{audience:["user"],priority:1}},{type:"resource_link",name:"resume-ui",uri:"ui://resume-builder/main",mimeType:"text/html;profile=mcp-app",size:Buffer.byteLength(appHtml),_meta:{visibility:"app"}},{type:"resource",resource:{uri:"ui://resume-builder/state",mimeType:"application/json",text:"{\\\"ready\\\":true}",_meta:{revision:1}}}],structuredContent:{ready:true,version:${JSON.stringify(version)}},_meta:{"io.modelcontextprotocol/ui":{resourceUri:"ui://resume-builder/main",visibility:["app"]}},isError:false}); return; }
    if (message.method === "tools/call" && message.params?.name === "app.actions.plan") { try { const result=planResumeAction(message.params.arguments); send(response,message.id,{resultType:"complete",content:[],structuredContent:result,_meta:{ui:{visibility:["model"]}},isError:false}); } catch { response.writeHead(409,{"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id:message.id,error:{code:-32602,message:"Installed app action planning failed"}})); } return; }
    if (message.method === "tools/call" && message.params?.name === "app.inference.prepare") { try { const result=prepareResumeInference(message.params.arguments); send(response,message.id,{resultType:"complete",content:[],structuredContent:result,_meta:{ui:{visibility:["model"]}},isError:false}); } catch { response.writeHead(409,{"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id:message.id,error:{code:-32602,message:"Installed app inference preparation failed"}})); } return; }
    if (message.method === "tools/call" && message.params?.name === "app.inference.adjudicate") { try { const result=adjudicateResumeInference(message.params.arguments); send(response,message.id,{resultType:"complete",content:[],structuredContent:result,_meta:{ui:{visibility:["model"]}},isError:false}); } catch { response.writeHead(409,{"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id:message.id,error:{code:-32602,message:"Installed app inference adjudication failed"}})); } return; }
    response.writeHead(404, {"content-type":"application/json"}); response.end(JSON.stringify({jsonrpc:"2.0",id:message.id,error:{code:-32601,message:"Method not found"}}));
  });
});
server.listen(port, host, () => process.stdout.write(JSON.stringify({event:"fixture.ready"}) + "\\n"));
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
`;
}

function digest(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function rawPublicKey(publicKey: KeyObject): string {
  const der = publicKey.export({ format: "der", type: "spki" });
  return Buffer.from(der).subarray(-32).toString("base64");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${canonicalJson(value)}\n`, { encoding: "utf8", mode: 0o644 });
}

export async function createFixtureRepository(root: string): Promise<FixtureRepository> {
  const legacy = await loadOrCreateFixtureSource(root, ["1.0.0", "2.0.0"], "legacy");
  const modernRoot = path.join(root, "modern");
  const priorModern = await loadPersistedFixtureSources(modernRoot, MODERN_FIXTURE_VERSION);
  const retainedModern = mergePersistedFixtureSources(priorModern);
  const modern = await loadOrCreateFixtureSource(
    path.join(modernRoot, MODERN_FIXTURE_VERSION),
    [MODERN_FIXTURE_VERSION],
    "modern",
    true,
  );
  return {
    ...legacy,
    packages: { ...legacy.packages, ...retainedModern.packages, ...modern.packages },
    authoritiesByVersion: {
      ...retainedModern.authorities,
      [MODERN_FIXTURE_VERSION]: {
        trustRootPath: modern.trustRootPath,
        sourceIndexPath: modern.sourceIndexPath,
        revocationListPath: modern.revocationListPath,
      },
    },
  };
}

async function loadPersistedFixtureSources(root: string, currentVersion: string): Promise<FixtureRepository[]> {
  const repositories: FixtureRepository[] = [];
  const flatSource = await loadPersistedFixtureSource(root);
  if (flatSource) repositories.push(flatSource);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return repositories;
    throw error;
  }
  const versionDirectories = entries
    .filter((entry) => entry.isDirectory() && entry.name !== currentVersion && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of versionDirectories) {
    const repository = await loadPersistedFixtureSource(path.join(root, entry.name));
    if (repository) repositories.push(repository);
  }
  return repositories;
}

function mergePersistedFixtureSources(repositories: FixtureRepository[]): {
  packages: FixtureRepository["packages"];
  authorities: NonNullable<FixtureRepository["authoritiesByVersion"]>;
} {
  const packages: FixtureRepository["packages"] = {};
  const authorities: NonNullable<FixtureRepository["authoritiesByVersion"]> = {};
  for (const repository of repositories) {
    for (const [version, packagePaths] of Object.entries(repository.packages)) {
      if (packages[version]) {
        throw new AppPlatformError("source_index_signature_invalid", `Duplicate persisted fixture authority for Resume Builder ${version}`);
      }
      packages[version] = packagePaths;
      authorities[version] = {
        trustRootPath: repository.trustRootPath,
        sourceIndexPath: repository.sourceIndexPath,
        revocationListPath: repository.revocationListPath,
      };
    }
  }
  return { packages, authorities };
}

async function loadPersistedFixtureSource(root: string): Promise<FixtureRepository | null> {
  const sourceIndexPath = path.join(root, "source-index.json");
  try {
    const existing = PackageSourceIndexSchema.parse(JSON.parse(await readFile(sourceIndexPath, "utf8")));
    const packages = Object.fromEntries(existing.payload.entries.map((entry) => [entry.package_version, {
      archivePath: path.join(root, `${entry.package_version}.bdapp`),
      descriptorPath: path.join(root, `${entry.package_version}.descriptor.json`),
    }]));
    return { root, trustRootPath: path.join(root, "trust-root.json"), sourceIndexPath, revocationListPath: path.join(root, "revocations.json"), packages };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new AppPlatformError("source_index_signature_invalid", "Persisted fixture source index is malformed or unreadable");
  }
}

async function loadOrCreateFixtureSource(
  root: string,
  versions: string[],
  authorityLabel: "legacy" | "modern",
  republishCurrent = false,
): Promise<FixtureRepository> {
  const sourceIndexPath = path.join(root, "source-index.json");
  if (!republishCurrent) {
    try {
      const existing = JSON.parse(await readFile(sourceIndexPath, "utf8")) as SourceIndex;
      const packages = Object.fromEntries(existing.payload.entries.map((entry) => [entry.package_version, {
        archivePath: path.join(root, `${entry.package_version}.bdapp`),
        descriptorPath: path.join(root, `${entry.package_version}.descriptor.json`),
      }]));
      return { root, trustRootPath: path.join(root, "trust-root.json"), sourceIndexPath, revocationListPath: path.join(root, "revocations.json"), packages };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw new AppPlatformError("source_index_signature_invalid", "Persisted fixture source index is malformed or unreadable");
      }
      // Only a genuinely missing source initializes a synthetic authority.
    }
  }
  // The current development package is derived from mounted app files. Republish
  // it on host start so source changes and signed revocation freshness take effect.
  // Prior version-specific authorities are discovered separately and retained.
  await mkdir(root, { recursive: true });
  const rootPair = generateKeyPairSync("ed25519");
  const releasePair = generateKeyPairSync("ed25519");
  const rootKeyId = `braindrive-app-root-fixture-${authorityLabel}-2026`;
  const releaseKeyId = `braindrive-app-release-fixture-${authorityLabel}-2026`;
  const signWith = (privateKey: typeof rootPair.privateKey, domain: string, payload: unknown) =>
    sign(null, Buffer.from(canonicalSignedBytes(domain, payload), "utf8"), privateKey).toString("base64");
  const releaseSigner = (domain: string, payload: unknown) => signWith(releasePair.privateKey, domain, payload);
  const releaseKey = {
    key_version: 1 as const,
    key_id: releaseKeyId,
    algorithm: "ed25519" as const,
    public_key: rawPublicKey(releasePair.publicKey),
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: "2036-01-01T00:00:00.000Z",
    status: "active" as const,
    authorization: {
      signature_version: 1 as const,
      domain_separator: "BrainDrive-App-Release-Key-v1" as const,
      canonicalization: "braindrive-canonical-json-v1" as const,
      signature_algorithm: "ed25519" as const,
      signing_key_id: rootKeyId,
      signature: "",
    },
  };
  releaseKey.authorization.signature = signWith(rootPair.privateKey, releaseKey.authorization.domain_separator, releaseKeyAuthorizationPayload(releaseKey));
  const trustRoot = TrustRootSchema.parse({
    trust_root_version: 1,
    trust_domain: "braindrive-app-release",
    root_key: { key_id: rootKeyId, algorithm: "ed25519", public_key: rawPublicKey(rootPair.publicKey), status: "active" },
    threshold: 1,
    release_keys: [releaseKey],
  });
  await writeJson(path.join(root, "trust-root.json"), trustRoot);

  const packages: FixtureRepository["packages"] = {};
  const entries: SourceIndex["payload"]["entries"] = [];
  const modernFixtureHtml = authorityLabel === "modern" ? loadResumeBuilderUi() : null;
  const modernInferenceProgram = authorityLabel === "modern" ? loadResumeBuilderInferenceProgram() : null;
  const modernResourceFiles = authorityLabel === "modern"
    ? new Map([
      ...RESUME_CHAT_RESOURCE_FILES.map((resource) => [resource.packagePath, loadResumeBuilderResource(resource.fileName)] as [string, Buffer]),
      ...Object.values(RESUME_CHAT_INITIAL_DOCUMENT_FILES).map((resource) => [resource.packagePath, loadResumeBuilderResource(resource.fileName)] as [string, Buffer]),
    ])
    : null;
  const publishedAt = new Date().toISOString();
  const nextUpdateAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  for (const version of versions) {
    const files = new Map<string, Buffer>([
      ["payload/docker/index.js", Buffer.from(version === MODERN_FIXTURE_VERSION ? modernFixtureServer(modernFixtureHtml!, version) : FIXTURE_SERVER.replace('version:"1.0.0"', `version:"${version}"`), "utf8")],
      ...(version === MODERN_FIXTURE_VERSION ? [["payload/docker/inference-program.js", Buffer.from(modernInferenceProgram!, "utf8")] as [string, Buffer]] : []),
      ...(version === MODERN_FIXTURE_VERSION ? [["payload/ui/main.html", Buffer.from(modernFixtureHtml!, "utf8")] as [string, Buffer]] : []),
      ...(version === MODERN_FIXTURE_VERSION ? [...modernResourceFiles!] : []),
      ["provenance/build.jsonl", Buffer.from(`${canonicalJson({ builder: "braindrive-fixture", version, source: "repository" })}\n`, "utf8")],
      ["sbom/cyclonedx.json", Buffer.from(`${canonicalJson({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1, components: [] })}\n`, "utf8")],
    ]);
    const platformArtifacts = [
      { target: "docker_linux_x64" as const, os: "linux" as const, architecture: "x64" as const, runtime_kind: "packaged_node" as const, entrypoint: "payload/docker/index.js" },
      { target: "desktop_windows_x64" as const, os: "windows" as const, architecture: "x64" as const, runtime_kind: "packaged_node" as const, entrypoint: "payload/docker/index.js" },
      { target: "desktop_macos_universal" as const, os: "macos" as const, architecture: "universal" as const, runtime_kind: "packaged_node" as const, entrypoint: "payload/docker/index.js" },
    ];
    const manifest = version === MODERN_FIXTURE_VERSION
      ? GenericPackageManifestSchema.parse({
          manifest_version: 2,
          app_id: "ai.braindrive.resume-builder",
          publisher_id: "ai.braindrive",
          package_version: version,
          catalog: {
            display_name: "Resume Builder",
            summary: "Build an owner-reviewed Resume Profile and Resume in a chat-first workspace.",
            icon: null,
            retention_summary: "Resume Builder retains career data, resume history, artifacts, exports, and lifecycle evidence after uninstall.",
          },
          archive: { format: "zip", profile: "braindrive-zip-v1", compression: "store", layout_version: 1, manifest_path: "manifest.json", undeclared_entries: "reject", links_and_device_nodes: "reject", max_file_count: 256, max_compressed_bytes: 67_108_864, max_uncompressed_bytes: 268_435_456 },
          files: [...files].map(([filePath, bytes]) => ({ path: filePath, kind: "file", mode: filePath.endsWith("/index.js") ? "executable" : "read_only", size_bytes: bytes.length, digest: digest(bytes) })).sort((a, b) => a.path.localeCompare(b.path)),
          platform_artifacts: platformArtifacts,
          compatibility: { app_contract: 1, host_min_version: "26.7.23", mcp_protocol: "2026-07-28", mcp_apps: { extension_id: "io.modelcontextprotocol/ui", version: "2026-01-26" }, data_contract_version: 4 },
          primary_resource: { resource_version: 1, uri: "ui://resume-builder/main", package_path: "payload/ui/main.html", mime_type: "text/html;profile=mcp-app", content_digest: digest(files.get("payload/ui/main.html")!) },
          presentations: buildModernResumePresentations(files),
          requested_capabilities: MODERN_FIXTURE_CAPABILITIES.map((name) => ({ name, version: 1 })),
          requested_inference_purposes: [...RESUME_INFERENCE_PURPOSE_REQUESTS],
          provenance_path: "provenance/build.jsonl",
          sbom_path: "sbom/cyclonedx.json",
          retention_policy: DEFAULT_APP_RETENTION_POLICY,
        })
      : PackageManifestSchema.parse({
          manifest_version: 1,
          app_id: "ai.braindrive.resume-builder",
          publisher_id: "ai.braindrive",
          display_name: "Resume Builder",
          package_version: version,
          archive: { format: "zip", profile: "braindrive-zip-v1", compression: "store", layout_version: 1, manifest_path: "manifest.json", undeclared_entries: "reject", links_and_device_nodes: "reject", max_file_count: 256, max_compressed_bytes: 67_108_864, max_uncompressed_bytes: 268_435_456 },
          files: [...files].map(([filePath, bytes]) => ({ path: filePath, kind: "file", mode: filePath.endsWith("/index.js") ? "executable" : "read_only", size_bytes: bytes.length, digest: digest(bytes) })),
          platform_artifacts: platformArtifacts,
          compatibility: { app_contract: 1, host_min_version: "26.7.23", mcp_protocol: "2026-07-28", legacy_mcp_adapter: "2025-11-25", mcp_apps: { extension_id: "io.modelcontextprotocol/ui", version: "2026-01-26" }, data_schema: { read_min: 1, read_max: 1, write_version: 1 } },
          requested_capabilities: ["career.context.read", "career.facts.read", "career.facts.propose", "career.facts.confirm", "resume.definitions.read", "resume.definitions.write", "resume.jobs.read", "resume.jobs.write", "resume.artifacts.register", "resume.export.request", "resume.operations.read", ...(version === "1.0.0" ? [] : ["app.inference.request" as const])],
          provenance_path: "provenance/build.jsonl",
          sbom_path: "sbom/cyclonedx.json",
          retention_policy: "retain_owner_data_remove_runtime_authority",
        });
    const archive = createStoredZip([
      { name: "manifest.json", bytes: Buffer.from(`${canonicalJson(manifest)}\n`, "utf8"), executable: false },
      ...[...files].map(([name, bytes]) => ({ name, bytes, executable: name.endsWith("/index.js") })),
    ]);
    const archivePath = path.join(root, `${version}.bdapp`);
    await writeFile(archivePath, archive, { mode: 0o644 });
    const payload = {
      descriptor_version: manifest.manifest_version === 2 ? 2 as const : 1 as const,
      manifest,
      manifest_digest: canonicalJsonDocumentDigest(manifest),
      archive: { media_type: "application/vnd.braindrive.app+zip" as const, byte_length: archive.length, digest: digest(archive) },
      published_at: publishedAt,
    };
    const descriptor = manifest.manifest_version === 2
      ? { payload, signature: { signature_version: 1 as const, domain_separator: "BrainDrive-App-Package-v1" as const, canonicalization: "braindrive-canonical-json-v1" as const, signature_algorithm: "ed25519" as const, signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Package-v1", payload) } }
      : PackageDescriptorSchema.parse({ payload: payload as Descriptor["payload"], signature: { signature_version: 1, domain_separator: "BrainDrive-App-Package-v1", canonicalization: "braindrive-canonical-json-v1", signature_algorithm: "ed25519", signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Package-v1", payload) } });
    const descriptorPath = path.join(root, `${version}.descriptor.json`);
    await writeJson(descriptorPath, descriptor);
    packages[version] = { archivePath, descriptorPath };
    entries.push({
      app_id: "ai.braindrive.resume-builder", publisher_id: "ai.braindrive", package_version: version,
      descriptor_digest: canonicalJsonDocumentDigest(descriptor), archive_digest: digest(archive), targets: ["docker_linux_x64", "desktop_windows_x64", "desktop_macos_universal"],
      sources: [
        { environment: "docker_dev", kind: "repository_fixture", descriptor_fixture_id: `resume-builder-${version}-descriptor`, archive_fixture_id: `resume-builder-${version}-archive` },
        { environment: "desktop_windows", kind: "release_https", descriptor_url: `https://releases.braindrive.ai/apps/resume-builder/${version}.descriptor.json`, archive_url: `https://releases.braindrive.ai/apps/resume-builder/${version}.bdapp` },
        { environment: "desktop_macos", kind: "release_https", descriptor_url: `https://releases.braindrive.ai/apps/resume-builder/${version}.descriptor.json`, archive_url: `https://releases.braindrive.ai/apps/resume-builder/${version}.bdapp` },
      ],
    });
  }
  const sourcePayload: SourceIndex["payload"] = { index_version: 1, sequence: 1, prior_index_digest: null, published_at: publishedAt, entries };
  const sourceIndex = PackageSourceIndexSchema.parse({ payload: sourcePayload, signature: { signature_version: 1, domain_separator: "BrainDrive-App-Source-Index-v1", canonicalization: "braindrive-canonical-json-v1", signature_algorithm: "ed25519", signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Source-Index-v1", sourcePayload) } });
  await writeJson(sourceIndexPath, sourceIndex);
  const revocationPayload: Revocations["payload"] = { revocation_version: 1, sequence: 1, prior_list_digest: null, issued_at: publishedAt, next_update_at: nextUpdateAt, entries: [] };
  const revocations = RevocationListSchema.parse({ payload: revocationPayload, signature: { signature_version: 1, domain_separator: "BrainDrive-App-Revocations-v1", canonicalization: "braindrive-canonical-json-v1", signature_algorithm: "ed25519", signing_key_id: releaseKeyId, signature: releaseSigner("BrainDrive-App-Revocations-v1", revocationPayload) } });
  const revocationListPath = path.join(root, "revocations.json");
  await writeJson(revocationListPath, revocations);
  return { root, trustRootPath: path.join(root, "trust-root.json"), sourceIndexPath, revocationListPath, packages, signer: releaseSigner, releaseKeyId };
}

export async function revokeFixtureVersion(repository: FixtureRepository, version: string, appId = "ai.braindrive.resume-builder"): Promise<void> {
  const key = appVersionKey(appId, version);
  const genericSigner = repository.signersByAppVersion?.[key];
  const genericReleaseKeyId = repository.releaseKeyIdsByAppVersion?.[key];
  if (genericSigner && genericReleaseKeyId) {
    const authority = repository.authoritiesByAppVersion?.[key];
    const packagePaths = repository.packagesByAppVersion?.[key];
    if (!authority || !packagePaths) throw new Error("Fixture authority is incomplete");
    const descriptor = JSON.parse(await readFile(packagePaths.descriptorPath, "utf8")) as { payload: { archive: { digest: string } } };
    const prior = JSON.parse(await readFile(authority.revocationListPath, "utf8")) as { payload: { sequence: number } };
    const revokedAt = new Date().toISOString();
    const payload = { revocation_version: 2 as const, sequence: prior.payload.sequence + 1, prior_list_digest: null, issued_at: revokedAt, next_update_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), entries: [{ revocation_id: crypto.randomUUID(), publisher_id: "ai.braindrive", app_id: appId, match: { kind: "package_digest", package_digest: descriptor.payload.archive.digest }, reason_code: "critical_defect", revoked_at: revokedAt }] };
    await writeJson(authority.revocationListPath, { payload, signature: { signature_version: 1, domain_separator: "BrainDrive-App-Revocations-v1", canonicalization: "braindrive-canonical-json-v1", signature_algorithm: "ed25519", signing_key_id: genericReleaseKeyId, signature: genericSigner("BrainDrive-App-Revocations-v1", payload) } });
    return;
  }
  if (!repository.signer || !repository.releaseKeyId) throw new Error("Fixture signing authority is unavailable after restart");
  const descriptor = PackageDescriptorSchema.parse(JSON.parse(await readFile(repository.packages[version].descriptorPath, "utf8")));
  const prior = RevocationListSchema.parse(JSON.parse(await readFile(repository.revocationListPath, "utf8")));
  const revokedAt = new Date().toISOString();
  const payload: Revocations["payload"] = {
    revocation_version: 1,
    sequence: prior.payload.sequence + 1,
    prior_list_digest: canonicalJsonDocumentDigest(prior.payload),
    issued_at: revokedAt,
    next_update_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    entries: [{ revocation_id: crypto.randomUUID(), publisher_id: "ai.braindrive", app_id: "ai.braindrive.resume-builder", match: { kind: "package_digest", package_digest: descriptor.payload.archive.digest }, reason_code: "critical_defect", revoked_at: revokedAt }],
  };
  const revocations = RevocationListSchema.parse({ payload, signature: { signature_version: 1, domain_separator: "BrainDrive-App-Revocations-v1", canonicalization: "braindrive-canonical-json-v1", signature_algorithm: "ed25519", signing_key_id: repository.releaseKeyId, signature: repository.signer("BrainDrive-App-Revocations-v1", payload) } });
  await writeJson(repository.revocationListPath, revocations);
}
