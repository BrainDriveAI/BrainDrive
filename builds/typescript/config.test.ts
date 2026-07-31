import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadPreferences, readBootstrapPrompt, savePreferences } from "./config.js";
import type { Preferences } from "./contracts.js";
import { normalizeProviderActivationRevision } from "./gateway/provider-activation.js";

describe("preferences compatibility", () => {
  let tempRoot: string | null = null;
  let stdoutSpy: { mockRestore: () => void } | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-config-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    stdoutSpy?.mockRestore();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("ignores and prunes unknown top-level preference keys on load", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferencesDir = path.join(tempRoot, "preferences");
    await mkdir(preferencesDir, { recursive: true });
    await writeFile(
      path.join(preferencesDir, "default.json"),
      `${JSON.stringify(
        {
          default_model: "z-ai/glm-5.2",
          approval_mode: "ask-on-write",
          provider_base_urls: {
            ollama: "http://127.0.0.1:11434/v1",
          },
          twilio_sms: {
            enabled: true,
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const loaded = await loadPreferences(tempRoot);
    expect(loaded.default_model).toBe("z-ai/glm-5.2");
    expect(loaded.secret_resolution?.on_missing).toBe("fail_closed");
    expect(loaded.prompt_audit?.enabled).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(loaded as Record<string, unknown>, "twilio_sms")).toBe(false);

    const persisted = JSON.parse(await readFile(path.join(preferencesDir, "default.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.prototype.hasOwnProperty.call(persisted, "twilio_sms")).toBe(false);
  });

  it("strips unknown preference keys when saving", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferencesDir = path.join(tempRoot, "preferences");
    await mkdir(preferencesDir, { recursive: true });

    const nextPreferences = {
      default_model: "z-ai/glm-5.2",
      approval_mode: "ask-on-write",
      twilio_sms: {
        enabled: true,
      },
    } as unknown as Preferences;

    await savePreferences(tempRoot, nextPreferences);
    const persisted = JSON.parse(await readFile(path.join(preferencesDir, "default.json"), "utf8")) as Record<
      string,
      unknown
    >;

    expect(Object.prototype.hasOwnProperty.call(persisted, "twilio_sms")).toBe(false);
    expect((persisted.secret_resolution as Record<string, unknown>).on_missing).toBe("fail_closed");
    expect((persisted.prompt_audit as Record<string, unknown>).enabled).toBe(false);
  });

  it("keeps prompt audit preferences as a known top-level key", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferencesDir = path.join(tempRoot, "preferences");
    await mkdir(preferencesDir, { recursive: true });
    await writeFile(
      path.join(preferencesDir, "default.json"),
      `${JSON.stringify(
        {
          default_model: "z-ai/glm-5.2",
          approval_mode: "ask-on-write",
          prompt_audit: {
            enabled: true,
            detail: "verbose",
            retention_days: 7,
            max_file_bytes: 1024,
            include_provider_payload: true,
            include_provider_response: true,
            include_source_snapshots: false,
          },
          unknown_setting: true,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const loaded = await loadPreferences(tempRoot);
    expect(loaded.prompt_audit).toMatchObject({
      enabled: true,
      detail: "verbose",
      retention_days: 7,
      max_file_bytes: 1024,
      include_source_snapshots: false,
    });

    const persisted = JSON.parse(await readFile(path.join(preferencesDir, "default.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.prototype.hasOwnProperty.call(persisted, "prompt_audit")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(persisted, "unknown_setting")).toBe(false);
  });

  it("round-trips entitlement metadata and provider activation revisions", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferencesDir = path.join(tempRoot, "preferences");
    await mkdir(preferencesDir, { recursive: true });

    const nextPreferences = {
      default_model: "braindrive-models-default",
      approval_mode: "ask-on-write",
      active_provider_profile: "braindrive-models",
      provider_activation_revision: 4,
      braindrive_models_entitlement: {
        operation_id: "operation-round-trip",
        status: "completed",
        applied_cents: 2500,
        provider_activation_revision_at_start: 3,
        last_attempt_at: "2026-07-30T12:34:56.000Z",
        last_error: null,
      },
      unrelated_setting: true,
    } as unknown as Preferences;

    await savePreferences(tempRoot, nextPreferences);
    const loaded = await loadPreferences(tempRoot);

    expect(loaded).toMatchObject({
      provider_activation_revision: 4,
      braindrive_models_entitlement: {
        operation_id: "operation-round-trip",
        status: "completed",
        applied_cents: 2500,
        provider_activation_revision_at_start: 3,
        last_attempt_at: "2026-07-30T12:34:56.000Z",
        last_error: null,
      },
    });

    const persisted = JSON.parse(await readFile(path.join(preferencesDir, "default.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(persisted.provider_activation_revision).toBe(4);
    expect(Object.prototype.hasOwnProperty.call(persisted, "unrelated_setting")).toBe(false);
    expect(Object.keys(persisted.braindrive_models_entitlement as Record<string, unknown>).sort()).toEqual([
      "applied_cents",
      "last_attempt_at",
      "last_error",
      "operation_id",
      "provider_activation_revision_at_start",
      "status",
    ]);
  });

  it("loads legacy entitlement metadata without writing revision fields", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferencesDir = path.join(tempRoot, "preferences");
    await mkdir(preferencesDir, { recursive: true });
    await writeFile(
      path.join(preferencesDir, "default.json"),
      `${JSON.stringify(
        {
          default_model: "braindrive-models-default",
          approval_mode: "ask-on-write",
          active_provider_profile: "openrouter",
          braindrive_models_entitlement: {
            operation_id: "operation-legacy",
            status: "pending",
            last_attempt_at: "2026-07-30T12:34:56.000Z",
            last_error: null,
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const loaded = await loadPreferences(tempRoot);

    expect(loaded.braindrive_models_entitlement).toEqual({
      operation_id: "operation-legacy",
      status: "pending",
      last_attempt_at: "2026-07-30T12:34:56.000Z",
      last_error: null,
    });
    expect(Object.prototype.hasOwnProperty.call(loaded, "provider_activation_revision")).toBe(false);
    expect(normalizeProviderActivationRevision(loaded.provider_activation_revision)).toBe(0);
    expect(
      Object.prototype.hasOwnProperty.call(
        loaded.braindrive_models_entitlement ?? {},
        "provider_activation_revision_at_start"
      )
    ).toBe(false);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["string", "1"],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a %s provider activation revision", async (_label, invalidRevision) => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferencesDir = path.join(tempRoot, "preferences");
    await mkdir(preferencesDir, { recursive: true });
    const nextPreferences = {
      default_model: "braindrive-models-default",
      approval_mode: "ask-on-write",
      provider_activation_revision: invalidRevision,
    } as unknown as Preferences;

    await expect(savePreferences(tempRoot, nextPreferences)).rejects.toThrow();
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["string", "1"],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a %s captured provider activation revision", async (_label, invalidRevision) => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferencesDir = path.join(tempRoot, "preferences");
    await mkdir(preferencesDir, { recursive: true });
    const nextPreferences = {
      default_model: "braindrive-models-default",
      approval_mode: "ask-on-write",
      braindrive_models_entitlement: {
        operation_id: "operation-invalid",
        status: "pending",
        provider_activation_revision_at_start: invalidRevision,
      },
    } as unknown as Preferences;

    await expect(savePreferences(tempRoot, nextPreferences)).rejects.toThrow();
  });

  it("rejects JSON null revisions produced by non-finite numeric serialization", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferencesDir = path.join(tempRoot, "preferences");
    await mkdir(preferencesDir, { recursive: true });
    await writeFile(
      path.join(preferencesDir, "default.json"),
      `${JSON.stringify({
        default_model: "braindrive-models-default",
        approval_mode: "ask-on-write",
        provider_activation_revision: Number.NaN,
        braindrive_models_entitlement: {
          operation_id: "operation-non-finite",
          status: "pending",
          provider_activation_revision_at_start: Number.POSITIVE_INFINITY,
        },
      })}\n`,
      "utf8"
    );

    await expect(loadPreferences(tempRoot)).rejects.toThrow();
  });

  it("rejects unknown or sensitive entitlement fields", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferencesDir = path.join(tempRoot, "preferences");
    await mkdir(preferencesDir, { recursive: true });
    const nextPreferences = {
      default_model: "braindrive-models-default",
      approval_mode: "ask-on-write",
      braindrive_models_entitlement: {
        operation_id: "operation-sensitive",
        status: "pending",
        billing_email: "owner@example.com",
        api_key: "not-a-real-key",
      },
    } as unknown as Preferences;

    await expect(savePreferences(tempRoot, nextPreferences)).rejects.toThrow();
  });
});

describe("bootstrap prompt", () => {
  let tempRoot: string | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-bootstrap-"));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("prepends the current date and managed base prompt", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    await writeFile(path.join(tempRoot, "AGENT.md"), "Base instructions\n", "utf8");

    const prompt = await readBootstrapPrompt(tempRoot, new Date(2026, 4, 26));

    expect(prompt).toContain("Today's date is 2026-05-26.");
    expect(prompt).toContain("read managed base files first");
    expect(prompt).toContain("## Managed Base: AGENT.md\n\nBase instructions");
    expect(prompt).not.toContain("## Owner Overlay: AGENT-user.md");
  });

  it("appends AGENT-user.md after AGENT.md when present", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    await writeFile(path.join(tempRoot, "AGENT.md"), "Base instructions\n", "utf8");
    await writeFile(path.join(tempRoot, "AGENT-user.md"), "Owner overlay\n", "utf8");

    const prompt = await readBootstrapPrompt(tempRoot, new Date(2026, 4, 26));

    expect(prompt.indexOf("Base instructions")).toBeLessThan(prompt.indexOf("Owner overlay"));
    expect(prompt).toContain("## Owner Overlay: AGENT-user.md\n\nOwner overlay");
  });
});
