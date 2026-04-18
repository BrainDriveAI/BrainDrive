import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  AppliedStateParseError,
  isItemDeclined,
  loadAppliedState,
  lookupItemDecision,
  persistAppliedState,
  parseAppliedState,
} from "./applied-state.js";

describe("applied update state", () => {
  it("loads last_applied, item statuses, and run history without mutating source content", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-applied-state-"));
    const memoryRoot = path.join(tempRoot, "memory");
    const appliedPath = path.join(memoryRoot, "system", "updates", "applied.json");

    const seed = {
      last_applied: "1.2.0",
      items: {
        "1.2.1:sync-defaults:1111aaaa": {
          status: "applied",
          decided_at: "2026-04-16T10:00:00Z",
        },
        "1.2.1:optional-prompt:2222bbbb": {
          status: "declined",
          decided_at: "2026-04-16T10:05:00Z",
          note: "Kept custom prompt",
        },
      },
      runs: [
        {
          run_id: "run-001",
          started_at: "2026-04-16T10:00:00Z",
          completed_at: "2026-04-16T10:06:00Z",
          applied_item_ids: ["1.2.1:sync-defaults:1111aaaa"],
          declined_item_ids: ["1.2.1:optional-prompt:2222bbbb"],
        },
      ],
    };

    try {
      await mkdir(path.dirname(appliedPath), { recursive: true });
      await writeFile(appliedPath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");

      const loaded = await loadAppliedState(memoryRoot);
      expect(loaded.last_applied).toBe("1.2.0");
      expect(lookupItemDecision(loaded, "1.2.1:sync-defaults:1111aaaa")?.status).toBe("applied");
      expect(isItemDeclined(loaded, "1.2.1:optional-prompt:2222bbbb")).toBe(true);
      expect(loaded.runs).toEqual(seed.runs);

      const fileAfterLoad = await readFile(appliedPath, "utf8");
      expect(fileAfterLoad).toBe(`${JSON.stringify(seed, null, 2)}\n`);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed state", () => {
    expect(() => parseAppliedState("[]")).toThrow(AppliedStateParseError);
    expect(() =>
      parseAppliedState(
        JSON.stringify({
          last_applied: "1.2.0",
          items: {
            sample: {
              status: "ignored",
              decided_at: "2026-04-16T10:00:00Z",
            },
          },
          runs: [],
        })
      )
    ).toThrow(AppliedStateParseError);
  });

  it("supports in_progress and failed item statuses with rollback metadata", () => {
    const parsed = parseAppliedState(
      JSON.stringify({
        last_applied: null,
        items: {
          "1.2.1:in-progress:aaaa1111": {
            status: "in_progress",
            decided_at: "2026-04-18T10:00:00Z",
          },
          "1.2.1:failed:bbbb2222": {
            status: "failed",
            decided_at: "2026-04-18T10:01:00Z",
            error_summary: "source file was missing",
            snapshot_path: "system/updates/snapshots/fail.json",
          },
        },
        runs: [],
      })
    );

    expect(parsed.items["1.2.1:in-progress:aaaa1111"]?.status).toBe("in_progress");
    expect(parsed.items["1.2.1:failed:bbbb2222"]?.status).toBe("failed");
    expect(parsed.items["1.2.1:failed:bbbb2222"]?.error_summary).toBe("source file was missing");
    expect(parsed.items["1.2.1:failed:bbbb2222"]?.snapshot_path).toBe(
      "system/updates/snapshots/fail.json"
    );
  });

  it("persists state with formatting-compatible output", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-applied-state-save-"));
    const memoryRoot = path.join(tempRoot, "memory");

    try {
      await persistAppliedState(memoryRoot, {
        last_applied: "1.2.0",
        items: {
          "1.2.1:done:aaaa1111": {
            status: "applied",
            decided_at: "2026-04-18T11:00:00Z",
          },
        },
        runs: [],
      });

      const loaded = await loadAppliedState(memoryRoot);
      expect(loaded.last_applied).toBe("1.2.0");
      expect(loaded.items["1.2.1:done:aaaa1111"]?.status).toBe("applied");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
