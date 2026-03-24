import path from "node:path";

import { initializeMemoryLayout, type MemoryInitOptions, type MemoryInitProfile } from "../memory/init.js";

type CliOptions = {
  memoryRoot: string;
  initOptions: MemoryInitOptions;
};

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const memoryRoot = path.resolve(rootDir, parsed.memoryRoot);

  const summary = await initializeMemoryLayout(rootDir, memoryRoot, parsed.initOptions);
  printSummary(memoryRoot, summary);
}

function parseArgs(argv: string[]): CliOptions {
  const initOptions: MemoryInitOptions = {};
  let memoryRoot = process.env.PAA_MEMORY_ROOT?.trim() || "./your-memory";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--memory-root": {
        const value = argv[index + 1];
        if (!value) {
          throw new Error("Missing value for --memory-root");
        }
        memoryRoot = value;
        index += 1;
        break;
      }
      case "--profile": {
        const value = argv[index + 1];
        if (!value) {
          throw new Error("Missing value for --profile");
        }
        initOptions.profile = normalizeProfile(value);
        index += 1;
        break;
      }
      case "--seed-default-projects":
        initOptions.seedDefaultProjects = true;
        break;
      case "--no-seed-default-projects":
        initOptions.seedDefaultProjects = false;
        break;
      case "--force":
        initOptions.force = true;
        break;
      case "--dry-run":
        initOptions.dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    memoryRoot,
    initOptions,
  };
}

function normalizeProfile(value: string): MemoryInitProfile {
  const normalized = value.trim().toLowerCase();
  if (normalized === "local-dev") {
    return "local-dev";
  }
  if (normalized === "openrouter-secret-ref") {
    return "openrouter-secret-ref";
  }
  throw new Error(`Unsupported profile: ${value}`);
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  npm run memory:init -- [options]",
      "",
      "Options:",
      "  --memory-root <path>            Target memory root (default: PAA_MEMORY_ROOT or ./your-memory)",
      "  --profile <local-dev|openrouter-secret-ref>",
      "  --seed-default-projects         Seed default onboarding projects (default behavior)",
      "  --no-seed-default-projects      Skip default project seeding",
      "  --force                         Allow force updates where supported",
      "  --dry-run                       Report planned changes without writing",
      "  --help, -h                      Show help",
      "",
    ].join("\n")
  );
}

function printSummary(
  memoryRoot: string,
  summary: {
    profile: MemoryInitProfile;
    dry_run: boolean;
    starter_pack_dir: string | null;
    created: string[];
    updated: string[];
    skipped: string[];
    warnings: string[];
    seeded_projects: string[];
    seeded_skills: string[];
    skipped_skills: string[];
  }
): void {
  process.stdout.write(`Memory root: ${memoryRoot}\n`);
  process.stdout.write(`Profile: ${summary.profile}\n`);
  process.stdout.write(`Dry run: ${summary.dry_run}\n`);
  process.stdout.write(`Starter pack: ${summary.starter_pack_dir ?? "not found"}\n`);
  process.stdout.write(`Created: ${summary.created.length}\n`);
  process.stdout.write(`Updated: ${summary.updated.length}\n`);
  process.stdout.write(`Skipped: ${summary.skipped.length}\n`);
  process.stdout.write(`Seeded projects: ${summary.seeded_projects.length}\n`);
  process.stdout.write(`Seeded skills: ${summary.seeded_skills.length}\n`);
  process.stdout.write(`Skipped skills: ${summary.skipped_skills.length}\n`);

  if (summary.warnings.length > 0) {
    process.stdout.write("Warnings:\n");
    for (const warning of summary.warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
