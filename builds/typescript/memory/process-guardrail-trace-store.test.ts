import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProcessGuardrailTraceStore,
  ProcessGuardrailTraceStoreError,
  type ProcessGuardrailTraceEvent,
} from "./process-guardrail-trace-store.js";

function traceEvent(
  sequence: number,
  overrides: Partial<ProcessGuardrailTraceEvent> = {}
): ProcessGuardrailTraceEvent {
  return {
    schema_version: 1,
    timestamp: `2026-07-23T12:00:0${sequence}.000Z`,
    event_id: `event-${sequence}`,
    sequence,
    event: sequence === 1 ? "process_started" : "stage_activated",
    run_id: "run-1",
    conversation_id: "conversation-1",
    correlation_id: "correlation-1",
    process_kind: "page-alignment-v1",
    stage: "interview",
    stage_revision: 1,
    automatic_attempt: 0,
    configured_scope: "all",
    resolved_scope: "all",
    provider_id: "ollama",
    provider_class: "local",
    model_id: "test-model",
    state_revision: sequence,
    diagnostic_health: "healthy",
    ...overrides,
  };
}

describe("ProcessGuardrailTraceStore", () => {
  let tempRoot: string | null = null;
  let stdoutSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "process-guardrail-trace-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    stdoutSpy?.mockRestore();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("appends ordered events that reconstruct a run after restart", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailTraceStore(tempRoot);

    await expect(store.append(traceEvent(1))).resolves.toMatchObject({ status: "appended" });
    await expect(store.append(traceEvent(2))).resolves.toMatchObject({ status: "appended" });
    const replay = await store.append(traceEvent(2));
    expect(replay.status).toBe("replayed");

    const restarted = new ProcessGuardrailTraceStore(tempRoot);
    const events = await restarted.readRunEvents("run-1");
    expect(events.map((event) => [event.sequence, event.event])).toEqual([
      [1, "process_started"],
      [2, "stage_activated"],
    ]);
  });

  it("rejects gaps and conflicting sequence numbers", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailTraceStore(tempRoot);
    await store.append(traceEvent(1));

    await expect(store.append(traceEvent(3))).rejects.toMatchObject({
      code: "trace_sequence_conflict",
    });
    await expect(store.append(traceEvent(1, { event_id: "different-event" }))).rejects.toMatchObject({
      code: "trace_sequence_conflict",
    });
  });

  it("serializes concurrent events for one run in sequence order", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailTraceStore(tempRoot);
    await store.append(traceEvent(1));

    const results = await Promise.all([
      store.append(traceEvent(2)),
      store.append(traceEvent(3, { event: "validation_passed" })),
    ]);

    expect(results.map((result) => result.status)).toEqual(["appended", "appended"]);
    await expect(store.readRunEvents("run-1")).resolves.toHaveLength(3);
  });

  it("rotates by size and creates owner-only trace files", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailTraceStore(tempRoot, { maxFileBytes: 1 });
    await store.append(traceEvent(1));
    await store.append(traceEvent(2));

    const traceDir = path.join(tempRoot, "diagnostics", "process-guardrails", "traces");
    const files = (await readdir(traceDir)).sort();
    expect(files).toEqual(["2026-07-23.1.jsonl", "2026-07-23.jsonl"]);
    if (process.platform !== "win32") {
      expect((await stat(path.join(traceDir, files[0]!))).mode & 0o777).toBe(0o600);
    }
  });

  it("expires trace segments outside retention", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const traceDir = path.join(tempRoot, "diagnostics", "process-guardrails", "traces");
    await mkdir(traceDir, { recursive: true });
    await writeFile(path.join(traceDir, "2026-07-01.jsonl"), `${JSON.stringify(traceEvent(1))}\n`, "utf8");

    const store = new ProcessGuardrailTraceStore(tempRoot, {
      retentionDays: 14,
      now: () => new Date("2026-07-23T12:00:00.000Z"),
    });
    await store.runRetentionSweep();

    expect(await readdir(traceDir)).not.toContain("2026-07-01.jsonl");
  });

  it.each([
    ["raw content field", { owner_message: "private owner text" }],
    ["provider payload", { provider_payload: { response: "private" } }],
    ["secret-shaped key", { api_key: "plain-secret" }],
    ["secret-shaped value", { recovery_reason: "Bearer abcdefghijklmnop" }],
    ["secret query value", { model_id: "model?token=secret-value" }],
    ["private key value", { model_id: "-----BEGIN TEST PRIVATE KEY-----" }],
  ])("rejects %s rather than redacting it into required evidence", async (_label, unsafe) => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailTraceStore(tempRoot);
    const event = { ...traceEvent(1), ...unsafe } as unknown as ProcessGuardrailTraceEvent;

    await expect(store.append(event)).rejects.toMatchObject({
      code: "trace_record_rejected",
    });
    const traceDir = path.join(tempRoot, "diagnostics", "process-guardrails", "traces");
    await expect(readdir(traceDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists only allowlisted metadata and digest references", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailTraceStore(tempRoot);
    await store.append(traceEvent(1, {
      instruction_refs: [{
        path: "documents/career/run-interview.md",
        digest: "a".repeat(64),
      }],
      artifact_refs: [{
        path: "documents/career/spec.md",
        digest: "b".repeat(64),
      }],
      validator_codes: ["required_section_missing"],
      duration_ms: 125,
      retry_class: "provider_empty_completion",
      provider_empty_retry_count: 1,
    }));

    const persisted = await readFile(
      path.join(tempRoot, "diagnostics", "process-guardrails", "traces", "2026-07-23.jsonl"),
      "utf8"
    );
    expect(persisted).toContain('"validator_codes":["required_section_missing"]');
    expect(persisted).toContain('"provider_empty_retry_count":1');
    expect(persisted).toContain(`"digest":"${"a".repeat(64)}"`);
    expect(persisted).not.toContain("owner_message");
    expect(persisted).not.toContain("provider_payload");
    expect(persisted).not.toContain("authorization");
  });

  it("reports malformed trace data instead of silently skipping it", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const traceDir = path.join(tempRoot, "diagnostics", "process-guardrails", "traces");
    await mkdir(traceDir, { recursive: true });
    await writeFile(path.join(traceDir, "2026-07-23.jsonl"), "{bad-json\n", "utf8");

    const store = new ProcessGuardrailTraceStore(tempRoot);
    await expect(store.readRunEvents("run-1")).rejects.toMatchObject({
      code: "trace_corrupt",
    });
  });

  it("preserves and rejects unsupported trace schema records", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const traceDir = path.join(tempRoot, "diagnostics", "process-guardrails", "traces");
    const tracePath = path.join(traceDir, "2026-07-23.jsonl");
    const unsupported = JSON.stringify({
      ...traceEvent(1),
      schema_version: 99,
    });
    await mkdir(traceDir, { recursive: true });
    await writeFile(tracePath, `${unsupported}\n`, "utf8");

    const store = new ProcessGuardrailTraceStore(tempRoot);
    await expect(store.readRunEvents("run-1")).rejects.toMatchObject({
      code: "trace_corrupt",
    });
    await expect(readFile(tracePath, "utf8")).resolves.toBe(`${unsupported}\n`);
  });

  it("surfaces append failure as a typed error and protected diagnostic", async () => {
    if (!tempRoot || !stdoutSpy) throw new Error("Missing test setup");
    const store = new ProcessGuardrailTraceStore(tempRoot, {
      io: {
        appendFile: async () => {
          throw new Error("injected append failure");
        },
      },
    });

    await expect(store.append(traceEvent(1))).rejects.toBeInstanceOf(ProcessGuardrailTraceStoreError);
    await expect(store.append(traceEvent(1))).rejects.toMatchObject({
      code: "trace_persist_failed",
    });

    const output = (stdoutSpy.mock.calls as unknown[][])
      .map((call) => String(call[0]))
      .join("");
    expect(output).toContain('"event":"process_guardrails.trace_persist_failed"');
    expect(output).not.toContain("injected append failure");
  });
});
