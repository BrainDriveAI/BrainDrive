import { randomUUID } from "node:crypto";

import type { Preferences, ProviderCredentialPreference } from "../contracts.js";

export const BRAINDRIVE_MODELS_PROVIDER_ID = "braindrive-models";
export const BRAINDRIVE_MODELS_SECRET_REF = "provider/ai-gateway/api_key";

type FetchLike = typeof fetch;

export type BrainDriveModelsCheckoutKeyResult = {
  apiKey: string;
  preferences: Preferences;
  secretRef: string;
  provisioned: boolean;
};

export type BrainDriveModelsProvisioningErrorCode =
  | "repair_required"
  | "status_unavailable"
  | "provision_failed"
  | "vault_write_failed";

export class BrainDriveModelsProvisioningError extends Error {
  constructor(
    public readonly code: BrainDriveModelsProvisioningErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "BrainDriveModelsProvisioningError";
  }
}

export async function ensureBrainDriveModelsCheckoutKey(input: {
  creditsApiBase: string;
  preferences: Preferences;
  fetchImpl?: FetchLike;
  now?: () => Date;
  loadVaultSecret: (secretRef: string) => Promise<string | undefined>;
  saveVaultSecret: (secretRef: string, plaintext: string) => Promise<void>;
  savePreferences: (preferences: Preferences) => Promise<void>;
}): Promise<BrainDriveModelsCheckoutKeyResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const secretRef = resolveBrainDriveModelsSecretRef(input.preferences);
  const existingKey = await input.loadVaultSecret(secretRef);

  if (existingKey && existingKey.trim().length > 0) {
    const trimmedKey = existingKey.trim();
    const statusResp = await fetchImpl(`${input.creditsApiBase}/credits/status`, {
      headers: { Authorization: `Bearer ${trimmedKey}` },
    });

    if (statusResp.status === 401 || statusResp.status === 403) {
      await input.savePreferences(
        withBrainDriveModelsMetadata(input.preferences, {
          masked_key: maskApiKey(trimmedKey),
          status: "repair_required",
          checkout_pending: false,
          last_attempt_at: now().toISOString(),
          last_error: "invalid_existing_key",
        })
      );
      throw new BrainDriveModelsProvisioningError(
        "repair_required",
        "Stored BrainDrive Models key was rejected by credits status",
        statusResp.status
      );
    }

    if (!statusResp.ok) {
      throw new BrainDriveModelsProvisioningError(
        "status_unavailable",
        "Unable to validate stored BrainDrive Models key",
        statusResp.status
      );
    }

    const nextPreferences = withBrainDriveModelsMetadata(input.preferences, {
      masked_key: maskApiKey(trimmedKey),
      status: "checkout_pending",
      checkout_pending: true,
      last_attempt_at: now().toISOString(),
      last_error: null,
    });
    await input.savePreferences(nextPreferences);
    return {
      apiKey: trimmedKey,
      preferences: nextPreferences,
      secretRef,
      provisioned: false,
    };
  }

  if (hasPriorBrainDriveModelsKey(input.preferences)) {
    await input.savePreferences(
      withBrainDriveModelsMetadata(input.preferences, {
        status: "repair_required",
        checkout_pending: false,
        last_attempt_at: now().toISOString(),
        last_error: "missing_existing_key",
      })
    );
    throw new BrainDriveModelsProvisioningError(
      "repair_required",
      "BrainDrive Models key metadata exists but the encrypted vault key is missing"
    );
  }

  const installPublicId = resolveInstallPublicId(input.preferences);
  const provisionResp = await fetchImpl(`${input.creditsApiBase}/credits/key/provision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      install_public_id: installPublicId,
    }),
  });

  if (!provisionResp.ok) {
    throw new BrainDriveModelsProvisioningError(
      "provision_failed",
      "BrainDrive Models key provisioning failed",
      provisionResp.status
    );
  }

  const provisioned = parseProvisionResponse(await provisionResp.json());
  const baseMetadata = {
    install_public_id: installPublicId,
    ...(provisioned.key_id ? { key_id: provisioned.key_id } : {}),
    ...(provisioned.key_hash ? { key_hash: provisioned.key_hash } : {}),
    masked_key: maskApiKey(provisioned.api_key),
    ...(provisioned.expires_unfunded_at ? { expires_unfunded_at: provisioned.expires_unfunded_at } : {}),
    provisioned_at: now().toISOString(),
    last_attempt_at: now().toISOString(),
  };

  try {
    await input.saveVaultSecret(secretRef, provisioned.api_key);
  } catch {
    await input.savePreferences(
      withBrainDriveModelsMetadata(input.preferences, {
        ...baseMetadata,
        status: "vault_write_failed",
        checkout_pending: false,
        last_error: "vault_write_failed",
      })
    );
    throw new BrainDriveModelsProvisioningError(
      "vault_write_failed",
      "Unable to store provisioned BrainDrive Models key in the encrypted vault"
    );
  }

  const nextPreferences = withBrainDriveModelsMetadata(
    {
      ...input.preferences,
      provider_credentials: {
        ...(input.preferences.provider_credentials ?? {}),
        [BRAINDRIVE_MODELS_PROVIDER_ID]: {
          mode: "secret_ref",
          secret_ref: secretRef,
          required: true,
        } satisfies ProviderCredentialPreference,
      },
    },
    {
      ...baseMetadata,
      status: "provisioned",
      checkout_pending: true,
      last_error: null,
    }
  );
  await input.savePreferences(nextPreferences);

  return {
    apiKey: provisioned.api_key,
    preferences: nextPreferences,
    secretRef,
    provisioned: true,
  };
}

function resolveBrainDriveModelsSecretRef(preferences: Preferences): string {
  const credential = preferences.provider_credentials?.[BRAINDRIVE_MODELS_PROVIDER_ID];
  if (credential?.mode === "secret_ref" && credential.secret_ref.trim().length > 0) {
    return credential.secret_ref.trim();
  }
  return BRAINDRIVE_MODELS_SECRET_REF;
}

function resolveInstallPublicId(preferences: Preferences): string {
  const configured = preferences.braindrive_models_key?.install_public_id?.trim();
  if (configured) {
    return configured;
  }
  return randomUUID();
}

function hasPriorBrainDriveModelsKey(preferences: Preferences): boolean {
  const metadata = preferences.braindrive_models_key;
  if (!metadata) {
    return false;
  }
  return Boolean(
    metadata.key_id ||
      metadata.key_hash ||
      metadata.masked_key ||
      metadata.status === "provisioned" ||
      metadata.status === "ready" ||
      metadata.status === "checkout_pending" ||
      metadata.status === "zero_balance"
  );
}

function withBrainDriveModelsMetadata(
  preferences: Preferences,
  metadata: NonNullable<Preferences["braindrive_models_key"]>
): Preferences {
  return {
    ...preferences,
    braindrive_models_key: {
      ...(preferences.braindrive_models_key ?? {}),
      ...metadata,
    },
  };
}

function parseProvisionResponse(value: unknown): {
  api_key: string;
  key_id?: string;
  key_hash?: string;
  expires_unfunded_at?: string;
} {
  if (!value || typeof value !== "object") {
    throw new BrainDriveModelsProvisioningError("provision_failed", "Provision response was not an object");
  }
  const record = value as Record<string, unknown>;
  const apiKey = typeof record.api_key === "string" ? record.api_key.trim() : "";
  if (!/^sk-[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
    throw new BrainDriveModelsProvisioningError("provision_failed", "Provision response did not include a valid key");
  }

  return {
    api_key: apiKey,
    ...(typeof record.key_id === "string" && record.key_id.trim() ? { key_id: record.key_id.trim() } : {}),
    ...(typeof record.key_hash === "string" && record.key_hash.trim() ? { key_hash: record.key_hash.trim() } : {}),
    ...(typeof record.expires_unfunded_at === "string" && record.expires_unfunded_at.trim()
      ? { expires_unfunded_at: record.expires_unfunded_at.trim() }
      : {}),
  };
}

function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 10) {
    return "sk-...";
  }
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}
