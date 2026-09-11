import { createStage1CatalogPackageSource } from "../app-platform/lifecycle/stage1-catalog-source.js";
import { PackageVerifier, verifyComponentPackageForCatalog } from "../app-platform/lifecycle/package-verifier.js";

const catalogSource = process.argv[2];
const target = process.argv[3] ?? "docker_linux_x64";
const appId = process.argv[4] ?? "ai.braindrive.resume-builder";
if (!catalogSource) {
  throw new Error("usage: verify-stage1-catalog-source <catalog-path-or-url> [target] [app-id]");
}
if (target !== "docker_linux_x64" && target !== "desktop_windows_x64" && target !== "desktop_macos_universal") {
  throw new Error("target must be docker_linux_x64, desktop_windows_x64, or desktop_macos_universal");
}

const source = await createStage1CatalogPackageSource({
  source: /^https?:\/\//i.test(catalogSource)
    ? { kind: "braindrive_https", catalogUrl: catalogSource, cacheRoot: process.env.BRAINDRIVE_STAGE1_CATALOG_CACHE_ROOT?.trim() || ".stage1-catalog-cache" }
    : { kind: "local_file", catalogPath: catalogSource },
  appId,
  target,
});
if (source.packageKind.includes("capability_provider") || source.packageKind.includes("dependency_service")) {
  const verified = await verifyComponentPackageForCatalog(
    source.repository,
    source.availableVersion,
    { appId, publisherId: "ai.braindrive" },
    target,
  );
  console.log(`PASS ${target} ${verified.manifest.package_id}@catalog:${verified.catalogVersion} manifest:${verified.manifestVersion} ${verified.packageDigest} ${source.ownerSafeSource.cache_status}`);
} else {
  const verified = await new PackageVerifier("26.7.23", target).verifyForCatalog(
    source.repository,
    source.availableVersion,
    { appId, publisherId: "ai.braindrive" },
  );

  console.log(`PASS ${target} ${verified.manifest.app_id}@${verified.manifest.package_version} ${verified.packageDigest} ${source.ownerSafeSource.cache_status}`);
}
