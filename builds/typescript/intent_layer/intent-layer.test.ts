import { describe, expect, it } from "vitest";

import { DEFAULT_INTENT_LAYER_CONFIG } from "./config.js";
import { createPassThroughIntentPlan, resolveIntentLayer } from "./detector.js";
import type { SkillSummary } from "../memory/skills.js";
import type { WorkflowLockState } from "./types.js";

const BASE_SKILLS: SkillSummary[] = [
  {
    id: "interview",
    name: "Interview",
    description: "Conduct requirement interview",
    scope: "global",
    status: "active",
    version: 1,
    tags: ["requirements", "questions"],
    updated_at: "2026-03-26T00:00:00.000Z",
  },
  {
    id: "feature-spec",
    name: "Feature Spec",
    description: "Generate structured feature specification",
    scope: "global",
    status: "active",
    version: 1,
    tags: ["spec", "requirements"],
    updated_at: "2026-03-26T00:00:00.000Z",
  },
  {
    id: "plan",
    name: "Plan",
    description: "Generate implementation roadmap",
    scope: "global",
    status: "active",
    version: 1,
    tags: ["plan", "roadmap"],
    updated_at: "2026-03-26T00:00:00.000Z",
  },
];

function lock(profileId: string): WorkflowLockState {
  return {
    profileId,
    remainingTurns: 2,
    totalTurns: 4,
    updatedAt: "2026-03-26T00:00:00.000Z",
    reason: "workflow_continues",
  };
}

describe("resolveIntentLayer", () => {
  it("sets interview workflow lock and transient skill when interview intent is detected", () => {
    const result = resolveIntentLayer(
      {
        conversationId: "conv-1",
        userMessage: "Interview me so we can clarify requirements before implementation.",
        skills: BASE_SKILLS,
        activeLock: null,
        availableToolNames: ["workspace_search", "read_file", "apply_patch"],
      },
      DEFAULT_INTENT_LAYER_CONFIG
    );

    expect(result.plan.workflow_profile?.id).toBe("interview");
    expect(result.plan.workflow_lock.action).toBe("set");
    expect(result.plan.workflow_lock.profile_id).toBe("interview");
    expect(result.plan.transient_skill_ids).toContain("interview");
  });

  it("keeps interview lock for follow-up answers and does not require fixed question count", () => {
    const result = resolveIntentLayer(
      {
        conversationId: "conv-2",
        userMessage: "It is for internal onboarding. We also need audit logs.",
        skills: BASE_SKILLS,
        activeLock: lock("interview"),
        availableToolNames: ["workspace_search", "read_file"],
      },
      DEFAULT_INTENT_LAYER_CONFIG
    );

    expect(result.plan.workflow_profile?.id).toBe("interview");
    expect(result.plan.workflow_lock.action).toBe("keep");
    expect(result.plan.workflow_lock.profile_id).toBe("interview");
  });

  it("clears interview lock when the user explicitly asks to stop interview", () => {
    const result = resolveIntentLayer(
      {
        conversationId: "conv-3",
        userMessage: "Stop interview and draft the feature spec.",
        skills: BASE_SKILLS,
        activeLock: lock("interview"),
        availableToolNames: ["workspace_search", "read_file"],
      },
      DEFAULT_INTENT_LAYER_CONFIG
    );

    expect(result.plan.workflow_lock.action).toBe("clear");
  });

  it("uses pass-through plan when intent layer is disabled by caller", () => {
    const plan = createPassThroughIntentPlan("hello");
    expect(plan.policy).toBe("pass_through");
    expect(plan.workflow_lock.action).toBe("none");
    expect(plan.transient_skill_ids).toEqual([]);
  });
});
