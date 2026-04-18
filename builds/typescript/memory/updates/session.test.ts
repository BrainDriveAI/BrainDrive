import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  ActiveCodeUpdateSessionError,
  createCodeUpdateSessionService,
  loadCodeUpdateSession,
  resolveCanonicalUpgradeFallbackCommand,
  resolveCodeUpdateSessionPath,
  resolveCodeUpdateStatePath,
} from "./session.js";

type TestPaths = {
  tempRoot: string;
  memoryRoot: string;
};

async function createPaths(): Promise<TestPaths> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-update-session-"));
  const memoryRoot = path.join(tempRoot, "memory");
  await mkdir(memoryRoot, { recursive: true });
  return {
    tempRoot,
    memoryRoot,
  };
}

async function cleanupPaths(paths: TestPaths): Promise<void> {
  await rm(paths.tempRoot, { recursive: true, force: true });
}

describe("code update session service", () => {
  it("creates session.json with required fields before host upgrade execution starts", async () => {
    const paths = await createPaths();

    try {
      let observedSession = await loadCodeUpdateSession(paths.memoryRoot);
      const service = createCodeUpdateSessionService({
        memoryRoot: paths.memoryRoot,
        installMode: "local",
        runHostUpgradeFn: async () => {
          observedSession = await loadCodeUpdateSession(paths.memoryRoot);
        },
      });

      const result = await service.startCodeUpdate({
        fromVersion: "26.4.18",
        targetVersion: "26.4.19",
      });

      expect(result.kind).toBe("started");
      const sessionPath = resolveCodeUpdateSessionPath(paths.memoryRoot);
      const parsed = JSON.parse(await readFile(sessionPath, "utf8")) as Record<string, unknown>;

      expect(observedSession?.phase).toBe("code_update_in_progress");
      expect(parsed).toEqual(
        expect.objectContaining({
          update_id: expect.any(String),
          from_version: "26.4.18",
          target_version: "26.4.19",
          phase: "code_update_complete",
          status: "in_progress",
          started_at: expect.any(String),
          updated_at: expect.any(String),
          last_error: null,
        })
      );
    } finally {
      await cleanupPaths(paths);
    }
  });

  it("rejects a second code update attempt when a session is non-terminal", async () => {
    const paths = await createPaths();

    try {
      const service = createCodeUpdateSessionService({
        memoryRoot: paths.memoryRoot,
        installMode: "local",
        runHostUpgradeFn: async () => {},
      });

      const first = await service.startCodeUpdate({
        fromVersion: "26.4.18",
        targetVersion: "26.4.19",
      });
      if (first.kind !== "started") {
        throw new Error("Expected started result");
      }

      await expect(
        service.startCodeUpdate({
          fromVersion: "26.4.18",
          targetVersion: "26.4.20",
        })
      ).rejects.toBeInstanceOf(ActiveCodeUpdateSessionError);
    } finally {
      await cleanupPaths(paths);
    }
  });

  it("persists phase transitions before host-upgrade and restart boundaries", async () => {
    const paths = await createPaths();

    try {
      const statePath = resolveCodeUpdateStatePath(paths.memoryRoot);
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(
        statePath,
        `${JSON.stringify(
          {
            last_checked_at: "2026-04-18T12:00:00.000Z",
            last_check_status: "ok",
            last_check_error: null,
            last_available_version: "26.4.19",
            last_applied_version: "26.4.18",
            last_applied_app_ref: "app@sha256:old",
            last_applied_edge_ref: "edge@sha256:old",
            pending_update: false,
            pending_reason: null,
            consecutive_failures: 0,
            next_retry_at: null,
            custom_field: "keep-me",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const service = createCodeUpdateSessionService({
        memoryRoot: paths.memoryRoot,
        installMode: "local",
        runHostUpgradeFn: async () => {
          const session = await loadCodeUpdateSession(paths.memoryRoot);
          const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
          expect(session?.phase).toBe("code_update_in_progress");
          expect(state.pending_reason).toBe("code_update_in_progress");
          expect(state.custom_field).toBe("keep-me");
        },
        runContainerRestartFn: async () => {
          const session = await loadCodeUpdateSession(paths.memoryRoot);
          const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
          expect(session?.phase).toBe("restart_pending");
          expect(state.pending_reason).toBe("restart_pending");
          expect(state.custom_field).toBe("keep-me");
          expect(state.last_applied_version).toBe("26.4.18");
        },
      });

      const started = await service.startCodeUpdate({
        fromVersion: "26.4.18",
        targetVersion: "26.4.19",
      });
      if (started.kind !== "started") {
        throw new Error("Expected started result");
      }

      const restarted = await service.restartCodeUpdate({ updateId: started.session.update_id });
      expect(restarted.kind).toBe("restarted");

      const finalSession = await loadCodeUpdateSession(paths.memoryRoot);
      expect(finalSession?.phase).toBe("completed");
      expect(finalSession?.status).toBe("completed");

      const finalState = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
      expect(finalState.pending_update).toBe(false);
      expect(finalState.pending_reason).toBeNull();
      expect(finalState.custom_field).toBe("keep-me");
      expect(finalState.last_applied_version).toBe("26.4.18");
    } finally {
      await cleanupPaths(paths);
    }
  });

  it("returns canonical fallback command when host execution is unavailable", async () => {
    const paths = await createPaths();

    try {
      const service = createCodeUpdateSessionService({
        memoryRoot: paths.memoryRoot,
        installMode: "prod",
      });

      const result = await service.startCodeUpdate({
        fromVersion: "26.4.18",
        targetVersion: "26.4.19",
      });

      expect(result.kind).toBe("fallback");
      if (result.kind !== "fallback") {
        throw new Error("Expected fallback result");
      }

      expect(result.command).toBe(resolveCanonicalUpgradeFallbackCommand("prod"));
      expect(result.session.status).toBe("failed");
      expect(result.session.phase).toBe("host_execution_unavailable");
    } finally {
      await cleanupPaths(paths);
    }
  });
});
