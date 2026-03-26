import type { IntentActionCategory } from "./types.js";

type IntentCapabilityMap = {
  capabilities: string[];
  progressSteps: string[];
};

const ACTION_CAPABILITY_MAP: Record<IntentActionCategory, IntentCapabilityMap> = {
  debug: {
    capabilities: ["code_search", "diagnostics", "hypothesis_testing"],
    progressSteps: ["Inspect relevant files", "Form and test likely causes", "Propose minimal fix path"],
  },
  analyze: {
    capabilities: ["code_search", "impact_assessment", "evidence_summary"],
    progressSteps: ["Collect context", "Analyze constraints and tradeoffs", "Summarize findings"],
  },
  create: {
    capabilities: ["requirements_translation", "design_structuring", "artifact_generation"],
    progressSteps: ["Clarify objective", "Draft structured output", "Confirm completeness"],
  },
  modify: {
    capabilities: ["change_planning", "safe_editing", "verification"],
    progressSteps: ["Scope intended changes", "Apply bounded edits", "Verify behavior and regressions"],
  },
  automate: {
    capabilities: ["workflow_scripting", "repeatability", "guardrails"],
    progressSteps: ["Define workflow target", "Build repeatable sequence", "Validate safe execution"],
  },
  explain: {
    capabilities: ["knowledge_synthesis", "teaching", "contextual_examples"],
    progressSteps: ["Identify knowledge gap", "Explain clearly", "Confirm understanding"],
  },
  unknown: {
    capabilities: ["general_assistance"],
    progressSteps: ["Clarify request", "Choose a safe next step", "Proceed with bounded actions"],
  },
};

const PROFILE_OVERRIDES: Record<string, Partial<IntentCapabilityMap>> = {
  interview: {
    capabilities: ["requirements_elicitation", "adaptive_questioning", "context_tracking"],
    progressSteps: [
      "Ask one focused question",
      "Adapt next question based on answer",
      "Summarize collected requirements and next step",
    ],
  },
  "feature-spec": {
    capabilities: ["requirements_structuring", "acceptance_criteria", "scope_definition"],
    progressSteps: ["Capture feature goal", "Define scope and acceptance criteria", "Publish structured specification"],
  },
  plan: {
    capabilities: ["roadmapping", "phase_planning", "risk_management"],
    progressSteps: ["Define objective", "Break work into phases", "List risks and verification gates"],
  },
  "test-plan": {
    capabilities: ["verification_design", "test_matrix", "quality_gates"],
    progressSteps: ["Identify critical behaviors", "Define test lanes", "Map pass/fail criteria"],
  },
};

export function mapCapabilities(
  actionCategory: IntentActionCategory,
  workflowProfileId: string | null
): IntentCapabilityMap {
  const base = ACTION_CAPABILITY_MAP[actionCategory];
  const override = workflowProfileId ? PROFILE_OVERRIDES[workflowProfileId] : undefined;
  return {
    capabilities: dedupeStrings([...(override?.capabilities ?? []), ...base.capabilities]),
    progressSteps: dedupeStrings([...(override?.progressSteps ?? []), ...base.progressSteps]),
  };
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
