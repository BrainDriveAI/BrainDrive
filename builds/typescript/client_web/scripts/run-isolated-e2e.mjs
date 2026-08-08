import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
const identifier = "synthetic-e2e-owner";
const password = "synthetic-e2e-password-26!";
const mcpPorts = [8911, 8912, 8913];
const children = new Set();
const processGroups = new Set();
let cleaningUp = false;
let runtimeStarted = false;

function sanitized(text) {
  return String(text).replaceAll(taskRoot, "[task-root]");
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

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
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
  await rm(taskRoot, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(130));
  });
}

async function main() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await assertMcpPortsAvailable();
  const gatewayPort = await reservePort();
  const webPort = await reservePort();
  const isolatedEnv = {
    ...process.env,
    PAA_MEMORY_ROOT: memoryRoot,
    PAA_SECRETS_HOME: secretsRoot,
    PAA_AUTH_MODE: "local",
    BRAINDRIVE_BIND_ADDRESS: "127.0.0.1",
    BRAINDRIVE_PORT: String(gatewayPort),
    BRAINDRIVE_APP_PLATFORM_ENABLED: "true",
    BRAINDRIVE_E2E_RESUME_INFERENCE_FIXTURE: "1",
    BRAINDRIVE_APP_STATE_ROOT: path.join(taskRoot, "app-platform"),
  };

  await run(
    npmCommand,
    ["run", "memory:init", "--", "--memory-root", memoryRoot, "--profile", "local-dev"],
    { cwd: runtimeRoot, env: isolatedEnv }
  );

  const runtime = spawnProcess(process.execPath, ["scripts/dev-runtime.mjs"], {
    cwd: runtimeRoot,
    env: isolatedEnv,
    detached: process.platform !== "win32",
    killGroup: process.platform !== "win32",
  });
  runtimeStarted = true;
  runtime.once("exit", (code) => {
    if (!cleaningUp && code !== 0) process.stderr.write("Isolated E2E runtime exited early.\n");
  });

  const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;
  await waitForHealth(`${gatewayBaseUrl}/health`);
  const signup = await fetch(`${gatewayBaseUrl}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    },
    body: JSON.stringify({ active_provider_profile: "ollama" }),
  });
  if (!providerBaseline.ok) {
    throw new Error(`Provider-independent shell seed failed with HTTP ${providerBaseline.status}`);
  }

  const playwrightCli = path.join(webRoot, "node_modules", "@playwright", "test", "cli.js");
  await run(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
    cwd: webRoot,
    env: {
      ...isolatedEnv,
      VITE_GATEWAY_PROXY_TARGET: gatewayBaseUrl,
      BRAINDRIVE_E2E_ISOLATED: "1",
      BRAINDRIVE_E2E_WEB_PORT: String(webPort),
      BRAINDRIVE_E2E_ARTIFACT_ROOT: artifactRoot,
      BRAINDRIVE_E2E_IDENTIFIER: identifier,
      BRAINDRIVE_E2E_PASSWORD: password,
    },
  });
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${sanitized(error instanceof Error ? error.message : error)}\n`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (error) {
    process.stderr.write(`${sanitized(error instanceof Error ? error.message : error)}\n`);
    process.exitCode = 1;
  }
}
