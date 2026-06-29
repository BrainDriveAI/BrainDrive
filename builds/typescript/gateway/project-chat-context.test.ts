import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildProjectChatContext,
} from "./server.js";

const forbiddenRuntimeInterviewPhrases = [
  "## Current Turn Interview Guard",
  "Do not ask the same missing-context label again",
  "record the earlier detail as unknown",
  "Do not ask the same question again",
  "mark it unknown",
  "ask exactly one question",
  "at most one question mark",
  "Career-specific guard",
  "Finance-specific guard",
  "Relationships-specific guard",
  "New Project-specific guard",
  "Your Agent-specific guard",
  "product marketing",
  "marketing coordinator",
  "vegetable garden",
  "tomatoes",
  "herbs",
  "peppers",
];

const forbiddenProjectShapePhrases = [
  "For Finance project alignment",
  "The project has documents/finance/spec.md and documents/finance/plan.md files",
  "The project has documents/career/spec.md and documents/career/plan.md files",
  "Follow this project's AGENT.md and run-interview.md",
  "followed by spec.md and plan.md",
];

function expectNoRuntimeInterviewBehavior(content: string): void {
  for (const phrase of forbiddenRuntimeInterviewPhrases) {
    expect(content).not.toContain(phrase);
  }
}

function expectNoHardcodedProjectShape(content: string): void {
  for (const phrase of forbiddenProjectShapePhrases) {
    expect(content).not.toContain(phrase);
  }
}

describe("project chat context", () => {
  it("includes neutral current project files without Finance-specific project-shape guidance", () => {
    const context = buildProjectChatContext("finance", [
      {
        name: "dummy-statement.md",
        path: "documents/finance/dummy-statement.md",
      },
      {
        name: "plan.md",
        path: "documents/finance/plan.md",
      },
      {
        name: "run-interview.md",
        path: "documents/finance/run-interview.md",
      },
    ]);

    expect(context).toContain("## Active Project");
    expect(context).toContain("You are currently in the **finance** project.");
    expect(context).toContain("Read AGENT.md first if present, then AGENT-user.md if present.");
    expect(context).toContain("Use this project's other instruction files according to its AGENT.md.");
    expect(context).toContain("documents/finance/dummy-statement.md");
    expect(context).not.toContain("documents/finance/budget");
    expect(context).not.toContain("budget/statements");
    expect(context).not.toContain("reports/latest.md");
    expect(context).not.toContain("Draft 3 app folders");
    expect(context).not.toContain("saved-budget comparison");
    expect(context).not.toContain("Budget report");
    expect(context).not.toContain("Owner-Requested Items Audit");
    expect(context).toContain("current file list at the start of this user turn");
    expect(context).toContain("Do not rely on earlier conversation claims");
    expect(context).toContain("call memory_delete when a matching file exists");
    expectNoHardcodedProjectShape(context);
    expect(context).not.toContain("Once the owner provides usable facts");
    expect(context).not.toContain("Do not wait for a perfect interview before writing durable state");
    expect(context).not.toContain("do not only answer in chat");
    expect(context).not.toContain("update documents/finance/spec.md and/or documents/finance/plan.md");
  });

  it("does not include retired Budget archive files in default Finance chat context", () => {
    const context = buildProjectChatContext("finance", [
      {
        name: "archive/retired-budget/budget.md",
        path: "documents/finance/archive/retired-budget/budget.md",
      },
      {
        name: "archive/retired-budget/statements/may.md",
        path: "documents/finance/archive/retired-budget/statements/may.md",
      },
      {
        name: "plan.md",
        path: "documents/finance/plan.md",
      },
    ]);

    expect(context).toContain("documents/finance/plan.md");
    expect(context).not.toContain("documents/finance/archive/retired-budget");
    expect(context).not.toContain("statements/may.md");
  });

  it("describes a project neutrally without universal spec, plan, or runbook assumptions", () => {
    const context = buildProjectChatContext("career", [
      {
        name: "AGENT.md",
        path: "documents/career/AGENT.md",
      },
      {
        name: "spec.md",
        path: "documents/career/spec.md",
      },
      {
        name: "plan.md",
        path: "documents/career/plan.md",
      },
      {
        name: "run-interview.md",
        path: "documents/career/run-interview.md",
      },
      {
        name: "run-planning.md",
        path: "documents/career/run-planning.md",
      },
    ]);

    expect(context).toContain("You are currently in the **career** project.");
    expect(context).toContain("Read AGENT.md first if present, then AGENT-user.md if present.");
    expect(context).toContain("Use this project's other instruction files according to its AGENT.md.");
    expect(context).toContain("documents/career/spec.md");
    expect(context).toContain("documents/career/plan.md");
    expect(context).toContain("documents/career/run-interview.md");
    expect(context).toContain("documents/career/run-planning.md");
    expectNoHardcodedProjectShape(context);
    expect(context).not.toContain("Once the owner provides usable facts");
    expect(context).not.toContain("Do not wait for a perfect interview");
    expect(context).not.toContain("mark uncertainty");
    expect(context).not.toContain("tell the owner what changed");
  });

  it("keeps runtime interview behavior out of gateway prompt code", () => {
    const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

    expect(serverSource).not.toContain("buildProjectConversationGuard");
    expect(serverSource).not.toContain("buildProjectSpecificTurnGuard");
    expectNoRuntimeInterviewBehavior(serverSource);
    expectNoHardcodedProjectShape(serverSource);
  });

  it("does not keep runtime starter artifact snapshot auto-write code", () => {
    const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

    expect(serverSource).not.toContain("persistStarterProjectArtifactSnapshots");
    expect(serverSource).not.toContain("persistStarterProjectArtifactSnapshot");
    expect(serverSource).not.toContain("starterSnapshotProjectIds");
    expect(serverSource).not.toContain("buildStarterProjectArtifactSnapshot");
    expect(serverSource).not.toContain("buildStarterDerivedAnchors");
    expect(serverSource).not.toContain("mergeStarterProjectArtifactSnapshot");
    expect(serverSource).not.toContain("project.artifact_snapshot");
    expect(serverSource).not.toContain("project.artifact_snapshot_after_reply");
    expect(serverSource).not.toContain("BrainDrive starter owner snapshot");
    expect(serverSource).not.toContain("Owner Conversation Snapshot");
    expect(serverSource).not.toContain("Derived Starter Anchors");
    expect(serverSource).not.toContain("Starter Plan Snapshot");
    expect(serverSource).not.toContain("Katie");
  });

  it("does not add app-scope context for nested project folders", () => {
    const context = buildProjectChatContext("finance", [
      {
        name: "AGENT.md",
        path: "documents/finance/AGENT.md",
      },
      {
        name: "budget/AGENT.md",
        path: "documents/finance/budget/AGENT.md",
      },
      {
        name: "budget/AGENT-user.md",
        path: "documents/finance/budget/AGENT-user.md",
      },
      {
        name: "budget/budget.md",
        path: "documents/finance/budget/budget.md",
      },
      {
        name: "budget/budget-rules.md",
        path: "documents/finance/budget/budget-rules.md",
      },
      {
        name: "budget/budget-rules-user.md",
        path: "documents/finance/budget/budget-rules-user.md",
      },
      {
        name: "budget/statements/2026-05-card.md",
        path: "documents/finance/budget/statements/2026-05-card.md",
      },
      {
        name: "budget/reports/latest.md",
        path: "documents/finance/budget/reports/latest.md",
      },
    ]);

    expect(context).not.toContain("### Active App Scope");
    expect(context).not.toContain("focused on the app folder documents/finance/budget/");
    expect(context).not.toContain("Treat documents/finance/budget/budget.md as this app's owner state file");
    expect(context).not.toContain("Use documents/finance/budget/statements/ as app source evidence");
    expect(context).not.toContain("Use documents/finance/budget/reports/ for app-generated reports");
  });
});
