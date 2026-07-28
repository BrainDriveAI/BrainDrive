import { describe, expect, it, vi } from "vitest";

import type { Preferences } from "../contracts.js";
import {
  ensureBrainDriveModelsCheckoutKey,
  ensureBrainDriveModelsClaimKey,
} from "./credits-provisioning.js";

const basePreferences: Preferences = {
  default_model: "braindrive-models-default",
  approval_mode: "ask-on-write",
  active_provider_profile: "braindrive-models",
};

describe("ensureBrainDriveModelsCheckoutKey", () => {
  it("preserves checkout_pending semantics for an existing vault key", async () => {
    const savedPreferences: Preferences[] = [];
    const result = await ensureBrainDriveModelsCheckoutKey({
      creditsApiBase: "https://credits.example",
      preferences: {
        ...basePreferences,
        braindrive_models_key: { install_public_id: "install-existing" },
      },
      loadVaultSecret: vi.fn(async () => "sk-existing-checkout-key"),
      saveVaultSecret: vi.fn(),
      savePreferences: vi.fn(async (next) => {
        savedPreferences.push(next);
      }),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ remaining_usd: 0 }), { status: 200 })),
    });

    expect(result.provisioned).toBe(false);
    expect(result.installPublicId).toBe("install-existing");
    expect(savedPreferences.at(-1)?.braindrive_models_key).toMatchObject({
      status: "checkout_pending",
      checkout_pending: true,
    });
  });

  it("records retry metadata without exposing raw keys when vault storage fails", async () => {
    const rawKey = "sk-vault-write-failure-secret";
    const preferences: Preferences = {
      default_model: "braindrive-models-default",
      approval_mode: "ask-on-write",
      active_provider_profile: "braindrive-models",
    };
    const savedPreferences: Preferences[] = [];

    await expect(
      ensureBrainDriveModelsCheckoutKey({
        creditsApiBase: "https://credits.example",
        preferences,
        now: () => new Date("2026-07-06T12:00:00.000Z"),
        loadVaultSecret: vi.fn(async () => undefined),
        saveVaultSecret: vi.fn(async () => {
          throw new Error(`cannot write ${rawKey}`);
        }),
        savePreferences: vi.fn(async (next) => {
          savedPreferences.push(next);
        }),
        fetchImpl: vi.fn(async () =>
          new Response(
            JSON.stringify({
              api_key: rawKey,
              key_id: "token-failed",
              key_hash: "hash-failed",
              status: "active",
              expires_unfunded_at: "2026-07-07T12:00:00.000Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        ),
      })
    ).rejects.toMatchObject({ code: "vault_write_failed" });

    expect(savedPreferences).toHaveLength(1);
    const serialized = JSON.stringify(savedPreferences[0]);
    expect(serialized).not.toContain(rawKey);
    expect(savedPreferences[0]?.braindrive_models_key).toMatchObject({
      key_id: "token-failed",
      key_hash: "hash-failed",
      masked_key: "sk-...cret",
      status: "vault_write_failed",
      checkout_pending: false,
    });
  });
});

describe("ensureBrainDriveModelsClaimKey", () => {
  it("validates an existing key and records claim readiness without checkout state", async () => {
    const savedPreferences: Preferences[] = [];
    const result = await ensureBrainDriveModelsClaimKey({
      creditsApiBase: "https://credits.example",
      preferences: basePreferences,
      loadVaultSecret: vi.fn(async () => "sk-existing-claim-key"),
      saveVaultSecret: vi.fn(),
      savePreferences: vi.fn(async (next) => {
        savedPreferences.push(next);
      }),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ remaining_usd: 0 }), { status: 200 })),
    });

    expect(result.installPublicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(savedPreferences.at(-1)?.braindrive_models_key).toMatchObject({
      install_public_id: result.installPublicId,
      status: "ready",
      checkout_pending: false,
    });
    expect(savedPreferences.at(-1)?.provider_credentials?.["braindrive-models"]).toEqual({
      mode: "secret_ref",
      secret_ref: "provider/ai-gateway/api_key",
      required: true,
    });
  });

  it("stores a provisioned key in the vault before saving safe claim metadata", async () => {
    const calls: string[] = [];
    const rawKey = "sk-new-claim-key-secret";
    const savedPreferences: Preferences[] = [];
    const result = await ensureBrainDriveModelsClaimKey({
      creditsApiBase: "https://credits.example",
      preferences: basePreferences,
      loadVaultSecret: vi.fn(async () => undefined),
      saveVaultSecret: vi.fn(async () => {
        calls.push("vault");
      }),
      savePreferences: vi.fn(async (next) => {
        calls.push("preferences");
        savedPreferences.push(next);
      }),
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ api_key: rawKey, key_id: "key-1", key_hash: "hash-1" }), { status: 200 })
      ),
    });

    expect(calls).toEqual(["vault", "preferences"]);
    expect(result.apiKey).toBe(rawKey);
    expect(savedPreferences.at(-1)?.braindrive_models_key).toMatchObject({
      status: "provisioned",
      checkout_pending: false,
    });
    expect(JSON.stringify(savedPreferences)).not.toContain(rawKey);
  });

  it("requires repair instead of overwriting missing prior key material", async () => {
    const saveVaultSecret = vi.fn();
    const fetchImpl = vi.fn();
    await expect(
      ensureBrainDriveModelsClaimKey({
        creditsApiBase: "https://credits.example",
        preferences: {
          ...basePreferences,
          braindrive_models_key: { key_id: "prior-key", masked_key: "sk-...rior" },
        },
        loadVaultSecret: vi.fn(async () => undefined),
        saveVaultSecret,
        savePreferences: vi.fn(),
        fetchImpl,
      })
    ).rejects.toMatchObject({ code: "repair_required" });

    expect(saveVaultSecret).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
