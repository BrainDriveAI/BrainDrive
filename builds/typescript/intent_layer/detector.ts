import type { IntentLayerConfig } from "./config.js";
import { mapCapabilities } from "./capability-map.js";
import { assignIntentPolicy } from "./policy.js";
import { buildIntentProfileRegistry } from "./profile-registry.js";
import { resolveWorkflowProfile } from "./profile-resolver.js";
import { isMultiTurnProfile, wantsToClearWorkflowLock, wantsToSwitchWorkflow } from "./workflow-lock-policy.js";
import type {
  IntentActionCategory,
  IntentLayerContext,
  IntentLayerResult,
  IntentPlan,
  IntentProfileMatch,
  WorkflowLockPlan,
} from "./types.js";

const ACTION_KEYWORDS: Record<Exclude<IntentActionCategory, "unknown">, string[]> = {
  debug: ["debug", "bug", "broken", "fix", "issue", "not working", "failure", "trace"],
  analyze: ["analyze", "assess", "review", "audit", "investigate", "diagnose", "evaluate", "inspect"],
  create: ["create", "build", "draft", "generate", "design", "spec", "plan", "write"],
  modify: ["edit", "update", "change", "refactor", "adjust", "replace", "apply", "patch"],
  automate: ["automate", "script", "workflow", "pipeline", "repeat", "batch", "orchestrate"],
  explain: ["explain", "what", "why", "how", "walk through", "teach", "clarify"],
};

const PROFILE_OBJECTIVES: Record<string, string> = {
  interview: "Run a guided interview and gather enough detail to complete requirements confidently.",
  "feature-spec": "Produce a structured feature specification with clear scope and acceptance criteria.",
  plan: "Create a phased implementation plan with verification and risk checkpoints.",
  "test-plan": "Define a test strategy that validates critical behavior and safety constraints.",
};

const ACTION_OBJECTIVES: Record<IntentActionCategory, string> = {
  debug: "Diagnose the root cause and propose a safe fix path.",
  analyze: "Assess the situation and return evidence-backed findings.",
  create: "Create a concrete artifact aligned to the requested outcome.",
  modify: "Apply or propose scoped changes with clear verification steps.",
  automate: "Design or execute a repeatable workflow with guardrails.",
  explain: "Provide a clear explanation tailored to the current context.",
  unknown: "Clarify the request and proceed with the safest helpful action.",
};

export function resolveIntentLayer(context: IntentLayerContext, config: IntentLayerConfig): IntentLayerResult {
  const normalizedMessage = normalizeText(context.userMessage);
  const action = classifyActionCategory(normalizedMessage);
  const profileRegistry = buildIntentProfileRegistry(context.skills, config);
  const profileResolution = resolveWorkflowProfile(
    normalizedMessage,
    profileRegistry,
    config.thresholds.profile_match
  );

  const selectedProfile = resolveWorkflowProfileWithLock(
    context,
    profileRegistry,
    profileResolution.match,
    normalizedMessage,
    config.workflow_lock.allow_user_override
  );
  const capabilities = mapCapabilities(action.category, selectedProfile.match?.id ?? null);
  const confidence = Math.max(action.confidence, selectedProfile.match?.confidence ?? 0);
  const policy = assignIntentPolicy(action.category, confidence, normalizedMessage, config);
  const transientSkillIds = resolveTransientSkillIds(context, config, selectedProfile.match);
  const suggestedTools = suggestTools(action.category, context.availableToolNames);

  const plan: IntentPlan = {
    action_category: action.category,
    workflow_profile: selectedProfile.match,
    confidence,
    policy,
    objective: resolveObjective(action.category, selectedProfile.match, context.userMessage),
    suggested_capabilities: capabilities.capabilities,
    suggested_tools: suggestedTools,
    transient_skill_ids: transientSkillIds,
    workflow_lock: selectedProfile.workflowLock,
    progress_steps: capabilities.progressSteps,
    ...(selectedProfile.notes.length > 0 ? { notes: selectedProfile.notes } : {}),
  };

  return {
    plan,
    candidates: profileResolution.candidates,
  };
}

export function createPassThroughIntentPlan(userMessage: string): IntentPlan {
  return {
    action_category: "unknown",
    workflow_profile: null,
    confidence: 0,
    policy: "pass_through",
    objective: summarizeObjective(userMessage),
    suggested_capabilities: [],
    suggested_tools: [],
    transient_skill_ids: [],
    workflow_lock: {
      action: "none",
      reason: "intent_layer_disabled_or_off",
    },
    progress_steps: [],
    notes: ["Intent layer disabled/off. Existing gateway behavior preserved."],
  };
}

function resolveWorkflowProfileWithLock(
  context: IntentLayerContext,
  descriptors: Array<{ id: string; source: "skills_memory" | "built_in" }>,
  matchedProfile: IntentProfileMatch,
  normalizedMessage: string,
  allowUserOverride: boolean
): {
  match: IntentProfileMatch;
  workflowLock: WorkflowLockPlan;
  notes: string[];
} {
  const notes: string[] = [];
  const activeLock = context.activeLock;
  if (!activeLock) {
    if (matchedProfile && isMultiTurnProfile(matchedProfile.id)) {
      return {
        match: matchedProfile,
        workflowLock: {
          action: "set",
          profile_id: matchedProfile.id,
          reason: "multi_turn_workflow_started",
        },
        notes,
      };
    }

    return {
      match: matchedProfile,
      workflowLock: {
        action: "none",
        reason: "no_active_lock",
      },
      notes,
    };
  }

  if (allowUserOverride && wantsToClearWorkflowLock(normalizedMessage)) {
    notes.push("User requested workflow stop/clear.");
    return {
      match: matchedProfile,
      workflowLock: {
        action: "clear",
        reason: "user_requested_clear",
      },
      notes,
    };
  }

  if (
    allowUserOverride &&
    wantsToSwitchWorkflow(normalizedMessage, matchedProfile?.id ?? null, activeLock.profileId) &&
    matchedProfile
  ) {
    notes.push(`Workflow switched from ${activeLock.profileId} to ${matchedProfile.id}.`);
    return {
      match: matchedProfile,
      workflowLock: isMultiTurnProfile(matchedProfile.id)
        ? {
            action: "set",
            profile_id: matchedProfile.id,
            reason: "workflow_switched",
          }
        : {
            action: "clear",
            reason: "switch_to_single_turn_profile",
          },
      notes,
    };
  }

  const descriptor = descriptors.find((item) => item.id === activeLock.profileId);
  return {
    match: {
      id: activeLock.profileId,
      confidence: Math.max(matchedProfile?.id === activeLock.profileId ? matchedProfile.confidence : 0, 0.85),
      source: descriptor?.source ?? "built_in",
    },
    workflowLock: {
      action: "keep",
      profile_id: activeLock.profileId,
      reason: "workflow_continues",
    },
    notes,
  };
}

function resolveTransientSkillIds(
  context: IntentLayerContext,
  config: IntentLayerConfig,
  profileMatch: IntentProfileMatch
): string[] {
  const skillStatuses = new Map(context.skills.map((skill) => [skill.id, skill.status]));
  const transient: string[] = [];

  if (profileMatch && skillStatuses.get(profileMatch.id) === "active") {
    transient.push(profileMatch.id);
  }

  if (transient.length === 0) {
    const inferredAction = classifyActionCategory(normalizeText(context.userMessage)).category;
    const defaultProfile = config.default_profile_by_action[inferredAction];
    if (defaultProfile && skillStatuses.get(defaultProfile) === "active") {
      transient.push(defaultProfile);
    }
  }

  return dedupeStrings(transient);
}

function suggestTools(action: IntentActionCategory, availableToolNames: string[]): string[] {
  if (availableToolNames.length === 0) {
    return [];
  }

  const families: Record<IntentActionCategory, RegExp> = {
    debug: /(read|search|grep|find|inspect|list|trace)/i,
    analyze: /(read|search|grep|find|list|query|inspect)/i,
    create: /(write|create|generate|save|plan|spec)/i,
    modify: /(write|edit|patch|apply|replace|move|rename|delete|remove)/i,
    automate: /(run|exec|command|script|workflow|schedule)/i,
    explain: /(read|search|lookup)/i,
    unknown: /$^/,
  };

  const matcher = families[action];
  return availableToolNames.filter((name) => matcher.test(name)).slice(0, 6);
}

function resolveObjective(action: IntentActionCategory, profileMatch: IntentProfileMatch, userMessage: string): string {
  if (profileMatch) {
    return PROFILE_OBJECTIVES[profileMatch.id] ?? ACTION_OBJECTIVES[action];
  }

  if (action === "unknown") {
    return summarizeObjective(userMessage);
  }

  return ACTION_OBJECTIVES[action];
}

function classifyActionCategory(message: string): { category: IntentActionCategory; confidence: number } {
  const scores = new Map<IntentActionCategory, number>();

  (Object.keys(ACTION_KEYWORDS) as Array<Exclude<IntentActionCategory, "unknown">>).forEach((category) => {
    const matches = ACTION_KEYWORDS[category].reduce((count, keyword) => {
      return message.includes(keyword) ? count + 1 : count;
    }, 0);
    scores.set(category, matches);
  });

  let selectedCategory: IntentActionCategory = "unknown";
  let selectedScore = 0;
  for (const [category, score] of scores.entries()) {
    if (score > selectedScore) {
      selectedCategory = category;
      selectedScore = score;
    }
  }

  if (selectedCategory === "unknown" || selectedScore === 0) {
    return {
      category: "unknown",
      confidence: 0.2,
    };
  }

  const confidence = Math.min(0.95, 0.4 + selectedScore * 0.18);
  return {
    category: selectedCategory,
    confidence,
  };
}

function summarizeObjective(userMessage: string): string {
  const normalized = userMessage.trim();
  if (normalized.length === 0) {
    return ACTION_OBJECTIVES.unknown;
  }
  if (normalized.length <= 140) {
    return normalized;
  }
  return `${normalized.slice(0, 137)}...`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}
