import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProcessGuardrailInstructionError,
  loadProcessGuardrailInstructions,
} from "./instruction-loader.js";
import { PROCESS_GUARDRAIL_DEFINITION } from "./process-definition.js";

const roots: string[] = [];

async function projectRoot(): Promise<string> {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "guardrail-instructions-"));
  roots.push(memoryRoot);
  await mkdir(path.join(memoryRoot, "documents", "career"), { recursive: true });
  return memoryRoot;
}

async function put(memoryRoot: string, name: string, content: string): Promise<void> {
  await writeFile(path.join(memoryRoot, "documents", "career", name), content, "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("process guardrail instruction loading", () => {
  it("defines exactly one fixed process and accepts no owner-authored process graph", () => {
    expect(PROCESS_GUARDRAIL_DEFINITION.kind).toBe("page-alignment-v1");
    expect(PROCESS_GUARDRAIL_DEFINITION.stages.map((stage) => stage.kind)).toEqual([
      "interview",
      "specification",
      "plan",
      "journal_handoff",
    ]);
    expect(JSON.stringify(PROCESS_GUARDRAIL_DEFINITION)).not.toContain("owner_process");
    expect(JSON.stringify(PROCESS_GUARDRAIL_DEFINITION)).not.toContain("next_stage");
    expect(PROCESS_GUARDRAIL_DEFINITION.stages.map((stage) => stage.allowedWrites)).toEqual([
      [],
      ["spec.md"],
      ["plan.md"],
      ["journal.md"],
    ]);
  });

  it("loads managed base then overlay and the applicable procedure then overlay", async () => {
    const memoryRoot = await projectRoot();
    await put(memoryRoot, "AGENT.md", "managed agent\n");
    await put(memoryRoot, "AGENT-user.md", "owner agent overlay\n");
    await put(memoryRoot, "run-planning.md", "managed planning\n");
    await put(memoryRoot, "run-planning-user.md", "owner planning overlay\n");

    const loaded = await loadProcessGuardrailInstructions({
      memoryRoot,
      pageId: "career",
      stage: "plan",
    });

    expect(loaded.sources.map((source) => source.path)).toEqual([
      "documents/career/AGENT.md",
      "documents/career/AGENT-user.md",
      "documents/career/run-planning.md",
      "documents/career/run-planning-user.md",
    ]);
    expect(loaded.sources.map((source) => source.kind)).toEqual([
      "managed",
      "overlay",
      "managed",
      "overlay",
    ]);
    expect(loaded.sources[3]?.content).toBe("owner planning overlay\n");
    expect(loaded.sources[3]?.digest).toBe(
      createHash("sha256").update("owner planning overlay\n").digest("hex")
    );
  });

  it("uses the interview procedure for interview and specification without rewriting text", async () => {
    const memoryRoot = await projectRoot();
    await put(memoryRoot, "AGENT.md", "agent\n");
    await put(memoryRoot, "run-interview.md", "current combined interview procedure\n");

    for (const stage of ["interview", "specification"] as const) {
      const loaded = await loadProcessGuardrailInstructions({
        memoryRoot,
        pageId: "career",
        stage,
      });
      expect(loaded.sources.at(-1)?.path).toBe("documents/career/run-interview.md");
      expect(loaded.sources.at(-1)?.content).toBe("current combined interview procedure\n");
    }
  });

  it("reflects behavior edits on the next load while preserving the active snapshot and overlay bytes", async () => {
    const memoryRoot = await projectRoot();
    await put(memoryRoot, "AGENT.md", "agent v1\n");
    await put(memoryRoot, "AGENT-user.md", "owner bytes \r\nstay exact\r\n");
    await put(memoryRoot, "run-interview.md", "procedure v1\n");

    const first = await loadProcessGuardrailInstructions({
      memoryRoot,
      pageId: "career",
      stage: "interview",
    });
    const firstDigest = first.sources[0]!.digest;
    const overlayBefore = await readFile(
      path.join(memoryRoot, "documents", "career", "AGENT-user.md")
    );

    await put(memoryRoot, "AGENT.md", "agent v2\n");
    const second = await loadProcessGuardrailInstructions({
      memoryRoot,
      pageId: "career",
      stage: "interview",
    });

    expect(first.sources[0]?.content).toBe("agent v1\n");
    expect(first.sources[0]?.digest).toBe(firstDigest);
    expect(second.sources[0]?.digest).not.toBe(firstDigest);
    expect(
      await readFile(path.join(memoryRoot, "documents", "career", "AGENT-user.md"))
    ).toEqual(overlayBefore);
  });

  it.each([
    ["missing", false, "documents/career/run-journal.md"],
    ["unreadable", true, "documents/career/run-journal.md"],
  ])("returns a typed named-file error for a %s managed base", async (_label, unreadable, expectedPath) => {
    const memoryRoot = await projectRoot();
    await put(memoryRoot, "AGENT.md", "agent\n");
    if (unreadable) {
      await mkdir(path.join(memoryRoot, expectedPath));
    }

    await expect(loadProcessGuardrailInstructions({
      memoryRoot,
      pageId: "career",
      stage: "journal_handoff",
    })).rejects.toMatchObject({
      name: ProcessGuardrailInstructionError.name,
      path: expectedPath,
    });
  });
});
