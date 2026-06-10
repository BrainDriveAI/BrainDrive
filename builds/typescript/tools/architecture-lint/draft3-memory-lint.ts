import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Draft3MemoryLintResult = {
  ok: boolean;
  errors: string[];
};

const ARCHITECTURE_ALIGNED_PROJECTS = [
  "career",
  "finance",
  "fitness",
  "new-project",
  "relationships",
] as const;

const REQUIRED_PROJECT_FILES = [
  "AGENT.md",
  "spec.md",
  "run-interview.md",
  "plan.md",
  "run-planning.md",
] as const;

const STALE_PROJECT_PATHS = [
  "index.md",
] as const;

const STALE_FINANCE_PATHS = [
  "budget",
  "budget.md",
  "rules.md",
  "budgeting/index.md",
  "budgeting/first-pass-budget.md",
  "budgeting/monthly-comparison.md",
  "budgeting/source-evidence.md",
  "budgeting/report-contract.md",
  "budgeting/saved-budget-rules.md",
] as const;

const STALE_FITNESS_PATHS = [
  "health-docs",
] as const;

const PROCEDURE_FILES = [
  "run-interview.md",
  "run-planning.md",
] as const;

const OPTIONAL_PROJECT_OVERLAY_FILES = [
  "AGENT-user.md",
  "run-interview-user.md",
  "run-planning-user.md",
] as const;

export async function lintDraft3MemoryStarterPack(starterPackRoot: string): Promise<Draft3MemoryLintResult> {
  const errors: string[] = [];

  if (!existsSync(path.join(starterPackRoot, "base", "me", "profile.md"))) {
    errors.push("Missing required cross-project profile template: base/me/profile.md");
  }

  const baseAgent = await readOptional(path.join(starterPackRoot, "base", "AGENT.md"));
  if (baseAgent !== null && /powered by|what model you are/i.test(baseAgent)) {
    errors.push("base/AGENT.md must stay model-agnostic");
  }

  if (existsSync(path.join(starterPackRoot, "projects", "templates", "braindrive-plus-one"))) {
    errors.push("BrainDrive+1 must not be scaffolded as a normal project template");
  }

  const projectSeeds = await readOptional(path.join(starterPackRoot, "projects", "projects.seed.json"));
  if (projectSeeds !== null && /"id"\s*:\s*"braindrive-plus-one"/.test(projectSeeds)) {
    errors.push("BrainDrive+1 must not be seeded as a normal project");
  }

  for (const projectId of ARCHITECTURE_ALIGNED_PROJECTS) {
    const projectRoot = path.join(starterPackRoot, "projects", "templates", projectId);
    for (const file of REQUIRED_PROJECT_FILES) {
      if (!existsSync(path.join(projectRoot, file))) {
        errors.push(`Missing required Draft 3 ${projectId} file: ${file}`);
      }
    }

    for (const file of STALE_PROJECT_PATHS) {
      if (existsSync(path.join(projectRoot, file))) {
        errors.push(`Stale pre-Draft-3 ${projectId} path still exists: ${file}`);
      }
    }

    for (const file of PROCEDURE_FILES) {
      const content = await readOptional(path.join(projectRoot, file));
      if (content !== null && !/^## Preservation Rule\s*$/m.test(content)) {
        errors.push(`Procedure is missing Preservation Rule: ${projectId}/${file}`);
      }
    }

    for (const file of OPTIONAL_PROJECT_OVERLAY_FILES) {
      if (existsSync(path.join(projectRoot, file))) {
        errors.push(`Owner overlay must not be seeded by starter pack: ${projectId}/${file}`);
      }
    }

    const agentContent = await readOptional(path.join(projectRoot, "AGENT.md"));
    if (agentContent !== null) {
      for (const file of OPTIONAL_PROJECT_OVERLAY_FILES) {
        if (!agentContent.includes(file)) {
          errors.push(`Project AGENT.md does not document optional overlay: ${projectId}/${file}`);
        }
      }
    }
  }

  const financeRoot = path.join(starterPackRoot, "projects", "templates", "finance");
  for (const file of STALE_FINANCE_PATHS) {
    if (existsSync(path.join(financeRoot, file))) {
      errors.push(`Stale pre-Draft-3 Finance path still exists: ${file}`);
    }
  }

  const fitnessRoot = path.join(starterPackRoot, "projects", "templates", "fitness");
  for (const file of STALE_FITNESS_PATHS) {
    if (existsSync(path.join(fitnessRoot, file))) {
      errors.push(`Stale pre-Draft-3 Fitness path still exists: ${file}`);
    }
  }

  const latestReport = await readOptional(path.join(financeRoot, "reports", "latest.md"));
  if (latestReport !== null && !latestReport.includes("Generated report")) {
    errors.push("reports/latest.md must be labeled as generated output");
  }

  const overlayNameErrors = await findInvalidOverlayNames(starterPackRoot);
  errors.push(...overlayNameErrors);

  return {
    ok: errors.length === 0,
    errors,
  };
}

async function findInvalidOverlayNames(root: string): Promise<string[]> {
  const errors: string[] = [];
  await visitFiles(root, async (filePath) => {
    const fileName = path.basename(filePath);
    if (/user-AGENT\.md$/i.test(fileName) || /-(custom|local|mine)\.md$/i.test(fileName)) {
      errors.push(`Invalid overlay name: ${path.relative(root, filePath).replace(/\\/g, "/")}`);
    }
  });
  return errors;
}

async function visitFiles(root: string, visitor: (filePath: string) => Promise<void>): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await visitFiles(entryPath, visitor);
    } else if (entry.isFile()) {
      await visitor(entryPath);
    }
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const rootArg = process.argv[2];
  const starterPackRoot = rootArg
    ? path.resolve(rootArg)
    : path.resolve(process.cwd(), "memory", "starter-pack");
  const result = await lintDraft3MemoryStarterPack(starterPackRoot);
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  void main();
}
