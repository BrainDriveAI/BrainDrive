import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadPreferences, savePreferences } from "./config.js";
import type { Preferences } from "./contracts.js";

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
          default_model: "anthropic/claude-haiku-4.5",
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
    expect(loaded.default_model).toBe("anthropic/claude-haiku-4.5");
    expect(loaded.secret_resolution?.on_missing).toBe("fail_closed");
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
      default_model: "anthropic/claude-haiku-4.5",
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
  });
});
