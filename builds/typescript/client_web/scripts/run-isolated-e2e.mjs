import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.resolve(webRoot, "..");
const taskRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-e2e-"));
const memoryRoot = path.join(taskRoot, "memory");
const secretsRoot = path.join(taskRoot, "secrets");
const artifactRoot = path.join(taskRoot, "artifacts");
const retainedEvidenceRoot = process.env.BRAINDRIVE_E2E_RETAIN_EVIDENCE_ROOT?.trim();
const identifier = "synthetic-e2e-owner";
const password = "synthetic-e2e-password-26!";
const mcpPorts = [8911, 8912, 8913];
const children = new Set();
const processGroups = new Set();
const stoppingChildren = new Set();
let cleaningUp = false;
let runtimeStarted = false;
const browserAccess = process.argv.includes("--browser-access");
const playwrightArgs = process.argv.slice(2).filter((argument) => argument !== "--browser-access");

function sanitized(text) {
  return String(text).replaceAll(taskRoot, "[task-root]");
}

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function publicArgument(argument) {
  if (path.isAbsolute(argument) || /https?:\/\//i.test(argument)) return "[redacted-argument]";
  if (/bearer|authorization|password|token|secret/i.test(argument)) return "[redacted-argument]";
  return argument;
}

function hasExactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validateBrowserRecoveryManifest(value) {
  const fail = () => { throw new Error("Refusing malformed or non-content-free browser recovery manifest"); };
  if (!hasExactKeys(value, [
    "evidence_contract_version", "fixture_scope", "timing_rows", "guarded_intents", "stale_value",
    "terminal_rows", "topology_rows", "owner_content_retained", "credentials_tokens_endpoints_private_paths_retained",
  ])) fail();
  if (value.evidence_contract_version !== 1 || value.fixture_scope !== "synthetic_browser_recovery_matrix"
      || value.owner_content_retained !== false || value.credentials_tokens_endpoints_private_paths_retained !== false) fail();
  const timing = new Map([
    ["observed_630ms", 2], ["observed_741ms", 2], ["later_in_policy", 7], ["response_loss_after_commit", 1],
  ]);
  if (!Array.isArray(value.timing_rows) || value.timing_rows.length !== timing.size) fail();
  for (const row of value.timing_rows) {
    if (!hasExactKeys(row, ["id", "writeCalls", "operationReads", "workspaceReads", "status", "sawStillSaving"])
        || timing.get(row.id) !== row.operationReads || row.writeCalls !== 1 || row.workspaceReads !== 0
        || row.status !== "saved" || row.sawStillSaving !== true) fail();
    timing.delete(row.id);
  }
  if (timing.size !== 0) fail();
  const intents = new Set(["submit", "save_answer", "complete_for_now", "pause", "back", "stage:fact_review"]);
  if (!Array.isArray(value.guarded_intents) || value.guarded_intents.length !== intents.size) fail();
  for (const row of value.guarded_intents) {
    if (!hasExactKeys(row, ["intent", "requested", "writes", "transitions", "status"])
        || !intents.delete(row.intent) || row.requested !== 2 || row.writes !== 1 || row.transitions !== 1 || row.status !== "saved") fail();
  }
  if (intents.size !== 0
      || !hasExactKeys(value.stale_value, ["writeCalls", "distinctOperationIds", "terminalStatus", "terminalRevision"])
      || value.stale_value.writeCalls !== 2 || value.stale_value.distinctOperationIds !== 2
      || value.stale_value.terminalStatus !== "saved" || value.stale_value.terminalRevision !== 2
      || !hasExactKeys(value.terminal_rows, ["denied", "conflict", "cancelled_transition_count", "final_readback"])
      || value.terminal_rows.denied !== "not_saved" || value.terminal_rows.conflict !== "conflict"
      || value.terminal_rows.cancelled_transition_count !== 0 || value.terminal_rows.final_readback !== "not_saved"
      || !hasExactKeys(value.topology_rows, ["teardown_obsolete_transition_count", "reconnectOperationReads", "restoredStatus"])
      || value.topology_rows.teardown_obsolete_transition_count !== 0 || value.topology_rows.reconnectOperationReads !== 2
      || value.topology_rows.restoredStatus !== "saved") fail();
  return value;
}

function validateBrowserInferenceManifest(value) {
  const fail = () => { throw new Error("Refusing malformed or non-content-free browser inference manifest"); };
  if (!hasExactKeys(value, [
    "evidence_contract_version", "fixture_scope", "accepted_fixtures", "invalid_candidates",
    "owner_content_retained", "credentials_tokens_endpoints_private_paths_retained",
  ])) fail();
  if (value.evidence_contract_version !== 1 || value.fixture_scope !== "synthetic_browser_inference_matrix"
      || value.owner_content_retained !== false || value.credentials_tokens_endpoints_private_paths_retained !== false) fail();
  const fixtures = new Map([
    ["spec-10-dense-synthetic-v1", "sha256:46bb257ce2324228645d48480086cf4d0b6ae9e334a24ac207f82b5f651398e7"],
    ["spec-10-holdout-synthetic-v1", "sha256:3db0592ed2c1aeaa6bafe546437bc044490a2ca51532c5dcfdce9e9ec2d3a1cd"],
  ]);
  if (!Array.isArray(value.accepted_fixtures) || value.accepted_fixtures.length !== fixtures.size) fail();
  for (const row of value.accepted_fixtures) {
    if (!hasExactKeys(row, ["fixtureId", "factCount", "jobCount", "statementCount", "status", "approvedCount", "fixtureDigest"])
        || fixtures.get(row.fixtureId) !== row.fixtureDigest || row.factCount !== 29 || row.jobCount !== 3
        || row.statementCount !== 29 || row.status !== "proposed" || row.approvedCount !== 0) fail();
    fixtures.delete(row.fixtureId);
  }
  const codes = new Set([
    "invalid_request", "conflict", "model_incompatible", "protocol_incompatible", "provider_schema_unsupported",
    "provider_authentication_failed", "provider_authorization_failed", "provider_unavailable", "denied", "quota_exceeded",
    "rate_limited", "deadline_exceeded", "malformed_structured_output", "incomplete_output", "schema_validation_failed",
    "validation_failed", "evidence_validation_failed", "content_filtered", "provider_refused", "unexpected_tool_call",
    "cancelled", "session_closed", "internal_failure", "recoverable_internal_failure",
  ]);
  if (fixtures.size !== 0 || !Array.isArray(value.invalid_candidates) || value.invalid_candidates.length !== codes.size) fail();
  for (const row of value.invalid_candidates) {
    if (!hasExactKeys(row, ["code", "recovery", "actionLabels", "proposalWrites", "protectedMutationCount"])
        || !codes.delete(row.code) || typeof row.recovery !== "string" || !Array.isArray(row.actionLabels)
        || row.proposalWrites !== 0 || row.protectedMutationCount !== 0) fail();
    if (row.code === "evidence_validation_failed"
        && JSON.stringify(row.actionLabels) !== JSON.stringify(["Try again", "Review confirmed evidence", "Not now"])) fail();
  }
  if (codes.size !== 0) fail();
  return value;
}

async function retainSanitizedEvidence(status) {
  if (!retainedEvidenceRoot) return;
  if (!path.isAbsolute(retainedEvidenceRoot)) {
    throw new Error("BRAINDRIVE_E2E_RETAIN_EVIDENCE_ROOT must be an absolute task-owned path");
  }
  const resolvedEvidenceRoot = path.resolve(retainedEvidenceRoot);
  if (resolvedEvidenceRoot === taskRoot || resolvedEvidenceRoot.startsWith(`${taskRoot}${path.sep}`)) {
    throw new Error("Retained E2E evidence must be outside the disposable task root");
  }

  const allowedScreenshots = new Set([
    "resume-builder-owner-review.png",
    "resume-builder-career-preview.png",
    "resume-builder-version-comparison.png",
  ]);
  const artifactFiles = (await walkFiles(artifactRoot)).sort();
  const screenshotRoot = path.join(resolvedEvidenceRoot, "screenshots");
  await mkdir(screenshotRoot, { recursive: true, mode: 0o700 });
  const retainedScreenshots = [];
  for (const sourcePath of artifactFiles) {
    const name = path.basename(sourcePath);
    if (!allowedScreenshots.has(name)) continue;
    if (retainedScreenshots.some((entry) => entry.name === name)) {
      throw new Error(`Refusing ambiguous retained E2E screenshot name: ${name}`);
    }
    const content = await readFile(sourcePath);
    await copyFile(sourcePath, path.join(screenshotRoot, name), fsConstants.COPYFILE_EXCL);
    retainedScreenshots.push({
      name,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  const retainedManifests = [];
  const manifestContracts = new Map([
    ["spec10-browser-recovery-matrix.json", validateBrowserRecoveryManifest],
    ["spec10-browser-inference-matrix.json", validateBrowserInferenceManifest],
  ]);
  for (const [manifestName, validateManifest] of manifestContracts) {
    const manifestSources = artifactFiles.filter((sourcePath) => path.basename(sourcePath) === manifestName);
    if (manifestSources.length > 1) throw new Error(`Refusing ambiguous retained E2E manifest name: ${manifestName}`);
    if (manifestSources.length === 0) continue;
    const content = await readFile(manifestSources[0]);
    if (content.byteLength > 32_768) throw new Error(`Refusing oversized browser manifest: ${manifestName}`);
    validateManifest(JSON.parse(content.toString("utf8")));
    const manifestRoot = path.join(resolvedEvidenceRoot, "manifests");
    await mkdir(manifestRoot, { recursive: true, mode: 0o700 });
    await copyFile(manifestSources[0], path.join(manifestRoot, manifestName), fsConstants.COPYFILE_EXCL);
    retainedManifests.push({
      name: manifestName,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  const browserRun = {
    evidence_contract_version: 1,
    framework: "Playwright",
    status,
    selection: playwrightArgs.map(publicArgument),
    screenshots: retainedScreenshots,
    manifests: retainedManifests,
    raw_playwright_trace_retained: false,
    raw_trace_reason: "Raw trace archives may contain credentials, loopback endpoints, and private temporary paths.",
    sanitization: {
      synthetic_fixture_only: true,
      allowlisted_screenshots_only: true,
      strict_content_free_manifests_only: true,
      credentials_tokens_endpoints_private_paths_retained: false,
    },
  };
  await writeFile(
    path.join(resolvedEvidenceRoot, "sanitized-browser-run.json"),
    `${JSON.stringify(browserRun, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

function spawnProcess(command, args, options = {}) {
  const { killGroup = false, ...spawnOptions } = options;
  const child = spawn(command, args, {
    ...spawnOptions,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  if (killGroup) processGroups.add(child);
  child.once("exit", () => {
    children.delete(child);
    processGroups.delete(child);
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(sanitized(chunk)));
  child.stderr?.on("data", (chunk) => process.stderr.write(sanitized(chunk)));
  return child;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, options);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(command)} exited with ${signal || `code ${code}`}`));
    });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Unable to allocate isolated E2E port"));
        else resolve(port);
      });
    });
  });
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function assertMcpPortsAvailable() {
  const occupied = [];
  for (const port of mcpPorts) {
    if (await isPortInUse(port)) occupied.push(port);
  }
  if (occupied.length > 0) {
    throw new Error(
      `Isolated E2E requires unused loopback MCP ports: ${occupied.join(", ")}`
    );
  }
}

async function waitForMcpPortsReleased(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = await Promise.all(mcpPorts.map(isPortInUse));
    if (states.every((inUse) => !inUse)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Isolated E2E runtime did not release its loopback MCP ports");
}

async function waitForHealth(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "not reachable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Isolated E2E gateway did not become healthy: ${lastStatus}`);
}

function nonLoopbackIpv4Addresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (address.family === "IPv4" && !address.internal) addresses.push(address.address);
    }
  }
  return [...new Set(addresses)].sort((left, right) => {
    const privateAddress = (value) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
    return Number(privateAddress(right)) - Number(privateAddress(left));
  });
}

async function resolveBrowserAccessBaseUrl(port) {
  const addresses = nonLoopbackIpv4Addresses();
  if (addresses.length === 0) {
    throw new Error("Browser-access E2E requires a non-loopback IPv4 address");
  }
  for (const address of addresses) {
    const baseUrl = `http://${address}:${port}`;
    try {
      await waitForHealth(`${baseUrl}/healthz`, 2_000);
      return baseUrl;
    } catch {
      // Try the next host interface. VPN and virtual adapters may not route locally.
    }
  }
  throw new Error("Browser-access E2E could not reach the LAN bridge through a non-loopback IPv4 address");
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  stoppingChildren.add(child);
  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    return;
  }
  if (processGroups.has(child) && child.pid) process.kill(-child.pid, "SIGTERM");
  else child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    if (processGroups.has(child) && child.pid) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  }
}

async function cleanup() {
  if (cleaningUp) return;
  cleaningUp = true;
  await Promise.all([...children].map(stopChild));
  if (runtimeStarted) await waitForMcpPortsReleased();
  await makeTreeWritable(taskRoot);
  await rm(taskRoot, { recursive: true, force: true });
}

async function makeTreeWritable(root) {
  const metadata = await lstat(root).catch(() => null);
  if (!metadata) return;
  if (!metadata.isDirectory()) {
    await chmod(root, 0o600).catch(() => undefined);
    return;
  }
  await chmod(root, 0o700).catch(() => undefined);
  const children = await readdir(root).catch(() => []);
  await Promise.all(children.map((child) => makeTreeWritable(path.join(root, child))));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(130));
  });
}

async function main() {
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmArgs = [];
  if (process.platform === "win32") {
    const npmCli = process.env.npm_execpath?.trim();
    if (!npmCli) {
      throw new Error("Windows isolated E2E requires the npm CLI path from npm_execpath");
    }
    npmArgs.push(npmCli);
  }
  await assertMcpPortsAvailable();
  const gatewayPort = await reservePort();
  const webPort = await reservePort();
  const bridgePort = browserAccess ? await reservePort() : null;
  const transportToken = browserAccess ? randomBytes(32).toString("hex") : "";
  const isolatedEnv = {
    ...process.env,
    PAA_MEMORY_ROOT: memoryRoot,
    PAA_SECRETS_HOME: secretsRoot,
    PAA_AUTH_MODE: "local",
    BRAINDRIVE_BIND_ADDRESS: "127.0.0.1",
    BRAINDRIVE_PORT: String(gatewayPort),
    BRAINDRIVE_APP_PLATFORM_ENABLED: "true",
    BRAINDRIVE_E2E_INSTALLED_APP_PROVIDER_MODULE: "../resume_builder/test/installed-provider-fixture.mjs",
    BRAINDRIVE_E2E_BRIEF_INFERENCE_FIXTURE: "1",
    BRAINDRIVE_APP_STATE_ROOT: path.join(taskRoot, "app-platform"),
    ...(browserAccess
      ? {
          BRAINDRIVE_INTERNAL_TRANSPORT_TOKEN: transportToken,
          NODE_ENV: "production",
        }
      : {}),
  };

  await run(
    npmCommand,
    [...npmArgs, "run", "memory:init", "--", "--memory-root", memoryRoot, "--profile", "local-dev"],
    { cwd: runtimeRoot, env: isolatedEnv }
  );

  const startRuntime = () => {
    const child = spawnProcess(process.execPath, ["scripts/dev-runtime.mjs"], {
      cwd: runtimeRoot,
      env: isolatedEnv,
      detached: process.platform !== "win32",
      killGroup: process.platform !== "win32",
    });
    runtimeStarted = true;
    child.once("exit", (code) => {
      if (!cleaningUp && !stoppingChildren.has(child) && code !== 0) {
        process.stderr.write("Isolated E2E runtime exited early.\n");
      }
    });
    return child;
  };

  let runtime = startRuntime();

  const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;
  await waitForHealth(`${gatewayBaseUrl}/health`);
  const signup = await fetch(`${gatewayBaseUrl}/auth/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(transportToken ? { "x-braindrive-internal-transport-token": transportToken } : {}),
    },
    body: JSON.stringify({ identifier, password }),
  });
  if (signup.status !== 201) {
    throw new Error(`Synthetic local-auth seed failed with HTTP ${signup.status}`);
  }
  const signupPayload = await signup.json();
  const accessToken = signupPayload?.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Synthetic local-auth seed did not return an access token");
  }
  const providerBaseline = await fetch(`${gatewayBaseUrl}/settings`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(transportToken ? { "x-braindrive-internal-transport-token": transportToken } : {}),
    },
    body: JSON.stringify({ active_provider_profile: "ollama" }),
  });
  if (!providerBaseline.ok) {
    throw new Error(`Provider-independent shell seed failed with HTTP ${providerBaseline.status}`);
  }

  if (browserAccess) {
    await stopChild(runtime);
    await waitForMcpPortsReleased();
    const authStatePath = path.join(memoryRoot, "preferences", "auth-state.json");
    const authState = JSON.parse(await readFile(authStatePath, "utf8"));
    authState.session_policy.access_ttl_seconds = 2;
    await writeFile(authStatePath, `${JSON.stringify(authState, null, 2)}\n`, "utf8");
    runtime = startRuntime();
    await waitForHealth(`${gatewayBaseUrl}/health`);
  }

  let browserBaseUrl;
  if (browserAccess && bridgePort) {
    const tsxCli = path.join(runtimeRoot, "node_modules", "tsx", "dist", "cli.mjs");
    const bridge = spawnProcess(process.execPath, [tsxCli, "desktop/bridge.ts"], {
      cwd: runtimeRoot,
      env: {
        ...isolatedEnv,
        BRAINDRIVE_BROWSER_BRIDGE_HOST: "0.0.0.0",
        BRAINDRIVE_BROWSER_BRIDGE_PORT: String(bridgePort),
        BRAINDRIVE_BROWSER_BRIDGE_WEB_ROOT: path.join(webRoot, "dist"),
        BRAINDRIVE_BROWSER_BRIDGE_GATEWAY_URL: gatewayBaseUrl,
        BRAINDRIVE_BROWSER_BRIDGE_MODE: "lan",
        BRAINDRIVE_BROWSER_BRIDGE_EXTERNAL_PROTO: "http",
      },
      windowsHide: true,
    });
    bridge.once("exit", (code) => {
      if (!cleaningUp && code !== 0) process.stderr.write("Isolated E2E browser bridge exited early.\n");
    });
    await waitForHealth(`http://127.0.0.1:${bridgePort}/healthz`);
    browserBaseUrl = await resolveBrowserAccessBaseUrl(bridgePort);
  }

  const playwrightCli = path.join(webRoot, "node_modules", "@playwright", "test", "cli.js");
  await run(process.execPath, [playwrightCli, "test", ...playwrightArgs], {
    cwd: webRoot,
    env: {
      ...isolatedEnv,
      VITE_GATEWAY_PROXY_TARGET: gatewayBaseUrl,
      BRAINDRIVE_E2E_ISOLATED: "1",
      BRAINDRIVE_E2E_WEB_PORT: String(webPort),
      BRAINDRIVE_E2E_ARTIFACT_ROOT: artifactRoot,
      BRAINDRIVE_E2E_IDENTIFIER: identifier,
      BRAINDRIVE_E2E_PASSWORD: password,
      ...(browserAccess
        ? {
            BRAINDRIVE_E2E_BROWSER_ACCESS: "1",
            BRAINDRIVE_E2E_BASE_URL: browserBaseUrl,
          }
        : {}),
    },
  });
}

let runStatus = "failed";
try {
  await main();
  runStatus = "passed";
} catch (error) {
  process.stderr.write(`${sanitized(error instanceof Error ? error.message : error)}\n`);
  process.exitCode = 1;
} finally {
  try {
    await retainSanitizedEvidence(runStatus);
    await cleanup();
  } catch (error) {
    process.stderr.write(`${sanitized(error instanceof Error ? error.message : error)}\n`);
    process.exitCode = 1;
  }
}
