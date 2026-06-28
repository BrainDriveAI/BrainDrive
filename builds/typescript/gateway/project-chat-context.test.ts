import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildProjectConversationGuard,
  buildProjectChatContext,
} from "./server.js";

describe("project chat context", () => {
  it("includes current project files and Finance parent-project guidance without Budget app instructions", () => {
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
    expect(context).toContain("documents/finance/dummy-statement.md");
    expect(context).toContain("For Finance project alignment, use documents/finance/AGENT.md, AGENT-user.md if present, spec.md, plan.md, run-interview.md, and run-planning.md.");
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
    expect(context).toContain("The project has documents/finance/spec.md and documents/finance/plan.md files");
    expect(context).toContain("Follow this project's AGENT.md and run-interview.md");
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

  it("describes project artifacts without forcing starter project write timing", () => {
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
    expect(context).toContain("The project has documents/career/spec.md and documents/career/plan.md files");
    expect(context).toContain("Follow this project's AGENT.md and run-interview.md");
    expect(context).not.toContain("Once the owner provides usable facts");
    expect(context).not.toContain("Do not wait for a perfect interview");
    expect(context).not.toContain("mark uncertainty");
    expect(context).not.toContain("tell the owner what changed");
  });

  it("adds a current-turn guard for repeated missing context during project interviews", () => {
    const guard = buildProjectConversationGuard("fitness", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "I want to get active again.",
          timestamp: "2026-06-12T00:00:00.000Z",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "The missing context I need is your current activity baseline: what does a typical week look like?",
          timestamp: "2026-06-12T00:00:01.000Z",
        },
        {
          id: "user-2",
          role: "user",
          content: "Walking is usually okay.",
          timestamp: "2026-06-12T00:00:02.000Z",
        },
      ],
    });

    expect(guard).toContain("## Current Turn Interview Guard");
    expect(guard).toContain("your current activity baseline");
    expect(guard).toContain("Do not ask the same missing-context label again");
    expect(guard).toContain("record the earlier detail as unknown");
  });

  it("adds a current-turn guard for repeated exact interview questions", () => {
    const guard = buildProjectConversationGuard("fitness", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "I can do about three short workouts a week.",
          timestamp: "2026-06-12T00:00:00.000Z",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Running history: have you run before, and if so, what's the longest you've run continuously in recent months?",
          timestamp: "2026-06-12T00:00:01.000Z",
        },
        {
          id: "user-2",
          role: "user",
          content: "I sit most of the day and lose motivation when plans get too intense.",
          timestamp: "2026-06-12T00:00:02.000Z",
        },
      ],
    });

    expect(guard).toContain("You already asked these exact questions");
    expect(guard).toContain("what's the longest you've run continuously");
    expect(guard).toContain("Do not ask the same question again");
    expect(guard).toContain("mark it unknown");
  });

  it("does not force artifact writes when the owner gives a success criterion", () => {
    const guard = buildProjectConversationGuard("fitness", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Success is feeling consistent and not wiped out.",
          timestamp: "2026-06-12T00:00:00.000Z",
        },
      ],
    });

    expect(guard).not.toContain("Update documents/fitness/spec.md");
    expect(guard).not.toContain("documents/fitness/plan.md with known facts");
    expect(guard).not.toContain("no-question summary");
  });

  it("does not add Fitness-specific runtime behavior for concrete outcome phrases", () => {
    const guard = buildProjectConversationGuard("fitness", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "I want more energy, some strength, and to jog a 5K this fall.",
          timestamp: "2026-06-12T00:00:00.000Z",
        },
      ],
    });

    expect(guard).toBe("");
  });

  it("does not add Fitness-specific runtime behavior when an adjacent constraint answers a workout-details question", () => {
    const guard = buildProjectConversationGuard("fitness", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "I can do about three short workouts a week.",
          timestamp: "2026-06-12T00:00:00.000Z",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Three short workouts. What do those workouts usually look like?",
          timestamp: "2026-06-12T00:00:01.000Z",
        },
        {
          id: "user-2",
          role: "user",
          content: "I sit most of the day and usually lose motivation when plans get too intense.",
          timestamp: "2026-06-12T00:00:02.000Z",
        },
      ],
    });

    expect(guard).toContain("You already asked these exact questions");
    expect(guard).toContain("What do those workouts usually look like?");
    expect(guard).not.toContain("Fitness-specific guard");
    expect(guard).not.toContain("plans get too intense");
    expect(guard).not.toContain("mark workout composition and duration unknown");
    expect(guard).not.toContain("do not ask the workout-details question again");
  });

  it("adds a Career guard for adjacent constraint answers", () => {
    const guard = buildProjectConversationGuard("career", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "What target title, industry, timeline, and proof worry should we plan around?",
          timestamp: "2026-06-12T00:00:01.000Z",
        },
        {
          id: "user-1",
          role: "user",
          content: "I make $62K, cannot take a pay cut, and have five hours a week.",
          timestamp: "2026-06-12T00:00:02.000Z",
        },
      ],
    });

    expect(guard).toContain("Career-specific guard");
    expect(guard).toContain("no-pay-cut");
    expect(guard).toContain("do not repeat the same broad setup question");
  });

  it("adds a Finance guard for adjacent account and budget answers", () => {
    const guard = buildProjectConversationGuard("finance", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "The missing context I need is your income: what is your take-home pay?",
          timestamp: "2026-06-12T00:00:01.000Z",
        },
        {
          id: "user-1",
          role: "user",
          content: "I need this Roth IRA plan to fit my monthly budget.",
          timestamp: "2026-06-12T00:00:02.000Z",
        },
      ],
    });

    expect(guard).toContain("Finance-specific guard");
    expect(guard).toContain("Roth");
    expect(guard).toContain("do not repeat the same finance intake question");
  });

  it("adds a Finance guard to mirror every money amount", () => {
    const guard = buildProjectConversationGuard("finance", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "I make about $62K and bring home around $3,800 a month.",
          timestamp: "2026-06-12T00:00:00.000Z",
        },
      ],
    });

    expect(guard).toContain("Finance-specific guard");
    expect(guard).toContain("$62K");
    expect(guard).toContain("$3,800 a month");
    expect(guard).toContain("Mirror every amount back");
  });

  it("does not add a Finance runtime deferral after embarrassment or avoidance", () => {
    const guard = buildProjectConversationGuard("finance", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "I am embarrassed and I have avoided looking closely for a while.",
          timestamp: "2026-06-12T00:00:00.000Z",
        },
      ],
    });

    expect(guard).not.toContain("large budget worksheet");
    expect(guard).not.toContain("Mark the detailed monthly expense breakdown unknown");
    expect(guard).not.toContain("small first step");
    expect(guard).not.toContain("gathering statements or rough estimates");
  });

  it("does not treat success would be as a runtime artifact-writing stop point", () => {
    const guard = buildProjectConversationGuard("finance", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Success would be knowing my first money step this week and what information to gather next.",
          timestamp: "2026-06-12T00:00:00.000Z",
        },
      ],
    });

    expect(guard).not.toContain("Update documents/finance/spec.md");
    expect(guard).not.toContain("documents/finance/plan.md with known facts");
    expect(guard).not.toContain("Preserve the owner's exact success wording");
    expect(guard).not.toContain("must contain zero question marks");
  });

  it("adds a Relationships guard for broad relationship-area repeats", () => {
    const guard = buildProjectConversationGuard("relationships", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Which relationship area matters most: family, friends, or dating?",
          timestamp: "2026-06-12T00:00:01.000Z",
        },
        {
          id: "user-1",
          role: "user",
          content: "I mostly feel disconnected and want to feel better without overreaching.",
          timestamp: "2026-06-12T00:00:02.000Z",
        },
      ],
    });

    expect(guard).toContain("Relationships-specific guard");
    expect(guard).toContain("mirror the owner's relationship area");
    expect(guard).toContain("do not repeat the same broad relationship-area question");
  });

  it("adds New Project and Your Agent guards for concrete scope and control boundaries", () => {
    const newProjectGuard = buildProjectConversationGuard("new-project", {
      id: "conversation-1",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "The missing context I need is growing space: where will this garden go?",
          timestamp: "2026-06-12T00:00:01.000Z",
        },
        {
          id: "user-1",
          role: "user",
          content: "The Backyard Garden should grow tomatoes, herbs, and peppers with a $300 budget.",
          timestamp: "2026-06-12T00:00:02.000Z",
        },
      ],
    });
    const yourAgentGuard = buildProjectConversationGuard("your-agent", {
      id: "conversation-2",
      title: null,
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "What capabilities, tools, pages, and workflow should your agent support?",
          timestamp: "2026-06-12T00:00:01.000Z",
        },
        {
          id: "user-1",
          role: "user",
          content: "I want approval before any cross-page routing and privacy boundaries for sensitive topics.",
          timestamp: "2026-06-12T00:00:02.000Z",
        },
      ],
    });

    expect(newProjectGuard).toContain("New Project-specific guard");
    expect(newProjectGuard).toContain("Preserve project names");
    expect(newProjectGuard).toContain("do not repeat the same project setup question");
    expect(yourAgentGuard).toContain("Your Agent-specific guard");
    expect(yourAgentGuard).toContain("approval");
    expect(yourAgentGuard).toContain("do not repeat the same setup question");
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
