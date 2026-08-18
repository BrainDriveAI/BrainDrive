import { describe, expect, it } from "vitest";

import { ToolExecutionFailure, toToolFailure } from "./tool-error.js";

function errnoError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("toToolFailure", () => {
  it("passes through ToolExecutionFailure unchanged", () => {
    const original = new ToolExecutionFailure("invalid_input", "bad input");
    expect(toToolFailure(original)).toBe(original);
  });

  it("maps ENOENT to a recoverable not_found failure", () => {
    const failure = toToolFailure(errnoError("ENOENT", "no such file"));
    expect(failure.code).toBe("not_found");
    expect(failure.recoverable).toBe(true);
  });

  it("maps EISDIR to a recoverable path_invalid failure that points at listing instead", () => {
    const failure = toToolFailure(errnoError("EISDIR", "EISDIR: illegal operation on a directory, read"));
    expect(failure.code).toBe("path_invalid");
    expect(failure.recoverable).toBe(true);
    expect(failure.message).toContain("directory");
  });

  it("maps ENOTDIR to a recoverable path_invalid failure", () => {
    const failure = toToolFailure(errnoError("ENOTDIR", "ENOTDIR: not a directory"));
    expect(failure.code).toBe("path_invalid");
    expect(failure.recoverable).toBe(true);
  });

  it("keeps EACCES non-recoverable permission_denied", () => {
    const failure = toToolFailure(errnoError("EACCES", "permission denied"));
    expect(failure.code).toBe("permission_denied");
    expect(failure.recoverable).toBe(false);
  });

  it("keeps unknown errors non-recoverable execution_failed", () => {
    const failure = toToolFailure(new Error("boom"));
    expect(failure.code).toBe("execution_failed");
    expect(failure.recoverable).toBe(false);
  });
});
