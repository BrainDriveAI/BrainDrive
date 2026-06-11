import { describe, expect, it, vi } from "vitest";

import {
  buildStarterProjectArtifactSnapshot,
  buildProjectChatContext,
  createBrainDriveMemorySafetyGuard,
  conversationHasSavedBudgetComparison,
  createFinanceBudgetProtectionGuard,
  isProtectedFinanceBudgetMutation,
  mergeStarterProjectArtifactSnapshot,
  starterSnapshotProjectIds,
} from "./server.js";
import type { ConversationDetail } from "../contracts.js";

describe("project chat context", () => {
  it("includes current project files and warns against stale delete claims", () => {
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
        name: "AGENT.md",
        path: "documents/finance/budget/AGENT.md",
      },
      {
        name: "budget.md",
        path: "documents/finance/budget/budget.md",
      },
      {
        name: "budget-rules.md",
        path: "documents/finance/budget/budget-rules.md",
      },
    ]);

    expect(context).toContain("## Active Project");
    expect(context).toContain("documents/finance/dummy-statement.md");
    expect(context).toContain("Read documents/finance/AGENT.md, then documents/finance/AGENT-user.md if present");
    expect(context).toContain("read documents/finance/budget/AGENT.md, then documents/finance/budget/AGENT-user.md if present");
    expect(context).toContain("read documents/finance/budget/budget.md, documents/finance/budget/budget-rules.md, and documents/finance/budget/budget-rules-user.md");
    expect(context).toContain("do not rely on documents/finance/index.md, documents/finance/rules.md, or documents/finance/budgeting/");
    expect(context).toContain("complete the Finance task before coaching or cross-domain discussion");
    expect(context).toContain("attach files in chat or use the visible upload button");
    expect(context).toContain("Do not ask the owner to manually place files into documents/finance");
    expect(context).toContain("treat documents/finance/budget/budget.md as the saved budget");
    expect(context).toContain("Use documents/finance/budget/statements/ as source evidence");
    expect(context).toContain("visible received/missing statement checklist");
    expect(context).toContain("Do not write to documents/finance/budget/budget.md during a saved-budget comparison");
    expect(context).toContain("do not call memory_write, memory_edit, or memory_delete on documents/finance/budget/budget.md");
    expect(context).toContain("Preserve documents/finance/budget/budget.md byte-for-byte");
    expect(context).toContain("formatting-only, table-alignment, whitespace");
    expect(context).toContain("documents/finance/budget/budget.md is read-only for that turn");
    expect(context).toContain("If you are about to write documents/finance/budget/budget.md during a comparison, stop");
    expect(context).toContain("Put saved-budget comparison findings in documents/finance/budget/reports/latest.md");
    expect(context).toContain("Do not write a monthly archive");
    expect(context).toContain("Check for duplicate or overlapping statement evidence");
    expect(context).toContain("build a source evidence ledger");
    expect(context).toContain("locked evidence for the comparison turn");
    expect(context).toContain("verify that every owner-named item found in source statements appears by exact statement description");
    expect(context).toContain("Owner-Requested Items Audit");
    expect(context).toContain("sources checked, exact source match, amount, date, and final report treatment");
    expect(context).toContain("compare the Owner-Requested Items Audit rows against the final report sections");
    expect(context).toContain("account for named merchants");
    expect(context).toContain("date range overlaps the requested month");
    expect(context).toContain("call memory_list on documents/finance/budget and documents/finance/budget/statements");
    expect(context).toContain("do not accept a later conversational guess that it was absent");
    expect(context).toContain("New Or Unbudgeted Items section");
    expect(context).toContain("exact transaction description");
    expect(context).toContain("Budget report summaries must agree with their category tables");
    expect(context).toContain("literal 'Excluded From Expense Totals' section");
    expect(context).toContain("credit-card or debt payments");
    expect(context).toContain("never pause, stop, or redirect unfinished budget");
    expect(context).toContain("current file list at the start of this user turn");
    expect(context).toContain("Do not rely on earlier conversation claims");
    expect(context).toContain("call memory_delete when a matching file exists");
    expect(context).toContain("do not only answer in chat");
    expect(context).toContain("update documents/finance/spec.md and/or documents/finance/plan.md");
    expect(context).toContain("replace placeholder lines like \"To be filled...\"");
    expect(context).toContain("Do not wait for a perfect interview before writing durable state");
  });

  it("requires durable spec and plan writes for non-Finance starter project alignment", () => {
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
    expect(context).toContain("do not only answer in chat");
    expect(context).toContain("Once the owner provides usable facts, update documents/career/spec.md and/or documents/career/plan.md");
    expect(context).toContain("replace placeholder lines like \"To be filled...\"");
    expect(context).toContain("mark uncertainty");
    expect(context).toContain("tell the owner what changed");
  });

  it("builds starter artifact snapshots from owner conversation messages", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("career", conversationWithUserMessages([
      "I am a marketing coordinator making $62K and want to move toward product marketing.",
      "I can spend five hours a week and need no pay cut.",
    ]));

    expect(snapshot?.spec).toContain("marketing coordinator");
    expect(snapshot?.spec).toContain("$62K");
    expect(snapshot?.spec).toContain("product marketing");
    expect(snapshot?.plan).toContain("First action this week");
    expect(snapshot?.plan).toContain("Proof points");
    expect(snapshot?.plan).toContain("five hours a week");
  });

  it("routes Your Agent starter snapshots to the detected owning page", () => {
    const conversation = conversationWithUserMessages([
      "I want to use Your Agent instead of deciding which page to open first.",
      "The area is Career: I am deciding whether to push toward product marketing or improve my current role first.",
      "If you create or update artifacts, tell me the owner-facing page and artifact to review.",
    ]);

    expect(starterSnapshotProjectIds("braindrive-plus-one", conversation)).toEqual([
      "braindrive-plus-one",
      "career",
    ]);
    const snapshot = buildStarterProjectArtifactSnapshot("career", conversation);
    expect(snapshot?.spec).toContain("product marketing");
    expect(snapshot?.plan).toContain("Career page");
    expect(snapshot?.plan).toContain("Proof points");
  });

  it("adds Career starter anchors for vague owner direction", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("career", conversationWithUserMessages([
      "I feel stuck at work and want something better, but I do not really know what that means yet.",
      "I mostly know I do not want to feel this drained.",
      "I want more growth, but I am not sure if that means a new job or a different role.",
      "Money matters, but I do not know what number I need.",
      "I need help sorting out what to look at first.",
    ]));

    expect(snapshot?.spec).toContain("feels stuck");
    expect(snapshot?.spec).toContain("new job or different role");
    expect(snapshot?.spec).toContain("money unknown");
    expect(snapshot?.spec).toContain("Open unknowns");
    expect(snapshot?.plan).toContain("Clarifying questions");
    expect(snapshot?.plan).toContain("First sorting step");
    expect(snapshot?.plan).toContain("Information to gather");
    expect(snapshot?.plan).toContain("Small next action");
  });

  it("adds Fitness starter anchors for vague movement goals", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("fitness", conversationWithUserMessages([
      "I just want to get healthier and move more. I do not know where to start.",
      "I am not doing much right now.",
      "I get overwhelmed by plans that are too intense.",
      "I could probably start with two or three small things a week.",
      "I want to feel like I am making progress without obsessing over it.",
    ]));

    expect(snapshot?.spec).toContain("get healthier and move more");
    expect(snapshot?.spec).toContain("low-current-activity baseline");
    expect(snapshot?.spec).toContain("intense plans");
    expect(snapshot?.plan).toContain("Starter goal");
    expect(snapshot?.plan).toContain("Small first action");
    expect(snapshot?.plan).toContain("two or three times a week");
    expect(snapshot?.plan).toContain("Honest unknowns");
  });

  it("adds Finance starter anchors for Katie's vague debt setup", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("finance", conversationWithUserMessages([
      "I need to get better with money. I do not know where to start.",
      "I have some debt but I do not know the exact number.",
      "I avoid checking because it stresses me out.",
      "I want something simple that gets me unstuck.",
      "I can probably gather balances this week if I know what to look for.",
    ]));

    expect(snapshot?.spec).toContain("get better with money");
    expect(snapshot?.spec).toContain("some debt");
    expect(snapshot?.spec).toContain("avoid checking");
    expect(snapshot?.spec).toContain("simple");
    expect(snapshot?.spec).toContain("gather balances");
    expect(snapshot?.plan).toContain("First checking step");
    expect(snapshot?.plan).toContain("Balances to gather");
    expect(snapshot?.plan).toContain("Small next action");
    expect(snapshot?.plan).toContain("Unknowns");
  });

  it("adds Fitness starter anchors for injury-safety goals", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("fitness", conversationWithUserMessages([
      "I want to get active again, but I had a knee injury a while back and I am nervous about making it worse.",
      "I am not asking for a diagnosis. I just need a safe way to think about next steps.",
      "Walking is usually okay, but running too fast makes me nervous.",
      "I can check with a professional if the plan tells me what to ask.",
      "Success is building confidence without pushing through pain.",
    ]));

    expect(snapshot?.spec).toContain("knee injury");
    expect(snapshot?.spec).toContain("safe next steps");
    expect(snapshot?.spec).toContain("walking");
    expect(snapshot?.spec).toContain("professional input");
    expect(snapshot?.spec).toContain("without pushing through pain");
    expect(snapshot?.plan).toContain("Low-impact first action");
    expect(snapshot?.plan).toContain("Professional input");
    expect(snapshot?.plan).toContain("Pain boundary");
    expect(snapshot?.plan).toContain("Gradual progress");
  });

  it("adds Relationships starter anchors for money conversations", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("relationships", conversationWithUserMessages([
      "I want help improving communication with my boyfriend Evan. We avoid money conversations, and I want a better way to talk without making it feel like a fight.",
      "I feel embarrassed and defensive, so I usually delay the conversation.",
      "Evan is not hostile, but I worry he will think I am irresponsible.",
      "Success would be one honest conversation that does not spiral.",
      "I want to be direct without dumping everything at once.",
    ]));

    expect(snapshot?.spec).toContain("Evan");
    expect(snapshot?.spec).toContain("money conversations");
    expect(snapshot?.spec).toContain("embarrassed");
    expect(snapshot?.spec).toContain("defensive");
    expect(snapshot?.spec).toContain("honest conversation");
    expect(snapshot?.plan).toContain("First conversation step");
    expect(snapshot?.plan).toContain("Boundary");
    expect(snapshot?.plan).toContain("What to say");
    expect(snapshot?.plan).toContain("not assuming Evan's reaction");
  });

  it("adds Relationships starter anchors for vague relationship direction", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("relationships", conversationWithUserMessages([
      "I want my relationships to feel better. I do not really know how to explain it.",
      "I think I feel disconnected from people.",
      "I am not sure if it is family, friends, or dating stuff first.",
      "I avoid bringing things up because I do not want to be too much.",
      "I need help figuring out what to work on first.",
    ]));

    expect(snapshot?.spec).toContain("feel better");
    expect(snapshot?.spec).toContain("disconnected");
    expect(snapshot?.spec).toContain("family, friends, or dating");
    expect(snapshot?.spec).toContain("what to work on first");
    expect(snapshot?.plan).toContain("Clarifying step");
    expect(snapshot?.plan).toContain("Relationship area to choose");
    expect(snapshot?.plan).toContain("Low-pressure first action");
    expect(snapshot?.plan).toContain("Unknowns");
  });

  it("adds Relationships starter anchors for safety-sensitive boundary planning", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("relationships", conversationWithUserMessages([
      "I need help thinking through a relationship boundary, but I am worried because the other person can get intense when I say no.",
      "I do not want to overreact, but I also do not want to ignore the pattern.",
      "I want a plan that helps me stay calm and safe.",
      "I am not ready for a big confrontation.",
      "Success would be knowing what small step to take and what signs mean I should get more support.",
    ]));

    expect(snapshot?.spec).toContain("boundary");
    expect(snapshot?.spec).toContain("gets intense");
    expect(snapshot?.spec).toContain("say no");
    expect(snapshot?.spec).toContain("stay calm and safe");
    expect(snapshot?.spec).toContain("not ready for a big confrontation");
    expect(snapshot?.spec).toContain("more support");
    expect(snapshot?.plan).toContain("Safe small step");
    expect(snapshot?.plan).toContain("Support option");
    expect(snapshot?.plan).toContain("No confrontation pressure");
    expect(snapshot?.plan).toContain("Warning signs");
  });

  it("adds Career starter anchors for burnout and workplace-risk direction", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("career", conversationWithUserMessages([
      "I think I may need to leave my job, but I am burned out and worried about saying too much because there is some workplace tension I do not want spread around.",
      "My manager has been unpredictable, but I do not want to accuse anyone without proof.",
      "I need income stability, so quitting suddenly is not realistic.",
      "I want a plan that helps me protect my energy and options.",
      "I may need to document what is happening, but I do not know what is appropriate.",
    ]));

    expect(snapshot?.spec).toContain("burnout");
    expect(snapshot?.spec).toContain("workplace tension");
    expect(snapshot?.spec).toContain("income stability");
    expect(snapshot?.spec).toContain("protect energy");
    expect(snapshot?.spec).toContain("document what is happening");
    expect(snapshot?.spec).toContain("Open unknowns");
    expect(snapshot?.plan).toContain("Bounded next step");
    expect(snapshot?.plan).toContain("Risk reduction");
    expect(snapshot?.plan).toContain("Support or documentation option");
    expect(snapshot?.plan).toContain("No legal certainty");
  });

  it("merges starter artifact snapshots before the changelog and replaces old snapshots", () => {
    const template = [
      "# Career Spec",
      "",
      "## What You Want",
      "",
      "To be filled through conversation.",
      "",
      "## Changelog",
      "",
      "- Created.",
      "",
    ].join("\n");

    const firstMerge = mergeStarterProjectArtifactSnapshot(template, "### Owner Conversation Snapshot\n\n- Owner turn 1: marketing coordinator");
    const secondMerge = mergeStarterProjectArtifactSnapshot(firstMerge, "### Owner Conversation Snapshot\n\n- Owner turn 1: product marketing");

    expect(firstMerge.indexOf("BrainDrive starter owner snapshot")).toBeLessThan(firstMerge.indexOf("## Changelog"));
    expect(secondMerge).toContain("product marketing");
    expect(secondMerge).not.toContain("marketing coordinator");
    expect(secondMerge.match(/BrainDrive starter owner snapshot: start/g)).toHaveLength(1);
  });

  it("adds app-scope context when client metadata selects an app folder", () => {
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
    ], { appPath: "budget" });

    expect(context).toContain("### Active App Scope");
    expect(context).toContain("focused on the app folder documents/finance/budget/");
    expect(context).toContain("Read documents/finance/budget/AGENT.md, then documents/finance/budget/AGENT-user.md");
    expect(context).toContain("Treat documents/finance/budget/budget.md as this app's owner state file");
    expect(context).toContain("read documents/finance/budget/budget-rules.md, then documents/finance/budget/budget-rules-user.md");
    expect(context).toContain("Use documents/finance/budget/statements/ as app source evidence");
    expect(context).toContain("Use documents/finance/budget/reports/ for app-generated reports");
  });

  it("blocks Finance saved-budget comparison writes to budget.md", () => {
    const guard = createFinanceBudgetProtectionGuard("finance", conversationWithUserMessages([
      "I uploaded another month of transactions. Using the saved budget in documents/finance/budget/budget.md, how did I do? Do not rewrite the saved budget unless I ask.",
    ]));

    const result = guard?.("memory_write", {
      path: "documents/finance/budget/budget.md",
      content: "# Rewritten budget\n",
    });

    expect(result?.status).toBe("error");
    expect(result?.recoverable).toBe(true);
    expect(result?.output).toMatchObject({
      code: "permission_denied",
      path: "documents/finance/budget/budget.md",
      recoverable: true,
    });
  });

  it("allows report writes during Finance saved-budget comparisons", () => {
    const guard = createFinanceBudgetProtectionGuard("finance", conversationWithUserMessages([
      "Compare actual spending against the saved limits in budget.md and refresh reports/latest.md.",
    ]));

    const result = guard?.("memory_write", {
      path: "documents/finance/budget/reports/latest.md",
      content: "# Report\n",
    });

    expect(result).toBeNull();
  });

  it("allows explicit saved-budget revisions", () => {
    const guard = createFinanceBudgetProtectionGuard("finance", conversationWithUserMessages([
      "Using the saved budget in documents/finance/budget/budget.md, how did I do this month?",
      "Please update the saved budget and change my dining limit to 100.",
    ]));

    expect(guard).toBeUndefined();
  });

  it("detects protected Finance budget mutation paths", () => {
    expect(isProtectedFinanceBudgetMutation("memory_edit", { path: "./documents/finance/budget/budget.md" })).toBe(true);
    expect(isProtectedFinanceBudgetMutation("memory_delete", { path: "documents\\finance\\budget\\budget.md" })).toBe(true);
    expect(isProtectedFinanceBudgetMutation("memory_read", { path: "documents/finance/budget/budget.md" })).toBe(false);
    expect(isProtectedFinanceBudgetMutation("memory_write", { path: "documents/finance/budget/reports/latest.md" })).toBe(false);
  });

  it("recognizes saved-budget comparison conversation state", () => {
    expect(conversationHasSavedBudgetComparison(conversationWithUserMessages([
      "Using the saved budget in documents/finance/budget/budget.md, compare actual spending against saved limits.",
    ]))).toBe(true);
    expect(conversationHasSavedBudgetComparison(conversationWithUserMessages([
      "Please build my first budget from these statements.",
    ]))).toBe(false);
  });

  it("blocks open-period durable monthly report archives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26));
    try {
      const guard = createBrainDriveMemorySafetyGuard("finance", conversationWithUserMessages([
        "Compare May against my saved budget.",
      ]));

      const result = guard("memory_write", {
        path: "documents/finance/budget/reports/monthly-2026-05.md",
        content: "# May report\n",
      });

      expect(result?.status).toBe("error");
      expect(result?.output).toMatchObject({
        code: "permission_denied",
        path: "documents/finance/budget/reports/monthly-2026-05.md",
      });
      expect(guard("memory_write", {
        path: "documents/finance/budget/reports/latest.md",
        content: "# Latest report\n",
      })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

function conversationWithUserMessages(messages: string[]): ConversationDetail {
  return {
    id: "conversation-test",
    title: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    messages: messages.map((content, index) => ({
      id: `message-${index}`,
      role: "user",
      content,
      timestamp: "2026-05-19T00:00:00.000Z",
    })),
  };
}
