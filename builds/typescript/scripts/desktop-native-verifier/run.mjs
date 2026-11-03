import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EmbeddedWebDriver } from "./webdriver.mjs";
import { verifyScreenAndInput } from "./verify-screen-input.mjs";
import { STATUS } from "./verification-contract.mjs";

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
const catalogCacheRoot = path.join(artifactsRoot, "catalog-cache");
const catalogTracePath = path.join(artifactsRoot, "catalog-network-trace.jsonl");
const configuredCatalogPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CATALOG_PATH?.trim();
const configuredBundledCatalogPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_BUNDLED_CATALOG_PATH?.trim();
const configuredCatalogUrl = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CATALOG_URL?.trim()
  || "https://raw.githubusercontent.com/BrainDriveAI/BrainDrive-Marketplace/main/catalog/stage1/catalog.json";
const configuredBrainDriveUpdateVersion = process.env.BRAINDRIVE_DESKTOP_VERIFIER_BRAINDRIVE_UPDATE_VERSION?.trim() || null;
const configuredRecoveryFixtureRoot = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT?.trim() || null;
const configuredRecoveryObservationPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_OBSERVATION_PATH?.trim() || null;
const configuredKatieObservationPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_KATIE_OBSERVATION_PATH?.trim() || null;
const configuredKatiePublicKeyPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_KATIE_PUBLIC_KEY_PATH?.trim() || null;
const configuredFaultObservationPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_OBSERVATION_PATH?.trim() || null;
const configuredFaultFixtureRoot = process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_FIXTURE_ROOT?.trim() || null;
const configuredFaultAction = process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_ACTION?.trim() || null;
const configuredFaultPoint = process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_POINT?.trim() || null;
const configuredAuthorityPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_TB5_AUTHORITY_PATH?.trim() || null;
const configuredCfCatalogPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CF_CATALOG_PATH?.trim() || null;
const configuredCfBrowseObservationPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_CF_BROWSE_OBSERVATION_PATH?.trim() || null;
const catalogSource = configuredCatalogPath
  ? { kind: "local_file", catalogPath: path.resolve(configuredCatalogPath) }
  : { kind: "braindrive_https", catalogUrl: configuredCatalogUrl, ...(configuredBundledCatalogPath ? { bundledCatalogPath: path.resolve(configuredBundledCatalogPath) } : {}) };
await mkdir(profileRoot, { recursive: true });
await mkdir(localProfileRoot, { recursive: true });

const allocateLocalPort = () => new Promise((resolve, reject) => {
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
const webdriverPort = await allocateLocalPort();
const frontendPort = await allocateLocalPort();
const frontendUrl = `http://127.0.0.1:${frontendPort}`;

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
  catalogSource,
  catalogCacheRoot,
  catalogTracePath,
  brainDriveUpdateVersion: configuredBrainDriveUpdateVersion,
  recoveryFixtureRoot: configuredRecoveryFixtureRoot,
  recoveryObservationPath: configuredRecoveryObservationPath,
  katieObservationPath: configuredKatieObservationPath,
  katiePublicKeyPath: configuredKatiePublicKeyPath,
  faultObservationPath: configuredFaultObservationPath,
  faultFixtureRoot: configuredFaultFixtureRoot,
  faultAction: configuredFaultAction,
  faultPoint: configuredFaultPoint,
  authorityPath: configuredAuthorityPath,
  cfCatalogPath: configuredCfCatalogPath,
  cfBrowseObservationPath: configuredCfBrowseObservationPath,
  webdriverPort,
  frontendUrl,
};
await writeFile(path.join(artifactsRoot, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);

// Technical execution status is deliberately separate from qualification status.
// Until the verifier integrity review is complete, every native run is diagnostic
// evidence only, including a run whose executable rows happen to pass.
const qualificationDisposition = {
  schemaVersion: 1,
  disposition: "diagnostic_only",
  qualificationEligible: false,
  runId,
  candidate: candidate.head,
  reason: "Native desktop verifier output is not qualification evidence until the verifier integrity review is complete.",
  rawEvidencePreserved: true,
};
await writeFile(
  path.join(artifactsRoot, "qualification-disposition.json"),
  `${JSON.stringify(qualificationDisposition, null, 2)}\n`,
);

const env = {
  ...process.env,
  APPDATA: profileRoot,
  LOCALAPPDATA: localProfileRoot,
  BRAINDRIVE_DESKTOP_TYPESCRIPT_ROOT: projectRoot,
  BRAINDRIVE_DESKTOP_MCP_ROOT: path.resolve(projectRoot, "../mcp_release"),
  BRAINDRIVE_DESKTOP_WEB_ROOT: path.join(projectRoot, "client_web", "dist"),
  BRAINDRIVE_DESKTOP_VERIFIER_ARTIFACTS: artifactsRoot,
  BRAINDRIVE_STAGE1_CATALOG_CACHE_ROOT: catalogCacheRoot,
  BRAINDRIVE_STAGE1_CATALOG_TRACE_PATH: catalogTracePath,
  ...(configuredBrainDriveUpdateVersion ? { BRAINDRIVE_BRAINDRIVE_UPDATE_VERSION: configuredBrainDriveUpdateVersion } : {}),
  TAURI_WEBDRIVER_PORT: String(webdriverPort),
  WDIO_EMBEDDED_SERVER: "true",
  TAURI_CONFIG: JSON.stringify({ build: { devUrl: frontendUrl } }),
};
if (configuredCatalogPath) {
  env.BRAINDRIVE_STAGE1_CATALOG_PATH = path.resolve(configuredCatalogPath);
  delete env.BRAINDRIVE_STAGE1_CATALOG_URL;
} else {
  env.BRAINDRIVE_STAGE1_CATALOG_URL = configuredCatalogUrl;
  if (configuredBundledCatalogPath) env.BRAINDRIVE_STAGE1_CATALOG_BUNDLED_PATH = path.resolve(configuredBundledCatalogPath);
  delete env.BRAINDRIVE_STAGE1_CATALOG_PATH;
}

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

function start(command, args, outputRoot) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  child.stdout.pipe(createWriteStream(path.join(outputRoot, "frontend.stdout.log")));
  child.stderr.pipe(createWriteStream(path.join(outputRoot, "frontend.stderr.log")));
  return child;
}

async function waitForHttp(url, child, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Verifier frontend exited before startup (${child.exitCode}).`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Verifier frontend did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ""}`);
}

const runResult = {
  status: STATUS.NOT_RUN,
  qualification: {
    disposition: qualificationDisposition.disposition,
    qualificationEligible: qualificationDisposition.qualificationEligible,
    reason: qualificationDisposition.reason,
  },
  startedAt: new Date().toISOString(),
  candidate: candidate.head,
};
let app;
let driver;
let stdoutLog;
let stderrLog;
let appExit;
let frontend;

try {
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "desktop:preflight"]);
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "desktop:build:frontend"]);
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "desktop:prepare-dev"]);
  frontend = start(process.platform === "win32" ? "npm.cmd" : "npm", ["--prefix", "client_web", "run", "dev", "--", "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], artifactsRoot);
  await waitForHttp(frontendUrl, frontend);
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
  const evidence = await verifyScreenAndInput(driver, artifactsRoot, candidate);
  const failedRows = evidence.proofRows.filter((row) => row.status === STATUS.FAIL);
  const blockedRows = evidence.proofRows.filter((row) => row.status === STATUS.BLOCKED);
  const notRunRows = evidence.proofRows.filter((row) => row.status === STATUS.NOT_RUN);
  const incompleteRows = evidence.proofRows.filter((row) => row.status !== STATUS.PASS);
  runResult.rowSummary = {
    total: evidence.proofRows.length,
    pass: evidence.proofRows.filter((row) => row.status === STATUS.PASS).length,
    failed: failedRows.length,
    blocked: blockedRows.length,
    notRun: notRunRows.length,
  };
  if (incompleteRows.length > 0) {
    runResult.status = STATUS.FAIL;
    const reasons = [
      failedRows.length > 0 ? `${failedRows.length} failed (${failedRows.map((row) => row.id).join(", ")})` : null,
      blockedRows.length > 0 ? `${blockedRows.length} blocked (${blockedRows.map((row) => row.id).join(", ")})` : null,
      notRunRows.length > 0 ? `${notRunRows.length} not run` : null,
    ].filter(Boolean).join("; ");
    runResult.error = `Desktop proof rows remain incomplete: ${reasons}`;
    console.error(`Desktop verifier recorded incomplete proof rows. Candidate and run records: ${artifactsRoot}`);
    process.exitCode = 1;
  } else {
    runResult.status = STATUS.PASS;
  }
  console.log(`Desktop verifier artifacts: ${artifactsRoot}`);
} catch (error) {
  runResult.status = STATUS.FAIL;
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
  if (frontend && frontend.exitCode === null && frontend.signalCode === null) {
    frontend.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stdoutLog?.end();
  stderrLog?.end();
  runResult.finishedAt = new Date().toISOString();
  qualificationDisposition.technicalStatus = runResult.status;
  qualificationDisposition.finishedAt = runResult.finishedAt;
  await writeFile(
    path.join(artifactsRoot, "qualification-disposition.json"),
    `${JSON.stringify(qualificationDisposition, null, 2)}\n`,
  );
  await writeFile(path.join(artifactsRoot, "run-result.json"), `${JSON.stringify(runResult, null, 2)}\n`);
}
