import { spawnSync } from "node:child_process";
import process from "node:process";

const steps = [
  {
    name: "inference and host safety",
    command: process.execPath,
    args: ["./node_modules/vitest/vitest.mjs", "run", "resume-inference/validators.test.ts", "resume-inference/broker.test.ts", "resume-inference/e2e-fixture.test.ts"],
  },
  {
    name: "native chat mediation",
    command: "npm",
    args: ["--prefix", "client_web", "test", "--", "--run", "src/components/apps/resume-dialogue-mediation.test.ts", "src/components/apps/SandboxedAppFrame.test.tsx"],
  },
  {
    name: "sandbox resource contract",
    command: "npm",
    args: ["--prefix", "../resume_builder", "test", "--", "--run", "test/ui-resource.test.ts", "test/inference-mcp.test.ts"],
  },
];

if (process.env.BRAINDRIVE_RESUME_EVAL_SKIP_BROWSER !== "1") {
  steps.push({
    name: "isolated browser journey",
    command: process.execPath,
    args: ["client_web/scripts/run-isolated-e2e.mjs", "--project=desktop-chrome", "e2e/resume-builder-conversation-eval.spec.ts"],
  });
}

if (process.env.BRAINDRIVE_RESUME_EVAL_LIVE === "1") {
  steps.push({
    name: "live-provider conformance",
    command: "npm",
    args: ["run", "resume:conformance"],
    env: { BRAINDRIVE_RESUME_CONFORMANCE: "1" },
  });
}

const results = [];
for (const step of steps) {
  process.stdout.write(`\n[resume-eval] ${step.name}\n`);
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...step.env },
    stdio: "inherit",
  });
  const passed = result.status === 0;
  results.push({ name: step.name, passed });
  if (!passed) break;
}

process.stdout.write("\nResume Builder evaluation summary\n");
for (const result of results) process.stdout.write(`${result.passed ? "PASS" : "FAIL"}  ${result.name}\n`);
const remaining = steps.slice(results.length);
for (const step of remaining) process.stdout.write(`SKIP  ${step.name}\n`);

const failed = results.some((result) => !result.passed);
const ranLive = steps.some((step) => step.name === "live-provider conformance");
process.stdout.write(`LIVE  ${ranLive ? "requested" : "not requested (set BRAINDRIVE_RESUME_EVAL_LIVE=1 when an owner credential is available)"}\n`);
if (failed) process.exitCode = 1;
