import type { IntentLayerConfig } from "./config.js";
import type { IntentActionCategory, IntentActionPolicy } from "./types.js";

const HIGH_RISK_PHRASES = [
  "delete",
  "remove all",
  "wipe",
  "drop",
  "across all files",
  "entire codebase",
  "mass update",
  "bulk update",
  "overwrite",
];

const MUTATING_ACTIONS: IntentActionCategory[] = ["create", "modify", "automate"];
const READ_ONLY_ACTIONS: IntentActionCategory[] = ["debug", "analyze", "explain"];

export function assignIntentPolicy(
  actionCategory: IntentActionCategory,
  confidence: number,
  userMessage: string,
  config: IntentLayerConfig
): IntentActionPolicy {
  const normalized = userMessage.toLowerCase();
  const hasHighRiskPhrase = HIGH_RISK_PHRASES.some((phrase) => normalized.includes(phrase));
  const mutationAction = MUTATING_ACTIONS.includes(actionCategory);

  if (hasHighRiskPhrase) {
    return "confirm_first";
  }

  if (mutationAction && config.risk_policy.force_confirmation_for_mutation) {
    return "confirm_first";
  }

  if (READ_ONLY_ACTIONS.includes(actionCategory) && confidence >= config.thresholds.profile_match) {
    return "auto_run";
  }

  if (confidence >= config.thresholds.auto_run) {
    return "auto_run";
  }

  if (confidence >= config.thresholds.profile_match) {
    return "suggest_then_run";
  }

  return "pass_through";
}
