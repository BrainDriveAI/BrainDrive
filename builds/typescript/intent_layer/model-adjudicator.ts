import type { IntentLayerConfig } from "./config.js";
import type { IntentLayerContext } from "./types.js";

export type ModelAdjudicationResult = {
  used: boolean;
  reason: string;
};

export async function maybeAdjudicateIntent(
  _context: IntentLayerContext,
  config: IntentLayerConfig
): Promise<ModelAdjudicationResult> {
  if (config.resolver === "rules") {
    return {
      used: false,
      reason: "rules_only_mode",
    };
  }

  // Placeholder for future provider-backed adjudication in hybrid/model_assisted modes.
  return {
    used: false,
    reason: "adjudicator_not_wired",
  };
}
