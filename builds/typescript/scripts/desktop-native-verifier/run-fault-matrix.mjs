import { spawn } from "node:child_process";
import { access, constants, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reviewFaultRecovery } from "./fault-recovery-review.mjs";
import { candidateDigest, digestPath, signKatiePacket } from "./packet-tools.mjs";
import { STATUS } from "./verification-contract.mjs";

if (process.platform !== "win32" && process.platform !== "darwin") {
  throw new Error(`The F-1 native fault matrix must run on Windows/macOS, not ${process.platform}.`);
}

const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const fixtureRoot = path.resolve(valueAfter("--fixture-root", path.join(process.cwd(), ".desktop-evaluation-fixtures")));
const outputRoot = path.resolve(valueAfter("--output", path.join(os.tmpdir(), "braindrive-desktop-fault-matrix")));
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "run.mjs");
const aggregatePath = path.join(outputRoot, `${process.platform}-fault-observation.json`);

await access(fixtureRoot, constants.R_OK).catch(() => {
  throw new Error(`F-1 fixture root is not readable: ${fixtureRoot}`);
});
await mkdir(outputRoot, { recursive: true });

const cases = [
  { id: "network", action: "install", point: "network" },
  { id: "disk", action: "install", point: "disk" },
  { id: "restart", action: "install", point: "restart" },
  { id: "verification", action: "install", point: "verification" },
  { id: "update-activation", action: "update", point: "activation" },
];

function runCase(testCase) {
  const caseRoot = path.join(outputRoot, testCase.id);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runScript], {
      cwd: packageRoot,
      env: {
        ...process.env,
        BRAINDRIVE_DESKTOP_VERIFIER_ARTIFACTS: caseRoot,
        BRAINDRIVE_DESKTOP_VERIFIER_FAULT_FIXTURE_ROOT: fixtureRoot,
        BRAINDRIVE_DESKTOP_VERIFIER_FAULT_OBSERVATION_PATH: aggregatePath,
        BRAINDRIVE_DESKTOP_VERIFIER_FAULT_INJECTION: "1",
        BRAINDRIVE_DESKTOP_VERIFIER_FAULT_ACTION: testCase.action,
        BRAINDRIVE_DESKTOP_VERIFIER_FAULT_POINT: testCase.point,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, caseRoot }));
  });
}

async function findFaultObservation(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === "fault-observation.json") return JSON.parse(await readFile(candidate, "utf8"));
    if (entry.isDirectory()) {
      const found = await findFaultObservation(candidate);
      if (found) return found;
    }
  }
  return null;
}

const runs = [];
const aggregate = { packetVersion: 1, platform: process.platform, fixtureRoot, startedAt: new Date().toISOString(), installFailures: {}, updateActivation: null, runs };
for (const testCase of cases) {
  const result = await runCase(testCase);
  const observation = await findFaultObservation(result.caseRoot);
  runs.push({ ...testCase, ...result, observation, observationAvailable: Boolean(observation) });
  if (observation?.installFailures) Object.assign(aggregate.installFailures, observation.installFailures);
  if (observation?.updateActivation) aggregate.updateActivation = observation.updateActivation;
}
aggregate.finishedAt = new Date().toISOString();
const candidate = runs.map((run) => run.observation?.candidate).find(Boolean) ?? null;
if (candidate) {
  aggregate.candidate = candidate;
  aggregate.candidateDigest = candidateDigest(candidate);
}
aggregate.fixtureDigest = await digestPath(fixtureRoot);
const privateKeyPath = process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_PRIVATE_KEY_PATH?.trim() ?? null;
const privateKey = privateKeyPath ? await readFile(privateKeyPath) : null;
const packet = privateKey ? signKatiePacket(aggregate, privateKey) : aggregate;
await writeFile(aggregatePath, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_FIXTURE_ROOT = fixtureRoot;
process.env.BRAINDRIVE_DESKTOP_VERIFIER_FAULT_OBSERVATION_PATH = aggregatePath;
const review = await reviewFaultRecovery({ candidate });
await writeFile(path.join(outputRoot, `${process.platform}-fault-review.json`), `${JSON.stringify(review, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ aggregatePath, review: review.status, rows: review.rows }, null, 2));
if (review.status !== STATUS.PASS) process.exitCode = 1;
