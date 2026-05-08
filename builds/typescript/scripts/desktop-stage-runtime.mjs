import { cp, mkdir, rm, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";
import process from "node:process";

const execFileAsync = promisify(execFile);
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptRoot, "..");
const mcpRoot = path.resolve(projectRoot, "..", "mcp_release");
const outputRoot = path.join(projectRoot, "src-tauri", "desktop-runtime");

async function assertPathExists(targetPath, label) {
  try {
    await access(targetPath, constants.F_OK);
  } catch {
    throw new Error(`${label} was not found at ${targetPath}`);
  }
}

async function copyDirectory(source, destination) {
  await assertPathExists(source, "Required runtime directory");
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

async function copyFile(source, destination) {
  await assertPathExists(source, "Required runtime file");
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

async function pruneDevDependencies(runtimeRoot) {
  await execFileAsync("npm", ["prune", "--omit=dev"], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
  });
}

async function main() {
  const nodePath = process.env.BRAINDRIVE_DESKTOP_NODE_SOURCE || process.execPath;
  const nodeExeName = process.platform === "win32" ? "node.exe" : "node";

  await assertPathExists(
    path.join(projectRoot, "dist", "gateway", "server.js"),
    "BrainDrive gateway build",
  );
  await assertPathExists(
    path.join(projectRoot, "adapters", "openai-compatible.json"),
    "BrainDrive adapter configuration",
  );
  await assertPathExists(
    path.join(projectRoot, "memory", "starter-pack"),
    "BrainDrive starter memory",
  );
  await assertPathExists(
    path.join(projectRoot, "node_modules"),
    "BrainDrive gateway dependencies",
  );
  await assertPathExists(
    path.join(mcpRoot, "dist", "src", "index.js"),
    "BrainDrive MCP build",
  );
  await assertPathExists(
    path.join(mcpRoot, "node_modules"),
    "BrainDrive MCP dependencies",
  );

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  await copyFile(nodePath, path.join(outputRoot, "node", nodeExeName));

  await copyDirectory(path.join(projectRoot, "dist"), path.join(outputRoot, "typescript", "dist"));
  await copyDirectory(path.join(projectRoot, "adapters"), path.join(outputRoot, "typescript", "adapters"));
  await copyDirectory(
    path.join(projectRoot, "memory", "starter-pack"),
    path.join(outputRoot, "typescript", "memory", "starter-pack"),
  );
  await copyDirectory(
    path.join(projectRoot, "node_modules"),
    path.join(outputRoot, "typescript", "node_modules"),
  );
  await copyFile(path.join(projectRoot, "package.json"), path.join(outputRoot, "typescript", "package.json"));
  await copyFile(
    path.join(projectRoot, "package-lock.json"),
    path.join(outputRoot, "typescript", "package-lock.json"),
  );
  await copyFile(path.join(projectRoot, "config.json"), path.join(outputRoot, "typescript", "config.json"));

  await copyDirectory(path.join(mcpRoot, "dist"), path.join(outputRoot, "mcp_release", "dist"));
  await copyDirectory(
    path.join(mcpRoot, "node_modules"),
    path.join(outputRoot, "mcp_release", "node_modules"),
  );
  await copyFile(path.join(mcpRoot, "package.json"), path.join(outputRoot, "mcp_release", "package.json"));
  await copyFile(path.join(mcpRoot, "package-lock.json"), path.join(outputRoot, "mcp_release", "package-lock.json"));

  await pruneDevDependencies(path.join(outputRoot, "typescript"));
  await pruneDevDependencies(path.join(outputRoot, "mcp_release"));

  console.log(`Staged BrainDrive desktop runtime at ${outputRoot}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
