import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFixtureRepository, MODERN_FIXTURE_VERSION, revokeFixtureVersion } from "./fixture-repository.js";
import { PackageVerifier } from "./package-verifier.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-app-package-"));
  roots.push(root);
  const repository = await createFixtureRepository(path.join(root, "source"));
  return { root, repository, verifier: new PackageVerifier("26.7.23") };
}

describe("signed fixture package verification", () => {
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
