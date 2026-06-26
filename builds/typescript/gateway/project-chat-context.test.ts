import { describe, expect, it } from "vitest";

import {
  buildStarterProjectArtifactSnapshot,
  buildProjectConversationGuard,
  buildProjectChatContext,
  mergeStarterProjectArtifactSnapshot,
  starterSnapshotProjectIds,
} from "./server.js";
import type { ConversationDetail } from "../contracts.js";

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
    expect(context).toContain("do not only answer in chat");
    expect(context).toContain("update documents/finance/spec.md and/or documents/finance/plan.md");
    expect(context).toContain("replace placeholder lines like \"To be filled...\"");
    expect(context).toContain("Do not wait for a perfect interview before writing durable state");
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

  it("adds a current-turn guard when the owner gives a success criterion", () => {
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

    expect(guard).toContain("The owner's latest message gives a success criterion");
    expect(guard).toContain("Do not ask another intake question this turn");
    expect(guard).toContain("documents/fitness/spec.md");
  });

  it("adds a Fitness guard for concrete outcome phrases in the first reply", () => {
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

    expect(guard).toContain("Fitness-specific guard");
    expect(guard).toContain("more energy");
    expect(guard).toContain("strength");
    expect(guard).toContain("5K");
  });

  it("adds a Fitness guard when adjacent constraint answers a workout-details question", () => {
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

    expect(guard).toContain("plans get too intense");
    expect(guard).toContain("mark workout composition and duration unknown");
    expect(guard).toContain("do not ask the workout-details question again");
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

  it("adds a Finance guard against large worksheets after embarrassment or avoidance", () => {
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

    expect(guard).toContain("Finance-specific guard");
    expect(guard).toContain("large budget worksheet");
    expect(guard).toContain("Mark the detailed monthly expense breakdown unknown");
    expect(guard).toContain("small first step");
  });

  it("treats success would be as a Finance artifact-writing stop point", () => {
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

    expect(guard).toContain("The owner's latest message gives a success criterion");
    expect(guard).toContain("Do not ask another intake question this turn");
    expect(guard).toContain("documents/finance/spec.md");
    expect(guard).toContain("Preserve the owner's exact success wording");
    expect(guard).toContain("must contain zero question marks");
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

  it("adds Finance starter anchors for Katie's exact success wording", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("finance", conversationWithUserMessages([
      "I want help getting my finances under control. I have credit card debt from emergencies, no real emergency fund, and I want a plan before I upload any statements.",
      "I make about $62K and bring home around $3,800 a month.",
      "I think the credit card debt is around $8K.",
      "I am embarrassed and I have avoided looking closely for a while.",
      "Success would be knowing my first money step this week and what information to gather next.",
    ]));

    expect(snapshot?.spec).toContain("first money step this week");
    expect(snapshot?.spec).toContain("information to gather next");
    expect(snapshot?.plan).toContain("first money step this week");
    expect(snapshot?.plan).toContain("information to gather next");
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

  it("adds New Project starter anchors for created page placement", () => {
    const snapshot = buildStarterProjectArtifactSnapshot("new-project", conversationWithUserMessages([
      "I want to create a new BrainDrive page for planning a backyard garden project.",
      "The goal is a small beginner vegetable garden for this spring, mostly tomatoes, herbs, and peppers.",
      "Constraints are a sunny but small yard, about $300, weekend time only, and I do not know my soil quality yet.",
      "Please name it Backyard Garden and make the first plan something I can do this week without pretending there is marketplace, sharing, or app generation. Do not update my profile unless I explicitly approve it.",
    ]));

    expect(snapshot?.spec).toContain("Backyard Garden page");
    expect(snapshot?.spec).toContain("created page spec");
    expect(snapshot?.plan).toContain("Narrowest correct level");
    expect(snapshot?.plan).toContain("Created page spec");
    expect(snapshot?.plan).toContain("Created page plan");
    expect(snapshot?.plan).toContain("me/profile.md");
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

  it("does not add app-scope context when client metadata selects the retired Finance Budget folder", () => {
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

    expect(context).not.toContain("### Active App Scope");
    expect(context).not.toContain("focused on the app folder documents/finance/budget/");
    expect(context).not.toContain("Treat documents/finance/budget/budget.md as this app's owner state file");
    expect(context).not.toContain("Use documents/finance/budget/statements/ as app source evidence");
    expect(context).not.toContain("Use documents/finance/budget/reports/ for app-generated reports");
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
