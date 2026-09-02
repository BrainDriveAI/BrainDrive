#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const mode = args.mode ?? "dev";
const out = args.out;
const descriptors = args.descriptors;
if (!out || !descriptors) {
  console.error("Usage: render-package-sidecars.mjs --mode <dev|local> --out <compose.yml> --descriptors <runtime-descriptors.json>");
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dockerRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(dockerRoot, "..", "..");
const target = "docker_linux_x64";
const manifestPaths = await resolveManifestPaths(args.manifest);
const plans = [];

for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const sidecar of manifest.sidecars ?? []) {
    const selectedTarget = (sidecar.targets ?? []).find((candidate) => candidate.target === target && candidate.runtime_kind === "container");
    if (!selectedTarget) continue;
    assertContainerSidecar(manifest, sidecar, selectedTarget, manifestPath);
    const serviceName = serviceNameFor(manifest.package_id, sidecar.component_id);
    const containerPort = selectedTarget.container_port ?? 8080;
    plans.push({
      package_id: manifest.package_id,
      package_version: manifest.package_version,
      component_id: sidecar.component_id,
      owner_component_id: sidecar.owner_component_id,
      target,
      runtime_kind: selectedTarget.runtime_kind,
      transport: sidecar.binding.transport,
      service_name: serviceName,
      image: selectedTarget.image,
      endpoint: `http://${serviceName}:${containerPort}`,
      health_path: sidecar.health?.path ?? "/healthz",
      cleanup: "compose_project_service",
    });
  }
}

await mkdir(path.dirname(out), { recursive: true });
await mkdir(path.dirname(descriptors), { recursive: true });
await writeFile(descriptors, `${JSON.stringify({
  descriptor_version: 1,
  generated_by: "braindrive-package-sidecar-renderer",
  mode,
  target,
  sidecars: plans.map(({ image: _image, ...runtime }) => runtime),
}, null, 2)}\n`, "utf8");
await writeFile(out, renderComposeOverride(plans, descriptors), "utf8");
console.log(`Rendered ${plans.length} package-declared Docker sidecar(s) for ${mode}.`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    parsed[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

async function resolveManifestPaths(explicit) {
  const raw = explicit ?? process.env.BRAINDRIVE_DOCKER_SIDECAR_MANIFESTS ?? "";
  const listed = raw.split(process.platform === "win32" ? ";" : ":").flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  if (listed.length > 0) return listed.map((item) => path.resolve(dockerRoot, item));
  const repositoryManifest = path.join(repoRoot, "builds", "internet_search", "manifest.json");
  if (existsSync(repositoryManifest)) return [repositoryManifest];
  const installerManifest = path.join(dockerRoot, "package-manifests", "internet-search", "manifest.json");
  return existsSync(installerManifest) ? [installerManifest] : [];
}

function assertContainerSidecar(manifest, sidecar, targetValue, manifestPath) {
  if (!manifest.package_id || !manifest.package_version) throw new Error(`Manifest identity is incomplete: ${manifestPath}`);
  if (sidecar.binding?.visibility !== "provider_adapter_only" && sidecar.binding?.visibility !== "owning_app_private") {
    throw new Error(`Unsupported sidecar binding visibility in ${manifestPath}`);
  }
  if (sidecar.binding?.transport !== "container_internal" || sidecar.binding?.public_bind !== false || sidecar.binding?.consumer_projection !== "never") {
    throw new Error(`Unsafe Docker sidecar binding in ${manifestPath}`);
  }
  if (targetValue.network !== "private" || targetValue.public_network !== false) {
    throw new Error(`Unsafe Docker sidecar network in ${manifestPath}`);
  }
}

function serviceNameFor(packageId, componentId) {
  const digest = createHash("sha256").update(`${packageId}:${componentId}`).digest("hex").slice(0, 16);
  return `bdsc-${digest}`;
}

function renderComposeOverride(plans, descriptorPath) {
  const relativeDescriptor = path.relative(dockerRoot, descriptorPath).split(path.sep).join("/");
  const lines = [
    "services:",
    "  app:",
    "    environment:",
    "      BRAINDRIVE_SIDECAR_RUNTIME_DESCRIPTOR_FILE: /run/braindrive-sidecars/runtime-descriptors.json",
    "    volumes:",
    `      - ./${relativeDescriptor}:/run/braindrive-sidecars/runtime-descriptors.json:ro`,
  ];
  if (plans.length > 0) {
    lines.push("    depends_on:");
    for (const plan of plans) {
      lines.push(`      ${plan.service_name}:`);
      lines.push("        condition: service_started");
    }
  }
  for (const plan of plans) {
    lines.push("");
    lines.push(`  ${plan.service_name}:`);
    lines.push(`    image: ${plan.image}`);
    lines.push("    restart: unless-stopped");
    lines.push("    expose:");
    lines.push(`      - "${new URL(plan.endpoint).port}"`);
    lines.push("    security_opt:");
    lines.push("      - no-new-privileges:true");
  }
  return `${lines.join("\n")}\n`;
}
