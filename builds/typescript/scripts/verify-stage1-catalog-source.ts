import { createStage1CatalogPackageSource } from "../app-platform/lifecycle/stage1-catalog-source.js";
import { PackageVerifier } from "../app-platform/lifecycle/package-verifier.js";

const catalogPath = process.argv[2];
const target = process.argv[3] ?? "docker_linux_x64";
const appId = process.argv[4] ?? "ai.braindrive.resume-builder";
if (!catalogPath) {
  throw new Error("usage: verify-stage1-catalog-source <catalog-path> [target] [app-id]");
}
if (target !== "docker_linux_x64" && target !== "desktop_windows_x64" && target !== "desktop_macos_universal") {
  throw new Error("target must be docker_linux_x64, desktop_windows_x64, or desktop_macos_universal");
}

const source = await createStage1CatalogPackageSource({
  source: { kind: "local_file", catalogPath },
  appId,
  target,
});
const verified = await new PackageVerifier("26.7.23", target).verifyForCatalog(
  source.repository,
  source.availableVersion,
  { appId, publisherId: "ai.braindrive" },
);

console.log(`PASS ${target} ${verified.manifest.app_id}@${verified.manifest.package_version} ${verified.packageDigest} ${source.ownerSafeSource.cache_status}`);
