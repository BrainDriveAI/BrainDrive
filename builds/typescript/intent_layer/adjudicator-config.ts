import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const adjudicatorProfileSchema = z
  .object({
    provider_profile: z.string().min(1),
    model: z.string().min(1),
    timeout_ms: z.number().int().positive(),
    max_output_tokens: z.number().int().positive(),
    max_calls_per_message: z.number().int().positive(),
    daily_budget_usd: z.number().nonnegative(),
    enabled: z.boolean(),
  })
  .strict();

const adjudicatorConfigSchema = z
  .object({
    default_profile: z.string().min(1),
    profiles: z.record(adjudicatorProfileSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.profiles[value.default_profile]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "default_profile must match an existing profile key",
      });
    }
  });

export type IntentAdjudicatorConfig = z.infer<typeof adjudicatorConfigSchema>;

export type IntentAdjudicatorConfigLoadResult = {
  config: IntentAdjudicatorConfig | null;
  source: "file" | "missing" | "invalid";
  path: string;
  error?: string;
};

export async function loadIntentAdjudicatorConfig(rootDir: string): Promise<IntentAdjudicatorConfigLoadResult> {
  const configPath = resolveIntentAdjudicatorConfigPath(rootDir);
  let raw: string;

  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        config: null,
        source: "missing",
        path: configPath,
      };
    }

    return {
      config: null,
      source: "invalid",
      path: configPath,
      error: error instanceof Error ? error.message : "Failed to read adjudicator config",
    };
  }

  try {
    return {
      config: adjudicatorConfigSchema.parse(JSON.parse(raw)),
      source: "file",
      path: configPath,
    };
  } catch (error) {
    return {
      config: null,
      source: "invalid",
      path: configPath,
      error: error instanceof Error ? error.message : "Invalid adjudicator config",
    };
  }
}

export function resolveIntentAdjudicatorConfigPath(rootDir: string): string {
  return path.join(rootDir, "adapters", "intent-adjudicator.json");
}
