import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { initializeMemoryLayout, scaffoldProjectFiles } from "./init.js";

type TestProjectManifestEntry = {
  id: string;
  name: string;
  icon: string;
  conversation_id: string | null;
  default_skill_ids: string[];
};

async function readProjectsManifest(memoryRoot: string): Promise<TestProjectManifestEntry[]> {
  return JSON.parse(await readFile(path.join(memoryRoot, "documents", "projects.json"), "utf8")) as TestProjectManifestEntry[];
}

describe("memory init project scaffolding", () => {
  it("scaffolds Draft 3 life-area layouts without legacy app or source folders", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-index-test-"));
    const rootDir = path.resolve(".");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await initializeMemoryLayout(rootDir, memoryRoot, {
        seedStarterSkills: false,
      });

      await expect(readFile(path.join(memoryRoot, "me", "profile.md"), "utf8"))
        .resolves.toContain("# Your Profile");
      const projectsManifest = await readProjectsManifest(memoryRoot);
      expect(projectsManifest[0]).toMatchObject({
        id: "your-agent",
        name: "Your Agent",
      });
      expect(projectsManifest.map((project) => project.id)).toEqual([
        "your-agent",
        "finance",
        "fitness",
        "career",
        "relationships",
        "new-project",
      ]);
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "AGENT.md"), "utf8"))
        .resolves.toContain("# Your Agent - Agent Context");
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "spec.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "run-interview.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "plan.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "run-planning.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "career", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "relationships", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "career", "run-interview.md"), "utf8"))
        .resolves.toContain("# Career Interview");
      await expect(readFile(path.join(memoryRoot, "documents", "career", "run-planning.md"), "utf8"))
        .resolves.toContain("# Career Planning");
      await expect(readFile(path.join(memoryRoot, "documents", "relationships", "run-interview.md"), "utf8"))
        .resolves.toContain("# Relationships Interview");
      await expect(readFile(path.join(memoryRoot, "documents", "relationships", "run-planning.md"), "utf8"))
        .resolves.toContain("# Relationships Planning");
      await expect(readFile(path.join(memoryRoot, "documents", "relationships", "run-journal.md"), "utf8"))
        .resolves.toContain("# Relationships Journal");
      await expect(readFile(path.join(memoryRoot, "documents", "relationships", "journal", "AGENT.md"), "utf8"))
        .resolves.toContain("# Relationships Journal - Agent Context");
      await expect(readFile(path.join(memoryRoot, "documents", "relationships", "journal", "journal.md"), "utf8"))
        .resolves.toContain("# Your Journal");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "run-interview.md"), "utf8"))
        .resolves.toContain("# Fitness Interview");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "run-planning.md"), "utf8"))
        .resolves.toContain("# Fitness Planning");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "run-journal.md"), "utf8"))
        .resolves.toContain("# Fitness Journal");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "journal", "AGENT.md"), "utf8"))
        .resolves.toContain("# Fitness Journal - Agent Context");
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "journal", "journal.md"), "utf8"))
        .resolves.toContain("# Your Journal");
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "run-journal.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "career", "run-journal.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "new-project", "run-journal.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "AGENT-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "run-interview-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "run-planning-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "AGENT.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "budget-rules.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "create.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "compare.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "fitness", "health-docs", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "finance", "budget", "statements", "README.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "AGENT-user.md"), "utf8"))
        .rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("seeds only owner-facing starter skills by default", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-skills-test-"));
    const rootDir = path.resolve(".");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await initializeMemoryLayout(rootDir, memoryRoot);

      await expect(readFile(path.join(memoryRoot, "skills", "interview", "SKILL.md"), "utf8"))
        .resolves.toContain("active BrainDrive page");
      await expect(readFile(path.join(memoryRoot, "skills", "feature-spec", "SKILL.md"), "utf8"))
        .resolves.toContain("active page's `spec.md`");
      await expect(readFile(path.join(memoryRoot, "skills", "plan", "SKILL.md"), "utf8"))
        .resolves.toContain("active page's `plan.md`");
      await expect(readFile(path.join(memoryRoot, "skills", "landscape", "SKILL.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "skills", "test-plan", "SKILL.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "skills", "milestone-check", "SKILL.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "skills", "smoke-test", "SKILL.md"), "utf8"))
        .rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("migrates a legacy-only root agent manifest while preserving state and files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-root-agent-legacy-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "braindrive-plus-one"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        `${JSON.stringify([
          {
            id: "braindrive-plus-one",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: "conversation-legacy",
            default_skill_ids: ["interview"],
          },
        ], null, 2)}\n`,
        "utf8"
      );
      await writeFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "# Legacy Agent\n", "utf8");

      await initializeMemoryLayout(rootDir, memoryRoot, {
        seedStarterSkills: false,
      });

      const projectsManifest = await readProjectsManifest(memoryRoot);
      expect(projectsManifest).toHaveLength(1);
      expect(projectsManifest[0]).toMatchObject({
        id: "your-agent",
        name: "Your Agent",
        icon: "sparkles",
        conversation_id: "conversation-legacy",
        default_skill_ids: ["interview"],
      });
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "AGENT.md"), "utf8"))
        .resolves.toBe("# Legacy Agent\n");
      await expect(readFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "utf8"))
        .resolves.toBe("# Legacy Agent\n");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("removes an unused legacy root agent project entry when the canonical root agent exists", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-your-agent-cleanup-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "your-agent"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        `${JSON.stringify([
          {
            id: "braindrive-plus-one",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: null,
            default_skill_ids: [],
          },
          {
            id: "your-agent",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: null,
            default_skill_ids: [],
          },
        ], null, 2)}\n`,
        "utf8"
      );
      await writeFile(path.join(memoryRoot, "documents", "your-agent", "AGENT.md"), "# Preserved\n", "utf8");

      await initializeMemoryLayout(rootDir, memoryRoot, {
        seedStarterSkills: false,
      });

      const projectsManifest = await readProjectsManifest(memoryRoot);
      expect(projectsManifest.map((project) => project.id)).toEqual(["your-agent"]);
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "AGENT.md"), "utf8"))
        .resolves.toBe("# Preserved\n");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves root agent conversation state when duplicate root agent entries exist", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-your-agent-preserve-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        `${JSON.stringify([
          {
            id: "braindrive-plus-one",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: null,
            default_skill_ids: [],
          },
          {
            id: "your-agent",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: "conversation-1",
            default_skill_ids: [],
          },
        ], null, 2)}\n`,
        "utf8"
      );

      await initializeMemoryLayout(rootDir, memoryRoot, {
        seedStarterSkills: false,
      });

      const projectsManifest = await readProjectsManifest(memoryRoot);
      expect(projectsManifest.map((project) => project.id)).toEqual(["your-agent"]);
      expect(projectsManifest[0]?.conversation_id).toBe("conversation-1");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves conflicting duplicate root agent entries for manual review", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-your-agent-conflict-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        `${JSON.stringify([
          {
            id: "braindrive-plus-one",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: "conversation-legacy",
            default_skill_ids: ["interview"],
          },
          {
            id: "your-agent",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: "conversation-canonical",
            default_skill_ids: ["plan"],
          },
        ], null, 2)}\n`,
        "utf8"
      );

      const summary = await initializeMemoryLayout(rootDir, memoryRoot, {
        seedStarterSkills: false,
      });

      const projectsManifest = await readProjectsManifest(memoryRoot);
      expect(projectsManifest.map((project) => project.id)).toEqual(["your-agent", "braindrive-plus-one"]);
      expect(projectsManifest[0]?.conversation_id).toBe("conversation-canonical");
      expect(projectsManifest[1]?.conversation_id).toBe("conversation-legacy");
      expect(summary.warnings.some((warning) => warning.includes("Conflicting root agent conversation ids"))).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves divergent root agent folders for manual review", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-init-your-agent-folder-conflict-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await mkdir(path.join(memoryRoot, "documents", "braindrive-plus-one"), { recursive: true });
      await mkdir(path.join(memoryRoot, "documents", "your-agent"), { recursive: true });
      await writeFile(
        path.join(memoryRoot, "documents", "projects.json"),
        `${JSON.stringify([
          {
            id: "braindrive-plus-one",
            name: "Your Agent",
            icon: "sparkles",
            conversation_id: null,
            default_skill_ids: [],
          },
        ], null, 2)}\n`,
        "utf8"
      );
      await writeFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "# Legacy Agent\n", "utf8");
      await writeFile(path.join(memoryRoot, "documents", "your-agent", "AGENT.md"), "# Canonical Agent\n", "utf8");

      const summary = await initializeMemoryLayout(rootDir, memoryRoot, {
        seedStarterSkills: false,
      });

      const projectsManifest = await readProjectsManifest(memoryRoot);
      expect(projectsManifest.map((project) => project.id)).toEqual(["your-agent"]);
      await expect(readFile(path.join(memoryRoot, "documents", "braindrive-plus-one", "AGENT.md"), "utf8"))
        .resolves.toBe("# Legacy Agent\n");
      await expect(readFile(path.join(memoryRoot, "documents", "your-agent", "AGENT.md"), "utf8"))
        .resolves.toBe("# Canonical Agent\n");
      expect(summary.warnings.some((warning) => warning.includes("Preserved divergent root agent folders"))).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("scaffolds architecture-aligned files for newly created custom projects", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memory-scaffold-project-test-"));
    const rootDir = path.join(tempRoot, "repo");
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await scaffoldProjectFiles(rootDir, memoryRoot, "home-renovation", "Home Renovation");

      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "index.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "AGENT.md"), "utf8"))
        .resolves.toContain("# Home Renovation");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "spec.md"), "utf8"))
        .resolves.toContain("# Home Renovation Spec");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "run-interview.md"), "utf8"))
        .resolves.toContain("# Home Renovation Interview");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "plan.md"), "utf8"))
        .resolves.toContain("# Home Renovation Plan");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "run-planning.md"), "utf8"))
        .resolves.toContain("# Home Renovation Planning");
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "AGENT-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "run-interview-user.md"), "utf8"))
        .rejects.toThrow();
      await expect(readFile(path.join(memoryRoot, "documents", "home-renovation", "run-planning-user.md"), "utf8"))
        .rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
