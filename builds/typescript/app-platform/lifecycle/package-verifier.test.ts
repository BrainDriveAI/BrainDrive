import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GenericPackageManifestSchema } from "../contracts/app-registry.js";
import { canonicalJsonDocumentDigest } from "../contracts/common.js";
import { createFixtureRepository, createSyntheticFirstPartyFixtureRepository, MODERN_FIXTURE_VERSION, revokeFixtureVersion } from "./fixture-repository.js";
import { PackageVerifier } from "./package-verifier.js";
import { parseStoredRuntimePackageManifestWithDigest } from "./runtime-manifest.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-package-"));
  roots.push(root);
  const repository = await createFixtureRepository(path.join(root, "source"));
  return { root, repository, verifier: new PackageVerifier("26.7.23") };
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
