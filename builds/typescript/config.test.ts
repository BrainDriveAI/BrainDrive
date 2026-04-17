import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { loadPreferences } from "./config.js";

type JsonObject = Record<string, unknown>;

function withBasePreferences(patch: JsonObject = {}): JsonObject {
  return {
    default_model: "openai/gpt-4o-mini",
    approval_mode: "ask-on-write",
    ...patch,
  };
}

function withBaseTwilioSms(patch: JsonObject = {}): JsonObject {
  return {
    enabled: true,
    account_sid: "AC1234567890abcdef1234567890abcd",
    from_number: "+14155552671",
    public_base_url: "https://example.com",
    auto_reply: true,
    strict_owner_mode: false,
    rate_limit_period: 60,
    rate_limit_cap_round_trips: 5,
    rate_limit_current_count: 0,
    auth_token_secret_ref: "twilio/auth/token",
    ...patch,
  };
}

async function writePreferences(memoryRoot: string, value: JsonObject): Promise<void> {
  const preferencesDir = path.join(memoryRoot, "preferences");
  await mkdir(preferencesDir, { recursive: true });
  await writeFile(path.join(preferencesDir, "default.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("preferences Twilio SMS validation", () => {
  it("loads valid Twilio SMS preferences", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-config-test-"));
    try {
      await writePreferences(
        tempRoot,
        withBasePreferences({
          twilio_sms: withBaseTwilioSms({
            owner_phone_number: "+14155551212",
            test_recipient: "+14155553333",
          }),
        })
      );

      const parsed = await loadPreferences(tempRoot);
      expect(parsed.twilio_sms?.from_number).toBe("+14155552671");
      expect(parsed.twilio_sms?.auth_token_secret_ref).toBe("twilio/auth/token");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid E.164 numbers", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-config-test-"));
    try {
      await writePreferences(
        tempRoot,
        withBasePreferences({
          twilio_sms: withBaseTwilioSms({
            from_number: "4155552671",
          }),
        })
      );

      await expect(loadPreferences(tempRoot)).rejects.toThrow("valid E.164 phone number");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects negative rate-limit values", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-config-test-"));
    try {
      await writePreferences(
        tempRoot,
        withBasePreferences({
          twilio_sms: withBaseTwilioSms({
            rate_limit_cap_round_trips: -1,
          }),
        })
      );

      await expect(loadPreferences(tempRoot)).rejects.toThrow("greater than or equal to 0");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("requires owner_phone_number when strict_owner_mode is enabled", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-config-test-"));
    try {
      await writePreferences(
        tempRoot,
        withBasePreferences({
          twilio_sms: withBaseTwilioSms({
            strict_owner_mode: true,
          }),
        })
      );

      await expect(loadPreferences(tempRoot)).rejects.toThrow("owner_phone_number is required");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects insecure public_base_url values and plaintext auth token fields", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-config-test-"));
    try {
      await writePreferences(
        tempRoot,
        withBasePreferences({
          twilio_sms: withBaseTwilioSms({
            public_base_url: "http://example.com/hooks",
            auth_token: "plaintext-token",
          }),
        })
      );

      await expect(loadPreferences(tempRoot)).rejects.toThrow();
      await expect(loadPreferences(tempRoot)).rejects.toThrow(/public_base_url|auth_token/);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
