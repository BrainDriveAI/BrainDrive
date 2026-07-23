import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProcessGuardrailScopeConfigError,
  loadPreferences,
  loadRuntimeConfig,
  readBootstrapPrompt,
  savePreferences,
} from "./config.js";
import type { Preferences } from "./contracts.js";

describe("process guardrail runtime configuration", () => {
  let tempRoot: string | null = null;
  let previousScope: string | undefined;
  let stdoutSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-runtime-config-"));
    previousScope = process.env.BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await writeFile(
      path.join(tempRoot, "config.json"),
      `${JSON.stringify({
        memory_root: "memory",
        provider_adapter: "openai-compatible",
        auth_mode: "local-owner",
        tool_sources: [],
      })}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    stdoutSpy?.mockRestore();
    if (previousScope === undefined) {
      delete process.env.BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE;
    } else {
      process.env.BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE = previousScope;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing", undefined, "missing", "all"],
    ["empty", "", "empty", "all"],
    ["whitespace", "   \t", "empty", "all"],
    ["none", "none", "none", "none"],
    ["local", "local", "local", "local"],
    ["cloud", "cloud", "cloud", "cloud"],
    ["all", "all", "all", "all"],
    ["trimmed mixed case", "  ClOuD  ", "cloud", "cloud"],
  ])("resolves %s scope input", async (
    _label,
    configuredScope,
    expectedConfiguredScope,
    expectedScope
  ) => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    if (configuredScope === undefined) {
      delete process.env.BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE;
    } else {
      process.env.BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE = configuredScope;
    }

    const loaded = await loadRuntimeConfig(tempRoot);

    expect(loaded.process_guardrails_scope).toBe(expectedScope);
    expect(loaded.process_guardrails_configured_scope).toBe(
      expectedConfiguredScope
    );
  });

  it("rejects an invalid non-empty scope without echoing its value", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    process.env.BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE = "https://example.invalid/?token=do-not-log";

    await expect(loadRuntimeConfig(tempRoot)).rejects.toMatchObject({
      name: "ProcessGuardrailScopeConfigError",
      code: "invalid_process_guardrail_scope",
    });
    await expect(loadRuntimeConfig(tempRoot)).rejects.toThrow(
      "BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE must be one of: none, local, cloud, all"
    );

    try {
      await loadRuntimeConfig(tempRoot);
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessGuardrailScopeConfigError);
      expect((error as Error).message).not.toContain("do-not-log");
    }
  });

  it.each([
    ["missing", undefined, "missing", "all"],
    ["empty", "  ", "empty", "all"],
    ["configured", " ClOuD ", "cloud", "cloud"],
  ])(
    "emits sanitized configured and resolved diagnostics for %s input",
    async (_label, configuredScope, expectedConfiguredScope, expectedResolvedScope) => {
      if (!tempRoot || !stdoutSpy) {
        throw new Error("Missing test setup");
      }

      if (configuredScope === undefined) {
        delete process.env.BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE;
      } else {
        process.env.BRAINDRIVE_PROCESS_GUARDRAILS_SCOPE = configuredScope;
      }

      await loadRuntimeConfig(tempRoot);

      const payloads = (stdoutSpy.mock.calls as unknown[][])
        .map((call): string => typeof call[0] === "string" ? call[0].trim() : "")
        .filter((value) => value.length > 0)
        .map((value) => JSON.parse(value) as {
          event: string;
          details: Record<string, unknown>;
        });
      const diagnostic = payloads.find((payload) => payload.event === "process_guardrails.config");

      expect(diagnostic?.details).toEqual({
        configured_scope: expectedConfiguredScope,
        resolved_scope: expectedResolvedScope,
      });
    }
  );
});

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
