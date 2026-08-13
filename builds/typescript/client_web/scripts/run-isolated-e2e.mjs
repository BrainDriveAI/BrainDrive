import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const stoppingChildren = new Set();
let cleaningUp = false;
let runtimeStarted = false;
const browserAccess = process.argv.includes("--browser-access");
const playwrightArgs = process.argv.slice(2).filter((argument) => argument !== "--browser-access");

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
    BRAINDRIVE_E2E_RESUME_INFERENCE_FIXTURE: "1",
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
