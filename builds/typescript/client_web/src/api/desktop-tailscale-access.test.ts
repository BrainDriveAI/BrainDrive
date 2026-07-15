import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disableTailscaleAccess,
  enableTailscaleAccess,
  getTailscaleAccessStatus,
  retryTailscaleAccess,
} from "@/api/desktop-tailscale-access";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("desktop-tailscale-access", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  it.each([
    [getTailscaleAccessStatus, "get_tailscale_access_status"],
    [enableTailscaleAccess, "enable_tailscale_access"],
    [retryTailscaleAccess, "retry_tailscale_access"],
    [disableTailscaleAccess, "disable_tailscale_access"],
  ] as const)("invokes the typed desktop command %s", async (call, command) => {
    const response = { state: "off" };
    invokeMock.mockResolvedValueOnce(response);

    await expect(call()).resolves.toBe(response);
    expect(invokeMock).toHaveBeenCalledWith(command, undefined);
  });

  it("refuses non-Tauri callers before importing or invoking desktop APIs", async () => {
    delete window.__TAURI_INTERNALS__;

    await expect(getTailscaleAccessStatus()).rejects.toThrow(
      "Remote Access is only available in the BrainDrive desktop app."
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
