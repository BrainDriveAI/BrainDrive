import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptRoot, "..");
const repoRoot = path.resolve(projectRoot, "..", "..");
const mcpRoot = path.resolve(projectRoot, "..", "mcp_release");
const memoryRoot = path.resolve(process.env.PAA_MEMORY_ROOT?.trim() || path.join(projectRoot, "your-memory"));
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const childProcesses = [];

const includeWeb = process.argv.includes("--web");
const host = process.env.HOST || "127.0.0.1";
const gatewayPort = process.env.BRAINDRIVE_PORT || process.env.PORT || "8787";

function spawnManaged(label, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  childProcesses.push({ label, child });

  child.stdout.on("data", (chunk) => writePrefixed(label, chunk));
  child.stderr.on("data", (chunk) => writePrefixed(label, chunk, true));
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[${label}] exited with ${reason}`);
    shutdown(code && code > 0 ? code : 1);
  });

  return child;
}

function writePrefixed(label, chunk, stderr = false) {
  const stream = stderr ? process.stderr : process.stdout;
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.length > 0) {
      stream.write(`[${label}] ${line}\n`);
    }
  }
}

async function waitForHealth(label, url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become healthy at ${url}: ${lastError}`);
}

let shuttingDown = false;
function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const { child } of childProcesses.toReversed()) {
    if (!child.killed) {
      child.kill();
    }
  }
  setTimeout(() => process.exit(exitCode), 300).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  console.log(`Starting BrainDrive dev runtime from ${repoRoot}`);
  console.log(`Memory root: ${memoryRoot}`);

  const mcpServers = [
    { kind: "memory", port: "8911" },
    { kind: "auth", port: "8912" },
    { kind: "project", port: "8913" },
  ];

  for (const server of mcpServers) {
    spawnManaged(`mcp:${server.kind}`, npmExecutable, ["run", "dev"], {
      cwd: mcpRoot,
      env: {
        ...process.env,
        SERVER_KIND: server.kind,
        HOST: "127.0.0.1",
        PORT: server.port,
        MEMORY_ROOT: memoryRoot,
      },
    });
  }

  await Promise.all(
    mcpServers.map((server) =>
      waitForHealth(`mcp:${server.kind}`, `http://127.0.0.1:${server.port}/healthz`)
    )
  );

  spawnManaged("gateway", npmExecutable, ["run", "dev:gateway"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PAA_MEMORY_ROOT: memoryRoot,
      BRAINDRIVE_BIND_ADDRESS: host,
      BRAINDRIVE_PORT: gatewayPort,
    },
  });

  await waitForHealth("gateway", `http://127.0.0.1:${gatewayPort}/health`, 60_000);
  console.log(`Gateway ready: http://127.0.0.1:${gatewayPort}`);

  if (includeWeb) {
    spawnManaged("web", npmExecutable, ["--prefix", "client_web", "run", "dev"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        VITE_GATEWAY_PROXY_TARGET: `http://127.0.0.1:${gatewayPort}`,
      },
    });
    console.log("Web dev server starting: http://127.0.0.1:5073");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
