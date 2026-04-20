import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

import type { AdapterConfig, InstallMode, Preferences, RuntimeConfig } from "./contracts.js";
import { initializeMemoryLayout } from "./memory/init.js";
import { auditLog } from "./logger.js";

const runtimeConfigSchema = z.object({
  memory_root: z.string().min(1),
  provider_adapter: z.string().min(1),
  conversation_store: z.literal("markdown").optional(),
  auth_mode: z.enum(["local-owner", "local", "managed"]),
  install_mode: z.string().optional(),
  tool_sources: z.array(z.string()),
  bind_address: z.string().min(1).optional(),
  safety_iteration_limit: z.number().int().positive().optional(),
  port: z.number().int().positive().optional(),
});

const adapterProfileSchema = z.object({
  base_url: z.string().url(),
  model: z.string().trim(),
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

const memoryBackupFrequencySchema = z.enum(["manual", "after_changes", "hourly", "daily"]);

const memoryBackupResultSchema = z.enum(["never", "success", "failed"]);

const memoryBackupPreferenceSchema = z
  .object({
    repository_url: z
      .string()
      .trim()
      .url()
      .superRefine((value, context) => {
        if (looksLikeSshRepositoryUrl(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "memory_backup.repository_url must use https:// (SSH URLs are not supported)",
          });
          return;
        }

        const parsed = tryParseUrl(value);
        if (!parsed) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "memory_backup.repository_url must be a valid URL",
          });
          return;
        }

        if (parsed.protocol !== "https:") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "memory_backup.repository_url must use https://",
          });
        }

        if (parsed.username || parsed.password) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "memory_backup.repository_url cannot include embedded credentials",
          });
        }
      }),
    frequency: memoryBackupFrequencySchema,
    token_secret_ref: z.string().trim().min(1),
    last_save_at: z.string().datetime({ offset: true }).optional(),
    last_attempt_at: z.string().datetime({ offset: true }).optional(),
    last_result: memoryBackupResultSchema.optional(),
    last_error: z.string().optional().nullable(),
  })
  .strict();

const PREFERENCE_TOP_LEVEL_KEYS = new Set([
  "default_model",
  "approval_mode",
  "active_provider_profile",
  "provider_credentials",
  "provider_base_urls",
  "provider_default_models",
  "secret_resolution",
  "memory_backup",
]);

const preferencesSchema = z
  .object({
    default_model: z.string().min(1),
    approval_mode: z.enum(["ask-on-write", "auto-approve"]),
    active_provider_profile: z.string().min(1).optional(),
    provider_credentials: z.record(providerCredentialSchema).optional(),
    provider_base_urls: z.record(z.string().url()).optional(),
    provider_default_models: z.record(z.string().min(1)).optional(),
    secret_resolution: secretResolutionSchema.optional(),
    memory_backup: memoryBackupPreferenceSchema.optional(),
  })
  .strip()
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
  const installModeFromEnv = normalizeInstallMode(process.env.BRAINDRIVE_INSTALL_MODE);
  const resolvedInstallMode =
    installModeFromEnv !== "unknown" ? installModeFromEnv : normalizeInstallMode(parsed.install_mode);

  const authModeOverride = process.env.PAA_AUTH_MODE?.trim();
  const resolvedAuthMode =
    authModeOverride && ["local-owner", "local", "managed"].includes(authModeOverride)
      ? (authModeOverride as "local-owner" | "local" | "managed")
      : parsed.auth_mode;

  return {
    ...parsed,
    auth_mode: resolvedAuthMode,
    conversation_store: parsed.conversation_store ?? "markdown",
    install_mode: resolvedInstallMode,
    memory_root: path.resolve(rootDir, resolvedMemoryRoot),
    bind_address: parsed.bind_address ?? "127.0.0.1",
    port: parsed.port ?? 8787,
  };
}

export async function ensureSystemAppConfig(memoryRoot: string, installMode: InstallMode): Promise<{
  path: string;
  backupPath: string;
  installMode: InstallMode;
  updated: boolean;
}> {
  const configDir = path.join(memoryRoot, "system", "config");
  const appConfigPath = path.join(configDir, "app-config.json");
  const backupPath = path.join(configDir, "app-config.bak.json");
  await mkdir(configDir, { recursive: true });

  let raw = "";
  let document: Record<string, unknown> = {};
  let hasExistingConfig = false;
  try {
    raw = await readFile(appConfigPath, "utf8");
    hasExistingConfig = true;
    document = parseObjectOrDefault(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  let updated = false;
  const systemSection = getOrCreateObject(document, "system");
  if (!Object.prototype.hasOwnProperty.call(systemSection, "install_mode")) {
    systemSection.install_mode = installMode;
    updated = true;
  } else {
    const normalized = normalizeInstallMode(systemSection.install_mode);
    if (normalized !== systemSection.install_mode) {
      systemSection.install_mode = normalized;
      updated = true;
    }
  }

  if (!hasExistingConfig || updated) {
    if (hasExistingConfig && raw.trim().length > 0) {
      await writeFile(backupPath, raw.endsWith("\n") ? raw : `${raw}\n`, "utf8");
    }
    await writeFile(appConfigPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }

  return {
    path: appConfigPath,
    backupPath,
    installMode: normalizeInstallMode(systemSection.install_mode),
    updated: !hasExistingConfig || updated,
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

  const config = adapterConfigSchema.parse(JSON.parse(raw));
  return applyManagedApiBaseOverride(applyAdapterEnvironmentOverrides(config));
}

function applyManagedApiBaseOverride(config: AdapterConfig): AdapterConfig {
  const managedApiBase = process.env.BD_MANAGED_API_BASE?.replace(/\/+$/, "");
  if (!managedApiBase || !config.provider_profiles?.["braindrive-models"]) {
    return config;
  }
  const profiles = { ...config.provider_profiles };
  profiles["braindrive-models"] = {
    ...profiles["braindrive-models"],
    base_url: `${managedApiBase}/credits/v1`,
  };
  return { ...config, provider_profiles: profiles };
}

function applyAdapterEnvironmentOverrides(config: AdapterConfig): AdapterConfig {
  if (!config.provider_profiles) {
    return config;
  }

  const profiles = { ...config.provider_profiles };
  let changed = false;

  for (const [id, profile] of Object.entries(profiles)) {
    const envKey = `${(profile.provider_id ?? id).toUpperCase()}_BASE_URL`;
    const envValue = process.env[envKey]?.trim();
    if (envValue) {
      profiles[id] = { ...profile, base_url: envValue };
      changed = true;
    }
  }

  return changed ? { ...config, provider_profiles: profiles } : config;
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
  const document = JSON.parse(raw) as unknown;
  const unknownKeys = findUnknownPreferenceKeys(document);
  const parsed = preferencesSchema.parse(document);
  if (unknownKeys.length > 0) {
    auditLog("preferences.unknown_keys_ignored", {
      path: preferencesPath,
      keys: unknownKeys,
    });
    try {
      await writeFile(preferencesPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      auditLog("preferences.unknown_keys_pruned", {
        path: preferencesPath,
        keys: unknownKeys,
      });
    } catch (error) {
      auditLog("preferences.unknown_keys_prune_failed", {
        path: preferencesPath,
        keys: unknownKeys,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return parsed;
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

function findUnknownPreferenceKeys(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }
  const unknownKeys = Object.keys(input as Record<string, unknown>).filter(
    (key) => !PREFERENCE_TOP_LEVEL_KEYS.has(key)
  );
  unknownKeys.sort((left, right) => left.localeCompare(right));
  return unknownKeys;
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function looksLikeSshRepositoryUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("ssh://") || normalized.startsWith("git@");
}

function normalizeInstallMode(value: unknown): InstallMode {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "quickstart") {
    return "local";
  }
  if (normalized === "local" || normalized === "prod") {
    return normalized;
  }
  if (normalized === "unknown") {
    return "unknown";
  }
  return "unknown";
}

function parseObjectOrDefault(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall back to an empty object when parsing fails.
  }
  return {};
}

function getOrCreateObject(
  root: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const existing = root[key];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  root[key] = created;
  return created;
}
