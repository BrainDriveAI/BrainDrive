import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AuthContext,
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "../../contracts.js";
import {
  GuardedProcessToolExecutor,
  type GuardedProcessToolExecutorOptions,
} from "./guarded-tool-executor.js";
import { artifactContractFor } from "./process-definition.js";
import type { ToolExecutorLike } from "../tool-executor.js";

const roots: string[] = [];
const auth: AuthContext = {
  actorId: "owner",
  actorType: "owner",
  mode: "local",
  permissions: {
    memory_access: true,
    tool_access: true,
    system_actions: true,
    delegation: true,
    approval_authority: true,
    administration: true,
  },
};

function specContent(): string {
  return artifactContractFor("career", "specification").requiredHeadings
    .map((heading) => `${heading}\n\nOwner content.`)
    .join("\n\n");
}

class FakeExecutor implements ToolExecutorLike {
  readonly calls: Array<{ name: string; input: Record<string, unknown> }> = [];

  constructor(
    private readonly result: ToolExecutionResult | ((context: ToolContext, input: Record<string, unknown>) => Promise<ToolExecutionResult>) = {
      status: "ok",
      output: { updated: true },
    }
  ) {}

  listTools(): ToolDefinition[] {
    return ["memory_read", "memory_write", "memory_edit", "memory_delete", "memory_search"].map((name) => ({
      name,
      description: name,
      requiresApproval: name !== "memory_read",
      readOnly: name === "memory_read",
      inputSchema: { type: "object" },
      execute: async () => ({}),
    }));
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.listTools().find((tool) => tool.name === name);
  }

  async execute(
    _auth: AuthContext,
    context: ToolContext,
    name: string,
    input: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    this.calls.push({ name, input });
    if (typeof this.result === "function") {
      return this.result(context, input);
    }
    return this.result;
  }
}

async function setup(
  options: Partial<GuardedProcessToolExecutorOptions> = {},
  base = new FakeExecutor()
) {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "guarded-executor-"));
  roots.push(memoryRoot);
  await mkdir(path.join(memoryRoot, "documents", "career"), { recursive: true });
  const context: ToolContext = { memoryRoot, auth, correlationId: "correlation-1" };
  const executor = new GuardedProcessToolExecutor(base, {
    pageId: "career",
    stage: "specification",
    prerequisites: [{ kind: "interview", status: "accepted" }],
    journalEligibility: "not_applicable",
    approve: async () => "approved",
    ...options,
  });
  return { memoryRoot, context, executor, base };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("guarded process tool executor", () => {
  it("exposes guarded-only structural controls and delegates a valid create exactly once after approval", async () => {
    const applied = new FakeExecutor(async (context, input) => {
      await writeFile(path.join(context.memoryRoot, String(input.path)), String(input.content), "utf8");
      return { status: "ok", output: { written: true } };
    });
    const { context, executor } = await setup({}, applied);

    expect(executor.listTools(auth).map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "process_start",
      "process_stage_outcome",
      "process_owner_override",
    ]));
    const result = await executor.execute(auth, context, "memory_write", {
      path: "documents/career/spec.md",
      content: specContent(),
    });

    expect(result).toMatchObject({
      status: "ok",
      output: { reconciliation: "applied", artifact_digest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(applied.calls).toHaveLength(1);
  });

  it("constructs an edit candidate with the existing unique-match rule and preserves unrelated bytes", async () => {
    const applied = new FakeExecutor(async (context, input) => {
      const target = path.join(context.memoryRoot, String(input.path));
      const original = await readFile(target, "utf8");
      await writeFile(target, original.replace(String(input.find), String(input.replace)), "utf8");
      return { status: "ok", output: { updated: true } };
    });
    const { memoryRoot, context, executor } = await setup({}, applied);
    const target = path.join(memoryRoot, "documents", "career", "spec.md");
    const preserved = "## Owner Custom\n\nPreserve exactly.";
    const preservedHash = createHash("sha256").update(preserved).digest("hex");
    await writeFile(target, `${specContent()}\n\n${preserved}`, "utf8");

    const result = await executor.execute(auth, context, "memory_edit", {
      path: "documents/career/spec.md",
      find: "Owner content.",
      replace: "Updated owner content.",
    });

    expect(result.status).toBe("error");
    expect(result.output).toMatchObject({ code: "edit_target_not_unique" });

    const unique = await executor.execute(auth, context, "memory_edit", {
      path: "documents/career/spec.md",
      find: "## What You Want\n\nOwner content.",
      replace: "## What You Want\n\nUpdated owner content.",
    });
    expect(unique.status).toBe("ok");
    const updated = await readFile(target, "utf8");
    expect(updated).toContain(preserved);
    expect(createHash("sha256").update(preserved).digest("hex")).toBe(preservedHash);
    expect(applied.calls).toHaveLength(1);
  });

  it("preserves the canonical artifact hash when destructive replacement is rejected", async () => {
    const { memoryRoot, context, executor, base } = await setup();
    const target = path.join(memoryRoot, "documents", "career", "spec.md");
    const original = `${specContent()}\n\n## Owner Custom\n\nDo not remove.`;
    await writeFile(target, original, "utf8");
    const before = createHash("sha256").update(original).digest("hex");

    const result = await executor.execute(auth, context, "memory_write", {
      path: "documents/career/spec.md",
      content: specContent(),
    });
    const afterContent = await readFile(target, "utf8");
    const after = createHash("sha256").update(afterContent).digest("hex");

    expect(result).toMatchObject({
      status: "error",
      output: {
        validator_codes: expect.arrayContaining(["destructive_replacement"]),
      },
    });
    expect(after).toBe(before);
    expect(base.calls).toHaveLength(0);
  });

  it("does not approve, delegate, or mutate an invalid candidate", async () => {
    let approvals = 0;
    const { memoryRoot, context, executor, base } = await setup({
      approve: async () => {
        approvals += 1;
        return "approved";
      },
    });

    const result = await executor.execute(auth, context, "memory_write", {
      path: "documents/fitness/spec.md",
      content: specContent(),
    });

    expect(result).toMatchObject({
      status: "error",
      output: { code: "guardrail_validation_failed" },
    });
    expect(approvals).toBe(0);
    expect(base.calls).toHaveLength(0);
    await expect(readFile(path.join(memoryRoot, "documents", "fitness", "spec.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves normal approval denial without canonical delegation", async () => {
    const { context, executor, base } = await setup({
      approve: async () => "denied",
    });
    const result = await executor.execute(auth, context, "memory_write", {
      path: "documents/career/spec.md",
      content: specContent(),
    });

    expect(result).toEqual({
      status: "denied",
      output: { code: "approval_denied", message: "Denied by owner" },
    });
    expect(base.calls).toHaveLength(0);
  });

  it.each([
    ["applied", true, "ok"],
    ["not_applied", false, "error"],
  ] as const)("reconciles an ambiguous %s result without repeating", async (_label, apply, expectedStatus) => {
    const ambiguous = new FakeExecutor(async (context, input) => {
      if (apply) {
        await writeFile(path.join(context.memoryRoot, String(input.path)), String(input.content), "utf8");
      }
      return {
        status: "error",
        output: { code: "ambiguous_result", message: "Outcome unknown" },
        recoverable: true,
      };
    });
    const { context, executor } = await setup({}, ambiguous);
    const result = await executor.execute(auth, context, "memory_write", {
      path: "documents/career/spec.md",
      content: specContent(),
    });

    expect(result.status).toBe(expectedStatus);
    expect(result.output).toMatchObject({
      reconciliation: apply ? "applied" : "not_applied",
    });
    expect(ambiguous.calls).toHaveLength(1);
  });

  it("rejects delete, diagnostics, overlays, and duplicate journal writes before delegation", async () => {
    const { context, executor, base } = await setup();
    const denied = await Promise.all([
      executor.execute(auth, context, "memory_delete", { path: "documents/career/spec.md" }),
      executor.execute(auth, context, "memory_write", {
        path: "diagnostics/process-guardrails/x",
        content: specContent(),
      }),
      executor.execute(auth, context, "memory_write", {
        path: "documents/career/AGENT-user.md",
        content: specContent(),
      }),
    ]);

    expect(denied.every((result) => result.status === "error")).toBe(true);
    expect(base.calls).toHaveLength(0);
  });

  it("allows only registry-listed reads and hides broad browsing tools", async () => {
    const { context, executor, base } = await setup();

    expect(executor.listTools(auth).map((tool) => tool.name)).not.toContain("memory_search");
    await expect(executor.preflight(auth, context, "memory_read", {
      path: "documents/career/spec.md",
    })).resolves.toBeNull();
    await expect(executor.preflight(auth, context, "memory_read", {
      path: "documents/finance/spec.md",
    })).resolves.toMatchObject({
      status: "error",
      output: { code: "guardrail_read_forbidden" },
    });
    await expect(executor.preflight(auth, context, "memory_read", {
      path: "diagnostics/process-guardrails/state/x.json",
    })).resolves.toMatchObject({
      status: "error",
      output: { code: "guardrail_read_forbidden" },
    });
    expect(base.calls).toHaveLength(0);
  });
});
