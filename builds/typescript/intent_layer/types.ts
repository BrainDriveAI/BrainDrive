import type { SkillSummary } from "../memory/skills.js";

export type IntentActionCategory = "debug" | "analyze" | "create" | "modify" | "automate" | "explain" | "unknown";

export type IntentActionPolicy = "auto_run" | "suggest_then_run" | "confirm_first" | "pass_through";

export type IntentProfileId = string;

export type IntentProfileMatch = {
  id: IntentProfileId;
  confidence: number;
  source: "skills_memory" | "built_in";
} | null;

export type WorkflowLockAction = "none" | "set" | "keep" | "clear" | "expire";

export type WorkflowLockPlan = {
  action: WorkflowLockAction;
  profile_id?: IntentProfileId;
  reason?: string;
  ttl_turns?: number;
};

export type IntentPlan = {
  action_category: IntentActionCategory;
  workflow_profile: IntentProfileMatch;
  confidence: number;
  policy: IntentActionPolicy;
  objective: string;
  suggested_capabilities: string[];
  suggested_tools: string[];
  transient_skill_ids: string[];
  workflow_lock: WorkflowLockPlan;
  progress_steps: string[];
  notes?: string[];
};

export type WorkflowLockState = {
  profileId: IntentProfileId;
  remainingTurns: number;
  totalTurns: number;
  updatedAt: string;
  reason: string;
};

export type IntentLayerContext = {
  conversationId: string;
  userMessage: string;
  skills: SkillSummary[];
  activeLock: WorkflowLockState | null;
  availableToolNames: string[];
};

export type IntentLayerResult = {
  plan: IntentPlan;
  candidates: IntentProfileCandidate[];
};

export type IntentProfileDescriptor = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  status: SkillSummary["status"];
  aliases: string[];
  source: "skills_memory" | "built_in";
};

export type IntentProfileCandidate = {
  id: string;
  score: number;
};

export type WorkflowLockStoreConfig = {
  ttl_turns: number;
  max_total_turns: number;
  allow_user_override: boolean;
};

export type WorkflowLockSnapshot = {
  lock: WorkflowLockState | null;
  expired: boolean;
};

export type WorkflowLockUpdateResult = {
  event: "none" | "set" | "renewed" | "cleared";
  state: WorkflowLockState | null;
  reason: string;
};
