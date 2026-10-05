import { describe, expect, it } from "vitest";

import { ToolExecutionFailure } from "../tool-error.js";
import { normalizeLegacyCallResult } from "./client.js";

function errorResult(structured: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: "error" }],
    structuredContent: structured,
    isError: true,
  };
}

describe("MCP client error mapping", () => {
  it("remaps a server-fatal EISDIR read into a recoverable path_invalid failure", () => {
    let failure: ToolExecutionFailure | null = null;
    try {
      normalizeLegacyCallResult(errorResult({
        code: "execution_failed",
        message: "EISDIR: illegal operation on a directory, read",
        recoverable: false,
      }));
    } catch (error) {
      failure = error as ToolExecutionFailure;
    }
    expect(failure).toBeInstanceOf(ToolExecutionFailure);
    expect(failure?.code).toBe("path_invalid");
    expect(failure?.recoverable).toBe(true);
    expect(failure?.message).toContain("directory");
  });

  it("leaves other execution failures untouched", () => {
    let failure: ToolExecutionFailure | null = null;
    try {
      normalizeLegacyCallResult(errorResult({
        code: "execution_failed",
        message: "disk exploded",
        recoverable: false,
      }));
    } catch (error) {
      failure = error as ToolExecutionFailure;
    }
    expect(failure?.code).toBe("execution_failed");
    expect(failure?.recoverable).toBe(false);
  });
});
