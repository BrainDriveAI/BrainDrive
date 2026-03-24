import type {
  AdapterConfig,
  Preferences,
  ProviderCredentialPreference,
  ResolvedProviderCredential,
} from "../contracts.js";
import { loadMasterKey } from "./key-provider.js";
import { resolveSecretsPaths, type SecretsPaths } from "./paths.js";
import { promptForSecretInput } from "./prompt.js";
import { getVaultSecret } from "./vault.js";

type ProviderCredentialMatch = {
  providerId: string;
  preference: ProviderCredentialPreference;
};

export type ResolveProviderCredentialOptions = {
  paths?: SecretsPaths;
  promptForSecret?: (secretRef: string, providerId: string) => Promise<string>;
};

export async function resolveProviderCredentialForStartup(
  adapterName: string,
  adapterConfig: AdapterConfig,
  preferences: Preferences,
  options: ResolveProviderCredentialOptions = {}
): Promise<ResolvedProviderCredential | undefined> {
  const providerCredentialMatch = findProviderCredentialPreference(adapterName, adapterConfig, preferences);
  if (!providerCredentialMatch) {
    return undefined;
  }

  const { providerId, preference } = providerCredentialMatch;
  if (preference.mode === "plain") {
    return undefined;
  }

  const secretRef = preference.secret_ref.trim();
  const onMissing = preferences.secret_resolution?.on_missing ?? "fail_closed";
  const required = preference.required ?? true;

  const envOverride = resolveEnvOverride(preference.env_ref);
  if (envOverride) {
    return {
      providerId,
      secretRef,
      source: "env_ref",
      apiKey: envOverride,
    };
  }

  const paths = options.paths ?? resolveSecretsPaths();
  const vaultResult = await resolveFromVault(secretRef, paths);
  if (vaultResult.value) {
    return {
      providerId,
      secretRef,
      source: "vault",
      apiKey: vaultResult.value,
    };
  }

  if (onMissing === "prompt_once") {
    const prompt = options.promptForSecret ?? defaultPromptForSecret;
    const promptedValue = (await prompt(secretRef, providerId)).trim();
    if (promptedValue.length > 0) {
      return {
        providerId,
        secretRef,
        source: "prompt_once",
        apiKey: promptedValue,
      };
    }
  }

  if (!required) {
    return undefined;
  }

  if (vaultResult.error) {
    throw new Error(
      `Failed to resolve required secret reference ${secretRef} for provider ${providerId}: ${vaultResult.error.message}`
    );
  }

  throw new Error(`Required secret reference ${secretRef} for provider ${providerId} is missing`);
}

function findProviderCredentialPreference(
  adapterName: string,
  adapterConfig: AdapterConfig,
  preferences: Preferences
): ProviderCredentialMatch | undefined {
  const credentialMap = preferences.provider_credentials;
  if (!credentialMap) {
    return undefined;
  }

  const candidates = dedupe(
    [
      adapterConfig.provider_id,
      inferProviderId(adapterConfig.base_url),
      adapterName,
    ].filter((value): value is string => Boolean(value && value.trim().length > 0))
  );

  for (const candidate of candidates) {
    const preference = credentialMap[candidate];
    if (preference) {
      return {
        providerId: candidate,
        preference,
      };
    }
  }

  const allProviderIds = Object.keys(credentialMap);
  if (allProviderIds.length === 1) {
    const providerId = allProviderIds[0];
    if (!providerId) {
      return undefined;
    }
    const preference = credentialMap[providerId];
    if (!preference) {
      return undefined;
    }
    return {
      providerId,
      preference,
    };
  }

  return undefined;
}

function inferProviderId(baseUrl: string): string | undefined {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname.includes("openrouter")) {
      return "openrouter";
    }
    if (hostname.includes("openai")) {
      return "openai";
    }
    if (hostname.includes("anthropic")) {
      return "anthropic";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveEnvOverride(envRef: string | undefined): string | undefined {
  if (!envRef || envRef.trim().length === 0) {
    return undefined;
  }
  const value = process.env[envRef]?.trim();
  if (!value || value.length === 0) {
    return undefined;
  }
  return value;
}

async function resolveFromVault(
  secretRef: string,
  paths: SecretsPaths
): Promise<{ value?: string; error?: Error }> {
  try {
    const masterKey = await loadMasterKey(paths);
    const value = await getVaultSecret(secretRef, masterKey, paths);
    return { value };
  } catch (error) {
    return { error: error as Error };
  }
}

async function defaultPromptForSecret(secretRef: string, providerId: string): Promise<string> {
  return promptForSecretInput(`Enter secret for ${providerId} (${secretRef}): `);
}
