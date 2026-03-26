import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

import type { AdapterConfig, Preferences, RuntimeConfig } from "./contracts.js";
import { initializeMemoryLayout } from "./memory/init.js";
import { auditLog } from "./logger.js";

const runtimeConfigSchema = z.object({
  memory_root: z.string().min(1),
  provider_adapter: z.string().min(1),
  conversation_store: z.literal("markdown").optional(),
  auth_mode: z.enum(["local-owner", "local", "managed"]),
  tool_sources: z.array(z.string()),
  bind_address: z.string().min(1).optional(),
  safety_iteration_limit: z.number().int().positive().optional(),
  port: z.number().int().positive().optional(),
});

const adapterProfileSchema = z.object({
  base_url: z.string().url(),
  model: z.string().min(1),
  api_key_env: z.string().min(1),
  provider_id: z.string().min(1).optional(),
});

const adapterConfigSchema = z
  .object({
    base_url: z.string().url().optional(),
    model: z.string().min(1).optional(),
    api_key_env: z.string().min(1).optional(),
    provider_id: z.string().min(1).optional(),
    provider_profiles: z.record(adapterProfileSchema).optional(),
    default_provider_profile: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider_profiles) {
      const profileNames = Object.keys(value.provider_profiles);
      if (profileNames.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "provider_profiles must include at least one profile",
        });
      }

      if (!value.default_provider_profile || !value.provider_profiles[value.default_provider_profile]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "default_provider_profile must match a key in provider_profiles",
        });
      }
    }

    const hasTopLevelAdapterFields = Boolean(value.base_url && value.model && value.api_key_env);
    if (!hasTopLevelAdapterFields && !value.provider_profiles) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "adapter config requires base_url, model, and api_key_env",
      });
    }
  })
  .transform((value): AdapterConfig => {
    if (value.base_url && value.model && value.api_key_env) {
      return {
        base_url: value.base_url,
        model: value.model,
        api_key_env: value.api_key_env,
        ...(value.provider_id ? { provider_id: value.provider_id } : {}),
        ...(value.provider_profiles ? { provider_profiles: value.provider_profiles } : {}),
        ...(value.default_provider_profile ? { default_provider_profile: value.default_provider_profile } : {}),
      };
    }

    if (!value.provider_profiles || !value.default_provider_profile) {
      throw new Error("Adapter profile configuration is missing a default provider profile");
    }

    const defaultProfile = value.provider_profiles[value.default_provider_profile];
    if (!defaultProfile) {
      throw new Error("Adapter profile configuration is missing the default provider profile entry");
    }

    return {
      ...defaultProfile,
      provider_profiles: value.provider_profiles,
      default_provider_profile: value.default_provider_profile,
    };
  });

const secretResolutionSchema = z
  .object({
    on_missing: z.enum(["fail_closed", "prompt_once"]).default("fail_closed"),
  })
  .strict();

const plainProviderCredentialSchema = z
  .object({
    mode: z.literal("plain"),
    required: z.boolean().optional(),
  })
  .strict();

const secretRefProviderCredentialSchema = z
  .object({
    mode: z.literal("secret_ref"),
    secret_ref: z.string().min(1),
    env_ref: z.string().min(1).optional(),
    required: z.boolean().optional(),
  })
  .strict();

const providerCredentialSchema = z.discriminatedUnion("mode", [
  plainProviderCredentialSchema,
  secretRefProviderCredentialSchema,
]);

const preferencesSchema = z
  .object({
    default_model: z.string().min(1),
    approval_mode: z.literal("ask-on-write"),
    active_provider_profile: z.string().min(1).optional(),
    provider_credentials: z.record(providerCredentialSchema).optional(),
    secret_resolution: secretResolutionSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const forbiddenFieldPaths = findForbiddenSecretFieldPaths(value);
    for (const fieldPath of forbiddenFieldPaths) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden secret-by-value field in preferences: ${fieldPath}`,
      });
    }
  })
  .transform((value): Preferences => ({
    ...value,
    secret_resolution: value.secret_resolution ?? { on_missing: "fail_closed" },
  }));

export async function loadRuntimeConfig(rootDir: string): Promise<RuntimeConfig> {
  const runtimePath = path.join(rootDir, "config.json");
  const raw = await readFile(runtimePath, "utf8");
  const parsed = runtimeConfigSchema.parse(JSON.parse(raw));
  const memoryRootOverride = process.env.PAA_MEMORY_ROOT?.trim();
  const resolvedMemoryRoot = memoryRootOverride && memoryRootOverride.length > 0 ? memoryRootOverride : parsed.memory_root;

  return {
    ...parsed,
    conversation_store: parsed.conversation_store ?? "markdown",
    memory_root: path.resolve(rootDir, resolvedMemoryRoot),
    bind_address: parsed.bind_address ?? "127.0.0.1",
    port: parsed.port ?? 8787,
  };
}

export async function loadAdapterConfig(rootDir: string, adapterName: string): Promise<AdapterConfig> {
  const adapterPath = path.join(rootDir, "adapters", `${adapterName}.json`);
  let raw: string;

  try {
    raw = await readFile(adapterPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Unsupported provider adapter: ${adapterName}`);
    }

    throw error;
  }

  return adapterConfigSchema.parse(JSON.parse(raw));
}

export async function ensureMemoryLayout(rootDir: string, memoryRoot: string): Promise<void> {
  const summary = await initializeMemoryLayout(rootDir, memoryRoot, {
    seedDefaultProjects: true,
  });
  auditLog("memory.init", {
    memory_root: memoryRoot,
    profile: summary.profile,
    starter_pack_dir: summary.starter_pack_dir,
    created_count: summary.created.length,
    updated_count: summary.updated.length,
    skipped_count: summary.skipped.length,
    warnings_count: summary.warnings.length,
    seeded_projects_count: summary.seeded_projects.length,
    seeded_skills_count: summary.seeded_skills.length,
  });
}

export async function loadPreferences(memoryRoot: string): Promise<Preferences> {
  const preferencesPath = resolvePreferencesPath(memoryRoot);
  const raw = await readFile(preferencesPath, "utf8");
  return preferencesSchema.parse(JSON.parse(raw));
}

export async function savePreferences(memoryRoot: string, preferences: Preferences): Promise<void> {
  const preferencesPath = resolvePreferencesPath(memoryRoot);
  const validated = preferencesSchema.parse(preferences);
  await writeFile(preferencesPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

export async function readBootstrapPrompt(memoryRoot: string): Promise<string> {
  const agentPath = path.join(memoryRoot, "AGENT.md");
  return readFile(agentPath, "utf8");
}

function resolvePreferencesPath(memoryRoot: string): string {
  return path.join(memoryRoot, "preferences", "default.json");
}

function findForbiddenSecretFieldPaths(input: unknown, parentPath = ""): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }

  const forbiddenKeys = new Set(["api_key", "token", "password", "secret_value"]);
  const matches: string[] = [];
  const entries = Object.entries(input as Record<string, unknown>);

  for (const [key, value] of entries) {
    const currentPath = parentPath.length > 0 ? `${parentPath}.${key}` : key;

    if (forbiddenKeys.has(key)) {
      matches.push(currentPath);
    }

    matches.push(...findForbiddenSecretFieldPaths(value, currentPath));
  }

  return matches;
}
