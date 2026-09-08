import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  process.stderr.write("Usage: node scripts/build-artifact-digests.mjs <artifact-path> [...]\n");
  process.exit(2);
}

const cwd = process.cwd();
const artifacts = [];

for (const root of roots) {
  const absolute = path.resolve(cwd, root);
  const info = await stat(absolute).catch(() => null);
  if (!info) {
    artifacts.push({ path: normalize(root), state: "missing" });
    continue;
  }
  if (info.isDirectory()) {
    for (const filePath of await walk(absolute)) {
      artifacts.push(await digestFile(filePath));
    }
  } else if (info.isFile()) {
    artifacts.push(await digestFile(absolute));
  }
}

const presentArtifacts = artifacts.filter((artifact) => artifact.state !== "missing");
if (presentArtifacts.length === 0) {
  process.stderr.write("No artifact files were found under the requested paths.\n");
  process.exit(1);
}

artifacts.sort((a, b) => a.path.localeCompare(b.path));
const aggregateInput = artifacts.map((artifact) => JSON.stringify(artifact)).join("\n");

console.log(JSON.stringify({
  digest_manifest_version: 1,
  root: normalize(cwd),
  generated_at: new Date().toISOString(),
  aggregate_digest: `sha256:${createHash("sha256").update(aggregateInput).digest("hex")}`,
  artifact_count: presentArtifacts.length,
  missing_paths: artifacts.filter((artifact) => artifact.state === "missing").map((artifact) => artifact.path),
  artifacts,
}, null, 2));

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function digestFile(filePath) {
  const bytes = await readFile(filePath);
  return {
    path: normalize(path.relative(cwd, filePath)),
    state: "present",
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function normalize(value) {
  return value.split(path.sep).join("/");
}
