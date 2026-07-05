import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ROOT_AGENT_CANONICAL_ID,
  ROOT_AGENT_LEGACY_IDS,
} from "../../memory/root-agent.js";

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

const DEFAULT_PAGE_PROJECT_IDS = [
  "finance",
  "fitness",
  "career",
  "relationships",
  "new-project",
] as const;

const PAGE_JOURNAL_PROJECT_IDS = [
  "finance",
  "fitness",
  "career",
  "relationships",
  "new-project",
] as const;

const REQUIRED_PROJECT_FILES = [
  "AGENT.md",
  "spec.md",
  "run-interview.md",
  "plan.md",
  "run-planning.md",
] as const;

const ROOT_AGENT_FORBIDDEN_TEMPLATE_FILES = [
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

const JOURNAL_PROJECT_FILES = [
  "run-journal.md",
  "journal.md",
] as const;

const STALE_JOURNAL_PROJECT_PATHS = [
  "journal/AGENT.md",
  "journal/journal.md",
] as const;

const OPTIONAL_PROJECT_OVERLAY_FILES = [
  "AGENT-user.md",
  "run-interview-user.md",
  "run-planning-user.md",
] as const;

const BUILDER_ONLY_STARTER_SKILLS = [
  "landscape.md",
  "milestone-check.md",
  "smoke-test.md",
  "test-plan.md",
] as const;

const FINANCE_REQUIRED_MARKERS: Array<{ file: string; marker: string; description: string }> = [
  {
    file: "AGENT.md",
    marker: "Finance owns financial alignment and planning",
    description: "Finance parent surface ownership",
  },
  {
    file: "AGENT.md",
    marker: "page-level action",
    description: "Finance page-level execution boundary",
  },
  {
    file: "spec.md",
    marker: "## What Good Looks Like",
    description: "Finance success criteria section",
  },
  {
    file: "spec.md",
    marker: "## Assumptions And Unknowns",
    description: "Finance assumptions and unknowns section",
  },
  {
    file: "run-interview.md",
    marker: "debt pressure, high savings",
    description: "Finance starting-position adaptation",
  },
  {
    file: "run-interview.md",
    marker: "Classify new facts before writing",
    description: "Finance artifact placement rule",
  },
  {
    file: "plan.md",
    marker: "## Review Status",
    description: "Finance review status section",
  },
  {
    file: "plan.md",
    marker: "## Review Status",
    description: "Finance review status section",
  },
  {
    file: "run-planning.md",
    marker: "Every plan step must trace",
    description: "Finance plan traceability",
  },
  {
    file: "run-planning.md",
    marker: "return to Finance scope",
    description: "Finance page-level execution boundary",
  },
];

const SURFACE_REQUIRED_MARKERS: Record<string, Array<{ file: string; marker: string; description: string }>> = {
  career: [
    {
      file: "AGENT.md",
      marker: "Career owns career alignment and planning",
      description: "Career parent surface ownership",
    },
    {
      file: "run-interview.md",
      marker: "early career or first direction",
      description: "Career starting-position adaptation",
    },
    {
      file: "run-interview.md",
      marker: "Classify new facts before writing",
      description: "Career artifact placement rule",
    },
    {
      file: "plan.md",
      marker: "## Review Status",
      description: "Career review status section",
    },
    {
      file: "run-planning.md",
      marker: "Keep all execution work at the page level as a manual step",
      description: "Career page-level execution boundary",
    },
  ],
  fitness: [
    {
      file: "AGENT.md",
      marker: "Fitness owns fitness alignment and planning",
      description: "Fitness parent surface ownership",
    },
    {
      file: "run-interview.md",
      marker: "starting from scratch",
      description: "Fitness starting-position adaptation",
    },
    {
      file: "run-interview.md",
      marker: "Classify new facts before writing",
      description: "Fitness artifact placement rule",
    },
    {
      file: "plan.md",
      marker: "## Review Status",
      description: "Fitness review status section",
    },
    {
      file: "run-planning.md",
      marker: "Keep all execution work at the page level as a manual step",
      description: "Fitness page-level execution boundary",
    },
  ],
  "new-project": [
    {
      file: "AGENT.md",
      marker: "New Project owns guided custom-page creation",
      description: "New Project surface ownership",
    },
    {
      file: "spec.md",
      marker: "## Why This Belongs Here",
      description: "New Project routing rationale section",
    },
    {
      file: "run-interview.md",
      marker: "decide the right home before scaffolding",
      description: "New Project routing judgment",
    },
    {
      file: "plan.md",
      marker: "## Routing Decision",
      description: "New Project routing decision section",
    },
    {
      file: "run-planning.md",
      marker: "Placeholder-only files are not sufficient",
      description: "New Project useful scaffold guard",
    },
  ],
  relationships: [
    {
      file: "AGENT.md",
      marker: "Relationships owns relationship-status triage and planning",
      description: "Relationships parent surface ownership",
    },
    {
      file: "run-interview.md",
      marker: "finding a romantic partner",
      description: "Relationships starting-position adaptation",
    },
    {
      file: "run-interview.md",
      marker: "Treat information about other people as owner-provided context",
      description: "Relationships privacy-of-others boundary",
    },
    {
      file: "plan.md",
      marker: "## Review Status",
      description: "Relationships review status section",
    },
    {
      file: "run-planning.md",
      marker: "Keep all execution work at the page level as a manual step",
      description: "Relationships page-level execution boundary",
    },
  ],
};

export async function lintDraft3MemoryStarterPack(starterPackRoot: string): Promise<Draft3MemoryLintResult> {
  const errors: string[] = [];

  if (!existsSync(path.join(starterPackRoot, "base", "me", "profile.md"))) {
    errors.push("Missing required cross-project profile template: base/me/profile.md");
  }

  const baseAgent = await readOptional(path.join(starterPackRoot, "base", "AGENT.md"));
  if (baseAgent !== null && /powered by|what model you are/i.test(baseAgent)) {
    errors.push("base/AGENT.md must stay model-agnostic");
  }

  for (const legacyId of ROOT_AGENT_LEGACY_IDS) {
    if (existsSync(path.join(starterPackRoot, "projects", "templates", legacyId))) {
      errors.push(`Legacy root agent slug must not be scaffolded as a normal project template: ${legacyId}`);
    }
  }

  const rootAgentTemplateRoot = path.join(starterPackRoot, "projects", "templates", ROOT_AGENT_CANONICAL_ID);
  if (!existsSync(path.join(rootAgentTemplateRoot, "AGENT.md"))) {
    errors.push(`Missing required root agent template file: ${ROOT_AGENT_CANONICAL_ID}/AGENT.md`);
  }
  for (const file of ROOT_AGENT_FORBIDDEN_TEMPLATE_FILES) {
    if (existsSync(path.join(rootAgentTemplateRoot, file))) {
      errors.push(`Root agent must not be scaffolded as a normal project template: ${ROOT_AGENT_CANONICAL_ID}/${file}`);
    }
  }

  const projectSeeds = await readOptional(path.join(starterPackRoot, "projects", "projects.seed.json"));
  if (projectSeeds !== null) {
    const seededProjectIds = parseProjectSeedIds(projectSeeds);
    if (seededProjectIds === null) {
      errors.push("projects.seed.json must be a JSON array of project seed objects");
    }
    for (const projectId of DEFAULT_PAGE_PROJECT_IDS) {
      if (seededProjectIds !== null && !seededProjectIds.has(projectId)) {
        errors.push(`Missing default page project seed: ${projectId}`);
      }
    }
  }

  for (const file of BUILDER_ONLY_STARTER_SKILLS) {
    if (existsSync(path.join(starterPackRoot, "skills", file))) {
      errors.push(`Builder-only skill must not be seeded in owner starter pack: skills/${file}`);
    }
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

    if (PAGE_JOURNAL_PROJECT_IDS.includes(projectId as typeof PAGE_JOURNAL_PROJECT_IDS[number])) {
      for (const file of JOURNAL_PROJECT_FILES) {
        if (!existsSync(path.join(projectRoot, file))) {
          errors.push(`Missing required journal template file: ${projectId}/${file}`);
        }
      }

      for (const file of STALE_JOURNAL_PROJECT_PATHS) {
        if (existsSync(path.join(projectRoot, file))) {
          errors.push(`Stale nested journal template file must be removed: ${projectId}/${file}`);
        }
      }

      const journalProcedure = await readOptional(path.join(projectRoot, "run-journal.md"));
      if (journalProcedure !== null && !/^## Preservation Rule\s*$/m.test(journalProcedure)) {
        errors.push(`Procedure is missing Preservation Rule: ${projectId}/run-journal.md`);
      }

      const journalState = await readOptional(path.join(projectRoot, "journal.md"));
      if (journalState !== null && !/^# Your(?: .+)? Journal\s*$/m.test(journalState)) {
        errors.push(`Journal state template must be owner-facing: ${projectId}/journal.md`);
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

  for (const requirement of FINANCE_REQUIRED_MARKERS) {
    const content = await readOptional(path.join(financeRoot, requirement.file));
    if (content !== null && !content.includes(requirement.marker)) {
      errors.push(`Finance template missing ${requirement.description}: ${requirement.file}`);
    }
  }

  for (const [projectId, requirements] of Object.entries(SURFACE_REQUIRED_MARKERS)) {
    const projectRoot = path.join(starterPackRoot, "projects", "templates", projectId);
    for (const requirement of requirements) {
      const content = await readOptional(path.join(projectRoot, requirement.file));
      if (content !== null && !content.includes(requirement.marker)) {
        errors.push(`${projectId} template missing ${requirement.description}: ${requirement.file}`);
      }
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

function parseProjectSeedIds(raw: string): Set<string> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const ids = new Set<string>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const id = (entry as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim().length > 0) {
        ids.add(id.trim());
      }
    }
    return ids;
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
