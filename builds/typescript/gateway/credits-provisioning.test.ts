import { describe, expect, it, vi } from "vitest";

import type { Preferences } from "../contracts.js";
import { ensureBrainDriveModelsCheckoutKey } from "./credits-provisioning.js";

describe("ensureBrainDriveModelsCheckoutKey", () => {
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
