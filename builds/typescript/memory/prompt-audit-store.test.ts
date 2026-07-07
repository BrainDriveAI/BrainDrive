import os from "node:os";
import path from "node:path";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Preferences, PromptAuditPreference } from "../contracts.js";
import {
  createPromptAuditRecorder,
  PromptAuditStore,
  sanitizePromptAuditValue,
} from "./prompt-audit-store.js";

const enabledPreference: PromptAuditPreference = {
  enabled: true,
  detail: "standard",
  retention_days: 14,
  max_file_bytes: 5 * 1024 * 1024,
  include_provider_payload: true,
  include_provider_response: true,
  include_source_snapshots: true,
};

describe("PromptAuditStore", () => {
  let tempRoot: string | null = null;
  let stdoutSpy: { mockRestore: () => void } | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtempRoot();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    stdoutSpy?.mockRestore();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not create prompt audit files when disabled", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const preferences = {
      default_model: "test-model",
      approval_mode: "auto-approve",
      prompt_audit: { ...enabledPreference, enabled: false },
    } satisfies Preferences;

    const recorder = createPromptAuditRecorder({
      memoryRoot: tempRoot,
      preferences,
      traceId: "trace-1",
      conversationId: "conversation-1",
      correlationId: "correlation-1",
    });

    expect(recorder).toBeNull();
    await expect(readdir(path.join(tempRoot, "diagnostics", "prompt-audit"))).rejects.toThrow();
  });

  it("redacts sensitive headers and secret-looking strings before persistence", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const store = new PromptAuditStore(tempRoot, enabledPreference, {
      now: () => new Date("2026-05-26T12:00:00.000Z"),
    });
    const recorder = store.createRecorder({
      traceId: "trace-1",
      conversationId: "conversation-1",
      correlationId: "correlation-1",
    });

    await recorder.append("prompt_audit.provider_request", {
      headers: {
        authorization: "Bearer sk-secretvalue123456789",
        cookie: "session=abc123456789",
      },
      provider_request_body: {
        prompt: "use sk-secretvalue123456789",
      },
    });

    const persisted = await readFile(path.join(tempRoot, "diagnostics", "prompt-audit", "2026-05-26.jsonl"), "utf8");
    expect(persisted).toContain('"authorization":"[REDACTED]"');
    expect(persisted).toContain('"cookie":"[REDACTED]"');
    expect(persisted).not.toContain("sk-secretvalue123456789");
  });

  it("rotates files by configured byte size", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const store = new PromptAuditStore(tempRoot, { ...enabledPreference, max_file_bytes: 180 }, {
      now: () => new Date("2026-05-26T12:00:00.000Z"),
    });
    const recorder = store.createRecorder({
      traceId: "trace-1",
      conversationId: "conversation-1",
      correlationId: "correlation-1",
    });

    await recorder.append("prompt_audit.trace_started", { payload: "x".repeat(80) });
    await recorder.append("prompt_audit.trace_completed", { payload: "y".repeat(80) });

    const files = await readdir(path.join(tempRoot, "diagnostics", "prompt-audit"));
    expect(files.sort()).toEqual(["2026-05-26.1.jsonl", "2026-05-26.jsonl"]);
  });

  it("removes files outside retention during append", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const auditDir = path.join(tempRoot, "diagnostics", "prompt-audit");
    await mkdir(auditDir, { recursive: true });
    await writeFile(path.join(auditDir, "2026-05-20.jsonl"), "{}\n", "utf8");

    const store = new PromptAuditStore(tempRoot, { ...enabledPreference, retention_days: 2 }, {
      now: () => new Date("2026-05-26T12:00:00.000Z"),
    });
    const recorder = store.createRecorder({
      traceId: "trace-1",
      conversationId: "conversation-1",
      correlationId: "correlation-1",
    });

    await recorder.append("prompt_audit.trace_started");

    const files = await readdir(auditDir);
    expect(files).not.toContain("2026-05-20.jsonl");
    expect(files).toContain("2026-05-26.jsonl");
  });
});

describe("sanitizePromptAuditValue", () => {
  it("redacts sensitive nested fields", () => {
    expect(
      sanitizePromptAuditValue({
        api_key: "plain-secret",
        apiKey: "sk-camelcasekey123456",
        raw_key: "sk-rawkeyvalue123456",
        nested: {
          token: "secret-token",
          secret_ref: "provider/openrouter/api_key",
        },
      })
    ).toEqual({
      api_key: "[REDACTED]",
      apiKey: "[REDACTED]",
      raw_key: "[REDACTED]",
      nested: {
        token: "[REDACTED]",
        secret_ref: "provider/openrouter/api_key",
      },
    });
  });
});

async function mkdtempRoot(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), "prompt-audit-store-"));
}
