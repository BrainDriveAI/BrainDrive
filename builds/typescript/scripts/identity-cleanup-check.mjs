import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptRoot, "..");
const repoRoot = path.resolve(projectRoot, "..", "..");
const legacyPattern = /BrainDrive\+1|BD\+1|braindrive-plus-one|templates\/braindrive-plus-one/g;

const sourceAllowlist = [
  /^CHANGELOG\.md$/,
  /^builds\/typescript\/scripts\/identity-cleanup-check\.mjs$/,
  /^builds\/typescript\/memory\/root-agent\.ts$/,
  /^builds\/typescript\/client_web\/src\/lib\/rootAgent\.ts$/,
  /^builds\/typescript\/memory\/init\.ts$/,
  /^builds\/mcp_release\/src\/memory-core\.ts$/,
  /\.test\.ts$/,
  /^builds\/mcp_release\/test\//,
];

const generatedRuntimeRoot = path.join(
  repoRoot,
  "builds",
  "typescript",
  "src-tauri",
  "desktop-runtime",
  "typescript",
  "memory",
  "starter-pack",
);

function isAllowedSourceMatch(relativePath) {
  return sourceAllowlist.some((pattern) => pattern.test(relativePath));
}

async function trackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: repoRoot });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function sourceMatches() {
  const matches = [];
  for (const relativePath of await trackedFiles()) {
    const absolutePath = path.join(repoRoot, relativePath);
    const content = await readFile(absolutePath, "utf8").catch(() => null);
    if (content === null) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      legacyPattern.lastIndex = 0;
      if (legacyPattern.test(line) && !isAllowedSourceMatch(relativePath)) {
        matches.push(`${relativePath}:${index + 1}:${line.trim()}`);
      }
    });
  }
  return matches;
}

async function generatedRuntimeMatches() {
  if (!existsSync(generatedRuntimeRoot)) {
    return [];
  }

  const matches = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const content = await readFile(absolutePath, "utf8").catch(() => null);
      if (content === null) {
        continue;
      }
      const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, "/");
      content.split(/\r?\n/).forEach((line, index) => {
        legacyPattern.lastIndex = 0;
        if (legacyPattern.test(line)) {
          matches.push(`${relativePath}:${index + 1}:${line.trim()}`);
        }
      });
    }
  }

  await visit(generatedRuntimeRoot);
  return matches;
}

async function main() {
  const includeGeneratedRuntime = process.argv.includes("--include-generated-runtime");
  const matches = [
    ...(await sourceMatches()),
    ...(includeGeneratedRuntime ? await generatedRuntimeMatches() : []),
  ];

  if (matches.length > 0) {
    console.error("Unapproved legacy Your Agent identity references found:");
    for (const match of matches) {
      console.error(`- ${match}`);
    }
    process.exit(1);
  }

  const runtimeNote = includeGeneratedRuntime
    ? " and generated desktop runtime"
    : "";
  console.log(`Your Agent identity check passed for tracked source${runtimeNote}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
