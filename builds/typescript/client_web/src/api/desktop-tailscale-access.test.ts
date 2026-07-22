import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disableTailscaleAccess,
  enableTailscaleAccess,
  getTailscaleAccessStatus,
  retryTailscaleAccess,
} from "@/api/desktop-tailscale-access";
import type {
  TailscaleAccessStatus,
  TailscaleCleanupState,
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

  it("accepts typed running and every off cleanup status contract", async () => {
    const readiness = {
      state: "ready",
      installedVersion: { major: 1, minor: 98, patch: 8 },
      minimumSupportedVersion: { major: 1, minor: 98, patch: 8 },
      backendState: "Running",
      online: true,
      dnsNameAvailable: true,
      errorCode: null,
    } as const;
    const running = {
      state: "running",
      desiredEnabled: true,
      readiness,
      ownership: "ownedExact",
      bridgeState: "running",
      accessUrl: "https://brain.example.ts.net/",
      setupUrl: null,
      availableActions: ["checkAgain", "disable"],
      message: "Private Tailscale access is running.",
      detail: null,
      errorCode: null,
      checkedAtUnixMs: 1,
    } satisfies TailscaleAccessStatus;
    const cleanupStates = [
      "complete",
      "notNeeded",
      "deferred",
      "failed",
    ] satisfies TailscaleCleanupState[];
    const cleanupStatuses = cleanupStates.map(
      (cleanupState) =>
        ({
          ...running,
          state: "off",
          desiredEnabled: false,
          ownership: cleanupState === "deferred" ? "ownedDrifted" : "absent",
          bridgeState: "stopped",
          cleanupState,
          accessUrl: null,
          availableActions:
            cleanupState === "deferred" || cleanupState === "failed"
              ? ["disable", "checkAgain"]
              : ["enable", "checkAgain"],
          message: "Private Tailscale access is off.",
        }) satisfies TailscaleAccessStatus
    );
    const offWithNullCleanup = {
      ...cleanupStatuses[0],
      cleanupState: null,
    } satisfies TailscaleAccessStatus;

    invokeMock.mockResolvedValueOnce(running);
    cleanupStatuses.forEach((status) => invokeMock.mockResolvedValueOnce(status));
    invokeMock.mockResolvedValueOnce(offWithNullCleanup);

    await expect(getTailscaleAccessStatus()).resolves.toBe(running);
    for (const cleanupStatus of cleanupStatuses) {
      await expect(getTailscaleAccessStatus()).resolves.toBe(cleanupStatus);
    }
    await expect(getTailscaleAccessStatus()).resolves.toBe(offWithNullCleanup);
  });
});
