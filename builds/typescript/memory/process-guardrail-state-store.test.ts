import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProcessGuardrailRevisionConflictError,
  ProcessGuardrailStateRecoveryRequiredError,
  ProcessGuardrailStateStore,
  ProcessGuardrailStateStoreError,
  type ProcessGuardrailTuple,
} from "./process-guardrail-state-store.js";
import { createInitialProcessGuardrailState } from "../engine/process-guardrails/state-machine.js";

const tuple: ProcessGuardrailTuple = {
  conversationId: "conversation-1",
  pageId: "career",
  processKind: "page-alignment-v1",
};

function stateFor(
  targetTuple = tuple,
  createdAt = "2026-07-01T12:00:00.000Z",
  runId = "run-1"
) {
  return createInitialProcessGuardrailState({
    runId,
    conversationId: targetTuple.conversationId,
    pageId: targetTuple.pageId,
    providerId: "ollama",
    providerClass: "local",
    modelId: "test-model",
    configuredScope: "all",
    resolvedScope: "all",
    createdAt,
    transitionId: "created",
  });
}

describe("ProcessGuardrailStateStore", () => {
  let tempRoot: string | null = null;
  let stdoutSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "process-guardrail-state-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    stdoutSpy?.mockRestore();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates an atomic owner-only snapshot and reloads it after restart", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailStateStore(tempRoot);

    const created = await store.create(tuple, stateFor());
    const statePath = store.statePath(tuple);
    const files = await readdir(path.dirname(statePath));

    expect(created.revision).toBe(1);
    expect(files).toEqual([path.basename(statePath)]);
    if (process.platform !== "win32") {
      expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    }

    const restarted = new ProcessGuardrailStateStore(tempRoot);
    await expect(restarted.load(tuple)).resolves.toEqual({
      status: "ok",
      state: created,
    });
  });

  it("updates with compare-and-set and replays the same transition idempotently", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailStateStore(tempRoot);
    await store.create(tuple, stateFor());

    const first = await store.transition(tuple, {
      expectedRevision: 1,
      transition: {
        type: "begin_attempt",
        stage: "interview",
        transition_id: "attempt-1",
        timestamp: "2026-07-01T12:00:01.000Z",
      },
    });
    const replay = await store.transition(tuple, {
      expectedRevision: 1,
      transition: {
        type: "begin_attempt",
        stage: "interview",
        transition_id: "attempt-1",
        timestamp: "2026-07-01T12:00:01.000Z",
      },
    });

    expect(first.status).toBe("updated");
    expect(first.state.revision).toBe(2);
    expect(replay).toEqual({ status: "replayed", state: first.state });
  });

  it("serializes same-tuple writers so one stale revision loses", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailStateStore(tempRoot);
    await store.create(tuple, stateFor());

    const results = await Promise.allSettled([
      store.transition(tuple, {
        expectedRevision: 1,
        transition: {
          type: "begin_attempt",
          stage: "interview",
          transition_id: "writer-a",
          timestamp: "2026-07-01T12:00:01.000Z",
        },
      }),
      store.transition(tuple, {
        expectedRevision: 1,
        transition: {
          type: "begin_attempt",
          stage: "interview",
          transition_id: "writer-b",
          timestamp: "2026-07-01T12:00:01.000Z",
        },
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(ProcessGuardrailRevisionConflictError),
    });
    const loaded = await store.load(tuple);
    expect(loaded.status === "ok" ? loaded.state.revision : null).toBe(2);
  });

  it("shares the same-tuple mutex across store instances in one process", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const firstStore = new ProcessGuardrailStateStore(tempRoot);
    const secondStore = new ProcessGuardrailStateStore(tempRoot);
    await firstStore.create(tuple, stateFor());

    const results = await Promise.allSettled([
      firstStore.transition(tuple, {
        expectedRevision: 1,
        transition: {
          type: "begin_attempt",
          stage: "interview",
          transition_id: "instance-a",
          timestamp: "2026-07-01T12:00:01.000Z",
        },
      }),
      secondStore.transition(tuple, {
        expectedRevision: 1,
        transition: {
          type: "begin_attempt",
          stage: "interview",
          transition_id: "instance-b",
          timestamp: "2026-07-01T12:00:01.000Z",
        },
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("updates different tuples independently", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const otherTuple = {
      conversationId: "conversation-2",
      pageId: "finance",
      processKind: "page-alignment-v1" as const,
    };
    const store = new ProcessGuardrailStateStore(tempRoot);
    await store.create(tuple, stateFor());
    await store.create(otherTuple, stateFor(otherTuple, "2026-07-01T12:00:00.000Z", "run-2"));

    const [first, second] = await Promise.all([
      store.transition(tuple, {
        expectedRevision: 1,
        transition: {
          type: "begin_attempt",
          stage: "interview",
          transition_id: "tuple-a",
          timestamp: "2026-07-01T12:00:01.000Z",
        },
      }),
      store.transition(otherTuple, {
        expectedRevision: 1,
        transition: {
          type: "begin_attempt",
          stage: "interview",
          transition_id: "tuple-b",
          timestamp: "2026-07-01T12:00:01.000Z",
        },
      }),
    ]);

    expect([first.state.revision, second.state.revision]).toEqual([2, 2]);
  });

  it.each([
    ["malformed", "{not-json", "corrupt"],
    ["unsupported", JSON.stringify({ schema_version: 99, contract_version: 1 }), "unsupported"],
  ] as const)("preserves %s state and returns a typed recovery result", async (_label, content, status) => {
    if (!tempRoot) throw new Error("Missing temp root");
    const store = new ProcessGuardrailStateStore(tempRoot);
    const statePath = store.statePath(tuple);
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, content, "utf8");

    const loaded = await store.load(tuple);
    expect(loaded.status).toBe(status);
    await expect(store.transition(tuple, {
      expectedRevision: 1,
      transition: {
        type: "begin_attempt",
        stage: "interview",
        transition_id: "unsafe-overwrite",
        timestamp: "2026-07-01T12:00:01.000Z",
      },
    })).rejects.toBeInstanceOf(ProcessGuardrailStateRecoveryRequiredError);
    await expect(readFile(statePath, "utf8")).resolves.toBe(content);
  });

  it("retains nonterminal and corrupt state while expiring old terminal state", async () => {
    if (!tempRoot) throw new Error("Missing temp root");
    const oldTime = "2026-07-01T12:00:00.000Z";
    const terminalTuple = { ...tuple, conversationId: "terminal" };
    const activeTuple = { ...tuple, conversationId: "active" };
    const corruptTuple = { ...tuple, conversationId: "corrupt" };
    const oldStore = new ProcessGuardrailStateStore(tempRoot, {
      now: () => new Date(oldTime),
    });
    await oldStore.create(terminalTuple, stateFor(terminalTuple, oldTime, "terminal-run"));
    await oldStore.create(activeTuple, stateFor(activeTuple, oldTime, "active-run"));
    await oldStore.transition(terminalTuple, {
      expectedRevision: 1,
      transition: {
        type: "stop_process",
        transition_id: "stop",
        timestamp: oldTime,
      },
    });
    await writeFile(oldStore.statePath(corruptTuple), "{bad", "utf8");

    const currentStore = new ProcessGuardrailStateStore(tempRoot, {
      now: () => new Date("2026-07-23T12:00:00.000Z"),
    });
    await currentStore.runRetentionSweep();

    await expect(readFile(currentStore.statePath(terminalTuple), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(currentStore.statePath(activeTuple), "utf8")).resolves.toContain('"outcome": "active"');
    await expect(readFile(currentStore.statePath(corruptTuple), "utf8")).resolves.toBe("{bad");
  });

  it("surfaces persistence failure as a typed error and protected diagnostic", async () => {
    if (!tempRoot || !stdoutSpy) throw new Error("Missing test setup");
    const store = new ProcessGuardrailStateStore(tempRoot, {
      io: {
        writeFile: async () => {
          throw new Error("injected write failure");
        },
      },
    });

    await expect(store.create(tuple, stateFor())).rejects.toMatchObject({
      name: "ProcessGuardrailStateStoreError",
      code: "state_persist_failed",
    });
    await expect(store.create(tuple, stateFor())).rejects.toBeInstanceOf(ProcessGuardrailStateStoreError);

    const output = (stdoutSpy.mock.calls as unknown[][])
      .map((call) => String(call[0]))
      .join("");
    expect(output).toContain('"event":"process_guardrails.state_persist_failed"');
    expect(output).not.toContain("artifact_body");
  });
});
