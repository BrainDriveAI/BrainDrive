import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { STATUS } from "./verification-contract.mjs";

const DEFAULT_PACKAGE_ID = "ai.braindrive.resume-builder";
const RELEASE_REPOSITORIES = {
  "ai.braindrive.resume-builder": "BrainDrive-Resume-Builder",
  "ai.braindrive.brief-builder": "BrainDrive-Brief-Builder",
  "ai.braindrive.internet-search.searxng": "BrainDrive-Internet-Search",
};

export async function reviewE21PackagePortability({
  catalogSource,
  target,
  artifactsRoot,
  liveObservation = {},
  packageId = process.env.BRAINDRIVE_DESKTOP_VERIFIER_PACKAGE_ID?.trim() || DEFAULT_PACKAGE_ID,
}) {
  const evidence = {
    evaluationGroup: "E-21",
    rows: ["TB-6", "FR-10"],
    packageId,
    target,
    status: STATUS.NOT_RUN,
    acquisitionReceipts: [],
    manifestParity: null,
    catalogRegistration: null,
    liveInstallation: null,
  };

  try {
    const loaded = await loadCatalog(catalogSource);
    const entry = loaded.catalog.entries?.find((candidate) => candidate.package_identity?.package_id === packageId);
    if (!entry) throw new Error(`E-21 package is not registered in the selected catalog: ${packageId}`);
    const targetArtifact = entry.target_artifacts?.find((candidate) => candidate.target === target);
    if (!targetArtifact) throw new Error(`E-21 package has no ${target} target artifact: ${packageId}`);

    const e21Root = path.join(artifactsRoot, "e21-package-portability");
    const channelsRoot = path.join(e21Root, "channels");
    await mkdir(channelsRoot, { recursive: true });

    const catalogArchivePath = path.join(channelsRoot, "catalog", safeFileName(entry.release.artifact_name));
    const catalogArchive = await acquireReference({
      sourceRoot: loaded.sourceRoot,
      reference: targetArtifact.archive,
      destination: catalogArchivePath,
      channel: "catalog",
    });
    evidence.acquisitionReceipts.push(catalogArchive.receipt);

    const releaseAssetUrl = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RELEASE_ASSET_URL?.trim()
      || releaseAssetUrlFor(entry);
    const githubArchivePath = path.join(channelsRoot, "github-release", safeFileName(entry.release.artifact_name));
    const githubArchive = await acquireRemote({
      url: releaseAssetUrl,
      destination: githubArchivePath,
      channel: "github-release",
      expectedDigest: targetArtifact.archive.digest,
    });
    evidence.acquisitionReceipts.push(githubArchive.receipt);

    const copiedZipPath = path.join(channelsRoot, "copied-zip", `${safeFileName(entry.release.artifact_name)}.zip`);
    await mkdir(path.dirname(copiedZipPath), { recursive: true });
    await copyFile(githubArchive.path, copiedZipPath);
    const copiedZipDigest = await digestFile(copiedZipPath);
    const copiedZipReceipt = {
      channel: "byte-preserving-copied-zip",
      sourcePath: githubArchive.path,
      path: copiedZipPath,
      bytes: copiedZipDigest.bytes,
      sha256: copiedZipDigest.sha256,
      expectedSha256: targetArtifact.archive.digest,
      bytePreserving: copiedZipDigest.sha256 === githubArchive.receipt.sha256,
    };
    evidence.acquisitionReceipts.push(copiedZipReceipt);

    const channelDigests = evidence.acquisitionReceipts.map((receipt) => receipt.sha256);
    const archiveParity = channelDigests.every((digest) => digest === targetArtifact.archive.digest)
      && new Set(channelDigests).size === 1;

    const catalogManifest = await readStoredZipManifest(catalogArchive.path);
    const githubManifest = await readStoredZipManifest(githubArchive.path);
    const copiedManifest = await readStoredZipManifest(copiedZipPath);
    const releaseManifestUrl = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RELEASE_MANIFEST_URL?.trim()
      || releaseManifestUrlFor(releaseAssetUrl);
    const releaseManifestPath = path.join(e21Root, "github-release-manifest.json");
    const releaseManifest = await acquireJson({ url: releaseManifestUrl, destination: releaseManifestPath });
    const descriptor = await readReferencedJson(loaded.sourceRoot, targetArtifact.descriptor);
    const descriptorManifest = descriptor?.payload?.manifest ?? descriptor?.manifest;
    const manifests = {
      catalogArchive: canonicalJson(catalogManifest),
      githubReleaseArchive: canonicalJson(githubManifest),
      copiedZip: canonicalJson(copiedManifest),
      githubReleaseManifest: canonicalJson(releaseManifest),
      catalogDescriptor: canonicalJson(descriptorManifest),
    };
    const manifestDigests = Object.fromEntries(Object.entries(manifests).map(([name, value]) => [name, sha256(value)]));
    const manifestParity = Object.values(manifests).every((manifest) => manifest === manifests.catalogArchive);
    evidence.manifestParity = {
      source: "manifest.json plus signed catalog descriptor and GitHub release manifest",
      manifestDigests,
      allEqual: manifestParity,
    };

    const registrationDiff = compareCatalogRegistration(entry, catalogManifest, target);
    evidence.catalogRegistration = {
      packageIdentity: entry.package_identity,
      relationshipProjection: entry.relationship_projection,
      securityProjection: entry.security_projection,
      target: targetArtifact,
      diff: registrationDiff,
      catalogOnlyAuthorityDetected: registrationDiff.length > 0,
    };

    evidence.liveInstallation = compareLiveInstallation({
      expectedArchiveDigest: targetArtifact.archive.digest,
      liveObservation,
    });

    const artifactParityPassed = archiveParity && manifestParity && registrationDiff.length === 0;
    const liveParityPassed = evidence.liveInstallation.pass;
    evidence.artifactParity = {
      archiveDigestsEqual: archiveParity,
      expectedArchiveDigest: targetArtifact.archive.digest,
      observedArchiveDigests: channelDigests,
      manifestsEqual: manifestParity,
      catalogRegistrationClean: registrationDiff.length === 0,
    };
    evidence.status = artifactParityPassed && liveParityPassed ? STATUS.PASS : STATUS.FAIL;
    evidence.basis = evidence.status === STATUS.PASS
      ? "Catalog, GitHub release, and byte-preserving ZIP acquisitions are digest- and manifest-identical; the catalog-mediated desktop install activated the expected package digest, and no separate ZIP UI is required by the desktop UX."
      : [
        !artifactParityPassed ? "The multi-channel artifact or catalog-registration parity leg failed." : null,
        !liveParityPassed ? evidence.liveInstallation.reason : null,
      ].filter(Boolean).join(" ");
  } catch (error) {
    evidence.status = STATUS.FAIL;
    evidence.error = error instanceof Error ? error.message : String(error);
    evidence.basis = "E-21 could not produce a complete acquisition, digest, manifest, registration, and live-installation record.";
  }

  await mkdir(artifactsRoot, { recursive: true });
  await writeFile(path.join(artifactsRoot, "e21-package-portability.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function compareLiveInstallation({ expectedArchiveDigest, liveObservation }) {
  const catalogInstall = liveObservation.catalogInstall ?? {};
  const alternativeControls = liveObservation.alternativeAcquisitionControls ?? [];
  const activatedDigests = catalogInstall.activatedPackageDigests ?? [];
  const catalogDigestMatches = catalogInstall.executed === true
    && activatedDigests.includes(expectedArchiveDigest);
  const catalogOwnerState = catalogInstall.ownerVisibleState ?? null;
  const pass = catalogDigestMatches;
  return {
    requiredPaths: ["catalog-mediated GitHub download"],
    catalog: {
      executed: catalogInstall.executed === true,
      activatedPackageDigests: activatedDigests,
      expectedArchiveDigest,
      digestMatches: catalogDigestMatches,
      packageStoreSnapshot: catalogInstall.packageStoreSnapshot ?? null,
      ownerVisibleState: catalogOwnerState,
    },
    copiedZip: {
      userFacingInstallPathRequired: false,
      purpose: "independent byte-preserving artifact fixture, not a product install control",
    },
    ownerVisibleStateParity: "not_applicable_for_separate_acquisition_ui",
    alternativeAcquisitionControls: alternativeControls,
    pass,
    reason: pass
      ? "The catalog-mediated GitHub download activated the expected package digest; independent artifact and manifest parity proves the reviewed package is not catalog-authority dependent. No separate ZIP UI is required by the desktop UX."
      : "The catalog-mediated installation did not produce the expected activated package digest.",
  };
}

function compareCatalogRegistration(entry, manifest, target) {
  const differences = [];
  const identity = entry.package_identity;
  if (manifest.app_id !== identity.package_id) differences.push(`package identity mismatch: catalog ${identity.package_id}, manifest ${manifest.app_id ?? "missing"}`);
  if (manifest.publisher_id !== identity.publisher_id) differences.push(`publisher mismatch: catalog ${identity.publisher_id}, manifest ${manifest.publisher_id ?? "missing"}`);
  if (manifest.package_version !== identity.version) differences.push(`version mismatch: catalog ${identity.version}, manifest ${manifest.package_version ?? "missing"}`);
  if (!(manifest.platform_artifacts ?? []).some((artifact) => artifact.target === target)) differences.push(`manifest does not declare target ${target}`);

  const projection = entry.relationship_projection ?? {};
  const packageProvides = manifest.provides_operations ?? [];
  const packageRequires = manifest.requires_operations ?? [];
  if (canonicalJson(projection.provides_operations ?? []) !== canonicalJson(packageProvides)) {
    differences.push("catalog provides_operations differs from the package manifest");
  }
  if (canonicalJson(projection.requires_operations ?? []) !== canonicalJson(packageRequires)) {
    differences.push("catalog requires_operations differs from the package manifest");
  }
  if ((projection.depends_on_packages ?? []).length > 0 && canonicalJson(projection.depends_on_packages) !== canonicalJson(manifest.depends_on_packages ?? [])) {
    differences.push("catalog declares package dependencies absent from the package manifest");
  }
  if (projection.launchable_app !== (identity.package_kind ?? []).includes("app")) {
    differences.push("catalog launchable_app projection does not match package kind");
  }

  const expectedSecurityProjection = {
    catalog_role: "discovery_and_retrieval_metadata_only",
    runtime_authority: false,
    install_decision: false,
    owner_trust_roots: false,
    private_binding_projection: "never",
  };
  if (canonicalJson(entry.security_projection ?? {}) !== canonicalJson(expectedSecurityProjection)) {
    differences.push("catalog security projection grants authority outside the package/Host contract");
  }
  return differences;
}

async function loadCatalog(source) {
  if (source?.kind === "local_file") {
    const catalogPath = path.resolve(source.catalogPath);
    return {
      catalog: JSON.parse(await readFile(catalogPath, "utf8")),
      sourceRoot: catalogReferenceRoot(catalogPath),
    };
  }
  const catalogUrl = source?.catalogUrl;
  if (!catalogUrl) throw new Error("E-21 requires a local or HTTPS catalog source.");
  const response = await fetch(catalogUrl);
  if (!response.ok) throw new Error(`E-21 catalog fetch failed: ${response.status} ${response.statusText}`);
  return { catalog: await response.json(), sourceRoot: catalogReferenceRootUrl(catalogUrl) };
}

async function acquireReference({ sourceRoot, reference, destination, channel }) {
  const source = resolveReference(sourceRoot, reference.reference);
  const bytes = /^https?:\/\//i.test(source) ? await fetchBytes(source) : await readFile(source);
  const digest = digestBytes(bytes);
  if (digest !== reference.digest) throw new Error(`E-21 ${channel} artifact digest mismatch: expected ${reference.digest}, observed ${digest}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return {
    path: destination,
    receipt: { channel, sourceReference: reference.reference, resolvedSource: source, path: destination, bytes: bytes.byteLength, sha256: digest, expectedSha256: reference.digest },
  };
}

async function acquireRemote({ url, destination, channel, expectedDigest }) {
  const bytes = await fetchBytes(url);
  const digest = digestBytes(bytes);
  if (expectedDigest && digest !== expectedDigest) throw new Error(`E-21 ${channel} artifact digest mismatch: expected ${expectedDigest}, observed ${digest}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return { path: destination, receipt: { channel, sourceUrl: url, path: destination, bytes: bytes.byteLength, sha256: digest, expectedSha256: expectedDigest ?? null } };
}

async function acquireJson({ url, destination }) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`E-21 release manifest fetch failed: ${response.status} ${response.statusText}`);
  const raw = await response.text();
  const value = JSON.parse(raw);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

async function readReferencedJson(sourceRoot, reference) {
  const source = resolveReference(sourceRoot, reference.reference);
  const raw = /^https?:\/\//i.test(source) ? await (await fetch(source)).text() : await readFile(source, "utf8");
  return JSON.parse(raw);
}

async function readStoredZipManifest(archivePath) {
  const bytes = await readFile(archivePath);
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const compression = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (name === "manifest.json") {
      if (compression !== 0) throw new Error("E-21 manifest is not in the required stored-ZIP profile");
      return JSON.parse(bytes.subarray(dataStart, dataStart + compressedSize).toString("utf8"));
    }
    offset = dataStart + compressedSize;
  }
  throw new Error(`E-21 archive has no manifest.json: ${archivePath}`);
}

async function digestFile(filePath) {
  const bytes = await readFile(filePath);
  return { bytes: bytes.byteLength, sha256: digestBytes(bytes) };
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`E-21 artifact fetch failed: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

function releaseAssetUrlFor(entry) {
  const repository = RELEASE_REPOSITORIES[entry.package_identity.package_id];
  if (!repository) throw new Error(`Set BRAINDRIVE_DESKTOP_VERIFIER_RELEASE_ASSET_URL for ${entry.package_identity.package_id}.`);
  return `https://github.com/BrainDriveAI/${repository}/releases/download/v${entry.package_identity.version}/${encodeURIComponent(entry.release.artifact_name)}`;
}

function releaseManifestUrlFor(assetUrl) {
  return assetUrl.replace(/\.bd(?:app|cap)$/i, ".manifest.json");
}

function resolveReference(sourceRoot, reference) {
  if (/^https?:\/\//i.test(sourceRoot)) return new URL(reference, sourceRoot).toString();
  if (!reference || reference.startsWith("/") || /^[A-Za-z]:[\\/]/.test(reference) || reference.includes("..")) throw new Error(`Unsafe E-21 catalog reference: ${reference}`);
  return path.resolve(sourceRoot, ...reference.split("/"));
}

function catalogReferenceRoot(catalogPath) {
  const stageRoot = path.dirname(catalogPath);
  const catalogRoot = path.dirname(stageRoot);
  return path.basename(catalogPath) === "catalog.json" && path.basename(stageRoot) === "stage1" && path.basename(catalogRoot) === "catalog"
    ? path.dirname(catalogRoot)
    : stageRoot;
}

function catalogReferenceRootUrl(catalogUrl) {
  const url = new URL(catalogUrl);
  const segments = url.pathname.split("/");
  if (segments.at(-1) === "catalog.json" && segments.at(-2) === "stage1" && segments.at(-3) === "catalog") {
    url.pathname = `${segments.slice(0, -3).join("/")}/`;
  } else {
    url.pathname = `${segments.slice(0, -1).join("/")}/`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function safeFileName(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256(value) {
  return digestBytes(Buffer.from(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
