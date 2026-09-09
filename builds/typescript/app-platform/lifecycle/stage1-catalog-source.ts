import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { AppPlatformError } from "./errors.js";
import type { FixtureRepository } from "./fixture-repository.js";
import { CapabilityDependencySchema, type CapabilityDependency } from "../contracts/package-components.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REFERENCE = /^(?!\/)(?![A-Za-z]:)(?!.*\.\.)(?!.*:\/\/)[A-Za-z0-9._/-]+$/;
const TARGETS = ["docker_linux_x64", "desktop_windows_x64", "desktop_macos_universal"] as const;
const STAGE1_PACKAGE_IDS = [
  "ai.braindrive.resume-builder",
  "ai.braindrive.internet-search.searxng",
  "ai.braindrive.brief-builder",
] as const;

const ArtifactRefSchema = z.object({
  reference: z.string().regex(REFERENCE),
  digest: z.string().regex(DIGEST),
}).strict();

const TargetArtifactSchema = z.object({
  target: z.enum(TARGETS),
  trust_root: ArtifactRefSchema,
  descriptor: ArtifactRefSchema,
  archive: ArtifactRefSchema,
  source_index: ArtifactRefSchema,
  revocation: ArtifactRefSchema,
}).strict();

const CatalogEntrySchema = z.object({
  package_identity: z.object({
    package_id: z.enum(STAGE1_PACKAGE_IDS),
    publisher_id: z.literal("ai.braindrive"),
    package_kind: z.array(z.enum(["app", "capability_provider", "dependency_service"])).min(1).max(3),
    version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/),
  }).strict(),
  release: z.object({
    channel: z.literal("local-dev"),
    artifact_name: z.string(),
    status: z.enum(["fixture_pending_extraction", "local_dev_verified"]),
  }).strict(),
  target_artifacts: z.array(TargetArtifactSchema).min(1).max(3),
  compatibility: z.object({
    manifest_version: z.literal(2),
    package_profile: z.literal("braindrive-package-v2"),
    host_min_version: z.string(),
    mcp_protocol: z.literal("2026-07-28"),
    mcp_apps_extension: z.object({
      extension_id: z.literal("io.modelcontextprotocol/ui"),
      version: z.literal("2026-01-26"),
    }).strict(),
    targets: z.array(z.enum(TARGETS)).min(1).max(3),
  }).strict(),
  safe_presentation: z.object({
    display_name: z.string().min(1).max(80),
    summary: z.string().min(1).max(512),
    icon: ArtifactRefSchema.nullable(),
    retention_summary: z.string().min(1).max(256),
  }).strict(),
  relationship_projection: z.object({
    launchable_app: z.boolean(),
    provides_operations: z.array(z.string()).max(64),
    requires_operations: z.array(z.object({
      operation_id: z.string(),
      requirement: z.enum(["required", "optional"]),
      unavailable_behavior: z.enum(["block_activation", "degrade_with_safe_status"]),
      provider_selection: z.literal("owner_or_admin_policy"),
      silent_install_or_switch: z.literal(false),
    }).strict()).max(64),
    depends_on_packages: z.array(z.string()).max(64),
  }).strict(),
  security_projection: z.object({
    catalog_role: z.literal("discovery_and_retrieval_metadata_only"),
    runtime_authority: z.literal(false),
    install_decision: z.literal(false),
    owner_trust_roots: z.literal(false),
    private_binding_projection: z.literal("never"),
  }).strict(),
}).strict();

const Stage1CatalogSchema = z.object({
  catalog_version: z.literal(1),
  catalog_id: z.literal("ai.braindrive.stage1.local-dev"),
  publisher_id: z.literal("ai.braindrive"),
  release_channel: z.literal("local-dev"),
  generated_at: z.string().datetime(),
  authority_boundary: z.object({
    catalog_role: z.literal("discovery_and_retrieval_metadata_only"),
    package_scope: z.literal("braindrive_built_and_reviewed"),
    host_retains_authority: z.array(z.string()).min(8),
    stage1_exclusions: z.array(z.string()).min(8),
  }).strict(),
  entries: z.array(CatalogEntrySchema).min(1).max(1000),
}).strict();

export const Stage1CatalogSourceConfigSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("local_file"),
    catalogPath: z.string().min(1),
    cacheRoot: z.string().min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal("braindrive_https"),
    catalogUrl: z.string().url(),
    cacheRoot: z.string().min(1),
  }).strict(),
]);

export type Stage1CatalogRuntimeTarget = typeof TARGETS[number];
export type Stage1CatalogSourceConfig = z.infer<typeof Stage1CatalogSourceConfigSchema>;
type Stage1Catalog = z.infer<typeof Stage1CatalogSchema>;
type Stage1CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export type Stage1CatalogPackageSource = {
  repository: FixtureRepository;
  availableVersion: string;
  displayName: string;
  publisherName: "BrainDrive";
  packageKind: Stage1CatalogEntry["package_identity"]["package_kind"];
  providesOperations: string[];
  capabilityDependencies: CapabilityDependency[];
  ownerSafeSource: {
    kind: "stage1_catalog";
    label: string;
    cache_status: "fresh" | "last_known_good";
  };
};

const REQUIRED_AUTHORITY = new Set([
  "package_verification",
  "trust_evaluation",
  "compatibility_filtering",
  "revocation_checking",
  "reviewed_registration_joins",
  "install_update_decisions",
  "lifecycle_state",
  "runtime_supervision",
  "owner_data_preservation",
]);

const REQUIRED_EXCLUSIONS = new Set([
  "public_marketplace",
  "third_party_publishing",
  "arbitrary_local_package_installation",
  "source_neutral_registry",
  "owner_added_production_trust_roots",
  "open_registry",
  "federation_claim",
  "catalog_runtime_authority",
]);

const FORBIDDEN_KEY_PATTERNS = [
  /^(command|commands|cmd|args|argv|entrypoint|executable|launch_command)$/i,
  /^(host_path|host_paths|filesystem_path|absolute_path|working_directory)$/i,
  /^(endpoint|endpoints|url|uri|base_url|private_url|callback_url|listen|bind|bind_address)$/i,
  /^(port|ports|container_port|host_port|listen_port)$/i,
  /^(credential|credentials|secret|secrets|api_key|token|password|vault)$/i,
  /^(owner_trust_root|owner_trust_roots|trust_roots)$/i,
  /^(runtime|runtime_authority|runtime_permissions|process|supervisor|sidecar_binding|grant)$/i,
  /^(install|install_decision|auto_install|activation|auto_update|provider_switch)$/i,
];

export async function createStage1CatalogPackageSource(input: {
  source: Stage1CatalogSourceConfig;
  appId: string;
  publisherId?: string;
  target: Stage1CatalogRuntimeTarget;
  fallbackCacheRoot?: string;
}): Promise<Stage1CatalogPackageSource> {
  const config = Stage1CatalogSourceConfigSchema.parse(input.source);
  const loaded = await readCatalog(config, input.fallbackCacheRoot);
  const catalog = parseCatalog(loaded.raw);
  assertStage1Boundary(catalog);
  const publisherId = input.publisherId ?? "ai.braindrive";
  const entry = catalog.entries.find((candidate) =>
    candidate.package_identity.package_id === input.appId &&
    candidate.package_identity.publisher_id === publisherId
  );
  if (!entry) throw new AppPlatformError("package_not_found", "Stage 1 catalog does not list the selected package", 404);
  if (entry.release.status !== "local_dev_verified") {
    throw new AppPlatformError("package_not_found", "Stage 1 catalog package is not available for verified local-dev install", 404);
  }
  const target = entry.target_artifacts.find((candidate) => candidate.target === input.target);
  if (!target) throw new AppPlatformError("host_incompatible", "Stage 1 catalog package does not support this host target");
  for (const candidate of entry.target_artifacts) {
    if (!entry.compatibility.targets.includes(candidate.target)) {
      throw new AppPlatformError("host_incompatible", "Stage 1 catalog target metadata is inconsistent");
    }
  }

  const trustRootPath = await resolveVerifiedReference(loaded.sourceRoot, target.trust_root, "trust_root");
  const sourceIndexPath = await resolveVerifiedReference(loaded.sourceRoot, target.source_index, "source_index");
  const revocationListPath = await resolveVerifiedReference(loaded.sourceRoot, target.revocation, "revocation");
  const descriptorPath = await resolveVerifiedReference(loaded.sourceRoot, target.descriptor, "descriptor");
  const archivePath = await resolveVerifiedReference(loaded.sourceRoot, target.archive, "archive");
  const key = `${entry.package_identity.package_id}@${entry.package_identity.version}`;
  return {
    repository: {
      root: loaded.sourceRoot,
      trustRootPath,
      sourceIndexPath,
      revocationListPath,
      packages: {},
      packagesByAppVersion: { [key]: { archivePath, descriptorPath } },
      authoritiesByAppVersion: { [key]: { trustRootPath, sourceIndexPath, revocationListPath } },
    },
    availableVersion: entry.package_identity.version,
    displayName: entry.safe_presentation.display_name,
    publisherName: "BrainDrive",
    packageKind: [...entry.package_identity.package_kind],
    providesOperations: [...entry.relationship_projection.provides_operations],
    capabilityDependencies: entry.relationship_projection.requires_operations.map((dependency) => CapabilityDependencySchema.parse(dependency)),
    ownerSafeSource: {
      kind: "stage1_catalog",
      label: "BrainDrive Stage 1 catalog",
      cache_status: loaded.cacheStatus,
    },
  };
}

function parseCatalog(raw: string): Stage1Catalog {
  try {
    return Stage1CatalogSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof AppPlatformError) throw error;
    throw new AppPlatformError("source_index_signature_invalid", error instanceof Error ? error.message : "Stage 1 catalog metadata is invalid");
  }
}

function assertStage1Boundary(catalog: Stage1Catalog): void {
  for (const value of REQUIRED_AUTHORITY) {
    if (!catalog.authority_boundary.host_retains_authority.includes(value)) {
      throw new AppPlatformError("source_index_signature_invalid", "Stage 1 catalog authority boundary is incomplete");
    }
  }
  for (const value of REQUIRED_EXCLUSIONS) {
    if (!catalog.authority_boundary.stage1_exclusions.includes(value)) {
      throw new AppPlatformError("source_index_signature_invalid", "Stage 1 catalog exclusion boundary is incomplete");
    }
  }
  assertNoForbiddenProjection(catalog);
}

function assertNoForbiddenProjection(value: unknown, pointer = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenProjection(item, `${pointer}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      if (/^(?:\/|[A-Za-z]:\\|\\\\)/.test(value) || value.includes("/mnt/") || value.includes("/home/")) {
        throw new AppPlatformError("source_index_signature_invalid", "Stage 1 catalog metadata contains a host path");
      }
      if (/^https?:\/\/(?:localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/i.test(value)) {
        throw new AppPlatformError("source_index_signature_invalid", "Stage 1 catalog metadata contains a private endpoint");
      }
      if (/CANARY_|SECRET|TOKEN|PASSWORD|API_KEY|credential/i.test(value)) {
        throw new AppPlatformError("source_index_signature_invalid", "Stage 1 catalog metadata contains credential-like data");
      }
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (pointer.endsWith(".security_projection") && ["runtime_authority", "install_decision", "owner_trust_roots"].includes(key) && nested === false) continue;
    if (/\.target_artifacts\[\d+\]$/.test(pointer) && key === "trust_root") {
      assertNoForbiddenProjection(nested, `${pointer}.${key}`);
      continue;
    }
    if (FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new AppPlatformError("source_index_signature_invalid", "Stage 1 catalog metadata contains runtime authority");
    }
    assertNoForbiddenProjection(nested, `${pointer}.${key}`);
  }
}

async function readCatalog(source: Stage1CatalogSourceConfig, fallbackCacheRoot?: string): Promise<{
  raw: string;
  sourceRoot: string;
  cacheStatus: "fresh" | "last_known_good";
}> {
  if (source.kind === "braindrive_https") {
    throw new AppPlatformError("package_not_found", "BrainDrive HTTPS catalog source is not enabled in this local-dev run");
  }
  const cacheRoot = source.cacheRoot ?? fallbackCacheRoot;
  try {
    const catalogPath = path.resolve(source.catalogPath);
    const raw = await readFile(catalogPath, "utf8");
    const sourceRoot = catalogReferenceRoot(catalogPath);
    if (cacheRoot) await writeCache(cacheRoot, raw, sourceRoot);
    return { raw, sourceRoot, cacheStatus: "fresh" };
  } catch (error) {
    if (!cacheRoot) throw asCatalogReadError(error);
    return readCache(cacheRoot);
  }
}

function catalogReferenceRoot(catalogPath: string): string {
  const stageRoot = path.dirname(catalogPath);
  const catalogRoot = path.dirname(stageRoot);
  if (path.basename(catalogPath) === "catalog.json" && path.basename(stageRoot) === "stage1" && path.basename(catalogRoot) === "catalog") {
    return path.dirname(catalogRoot);
  }
  return stageRoot;
}

async function writeCache(cacheRoot: string, raw: string, sourceRoot: string): Promise<void> {
  const root = path.join(cacheRoot, "stage1-catalog");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, "latest.json"), raw, { mode: 0o600 });
  await writeFile(path.join(root, "metadata.json"), `${JSON.stringify({ sourceRoot })}\n`, { mode: 0o600 });
}

async function readCache(cacheRoot: string): Promise<{ raw: string; sourceRoot: string; cacheStatus: "last_known_good" }> {
  try {
    const root = path.join(cacheRoot, "stage1-catalog");
    const raw = await readFile(path.join(root, "latest.json"), "utf8");
    const metadata = z.object({ sourceRoot: z.string().min(1) }).strict().parse(JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8")));
    return { raw, sourceRoot: metadata.sourceRoot, cacheStatus: "last_known_good" };
  } catch (error) {
    throw asCatalogReadError(error);
  }
}

function asCatalogReadError(error: unknown): AppPlatformError {
  if (error instanceof AppPlatformError) return error;
  return new AppPlatformError("package_not_found", error instanceof Error ? error.message : "Stage 1 catalog source is unavailable");
}

async function resolveVerifiedReference(sourceRoot: string, reference: z.infer<typeof ArtifactRefSchema>, label: string): Promise<string> {
  const resolved = path.resolve(sourceRoot, reference.reference);
  const sourceRootResolved = path.resolve(sourceRoot);
  if (resolved !== sourceRootResolved && !resolved.startsWith(`${sourceRootResolved}${path.sep}`)) {
    throw new AppPlatformError("source_index_signature_invalid", `Stage 1 catalog ${label} reference escapes the catalog root`);
  }
  const actualDigest = `sha256:${createHash("sha256").update(await readFile(resolved)).digest("hex")}`;
  if (actualDigest !== reference.digest) {
    throw new AppPlatformError("source_index_signature_invalid", `Stage 1 catalog ${label} digest does not match referenced artifact`);
  }
  return resolved;
}
