import { createHash } from "node:crypto";
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GenericPackageManifestSchema } from "../contracts/app-registry.js";
import { canonicalJson, canonicalJsonDocumentDigest } from "../contracts/common.js";
import { createFixtureRepository, createSyntheticFirstPartyFixtureRepository, MODERN_FIXTURE_VERSION, revokeFixtureVersion } from "./fixture-repository.js";
import {
  PackageVerifier,
  parsePackageComponentManifestForConformance,
  type PackageComponentManifest,
} from "./package-verifier.js";
import { parseStoredRuntimePackageManifestWithDigest } from "./runtime-manifest.js";
import { createVerifiedSidecarPackageBundleFromStore, SidecarBundleStore, type VerifiedSidecarPackageBundle } from "./sidecar-bundle-store.js";
import { ImmutablePackageStore, type ImmutablePackageRecord } from "./verified-package-store.js";

const roots: string[] = [];

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(child);
    else await chmod(child, 0o600).catch(() => undefined);
  }));
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map(async (root) => {
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  }));
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-package-"));
  roots.push(root);
  const repository = await createFixtureRepository(path.join(root, "source"));
  return { root, repository, verifier: new PackageVerifier("26.7.23") };
}

function digest(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function sidecarFixture(): Promise<PackageComponentManifest> {
  const source = JSON.parse(await readFile(new URL("../contracts/fixtures/sidecar-package/sc-001-conformance-corpus.json", import.meta.url), "utf8")) as {
    valid_cases: Array<{ fixture_id: string; manifest: unknown }>;
  };
  const fixture = source.valid_cases.find((candidate) => candidate.fixture_id === "valid-app-owned-sidecar");
  if (!fixture) throw new Error("valid-app-owned-sidecar fixture is missing");
  return parsePackageComponentManifestForConformance(clone(fixture.manifest));
}

async function materializeSidecarPackage(
  root: string,
  options: {
    packageId?: string;
    packageVersion?: string;
    dependencyVersion?: string;
    cacheStrategy?: "package_version_isolated" | "content_addressed_immutable";
  } = {},
): Promise<{
  manifest: PackageComponentManifest;
  packageRoot: string;
  packageDigest: `sha256:${string}`;
  packageRecord: ImmutablePackageRecord;
  verifiedPackage: VerifiedSidecarPackageBundle;
}> {
  const manifest = clone(await sidecarFixture()) as PackageComponentManifest;
  manifest.package_id = options.packageId ?? manifest.package_id;
  manifest.package_version = options.packageVersion ?? manifest.package_version;
  const packageStageRoot = path.join(root, "package-stage", manifest.package_id, manifest.package_version);
  const fileBytes = new Map<string, Buffer>();
  const dependencyVersion = options.dependencyVersion ?? "22.17.0";

  for (const file of manifest.files) {
    let body = `${manifest.package_id}:${manifest.package_version}:${file.path}:${dependencyVersion}\n`;
    if (file.path.endsWith("lock.json")) {
      body = `${JSON.stringify({ lockfile_version: 1, package_id: manifest.package_id, dependency_version: dependencyVersion })}\n`;
    } else if (file.path.endsWith("intoto.jsonl")) {
      body = `${JSON.stringify({ builder: "bd-ac002-fixture", package_id: manifest.package_id, package_version: manifest.package_version })}\n`;
    } else if (file.path.endsWith("cyclonedx.json")) {
      body = `${JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", version: 1, components: [{ name: "nodejs.runtime", version: dependencyVersion }] })}\n`;
    }
    const bytes = Buffer.from(body, "utf8");
    fileBytes.set(file.path, bytes);
    file.size_bytes = bytes.byteLength;
    file.digest = digest(bytes);
  }

  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  for (const sidecar of manifest.sidecars) {
    for (const target of sidecar.targets) {
      if (target.runtime_kind !== "packaged_process") continue;
      const bundle = target.dependency_bundle;
      bundle.dependencies[0].version = dependencyVersion;
      bundle.dependencies[0].digest = digest(`${bundle.dependencies[0].name}:${dependencyVersion}:${target.target}`);
      bundle.bundle_digest = filesByPath.get(target.artifact_path)!.digest;
      bundle.lockfile_digest = filesByPath.get(bundle.lockfile_path)!.digest;
      bundle.provenance_digest = filesByPath.get(bundle.provenance_path)!.digest;
      bundle.sbom_digest = filesByPath.get(bundle.sbom_path)!.digest;
      bundle.cache.strategy = options.cacheStrategy ?? "package_version_isolated";
      bundle.cache.content_address = bundle.cache.strategy === "content_addressed_immutable" ? bundle.bundle_digest : null;
    }
  }

  const parsed = parsePackageComponentManifestForConformance(manifest);
  for (const [filePath, bytes] of fileBytes) {
    const targetPath = path.join(packageStageRoot, ...filePath.split("/"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, bytes);
  }
  const packageDigest = digest(JSON.stringify({ package_id: parsed.package_id, package_version: parsed.package_version }));
  await writeFile(path.join(packageStageRoot, ...parsed.archive.manifest_path.split("/")), `${canonicalJson(parsed)}\n`, "utf8");
  const packageStore = new ImmutablePackageStore(path.join(root, "verified-package-store"));
  const packageRecord: ImmutablePackageRecord = await packageStore.promote({
    manifest: parsed,
    packageDigest,
    descriptorDigest: digest(`descriptor:${packageDigest}`),
    stageRoot: packageStageRoot,
    entrypoint: path.join(packageStageRoot, "payload", "sidecars", "notes-worker", "windows-x64", "index.exe"),
    target: "desktop_windows_x64",
  });
  return {
    manifest: parsed,
    packageRoot: packageRecord.contentRoot,
    packageDigest,
    packageRecord,
    verifiedPackage: await createVerifiedSidecarPackageBundleFromStore({ packageStore, packageDigest, manifest: parsed }),
  };
}

describe("signed fixture package verification", () => {
  it("keys same-version packages by verified app identity and rejects every expected-identity mismatch before extraction", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-multi-app-"));
    roots.push(root);
    const repository = await createSyntheticFirstPartyFixtureRepository(path.join(root, "source"), [
      { appId: "ai.braindrive.resume-builder", routeKey: "resume-builder", displayName: "Resume Builder", version: "5.0.0" },
      { appId: "ai.braindrive.brief-builder", routeKey: "brief-builder", displayName: "Brief Builder", version: "5.0.0" },
    ]);
    const verifier = new PackageVerifier("26.7.23");

    const catalogPackage = await verifier.verifyForCatalog(repository, "5.0.0", {
      appId: "ai.braindrive.brief-builder", publisherId: "ai.braindrive",
    });
    expect(catalogPackage).toMatchObject({ manifest: { app_id: "ai.braindrive.brief-builder", package_version: "5.0.0" }, trust: { executable_allowed: true } });
    expect(catalogPackage).not.toHaveProperty("entrypoint");
    expect(catalogPackage).not.toHaveProperty("packageRoot");

    const resume = await verifier.verifyAndExtract(repository, "5.0.0", path.join(root, "resume-stage"), "candidate_install_or_update", {
      appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive",
    });
    const brief = await verifier.verifyAndExtract(repository, "5.0.0", path.join(root, "brief-stage"), "candidate_install_or_update", {
      appId: "ai.braindrive.brief-builder", publisherId: "ai.braindrive",
    });
    expect([resume.manifest.app_id, brief.manifest.app_id]).toEqual([
      "ai.braindrive.resume-builder", "ai.braindrive.brief-builder",
    ]);
    expect(repository.packagesByAppVersion?.["ai.braindrive.resume-builder@5.0.0"]?.archivePath)
      .not.toBe(repository.packagesByAppVersion?.["ai.braindrive.brief-builder@5.0.0"]?.archivePath);

    const resumeKey = "ai.braindrive.resume-builder@5.0.0";
    const briefKey = "ai.braindrive.brief-builder@5.0.0";
    repository.packagesByAppVersion![resumeKey] = repository.packagesByAppVersion![briefKey]!;
    await expect(verifier.verifyAndExtract(repository, "5.0.0", path.join(root, "collision-stage"), "candidate_install_or_update", {
      appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive",
    })).rejects.toMatchObject({ code: "package_signature_invalid" });
    await expect(readFile(path.join(root, "collision-stage", "payload", "docker", "index.js"))).rejects.toThrow();

    await expect(verifier.verifyAndExtract(repository, "5.0.0", path.join(root, "mismatch-stage"), "candidate_install_or_update", {
      appId: "ai.braindrive.unknown-builder", publisherId: "ai.braindrive",
    })).rejects.toMatchObject({ code: "package_not_found" });
    await expect(readFile(path.join(root, "mismatch-stage", "payload", "docker", "index.js"))).rejects.toThrow();

    repository.packages["5.0.0"] = repository.packagesByAppVersion![briefKey]!;
    repository.authoritiesByVersion = { "5.0.0": repository.authoritiesByAppVersion![briefKey]! };
    await expect(verifier.verifyAndExtract(repository, "5.0.0", path.join(root, "no-version-fallback-stage"), "candidate_install_or_update", {
      appId: "ai.braindrive.unknown-builder", publisherId: "ai.braindrive",
    })).rejects.toMatchObject({ code: "package_not_found" });
    await expect(readFile(path.join(root, "no-version-fallback-stage", "payload", "docker", "index.js"))).rejects.toThrow();
  });

  it("rejects unsafe catalog presentation before signing or catalog projection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-unsafe-catalog-"));
    roots.push(root);
    await expect(createSyntheticFirstPartyFixtureRepository(path.join(root, "source"), [
      { appId: "ai.braindrive.unsafe-builder", routeKey: "unsafe-builder", displayName: "<script>unsafe</script>", version: "1.0.0" },
    ])).rejects.toThrow();
  });

  it("applies revocation to the exact app/version authority when versions collide", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-app-revocation-"));
    roots.push(root);
    const repository = await createSyntheticFirstPartyFixtureRepository(path.join(root, "source"), [
      { appId: "ai.braindrive.resume-builder", routeKey: "resume-builder", displayName: "Resume Builder", version: "6.0.0" },
      { appId: "ai.braindrive.brief-builder", routeKey: "brief-builder", displayName: "Brief Builder", version: "6.0.0" },
    ]);
    await revokeFixtureVersion(repository, "6.0.0", "ai.braindrive.brief-builder");
    const verifier = new PackageVerifier("26.7.23");
    await expect(verifier.verifyAndExtract(repository, "6.0.0", path.join(root, "brief-stage"), "candidate_install_or_update", {
      appId: "ai.braindrive.brief-builder", publisherId: "ai.braindrive",
    })).rejects.toMatchObject({ code: "package_revoked" });
    await expect(verifier.verifyAndExtract(repository, "6.0.0", path.join(root, "resume-stage"), "candidate_install_or_update", {
      appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive",
    })).resolves.toMatchObject({ manifest: { app_id: "ai.braindrive.resume-builder" } });
  });

  it("stores each bundled modern release under an immutable version-specific authority", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-release-authority-"));
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const repository = await createFixtureRepository(sourceRoot);

    const authorityRoot = path.join(sourceRoot, "modern", MODERN_FIXTURE_VERSION);
    await expect(access(path.join(authorityRoot, "source-index.json"))).resolves.toBeUndefined();
    expect(repository.packages[MODERN_FIXTURE_VERSION]?.archivePath).toBe(path.join(authorityRoot, `${MODERN_FIXTURE_VERSION}.bdapp`));
    expect(repository.authoritiesByVersion?.[MODERN_FIXTURE_VERSION]?.sourceIndexPath).toBe(path.join(authorityRoot, "source-index.json"));
  });

  it("declares the PDF export action result as a prepared artifact export result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-export-result-schema-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const verified = await new PackageVerifier("26.7.23").verifyForCatalog(repository, MODERN_FIXTURE_VERSION, {
      appId: "ai.braindrive.resume-builder",
      publisherId: "ai.braindrive",
    });
    const workspace = verified.manifest.manifest_version === 2
      ? verified.manifest.presentations?.workspaces.find((candidate) => candidate.workspace_id === "resume.chat")
      : null;
    const action = workspace?.actions.find((candidate) => candidate.action_id === "resume.export.pdf.request");

    expect(action?.result_schema.schema).toMatchObject({
      type: "object",
      properties: {
        status: { type: "string", enum: ["prepared"] },
        artifact: { type: "object" },
        safe_destination_label: { type: "string" },
      },
    });
    expect((action?.result_schema.schema as { required?: string[] }).required).toEqual(expect.arrayContaining([
      "artifact",
      "bytes_base64",
      "safe_destination_label",
    ]));
  });

  it("normalizes historical stored v2 manifests without accepting them as new package candidates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-transitional-retention-"));
    roots.push(root);
    const repository = await createFixtureRepository(path.join(root, "source"));
    const descriptor = JSON.parse(await readFile(repository.packages[MODERN_FIXTURE_VERSION].descriptorPath, "utf8"));
    const transitionalManifest = {
      ...descriptor.payload.manifest,
      retention_policy: "retain_owner_data_remove_runtime_authority",
    };

    expect(GenericPackageManifestSchema.safeParse(transitionalManifest).success).toBe(false);
    const parsed = parseStoredRuntimePackageManifestWithDigest(transitionalManifest);
    if (typeof parsed.manifest.retention_policy === "string") throw new Error("expected normalized retention policy");
    expect(parsed.manifest.retention_policy.classes.map((entry) => entry.retention_class)).toContain("app_storage");
    expect(parsed.manifestDigest).toBe(canonicalJsonDocumentDigest(transitionalManifest));
  });

  it("republishes the current mounted Resume package with fresh verification metadata after a host restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-current-republish-"));
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const initial = await createFixtureRepository(sourceRoot);
    const verifier = new PackageVerifier("26.7.23");

    await expect(verifier.verifyForCatalog(initial, MODERN_FIXTURE_VERSION, {
      appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive",
    })).resolves.toMatchObject({ trust: { executable_allowed: true } });

    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    await expect(verifier.verifyForCatalog(initial, MODERN_FIXTURE_VERSION, {
      appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive",
    })).rejects.toMatchObject({ code: "revocation_metadata_stale" });

    const restarted = await createFixtureRepository(sourceRoot);
    await expect(verifier.verifyForCatalog(restarted, MODERN_FIXTURE_VERSION, {
      appId: "ai.braindrive.resume-builder", publisherId: "ai.braindrive",
    })).resolves.toMatchObject({ trust: { executable_allowed: true } });
  });

  it("retains prior signed first-party app versions when publishing a changed package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-first-party-update-"));
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    await createSyntheticFirstPartyFixtureRepository(sourceRoot, [
      { appId: "ai.braindrive.brief-builder", routeKey: "brief-builder", displayName: "Brief Builder", version: "1.0.0", resourceHtml: "<main>Old brief</main>" },
    ]);
    const repository = await createSyntheticFirstPartyFixtureRepository(sourceRoot, [
      { appId: "ai.braindrive.brief-builder", routeKey: "brief-builder", displayName: "Brief Builder", version: "1.1.0", resourceHtml: "<main>Updated brief</main>" },
    ]);
    const verifier = new PackageVerifier("26.7.23");
    await expect(verifier.verifyForCatalog(repository, "1.0.0", { appId: "ai.braindrive.brief-builder", publisherId: "ai.braindrive" }))
      .resolves.toMatchObject({ manifest: { package_version: "1.0.0" } });
    await expect(verifier.verifyForCatalog(repository, "1.1.0", { appId: "ai.braindrive.brief-builder", publisherId: "ai.braindrive" }))
      .resolves.toMatchObject({ manifest: { package_version: "1.1.0" } });
  });

  it("discovers retained version-specific modern authorities across app patch releases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-retained-authorities-"));
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    await createFixtureRepository(sourceRoot);

    const currentRoot = path.join(sourceRoot, "modern", MODERN_FIXTURE_VERSION);
    const priorVersion = "3.0.1";
    const priorRoot = path.join(sourceRoot, "modern", priorVersion);
    await cp(currentRoot, priorRoot, { recursive: true });
    const priorIndex = JSON.parse(await readFile(path.join(priorRoot, "source-index.json"), "utf8"));
    priorIndex.payload.entries[0].package_version = priorVersion;
    await writeFile(path.join(priorRoot, "source-index.json"), `${JSON.stringify(priorIndex)}\n`, "utf8");
    await cp(path.join(currentRoot, `${MODERN_FIXTURE_VERSION}.bdapp`), path.join(priorRoot, `${priorVersion}.bdapp`));
    await cp(path.join(currentRoot, `${MODERN_FIXTURE_VERSION}.descriptor.json`), path.join(priorRoot, `${priorVersion}.descriptor.json`));

    const repository = await createFixtureRepository(sourceRoot);
    expect(repository.packages[priorVersion]?.archivePath).toBe(path.join(priorRoot, `${priorVersion}.bdapp`));
    expect(repository.authoritiesByVersion?.[priorVersion]?.sourceIndexPath).toBe(path.join(priorRoot, "source-index.json"));
  });

  it("fails closed when a persisted prior modern authority is malformed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-package-prior-authority-"));
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    await mkdir(path.join(sourceRoot, "modern"), { recursive: true });
    await writeFile(path.join(sourceRoot, "modern", "source-index.json"), "{not-json\n", "utf8");

    await expect(createFixtureRepository(sourceRoot))
      .rejects.toMatchObject({ code: "source_index_signature_invalid" });
  });

  it("fails closed instead of replacing a corrupt persisted source authority", async () => {
    const { repository } = await setup();
    await writeFile(repository.sourceIndexPath, "{not-json\n", "utf8");
    await expect(createFixtureRepository(repository.root))
      .rejects.toMatchObject({ code: "source_index_signature_invalid" });
  });

  it("verifies the source, trust chain, archive, inventory, compatibility, and revocation before extraction", async () => {
    const { root, repository, verifier } = await setup();
    const verified = await verifier.verifyAndExtract(repository, "1.0.0", path.join(root, "stage"), "candidate_install_or_update");

    expect(verified.trust.executable_allowed).toBe(true);
    expect(verified.manifest.package_version).toBe("1.0.0");
    expect(await readFile(verified.entrypoint, "utf8")).toContain("fixture-mcp");
    expect(verified.entrypoint.startsWith(path.join(root, "stage"))).toBe(true);
  });

  it("selects only the accepted signed Windows desktop artifact", async () => {
    const { root, repository } = await setup();
    const verified = await new PackageVerifier("26.7.23", "desktop_windows_x64").verifyAndExtract(repository, "1.0.0", path.join(root, "desktop-stage"), "candidate_install_or_update");
    expect(verified).toMatchObject({ target: "desktop_windows_x64", runtimeKind: "packaged_node" });
    expect(verified.manifest.platform_artifacts.find((artifact) => artifact.target === verified.target)?.os).toBe("windows");
    expect(await readFile(verified.entrypoint, "utf8")).toContain("fixture-mcp");
  });

  it("fails closed for an unselected or undeclared package target", async () => {
    const { root, repository } = await setup();
    await expect(new PackageVerifier("26.7.23", "desktop_linux_x64").verifyAndExtract(repository, "1.0.0", path.join(root, "unsupported-stage"), "candidate_install_or_update"))
      .rejects.toMatchObject({ code: "host_incompatible" });
  });

  it.each([
    ["archive", "package_archive_digest_mismatch"],
    ["descriptor", "package_signature_invalid"],
    ["source-index", "source_index_signature_invalid"],
  ] as const)("rejects tampered %s bytes without extracting", async (target, expectedCode) => {
    const { root, repository, verifier } = await setup();
    const targetPath = target === "archive" ? repository.packages["1.0.0"].archivePath
      : target === "descriptor" ? repository.packages["1.0.0"].descriptorPath
      : repository.sourceIndexPath;
    const bytes = await readFile(targetPath);
    bytes[Math.max(0, bytes.length - 8)] ^= 1;
    await writeFile(targetPath, bytes);

    await expect(verifier.verifyAndExtract(repository, "1.0.0", path.join(root, "stage"), "candidate_install_or_update"))
      .rejects.toMatchObject({ code: expectedCode });
    await expect(readFile(path.join(root, "stage", "payload", "docker", "index.js"))).rejects.toThrow();
  });

  it("rejects an explicitly revoked package even during a local recheck", async () => {
    const { root, repository, verifier } = await setup();
    await revokeFixtureVersion(repository, "1.0.0");

    await expect(verifier.verifyAndExtract(repository, "1.0.0", path.join(root, "stage"), "verified_local_recheck"))
      .rejects.toMatchObject({ code: "package_revoked" });
  });

  it("rejects an incompatible host before extracting or executing", async () => {
    const { root, repository } = await setup();
    const verifier = new PackageVerifier("0.1.0");

    await expect(verifier.verifyAndExtract(repository, "1.0.0", path.join(root, "stage"), "candidate_install_or_update"))
      .rejects.toMatchObject({ code: "host_incompatible" });
  });
});

describe("AC-002 immutable desktop sidecar bundle staging", () => {
  it("stages a verified packaged-process dependency bundle behind an opaque reference", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-bundle-valid-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);
    const store = new SidecarBundleStore(path.join(root, "store"));

    const staged = await store.stage({
      verifiedPackage: fixture.verifiedPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
    });
    const projection = JSON.stringify(staged.reference);

    expect(staged.reference).toMatchObject({
      reference_version: 1,
      package_id: fixture.manifest.package_id,
      package_version: fixture.manifest.package_version,
      component_id: "notes.worker",
      target: "desktop_windows_x64",
      runtime_kind: "packaged_process",
      cache_strategy: "package_version_isolated",
    });
    expect(staged.reference.bundle_reference_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(projection).not.toContain(root);
    expect(projection).not.toMatch(/https?:|127\.0\.0\.1|localhost|token|port/i);

    const resolved = await store.resolveForDriver(staged.reference);
    expect(resolved.entrypoint).toContain(path.join("sidecar-bundles", "packages"));
    await expect(readFile(resolved.entrypoint, "utf8")).resolves.toContain("notes-worker");
  });

  it("rejects caller-invented sidecar package authority before staging", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-bundle-unverified-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);
    const syntheticPackage = {
      authority: "immutable_package_store",
      manifest: fixture.manifest,
      packageDigest: fixture.packageDigest,
      packageVersion: fixture.manifest.package_version,
      contentRoot: fixture.packageRoot,
      target: "desktop_windows_x64",
    } as unknown as VerifiedSidecarPackageBundle;

    await expect(new SidecarBundleStore(path.join(root, "store")).stage({
      verifiedPackage: syntheticPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
    })).rejects.toMatchObject({ code: "authority_widening" });
  });

  it("rejects structural fake package stores as sidecar staging authority", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-fake-store-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);

    await expect(createVerifiedSidecarPackageBundleFromStore({
      packageStore: { read: async () => fixture.packageRecord } as unknown as ImmutablePackageStore,
      packageDigest: fixture.packageDigest,
      manifest: fixture.manifest,
    })).rejects.toMatchObject({ code: "authority_widening" });
  });

  it("rejects same-version sidecar manifests that do not match immutable package store authority", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-wrong-manifest-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);
    const wrongManifest = clone(fixture.manifest);
    wrongManifest.package_id = "ai.braindrive.invented-package";

    await expect(createVerifiedSidecarPackageBundleFromStore({
      packageStore: new ImmutablePackageStore(path.join(root, "verified-package-store")),
      packageDigest: fixture.packageDigest,
      manifest: wrongManifest,
    })).rejects.toMatchObject({ code: "authority_widening" });
  });

  it("verifies staged copy bytes before promotion", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-staged-copy-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);
    const target = fixture.manifest.sidecars[0]!.targets.find((candidate) => candidate.target === "desktop_windows_x64");
    if (!target || target.runtime_kind !== "packaged_process") throw new Error("expected packaged-process fixture target");
    const store = new SidecarBundleStore(path.join(root, "store"), () => new Date("2026-08-20T12:00:00.000Z"), {
      afterCopyBeforePromotion: async ({ temporaryRoot }) => {
        const entrypoint = path.join(temporaryRoot, "payload", "sidecars", "notes-worker", "windows-x64", "index.exe");
        await chmod(entrypoint, 0o600);
        await writeFile(entrypoint, "mutated staged copy\n");
      },
    });

    await expect(store.stage({
      verifiedPackage: fixture.verifiedPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
    })).rejects.toMatchObject({ code: "package_file_mismatch" });

    const contentRoot = path.join(
      store.layout.packages,
      fixture.packageDigest.slice(7),
      "notes.worker",
      "desktop_windows_x64",
      target.dependency_bundle.bundle_digest.slice(7),
      target.dependency_bundle.lockfile_digest.slice(7),
    );
    await expect(access(contentRoot)).rejects.toThrow();
  });

  it("fails closed when a declared sidecar asset is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-bundle-missing-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);
    await makeWritable(fixture.packageRoot);
    await rm(path.join(fixture.packageRoot, "payload", "sidecars", "notes-worker", "windows-x64", "index.exe"));

    await expect(new SidecarBundleStore(path.join(root, "store")).stage({
      verifiedPackage: fixture.verifiedPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
    })).rejects.toMatchObject({ code: "package_file_mismatch" });
  });

  it("fails closed on dependency bundle digest mismatch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-bundle-digest-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);
    await makeWritable(fixture.packageRoot);
    await writeFile(path.join(fixture.packageRoot, "payload", "sidecars", "notes-worker", "windows-x64", "index.exe"), "mutated runtime\n");

    await expect(new SidecarBundleStore(path.join(root, "store")).stage({
      verifiedPackage: fixture.verifiedPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
    })).rejects.toMatchObject({ code: "package_digest_mismatch" });
  });

  it("fails closed on dependency lockfile mismatch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-bundle-lock-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);
    await makeWritable(fixture.packageRoot);
    await writeFile(path.join(fixture.packageRoot, "payload", "dependencies", "notes-worker", "lock.json"), "{\"mutated\":true}\n");

    await expect(new SidecarBundleStore(path.join(root, "store")).stage({
      verifiedPackage: fixture.verifiedPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
    })).rejects.toMatchObject({ code: "package_digest_mismatch" });
  });

  it("detects immutable cache mutation instead of repairing shared content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-cache-mutation-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root, { cacheStrategy: "content_addressed_immutable" });
    const store = new SidecarBundleStore(path.join(root, "store"));
    const staged = await store.stage({
      verifiedPackage: fixture.verifiedPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
    });
    const resolved = await store.resolveForDriver(staged.reference);
    await chmod(resolved.contentRoot, 0o700);
    await chmod(path.dirname(resolved.entrypoint), 0o700);
    await chmod(resolved.entrypoint, 0o600);
    await writeFile(resolved.entrypoint, "mutated cache entry\n");

    await expect(store.stage({
      verifiedPackage: fixture.verifiedPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
    })).rejects.toMatchObject({ code: "package_file_mismatch" });
  });

  it("keeps incompatible dependency versions in isolated immutable roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-incompatible-"));
    roots.push(root);
    const store = new SidecarBundleStore(path.join(root, "store"));
    const first = await materializeSidecarPackage(root, {
      packageId: "ai.braindrive.notes-assistant",
      packageVersion: "1.0.0",
      dependencyVersion: "22.17.0",
    });
    const second = await materializeSidecarPackage(root, {
      packageId: "ai.braindrive.notes-assistant",
      packageVersion: "2.0.0",
      dependencyVersion: "23.0.0",
    });

    const stagedFirst = await store.stage({ verifiedPackage: first.verifiedPackage, sidecarComponentId: "notes.worker", target: "desktop_windows_x64" });
    const stagedSecond = await store.stage({ verifiedPackage: second.verifiedPackage, sidecarComponentId: "notes.worker", target: "desktop_windows_x64" });
    const firstDriver = await store.resolveForDriver(stagedFirst.reference);
    const secondDriver = await store.resolveForDriver(stagedSecond.reference);

    expect(stagedFirst.reference.dependencies[0].version).toBe("22.17.0");
    expect(stagedSecond.reference.dependencies[0].version).toBe("23.0.0");
    expect(stagedFirst.reference.bundle_digest).not.toBe(stagedSecond.reference.bundle_digest);
    expect(firstDriver.contentRoot).not.toBe(secondDriver.contentRoot);
  });

  it("fails offline first-run staging when required package assets are unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-offline-missing-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);
    await makeWritable(fixture.packageRoot);
    await rm(fixture.packageRoot, { recursive: true, force: true });

    await expect(new SidecarBundleStore(path.join(root, "store")).stage({
      verifiedPackage: fixture.verifiedPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
      offline: true,
    })).rejects.toMatchObject({ code: "package_file_mismatch" });
  });

  it("restarts offline from already staged verified bundle references", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-ac002-offline-restart-"));
    roots.push(root);
    const fixture = await materializeSidecarPackage(root);
    const store = new SidecarBundleStore(path.join(root, "store"));
    const staged = await store.stage({
      verifiedPackage: fixture.verifiedPackage,
      sidecarComponentId: "notes.worker",
      target: "desktop_windows_x64",
    });
    await makeWritable(fixture.packageRoot);
    await rm(fixture.packageRoot, { recursive: true, force: true });

    await expect(store.resolveForDriver(staged.reference, { offline: true }))
      .resolves.toMatchObject({ packageDigest: fixture.packageDigest, target: "desktop_windows_x64" });
  });
});
