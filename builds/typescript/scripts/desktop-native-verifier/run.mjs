import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EmbeddedWebDriver } from "./webdriver.mjs";
import { verifyScreenAndInput } from "./verify-screen-input.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptRoot, "../..");

if (process.platform !== "win32" && process.platform !== "darwin") {
  throw new Error(`Native desktop verification supports Windows/macOS, not ${process.platform}.`);
}

const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const artifactsBase = path.resolve(
  process.env.BRAINDRIVE_DESKTOP_VERIFIER_ARTIFACTS ??
    path.join(os.tmpdir(), "braindrive-desktop-verifier"),
);
const artifactsRoot = path.join(artifactsBase, process.platform, runId);
const profileRoot = path.join(artifactsRoot, "profile");
const localProfileRoot = path.join(artifactsRoot, "local-profile");
await mkdir(profileRoot, { recursive: true });
await mkdir(localProfileRoot, { recursive: true });

const webdriverPort = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("Unable to allocate a local WebDriver port."));
      return;
    }
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const git = (args) => execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
const candidate = {
  runId,
  platform: process.platform,
  architecture: process.arch,
  branch: git(["branch", "--show-current"]),
  head: git(["rev-parse", "HEAD"]),
  workingTree: git(["status", "--short", "--branch"]),
  artifactsRoot,
  isolatedAppDataBase: profileRoot,
  isolatedLogDataBase: localProfileRoot,
  webdriverPort,
};
await writeFile(path.join(artifactsRoot, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);

const env = {
  ...process.env,
  APPDATA: profileRoot,
  LOCALAPPDATA: localProfileRoot,
  BRAINDRIVE_DESKTOP_TYPESCRIPT_ROOT: projectRoot,
  BRAINDRIVE_DESKTOP_MCP_ROOT: path.resolve(projectRoot, "../mcp_release"),
  BRAINDRIVE_DESKTOP_WEB_ROOT: path.join(projectRoot, "client_web", "dist"),
  BRAINDRIVE_DESKTOP_VERIFIER_ARTIFACTS: artifactsRoot,
  TAURI_WEBDRIVER_PORT: String(webdriverPort),
  WDIO_EMBEDDED_SERVER: "true",
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code}).`));
      }
    });
  });
}

const runResult = { status: "running", startedAt: new Date().toISOString(), candidate: candidate.head };
let app;
let driver;
let stdoutLog;
let stderrLog;
let appExit;

try {
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "desktop:preflight"]);
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "desktop:build:frontend"]);
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "desktop:prepare-dev"]);
  await run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--features", "desktop-verifier"]);

  const binaryName = process.platform === "win32" ? "braindrive-desktop.exe" : "braindrive-desktop";
  const binaryPath = path.join(projectRoot, "src-tauri", "target", "debug", binaryName);
  stdoutLog = createWriteStream(path.join(artifactsRoot, "desktop.stdout.log"));
  stderrLog = createWriteStream(path.join(artifactsRoot, "desktop.stderr.log"));
  app = spawn(binaryPath, [], { cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout.pipe(stdoutLog);
  app.stderr.pipe(stderrLog);
  appExit = new Promise((resolve) => app.once("exit", (code, signal) => resolve({ code, signal })));
  const appSpawnError = new Promise((_, reject) => app.once("error", reject));

  driver = new EmbeddedWebDriver(webdriverPort);
  await Promise.race([driver.waitUntilReady(), appSpawnError, appExit.then(({ code, signal }) => {
    throw new Error(`Desktop app exited before WebDriver startup (code=${code}, signal=${signal}).`);
  })]);
  runResult.capabilities = await driver.createSession("main");
  await verifyScreenAndInput(driver, artifactsRoot, candidate);
  runResult.status = "passed";
  console.log(`Desktop verifier artifacts: ${artifactsRoot}`);
} catch (error) {
  runResult.status = "failed";
  runResult.error = error instanceof Error ? error.message : String(error);
  console.error(`Desktop verifier failed. Candidate and run records: ${artifactsRoot}`);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (driver?.sessionId) {
    try {
      await driver.closeWindow();
    } catch {
      // The app may already have exited after a failed driver/test command.
    }
    try {
      await driver.deleteSession();
    } catch {
      // Preserve the test result; process cleanup below is the final safeguard.
    }
  }
  if (app && app.exitCode === null && app.signalCode === null) {
    const exited = await Promise.race([
      appExit.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 8_000)),
    ]);
    if (!exited) {
      app.kill();
      await Promise.race([appExit, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
  }
  stdoutLog?.end();
  stderrLog?.end();
  runResult.finishedAt = new Date().toISOString();
  await writeFile(path.join(artifactsRoot, "run-result.json"), `${JSON.stringify(runResult, null, 2)}\n`);
}
