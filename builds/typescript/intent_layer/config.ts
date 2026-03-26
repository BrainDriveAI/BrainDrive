import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const intentLayerModeSchema = z.enum(["off", "observe", "active"]);
const intentResolverSchema = z.enum(["rules", "hybrid", "model_assisted"]);
const intentTransparencySchema = z.enum(["minimal", "normal", "verbose"]);
const intentProfileSourceSchema = z.enum(["skills_memory", "built_in"]);

const intentLayerConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: intentLayerModeSchema.optional(),
    resolver: intentResolverSchema.optional(),
    thresholds: z
      .object({
        auto_run: z.number().min(0).max(1).optional(),
        profile_match: z.number().min(0).max(1).optional(),
      })
      .optional(),
    profile_registry_sources: z.array(intentProfileSourceSchema).nonempty().optional(),
    profile_alias_overrides: z.record(z.array(z.string().trim().min(1))).optional(),
    default_profile_by_action: z.record(z.string().trim().min(1)).optional(),
    risk_policy: z
      .object({
        force_confirmation_for_mutation: z.boolean().optional(),
      })
      .optional(),
    transparency_level: intentTransparencySchema.optional(),
    workflow_lock: z
      .object({
        enabled: z.boolean().optional(),
        ttl_turns: z.number().int().positive().optional(),
        max_total_turns: z.number().int().positive().optional(),
        allow_user_override: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

export type IntentLayerConfig = {
  enabled: boolean;
  mode: "off" | "observe" | "active";
  resolver: "rules" | "hybrid" | "model_assisted";
  thresholds: {
    auto_run: number;
    profile_match: number;
  };
  profile_registry_sources: Array<"skills_memory" | "built_in">;
  profile_alias_overrides: Record<string, string[]>;
  default_profile_by_action: Record<string, string>;
  risk_policy: {
    force_confirmation_for_mutation: boolean;
  };
  transparency_level: "minimal" | "normal" | "verbose";
  workflow_lock: {
    enabled: boolean;
    ttl_turns: number;
    max_total_turns: number;
    allow_user_override: boolean;
  };
};

export const DEFAULT_INTENT_LAYER_CONFIG: IntentLayerConfig = {
  enabled: true,
  mode: "active",
  resolver: "rules",
  thresholds: {
    auto_run: 0.8,
    profile_match: 0.55,
  },
  profile_registry_sources: ["skills_memory", "built_in"],
  profile_alias_overrides: {},
  default_profile_by_action: {},
  risk_policy: {
    force_confirmation_for_mutation: true,
  },
  transparency_level: "normal",
  workflow_lock: {
    enabled: true,
    ttl_turns: 3,
    max_total_turns: 48,
    allow_user_override: true,
  },
};

export type IntentLayerConfigLoadResult = {
  config: IntentLayerConfig;
  source: "defaults" | "file";
  path: string;
  error?: string;
};

export async function loadIntentLayerConfig(memoryRoot: string): Promise<IntentLayerConfigLoadResult> {
  const configPath = resolveIntentLayerConfigPath(memoryRoot);
  let raw: string;

  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        config: DEFAULT_INTENT_LAYER_CONFIG,
        source: "defaults",
        path: configPath,
      };
    }

    return {
      config: DEFAULT_INTENT_LAYER_CONFIG,
      source: "defaults",
      path: configPath,
      error: error instanceof Error ? error.message : "Failed to read intent config",
    };
  }

  try {
    const parsed = intentLayerConfigSchema.parse(JSON.parse(raw));
    return {
      config: mergeIntentLayerConfig(DEFAULT_INTENT_LAYER_CONFIG, parsed),
      source: "file",
      path: configPath,
    };
  } catch (error) {
    return {
      config: DEFAULT_INTENT_LAYER_CONFIG,
      source: "defaults",
      path: configPath,
      error: error instanceof Error ? error.message : "Invalid intent config",
    };
  }
}

export function resolveIntentLayerConfigPath(memoryRoot: string): string {
  return path.join(memoryRoot, "preferences", "intent-component.json");
}

function mergeIntentLayerConfig(
  defaults: IntentLayerConfig,
  input: z.infer<typeof intentLayerConfigSchema>
): IntentLayerConfig {
  return {
    enabled: input.enabled ?? defaults.enabled,
    mode: input.mode ?? defaults.mode,
    resolver: input.resolver ?? defaults.resolver,
    thresholds: {
      auto_run: input.thresholds?.auto_run ?? defaults.thresholds.auto_run,
      profile_match: input.thresholds?.profile_match ?? defaults.thresholds.profile_match,
    },
    profile_registry_sources: input.profile_registry_sources ?? defaults.profile_registry_sources,
    profile_alias_overrides: mergeAliasOverrides(defaults.profile_alias_overrides, input.profile_alias_overrides),
    default_profile_by_action: {
      ...defaults.default_profile_by_action,
      ...(input.default_profile_by_action ?? {}),
    },
    risk_policy: {
      force_confirmation_for_mutation:
        input.risk_policy?.force_confirmation_for_mutation ?? defaults.risk_policy.force_confirmation_for_mutation,
    },
    transparency_level: input.transparency_level ?? defaults.transparency_level,
    workflow_lock: {
      enabled: input.workflow_lock?.enabled ?? defaults.workflow_lock.enabled,
      ttl_turns: input.workflow_lock?.ttl_turns ?? defaults.workflow_lock.ttl_turns,
      max_total_turns: input.workflow_lock?.max_total_turns ?? defaults.workflow_lock.max_total_turns,
      allow_user_override: input.workflow_lock?.allow_user_override ?? defaults.workflow_lock.allow_user_override,
    },
  };
}

function mergeAliasOverrides(
  defaults: Record<string, string[]>,
  overrides: Record<string, string[]> | undefined
): Record<string, string[]> {
  if (!overrides) {
    return defaults;
  }

  const merged: Record<string, string[]> = {
    ...defaults,
  };

  for (const [profileId, aliases] of Object.entries(overrides)) {
    const normalizedAliases = dedupeStrings(aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0));
    if (normalizedAliases.length === 0) {
      continue;
    }
    merged[profileId] = normalizedAliases;
  }

  return merged;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}
