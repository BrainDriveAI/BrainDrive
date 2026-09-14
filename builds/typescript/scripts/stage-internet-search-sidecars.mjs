import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";

const execFileAsync = promisify(execFile);

async function main() {
  const sourceRoot = path.resolve(requireArgument("--source"));
  const destinationRoot = path.resolve(requireArgument("--destination"));
  const target = targetForHost();
  if (!target) return;

  const crateRoot = path.join(sourceRoot, "sidecar-runtime");
  const manifestPath = path.join(destinationRoot, "manifest.json");
  const stagedExecutable = path.join(destinationRoot, ...target.sidecarPath.split("/"));
  if (!existsSync(path.join(crateRoot, "Cargo.toml"))) {
    if (existsSync(stagedExecutable)) return;
    throw new Error(`Internet Search sidecar crate was not found at ${crateRoot}`);
  }

  const build = await buildSidecarExecutable(crateRoot, target);
  await copyFileIntoPackage(build.executablePath, stagedExecutable);
  if (target.platform === "desktop_macos_universal") await chmod(stagedExecutable, 0o755);

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
  await writeJsonPackageFile(destinationRoot, target.lockfilePath, lockfileMetadata(target, build));
  await writeJsonPackageFile(destinationRoot, target.provenancePath, provenanceMetadata(target, build));
  await writeJsonPackageFile(destinationRoot, target.sbomPath, {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    components: [{ name: "braindrive-internet-search-sidecar", version: "0.1.0", type: "application" }],
  });
  await writeTextPackageFile(destinationRoot, "provenance/intoto.jsonl", `${JSON.stringify({ builder: target.builder })}\n`);
  await writeJsonPackageFile(destinationRoot, "sbom/cyclonedx.json", {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    components: [{ name: "ai.braindrive.internet-search.searxng", version: "1.0.0", type: "application" }],
  });

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await rewriteManifestInventory(destinationRoot, manifest, target);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Staged unsigned ${target.label} Internet Search sidecar at ${stagedExecutable}`);
}

function targetForHost() {
  if (process.platform === "win32") {
    return {
      platform: "desktop_windows_x64",
      label: "Windows",
      executableName: "braindrive-internet-search-sidecar.exe",
      sidecarPath: "payload/sidecars/search-runtime/windows-x64/searxng-runtime.exe",
      lockfilePath: "payload/dependencies/searxng/windows-x64/lock.json",
      provenancePath: "provenance/searxng-windows.intoto.jsonl",
      sbomPath: "sbom/searxng-windows.cyclonedx.json",
      builder: "local-ws5-unsigned-cargo",
      oppositePlatform: "desktop_macos_universal",
    };
  }
  if (process.platform === "darwin") {
    return {
      platform: "desktop_macos_universal",
      label: "macOS",
      executableName: "braindrive-internet-search-sidecar",
      sidecarPath: "payload/sidecars/search-runtime/macos-universal/searxng-runtime",
      lockfilePath: "payload/dependencies/searxng/macos-universal/lock.json",
      provenancePath: "provenance/searxng-macos.intoto.jsonl",
      sbomPath: "sbom/searxng-macos.cyclonedx.json",
      builder: "local-macos-unsigned-cargo",
      oppositePlatform: "desktop_windows_x64",
    };
  }
  return null;
}

async function buildSidecarExecutable(crateRoot, target) {
  if (target.platform === "desktop_macos_universal") {
    return buildMacosSidecarExecutable(crateRoot, target);
  }
  await execFileAsync("cargo", ["build", "--release", "--manifest-path", path.join(crateRoot, "Cargo.toml")], {
    cwd: crateRoot,
    shell: true,
  });
  return {
    executablePath: path.join(crateRoot, "target", "release", target.executableName),
    buildKind: "host-release",
    rustTargets: [],
  };
}

async function buildMacosSidecarExecutable(crateRoot, target) {
  const installedTargets = await rustTargetsInstalled();
  const universalTargets = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  const canBuildUniversal = universalTargets.every((candidate) => installedTargets.includes(candidate));
  if (canBuildUniversal) {
    const builtExecutables = [];
    for (const rustTarget of universalTargets) {
      await execFileAsync("cargo", ["build", "--release", "--target", rustTarget, "--manifest-path", path.join(crateRoot, "Cargo.toml")], {
        cwd: crateRoot,
      });
      builtExecutables.push(path.join(crateRoot, "target", rustTarget, "release", target.executableName));
    }
    const universalExecutable = path.join(crateRoot, "target", "release", "braindrive-internet-search-sidecar-universal");
    await mkdir(path.dirname(universalExecutable), { recursive: true });
    await execFileAsync("lipo", ["-create", "-output", universalExecutable, ...builtExecutables], {
      cwd: crateRoot,
    });
    await chmod(universalExecutable, 0o755);
    return {
      executablePath: universalExecutable,
      buildKind: "macos-universal",
      rustTargets: universalTargets,
    };
  }

  await execFileAsync("cargo", ["build", "--release", "--manifest-path", path.join(crateRoot, "Cargo.toml")], {
    cwd: crateRoot,
  });
  return {
    executablePath: path.join(crateRoot, "target", "release", target.executableName),
    buildKind: `macos-${process.arch}-host-release`,
    rustTargets: [],
  };
}

async function rustTargetsInstalled() {
  try {
    const { stdout } = await execFileAsync("rustup", ["target", "list", "--installed"]);
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function lockfileMetadata(target, build) {
  const base = {
    lockfile_version: 1,
    runtime: "braindrive-internet-search-sidecar",
    package: "ai.braindrive.internet-search.searxng",
    target: target.platform,
  };
  if (target.platform === "desktop_windows_x64") return base;
  return {
    ...base,
    artifact: target.sidecarPath,
    build: build.buildKind,
  };
}

function provenanceMetadata(target, build) {
  const base = {
    builder: target.builder,
    target: target.platform,
    source: "builds/internet_search/sidecar-runtime",
  };
  if (target.platform === "desktop_windows_x64") return base;
  return {
    ...base,
    build_kind: build.buildKind,
    rust_targets: build.rustTargets,
    signing: "unsigned-local-build; release requires codesign and notarization",
  };
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

async function rewriteManifestInventory(root, manifest, targetConfig) {
  for (const sidecar of manifest.sidecars ?? []) {
    sidecar.targets = sidecar.targets.filter((target) => {
      if (target.runtime_kind !== "packaged_process") return true;
      if (target.target !== targetConfig.platform) return false;
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
  await pruneOppositeTargetPaths(root, targetConfig);
  if (!(manifest.sidecars ?? []).some((sidecar) => sidecar.targets.some((target) => target.target === targetConfig.platform && target.runtime_kind === "packaged_process"))) {
    throw new Error(`Staged Internet Search package is missing the ${targetConfig.platform} sidecar target`);
  }

  manifest.files = manifest.files.filter((file) => !isExcludedPackagePath(file.path, targetConfig) && existsSync(path.join(root, ...file.path.split("/"))));
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

  const activeTarget = desktopTargets.find((target) => target.target === targetConfig.platform);
  if (!activeTarget) return;
  activeTarget.resources.startup_timeout_ms = 10_000;
  activeTarget.resources.health_timeout_ms = 2_000;
  activeTarget.resources.stop_timeout_ms = 2_000;
  activeTarget.resources.cpu_percent = 25;
  activeTarget.resources.memory_mb = 128;
  activeTarget.resources.disk_mb = 64;
  activeTarget.resources.cache_mb = 16;
  activeTarget.resources.log_bytes = 65_536;
  activeTarget.resources.max_output_event_bytes = 4_096;
}

async function pruneOppositeTargetPaths(root, targetConfig) {
  const excludedPaths = targetConfig.oppositePlatform === "desktop_macos_universal" ? [
    "payload/sidecars/search-runtime/macos-universal",
    "payload/dependencies/searxng/macos-universal",
    "provenance/searxng-macos.intoto.jsonl",
    "sbom/searxng-macos.cyclonedx.json",
  ] : [
    "payload/sidecars/search-runtime/windows-x64",
    "payload/dependencies/searxng/windows-x64",
    "provenance/searxng-windows.intoto.jsonl",
    "sbom/searxng-windows.cyclonedx.json",
  ];
  await Promise.all(excludedPaths.map((packagePath) => rm(path.join(root, ...packagePath.split("/")), { recursive: true, force: true })));
}

function isExcludedPackagePath(packagePath, targetConfig) {
  if (targetConfig.oppositePlatform === "desktop_macos_universal") {
    return packagePath.startsWith("payload/sidecars/search-runtime/macos-universal/")
      || packagePath.startsWith("payload/dependencies/searxng/macos-universal/")
      || packagePath === "provenance/searxng-macos.intoto.jsonl"
      || packagePath === "sbom/searxng-macos.cyclonedx.json";
  }
  return packagePath.startsWith("payload/sidecars/search-runtime/windows-x64/")
    || packagePath.startsWith("payload/dependencies/searxng/windows-x64/")
    || packagePath === "provenance/searxng-windows.intoto.jsonl"
    || packagePath === "sbom/searxng-windows.cyclonedx.json";
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
