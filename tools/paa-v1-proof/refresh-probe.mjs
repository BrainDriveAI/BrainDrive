// This overwrites PAA_PROOF_SOURCE_FILE, which must be a task-owned fixture.
// Keep the Gateway and first-party MCP services running during the probe.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const baseUrl = process.env.PAA_PROOF_GATEWAY_URL ?? "http://127.0.0.1:8800";
const authPath = process.env.PAA_PROOF_AUTH_FILE;
const sourcePath = process.env.PAA_PROOF_SOURCE_FILE;
const providerLog = process.env.PAA_PROOF_PROVIDER_LOG;
if (!authPath || !sourcePath || !providerLog) {
  throw new Error("PAA_PROOF_AUTH_FILE, PAA_PROOF_SOURCE_FILE and PAA_PROOF_PROVIDER_LOG are required");
}
const repoRoot = path.resolve(import.meta.dirname, "../..");
const { token } = JSON.parse(readFileSync(authPath, "utf8"));
const { servers } = JSON.parse(readFileSync(path.join(repoRoot,
  "builds/typescript/mcp/servers.full-mcp.json"), "utf8"));
const authServer = servers.find((server) => server.id === "auth");
if (!token || !authServer) throw new Error("Token or auth source unavailable");
const results = [];

function setSources(selected) {
  writeFileSync(sourcePath, JSON.stringify({ servers: selected }));
}

async function message(content) {
  const response = await fetch(new URL("/message", baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return { status: response.status, body: await response.text() };
}

function lastProviderRequest() {
  const lines = readFileSync(providerLog, "utf8").trim().split("\n");
  return JSON.parse(lines.at(-1));
}

setSources([]);
const before = await message("Before adding a tool source");
results.push({
  id: "SWAP-3-no-source",
  result: before.status === 200 && !lastProviderRequest().tool_names.includes("auth_whoami")
    ? "pass" : "fail",
});

setSources([authServer]);
const added = await message("PAA_PROOF_CALL_TOOL");
results.push({
  id: "SWAP-3-add-service-without-restart",
  result: added.status === 200 &&
    added.body.includes("event: tool-call") &&
    added.body.includes("event: tool-result") &&
    added.body.includes("tool-complete") ? "pass" : "fail",
});

setSources([]);
const removed = await message("After removing a tool source");
results.push({
  id: "SWAP-3-remove-service-without-restart",
  result: removed.status === 200 &&
    !lastProviderRequest().tool_names.includes("auth_whoami") ? "pass" : "fail",
});

console.log(JSON.stringify({ target: baseUrl, results }, null, 2));
if (results.some((entry) => entry.result === "fail")) process.exitCode = 1;
