import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ToolContext } from "../../contracts.js";
import { ToolExecutionFailure } from "../../tool-error.js";
import { fileOpsTools } from "./server.js";

function toolContext(memoryRoot: string): ToolContext {
  return {
    memoryRoot,
    correlationId: "test-correlation",
    auth: {
      actorId: "owner",
      actorType: "owner",
      mode: "local-owner",
      permissions: {
        memory_access: true,
        tool_access: true,
        system_actions: true,
        delegation: true,
        approval_authority: true,
        administration: true,
      },
    },
  };
}

describe("file ops memory_delete", () => {
  it("does not report success for a missing path", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "bd-file-ops-"));
    const deleteTool = fileOpsTools().find((tool) => tool.name === "memory_delete");

    await expect(
      deleteTool?.execute(toolContext(memoryRoot), { path: "documents/missing.md" })
    ).rejects.toBeInstanceOf(ToolExecutionFailure);
  });
});
