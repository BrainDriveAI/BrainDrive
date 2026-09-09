import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { PermissionSet } from "../../contracts.js";
import { PackageVerifier } from "./package-verifier.js";
import { createFixtureRepository, revokeFixtureVersion } from "./fixture-repository.js";
import { createStage1CatalogPackageSource } from "./stage1-catalog-source.js";
import { AppLifecycleStore } from "./store.js";
import { AppLifecycleService } from "./service.js";
import { CapabilityTokenBroker } from "./capability-token.js";
import { InMemoryAppSupervisor } from "./process-supervisor.js";
import { createAppLifecycleRoutePlatform, registerAppLifecycleRoutes } from "./routes.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const permissions: PermissionSet = { memory_access: true, tool_access: true, system_actions: true, delegation: true, approval_authority: true, administration: true };

function sha256(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fileDigest(filePath: string): Promise<`sha256:${string}`> {
  return sha256(await readFile(filePath));
}

async function missing(filePath: string): Promise<boolean> {
  return stat(filePath).then(() => false, (error: NodeJS.ErrnoException) => error.code === "ENOENT");
}

async function writeStage1Catalog(input: {
  root: string;
  sourceRoot: string;
  version?: string;
  appId?: string;
  targets?: readonly string[];
  status?: "fixture_pending_extraction" | "local_dev_verified";
}): Promise<string> {
  const version = input.version ?? "1.0.0";
  const appId = input.appId ?? "ai.braindrive.resume-builder";
  const catalogPath = path.join(input.root, "catalog.json");
  const archive = `${version}.bdapp`;
  const descriptor = `${version}.descriptor.json`;
  const targetArtifacts = await Promise.all((input.targets ?? ["docker_linux_x64", "desktop_windows_x64", "desktop_macos_universal"]).map(async (target) => ({
    target,
    trust_root: { reference: "trust-root.json", digest: await fileDigest(path.join(input.sourceRoot, "trust-root.json")) },
    descriptor: { reference: descriptor, digest: await fileDigest(path.join(input.sourceRoot, descriptor)) },
    archive: { reference: archive, digest: await fileDigest(path.join(input.sourceRoot, archive)) },
    source_index: { reference: "source-index.json", digest: await fileDigest(path.join(input.sourceRoot, "source-index.json")) },
    revocation: { reference: "revocations.json", digest: await fileDigest(path.join(input.sourceRoot, "revocations.json")) },
  })));
  const catalog = {
    catalog_version: 1,
    catalog_id: "ai.braindrive.stage1.local-dev",
    publisher_id: "ai.braindrive",
    release_channel: "local-dev",
    generated_at: "2026-09-09T12:00:00.000Z",
    authority_boundary: {
      catalog_role: "discovery_and_retrieval_metadata_only",
      package_scope: "braindrive_built_and_reviewed",
      host_retains_authority: [
        "package_verification", "trust_evaluation", "compatibility_filtering", "revocation_checking", "reviewed_registration_joins",
        "install_update_decisions", "lifecycle_state", "runtime_supervision", "owner_data_preservation",
      ],
      stage1_exclusions: [
        "public_marketplace", "third_party_publishing", "arbitrary_local_package_installation", "source_neutral_registry",
        "owner_added_production_trust_roots", "open_registry", "federation_claim", "catalog_runtime_authority",
      ],
    },
    entries: [{
      package_identity: { package_id: appId, publisher_id: "ai.braindrive", package_kind: ["app"], version },
      release: { channel: "local-dev", artifact_name: `braindrive-resume-builder-${version}-local.dev.bdapp`, status: input.status ?? "local_dev_verified" },
      target_artifacts: targetArtifacts,
      compatibility: {
        manifest_version: 2,
        package_profile: "braindrive-package-v2",
        host_min_version: "26.7.23",
        mcp_protocol: "2026-07-28",
        mcp_apps_extension: { extension_id: "io.modelcontextprotocol/ui", version: "2026-01-26" },
        targets: input.targets ?? ["docker_linux_x64", "desktop_windows_x64", "desktop_macos_universal"],
      },
      safe_presentation: {
        display_name: "Resume Builder",
        summary: "Standalone BrainDrive resume app package.",
        icon: null,
        retention_summary: "Owner resume data retention remains host-owned.",
      },
      relationship_projection: { launchable_app: true, provides_operations: [], requires_operations: [], depends_on_packages: [] },
      security_projection: {
        catalog_role: "discovery_and_retrieval_metadata_only",
        runtime_authority: false,
        install_decision: false,
        owner_trust_roots: false,
        private_binding_projection: "never",
      },
    }],
  };
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  return catalogPath;
}

describe("Stage 1 catalog source", () => {
  it("resolves a local catalog entry into verifier-owned package metadata without exposing runtime authority", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-stage1-catalog-")); roots.push(root);
    const repository = await createFixtureRepository(root);
    const catalogPath = await writeStage1Catalog({ root, sourceRoot: repository.root });

    const source = await createStage1CatalogPackageSource({
      source: { kind: "local_file", catalogPath },
      appId: "ai.braindrive.resume-builder",
      target: "desktop_windows_x64",
      fallbackCacheRoot: path.join(root, "cache"),
    });

    expect(source).toMatchObject({
      availableVersion: "1.0.0",
      displayName: "Resume Builder",
      ownerSafeSource: { kind: "stage1_catalog", cache_status: "fresh" },
    });
    const verified = await new PackageVerifier("26.7.23", "desktop_windows_x64").verifyForCatalog(
      source.repository,
      source.availableVersion,
      { appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive" },
    );
    expect(verified.manifest).toMatchObject({ app_id: "ai.braindrive.resume-builder", package_version: "1.0.0" });
    expect(JSON.stringify(source.ownerSafeSource)).not.toMatch(/payload\/|entrypoint|secret|endpoint|host_path|trust_root|revocation/i);
  });

  it("uses last-known-good catalog metadata when the configured local file is unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-stage1-lkg-")); roots.push(root);
    const repository = await createFixtureRepository(root);
    const catalogPath = await writeStage1Catalog({ root, sourceRoot: repository.root });
    const cacheRoot = path.join(root, "cache");
    await createStage1CatalogPackageSource({ source: { kind: "local_file", catalogPath, cacheRoot }, appId: "ai.braindrive.resume-builder", target: "docker_linux_x64" });
    await rm(catalogPath);

    const source = await createStage1CatalogPackageSource({
      source: { kind: "local_file", catalogPath, cacheRoot },
      appId: "ai.braindrive.resume-builder",
      target: "docker_linux_x64",
    });

    expect(source.ownerSafeSource.cache_status).toBe("last_known_good");
    await expect(new PackageVerifier("26.7.23").verifyForCatalog(source.repository, "1.0.0", { appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive" }))
      .resolves.toMatchObject({ manifest: { package_version: "1.0.0" } });
  });

  it("rejects unsupported targets, identity mismatches, revoked packages, and arbitrary Stage 1 package IDs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-stage1-negative-")); roots.push(root);
    const repository = await createFixtureRepository(root);

    let catalogPath = await writeStage1Catalog({ root, sourceRoot: repository.root, targets: ["docker_linux_x64"] });
    await expect(createStage1CatalogPackageSource({ source: { kind: "local_file", catalogPath }, appId: "ai.braindrive.resume-builder", target: "desktop_windows_x64" }))
      .rejects.toMatchObject({ code: "host_incompatible" });

    catalogPath = await writeStage1Catalog({ root, sourceRoot: repository.root, appId: "ai.braindrive.unknown-builder" });
    await expect(createStage1CatalogPackageSource({ source: { kind: "local_file", catalogPath }, appId: "ai.braindrive.unknown-builder", target: "docker_linux_x64" }))
      .rejects.toMatchObject({ code: "source_index_signature_invalid" });

    catalogPath = await writeStage1Catalog({ root, sourceRoot: repository.root });
    const identityMismatch = await createStage1CatalogPackageSource({ source: { kind: "local_file", catalogPath }, appId: "ai.braindrive.resume-builder", target: "docker_linux_x64" });
    await expect(new PackageVerifier("26.7.23").verifyForCatalog(identityMismatch.repository, "1.0.0", { appId: "ai.braindrive.brief-builder", publisherId: "ai.braindrive" }))
      .rejects.toMatchObject({ code: "package_not_found" });

    await revokeFixtureVersion(repository, "1.0.0", "ai.braindrive.resume-builder");
    catalogPath = await writeStage1Catalog({ root, sourceRoot: repository.root });
    const revoked = await createStage1CatalogPackageSource({ source: { kind: "local_file", catalogPath }, appId: "ai.braindrive.resume-builder", target: "docker_linux_x64" });
    await expect(new PackageVerifier("26.7.23").verifyForCatalog(revoked.repository, "1.0.0", { appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive" }))
      .rejects.toMatchObject({ code: "package_revoked" });
  });

  it("drives install, launch projection, uninstall, and reinstall from a catalog-backed lifecycle while retaining owner data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-stage1-route-")); roots.push(root);
    const fixture = await createFixtureRepository(path.join(root, "source"));
    const catalogPath = await writeStage1Catalog({ root: fixture.root, sourceRoot: fixture.root });
    const catalogSource = await createStage1CatalogPackageSource({
      source: { kind: "local_file", catalogPath },
      appId: "ai.braindrive.resume-builder",
      target: "desktop_windows_x64",
    });
    const service = new AppLifecycleService({
      appIdentity: { appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive" },
      store: new AppLifecycleStore(path.join(root, "state"), { appId: "ai.braindrive.resume-builder" }),
      repository: catalogSource.repository,
      verifier: new PackageVerifier("26.7.23", "desktop_windows_x64"),
      supervisor: new InMemoryAppSupervisor(),
      tokenBroker: new CapabilityTokenBroker(),
      runtimeRoot: path.join(root, "runtime"),
      ownerDataRoot: path.join(root, "owner-data"),
      catalogPackageSource: catalogSource,
      runtimeTarget: { target: "desktop_windows_x64", runtimeKind: "packaged_node", transport: "loopback" },
      ownerDataLifecycle: { retainedClasses: ["app_storage", "artifact_records", "export_receipts", "owner_exports", "lifecycle_tombstone"], prepareActivation: async () => undefined, cleanupDefaultUninstall: async () => undefined },
    });
    await service.initialize();
    const retainedPath = path.join(root, "owner-data", "retained.json");
    await mkdir(path.dirname(retainedPath), { recursive: true });
    await writeFile(retainedPath, "{\"owner\":true}\n", "utf8");

    const app = Fastify();
    app.addHook("preHandler", async (request) => { request.authContext = { actorId: "owner", actorType: "owner", mode: "local-owner", permissions }; });
    registerAppLifecycleRoutes(app, createAppLifecycleRoutePlatform([
      { routeKey: "resume-builder", displayName: "Resume Builder", publisherName: "BrainDrive", service },
    ]));

    const catalog = (await app.inject({ method: "GET", url: "/apps" })).json();
    expect(catalog.apps[0]).toMatchObject({ source: { kind: "stage1_catalog", cache_status: "fresh" }, available_actions: ["install"] });
    const installed = (await app.inject({ method: "POST", url: "/apps/resume-builder/install", payload: {
      operation_id: crypto.randomUUID(),
      idempotency_key: "stage1-install-key",
      expected_generation: 0,
      installation_id: null,
      version: "1.0.0",
      approve_capabilities: true,
    } })).json();
    expect(installed).toMatchObject({ state: "active", available_actions: expect.arrayContaining(["launch", "uninstall"]) });
    const firstInstallation = installed.identity.installation_id;
    const uninstall = (await app.inject({ method: "POST", url: "/apps/resume-builder/uninstall", payload: {
      operation_id: crypto.randomUUID(),
      idempotency_key: "stage1-uninstall-key",
      expected_generation: installed.generation,
      installation_id: firstInstallation,
      confirm_retained_data: true,
    } })).json();
    expect(uninstall).toMatchObject({ state: "not_installed", retention: { owner_data_preserved: true } });
    expect(await readFile(retainedPath, "utf8")).toBe("{\"owner\":true}\n");
    const reinstalled = (await app.inject({ method: "POST", url: "/apps/resume-builder/reinstall", payload: {
      operation_id: crypto.randomUUID(),
      idempotency_key: "stage1-reinstall-key",
      expected_generation: uninstall.generation,
      installation_id: null,
      version: "1.0.0",
      approve_capabilities: true,
    } })).json();
    expect(reinstalled.state).toBe("active");
    expect(reinstalled.identity.installation_id).not.toBe(firstInstallation);
    expect(await missing(retainedPath)).toBe(false);
    expect(JSON.stringify(reinstalled)).not.toMatch(/payload\/|endpoint|token|secret|host_path|package_root/i);
    await app.close();
  });
});
