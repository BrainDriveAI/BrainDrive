import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptRoot, "..");
const bundleRoot = path.join(projectRoot, "src-tauri", "target", "release", "bundle");
const latestRoot = path.join(bundleRoot, "latest");
const packageManifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const expectedVersion = packageManifest.version;

const aliasTargets = [
  {
    platform: "windows",
    label: "Windows x64 NSIS installer",
    sourceDir: path.join(bundleRoot, "nsis"),
    extension: ".exe",
    aliasName: "BrainDrive-latest-windows-x64-setup.exe",
  },
  {
    platform: "mac",
    label: "macOS DMG installer",
    sourceDir: path.join(bundleRoot, "dmg"),
    extension: ".dmg",
    aliasName: "BrainDrive-latest-macos.dmg",
  },
];

function buildGatePath(platform) {
  return path.join(bundleRoot, `.braindrive-${platform}-build-gate.json`);
}

async function directoryExists(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function newestArtifact({ sourceDir, extension }) {
  if (!(await directoryExists(sourceDir))) {
    return null;
  }

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(extension)) {
      continue;
    }

    const artifactPath = path.join(sourceDir, entry.name);
    const artifactStat = await stat(artifactPath);
    candidates.push({ path: artifactPath, name: entry.name, mtimeMs: artifactStat.mtimeMs });
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
  return candidates[0] ?? null;
}

async function writeSha256File(filePath, aliasName) {
  const hash = createHash("sha256").update(await readFile(filePath)).digest("hex");
  await writeFile(`${filePath}.sha256`, `${hash}  ${aliasName}\n`, "utf8");
  return hash;
}

async function prepare(platform) {
  if (!aliasTargets.some((target) => target.platform === platform)) {
    throw new Error(`Unsupported desktop build gate platform: ${platform}`);
  }
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(buildGatePath(platform), `${JSON.stringify({ version: expectedVersion, startedAtMs: Date.now() })}\n`, "utf8");
  console.log(`Prepared ${platform} desktop artifact gate for ${expectedVersion}`);
}

async function main(requiredPlatform = null) {
  await mkdir(latestRoot, { recursive: true });

  let gate = null;
  if (requiredPlatform) {
    gate = JSON.parse(await readFile(buildGatePath(requiredPlatform), "utf8"));
    if (gate.version !== expectedVersion || !Number.isFinite(gate.startedAtMs)) {
      throw new Error(`Desktop ${requiredPlatform} build gate is invalid for ${expectedVersion}`);
    }
  }

  let created = 0;
  for (const target of aliasTargets.filter((candidate) => !requiredPlatform || candidate.platform === requiredPlatform)) {
    const artifact = await newestArtifact(target);
    if (!artifact) {
      if (requiredPlatform) throw new Error(`No ${target.label} was produced by this build`);
      console.log(`No ${target.label} found in ${target.sourceDir}; skipping ${target.aliasName}.`);
      continue;
    }
    if (!artifact.name.includes(expectedVersion)) {
      if (requiredPlatform) throw new Error(`${target.label} is stale: expected version ${expectedVersion}, found ${artifact.name}`);
      console.log(`No current-version ${target.label} found in ${target.sourceDir}; skipping ${target.aliasName}.`);
      continue;
    }
    if (gate && artifact.mtimeMs <= gate.startedAtMs) {
      throw new Error(`${target.label} was not produced by this build invocation`);
    }

    const aliasPath = path.join(latestRoot, target.aliasName);
    await copyFile(artifact.path, aliasPath);
    const hash = await writeSha256File(aliasPath, target.aliasName);
    created += 1;
    console.log(`Created ${target.aliasName} from ${artifact.name}`);
    console.log(`SHA256 ${hash}`);
  }

  if (created === 0) {
    throw new Error(`No desktop installer artifacts were found under ${bundleRoot}`);
  }

  console.log(`Stable installer aliases are in ${latestRoot}`);
}

const [mode, platform] = process.argv.slice(2);
const operation = mode === "--prepare" ? prepare(platform) : main(mode === "--require" ? platform : null);
operation.catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
