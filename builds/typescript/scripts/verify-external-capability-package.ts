import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parsePackageComponentManifestForConformance } from "../app-platform/contracts/package-components.js";
import { ImmutablePackageStore } from "../app-platform/lifecycle/verified-package-store.js";
import { createVerifiedSidecarPackageBundleFromStore, SidecarBundleStore } from "../app-platform/lifecycle/sidecar-bundle-store.js";
import {
  INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
  INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
  createInternetSearchProviderRuntime,
  digestInternetSearchProviderManifest,
  loadInternetSearchProviderManifest,
} from "../internet-search/provider-package.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) throw new Error("usage: verify-external-capability-package --package-root <path> --target <target>");
  args.set(key.slice(2), value);
}

const packageRoot = args.get("package-root");
const target = args.get("target") ?? "desktop_windows_x64";
if (!packageRoot) throw new Error("missing --package-root");
if (target !== "docker_linux_x64" && target !== "desktop_windows_x64" && target !== "desktop_macos_universal") {
  throw new Error("target must be docker_linux_x64, desktop_windows_x64, or desktop_macos_universal");
}

type RuntimeTargetName = "docker_linux_x64" | "desktop_windows_x64" | "desktop_macos_universal";

function digest(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function verifyFiles(root: string, manifest: ReturnType<typeof parsePackageComponentManifestForConformance>) {
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(root, ...file.path.split("/")));
    if (bytes.byteLength !== file.size_bytes || digest(bytes) !== file.digest) {
      throw new Error(`package file digest mismatch: ${file.path}`);
    }
  }
}

async function verifyDesktopSidecar(root: string, target: Extract<RuntimeTargetName, "desktop_windows_x64" | "desktop_macos_universal">) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bd-external-capability-"));
  try {
    const manifest = parsePackageComponentManifestForConformance(await loadInternetSearchProviderManifest(root, {
      BRAINDRIVE_INTERNET_SEARCH_PACKAGE_ROOT: root,
    }));
    await verifyFiles(root, manifest);
    const packageDigest = digestInternetSearchProviderManifest(manifest);
    const promotionRoot = path.join(tempRoot, "promotion-root");
    await mkdir(promotionRoot, { recursive: true });
    await cp(root, promotionRoot, { recursive: true, force: true });
    const packageStore = new ImmutablePackageStore(path.join(tempRoot, "verified-package-store"));
    await packageStore.promote({
      manifest,
      packageDigest,
      descriptorDigest: digest(`external-capability:${target}:${packageDigest}`),
      stageRoot: promotionRoot,
      entrypoint: path.join(promotionRoot, "manifest.json"),
      target,
    });
    const verifiedPackage = await createVerifiedSidecarPackageBundleFromStore({ packageStore, packageDigest, manifest });
    const bundleStore = new SidecarBundleStore(path.join(tempRoot, "bundle-store"));
    await bundleStore.stage({ verifiedPackage, sidecarComponentId: INTERNET_SEARCH_SIDECAR_COMPONENT_ID, target });
  } finally {
    await makeWritable(tempRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifyRuntime(root: string, target: RuntimeTargetName) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bd-external-provider-runtime-"));
  try {
    const descriptorPath = path.join(tempRoot, "runtime-descriptors.json");
    await writeFile(descriptorPath, JSON.stringify({
      descriptor_version: 1,
      target: "docker_linux_x64",
      sidecars: [{
        package_id: INTERNET_SEARCH_PROVIDER_PACKAGE_ID,
        component_id: INTERNET_SEARCH_SIDECAR_COMPONENT_ID,
        target: "docker_linux_x64",
        runtime_kind: "container",
        transport: "container_internal",
        endpoint: "http://bdsc-0000000000000001:8080",
        health_path: "/healthz",
      }],
    }), "utf8");
    const runtime = await createInternetSearchProviderRuntime({
      rootDir: root,
      memoryRoot: path.join(tempRoot, "memory"),
      stateRoot: path.join(tempRoot, "state"),
      target,
      env: target === "docker_linux_x64"
        ? {
            BRAINDRIVE_INTERNET_SEARCH_PACKAGE_ROOT: root,
            BRAINDRIVE_SIDECAR_RUNTIME_DESCRIPTOR_FILE: descriptorPath,
            BRAINDRIVE_SIDECAR_STARTUP_TIMEOUT_MS: "25",
            BRAINDRIVE_SIDECAR_READINESS_POLL_MS: "1",
          }
        : {
            BRAINDRIVE_INTERNET_SEARCH_PACKAGE_ROOT: root,
            BRAINDRIVE_SIDECAR_STARTUP_TIMEOUT_MS: "25",
            BRAINDRIVE_SIDECAR_READINESS_POLL_MS: "1",
          },
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/healthz") return new Response("ok", { status: 200 });
        return new Response(JSON.stringify({ results: [{ title: "External package result", url: "https://example.test", content: "ok" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      readExecutor: null,
    });
    try {
      const search = await runtime.providerRegistry.discover("web.search@1", { authorized: true });
      const read = await runtime.providerRegistry.discover("web.read@1", { authorized: true });
      if (target === "docker_linux_x64" && !search.callable) throw new Error("docker search operation should be callable with descriptor sidecar");
      if (!read.callable) throw new Error("web.read@1 should be callable from the extracted provider package");
    } finally {
      await runtime.close();
    }
  } finally {
    await makeWritable(tempRoot);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) await makeWritable(child);
    else await chmod(child, 0o600).catch(() => undefined);
  }));
}

const root = path.resolve(packageRoot);
const manifest = parsePackageComponentManifestForConformance(await loadInternetSearchProviderManifest(root, {
  BRAINDRIVE_INTERNET_SEARCH_PACKAGE_ROOT: root,
}));
if (manifest.package_id !== INTERNET_SEARCH_PROVIDER_PACKAGE_ID) throw new Error("unexpected package id");
if (!manifest.package_kind.includes("capability_provider")) throw new Error("manifest must declare capability_provider");
if (manifest.provided_operations.map((operation) => operation.operation_id).sort().join(",") !== "web.read@1,web.search@1") {
  throw new Error("operation set mismatch");
}
await verifyFiles(root, manifest);
if (target === "desktop_windows_x64" || target === "desktop_macos_universal") {
  await verifyDesktopSidecar(root, target);
}
if (target === "docker_linux_x64") {
  await verifyRuntime(root, target);
}
console.log(`PASS ${target} ${manifest.package_id}@${manifest.package_version} ${digestInternetSearchProviderManifest(manifest)}`);
