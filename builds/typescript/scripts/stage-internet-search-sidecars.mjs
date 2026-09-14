import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";

const execFileAsync = promisify(execFile);

async function main() {
  const sourceRoot = path.resolve(requireArgument("--source"));
  const destinationRoot = path.resolve(requireArgument("--destination"));
  if (process.platform !== "win32") return;

  const crateRoot = path.join(sourceRoot, "sidecar-runtime");
  const manifestPath = path.join(destinationRoot, "manifest.json");
  const executableName = "braindrive-internet-search-sidecar.exe";
  const sidecarPath = "payload/sidecars/search-runtime/windows-x64/searxng-runtime.exe";
  const stagedExecutable = path.join(destinationRoot, ...sidecarPath.split("/"));
  if (!existsSync(path.join(crateRoot, "Cargo.toml"))) {
    if (existsSync(stagedExecutable)) return;
    throw new Error(`Internet Search sidecar crate was not found at ${crateRoot}`);
  }
  await execFileAsync("cargo", ["build", "--release", "--manifest-path", path.join(crateRoot, "Cargo.toml")], {
    cwd: crateRoot,
    shell: true,
  });

  const builtExecutable = path.join(crateRoot, "target", "release", executableName);
  await copyFileIntoPackage(builtExecutable, path.join(destinationRoot, ...sidecarPath.split("/")));

  await writeTextPackageFile(
    destinationRoot,
    "payload/provider/read.js",
    "export async function handleRead() { return null; }\n",
  );
  await writeTextPackageFile(
    destinationRoot,
    "payload/provider/search.js",
    "export async function handleSearch() { return null; }\n",
  );
  await writeJsonPackageFile(destinationRoot, "payload/dependencies/searxng/windows-x64/lock.json", {
    lockfile_version: 1,
    runtime: "braindrive-internet-search-sidecar",
    package: "ai.braindrive.internet-search.searxng",
    target: "desktop_windows_x64",
  });
  await writeJsonPackageFile(destinationRoot, "provenance/searxng-windows.intoto.jsonl", {
    builder: "local-ws5-unsigned-cargo",
    target: "desktop_windows_x64",
    source: "builds/internet_search/sidecar-runtime",
  });
  await writeJsonPackageFile(destinationRoot, "sbom/searxng-windows.cyclonedx.json", {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    components: [{ name: "braindrive-internet-search-sidecar", version: "0.1.0", type: "application" }],
  });
  await writeTextPackageFile(destinationRoot, "provenance/intoto.jsonl", `${JSON.stringify({ builder: "local-ws5-unsigned-cargo" })}\n`);
  await writeJsonPackageFile(destinationRoot, "sbom/cyclonedx.json", {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    components: [{ name: "ai.braindrive.internet-search.searxng", version: "1.0.0", type: "application" }],
  });

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await rewriteManifestInventory(destinationRoot, manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Staged unsigned Windows Internet Search sidecar at ${path.join(destinationRoot, ...sidecarPath.split("/"))}`);
}

function requireArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

async function copyFileIntoPackage(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

async function writeTextPackageFile(root, packagePath, content) {
  const target = path.join(root, ...packagePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function writeJsonPackageFile(root, packagePath, value) {
  await writeTextPackageFile(root, packagePath, `${JSON.stringify(value)}\n`);
}

async function rewriteManifestInventory(root, manifest) {
  for (const sidecar of manifest.sidecars ?? []) {
    sidecar.targets = sidecar.targets.filter((target) => {
      if (target.runtime_kind !== "packaged_process") return true;
      if (target.target !== "desktop_windows_x64") return false;
      const bundle = target.dependency_bundle;
      return [
        target.artifact_path,
        target.entrypoint,
        bundle.lockfile_path,
        bundle.provenance_path,
        bundle.sbom_path,
      ].every((packagePath) => existsSync(path.join(root, ...packagePath.split("/"))));
    });
  }
  await pruneWindowsExcludedPaths(root);
  if (!(manifest.sidecars ?? []).some((sidecar) => sidecar.targets.some((target) => target.target === "desktop_windows_x64" && target.runtime_kind === "packaged_process"))) {
    throw new Error("Staged Internet Search package is missing the Windows sidecar target");
  }

  manifest.files = manifest.files.filter((file) => !isWindowsExcludedPackagePath(file.path) && existsSync(path.join(root, ...file.path.split("/"))));
  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  for (const file of filesByPath.values()) {
    const bytes = await readFile(path.join(root, ...file.path.split("/")));
    file.size_bytes = bytes.byteLength;
    file.digest = digest(bytes);
  }

  const desktopTargets = manifest.sidecars
    .flatMap((sidecar) => sidecar.targets)
    .filter((target) => target.runtime_kind === "packaged_process");

  for (const target of desktopTargets) {
    const bundle = target.dependency_bundle;
    bundle.bundle_digest = filesByPath.get(target.artifact_path)?.digest ?? bundle.bundle_digest;
    bundle.lockfile_digest = filesByPath.get(bundle.lockfile_path)?.digest ?? bundle.lockfile_digest;
    bundle.provenance_digest = filesByPath.get(bundle.provenance_path)?.digest ?? bundle.provenance_digest;
    bundle.sbom_digest = filesByPath.get(bundle.sbom_path)?.digest ?? bundle.sbom_digest;
  }

  const windowsTarget = desktopTargets.find((target) => target.target === "desktop_windows_x64");
  if (!windowsTarget) return;
  windowsTarget.resources.startup_timeout_ms = 10_000;
  windowsTarget.resources.health_timeout_ms = 2_000;
  windowsTarget.resources.stop_timeout_ms = 2_000;
  windowsTarget.resources.cpu_percent = 25;
  windowsTarget.resources.memory_mb = 128;
  windowsTarget.resources.disk_mb = 64;
  windowsTarget.resources.cache_mb = 16;
  windowsTarget.resources.log_bytes = 65_536;
  windowsTarget.resources.max_output_event_bytes = 4_096;
}

async function pruneWindowsExcludedPaths(root) {
  await Promise.all([
    "payload/sidecars/search-runtime/macos-universal",
    "payload/dependencies/searxng/macos-universal",
    "provenance/searxng-macos.intoto.jsonl",
    "sbom/searxng-macos.cyclonedx.json",
  ].map((packagePath) => rm(path.join(root, ...packagePath.split("/")), { recursive: true, force: true })));
}

function isWindowsExcludedPackagePath(packagePath) {
  return packagePath.startsWith("payload/sidecars/search-runtime/macos-universal/")
    || packagePath.startsWith("payload/dependencies/searxng/macos-universal/")
    || packagePath === "provenance/searxng-macos.intoto.jsonl"
    || packagePath === "sbom/searxng-macos.cyclonedx.json";
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
