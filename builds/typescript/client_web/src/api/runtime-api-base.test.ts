import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiFetch,
  resolveApiInput,
  resolveGatewayBaseUrl,
  setGatewayBaseUrlForTests,
} from "@/api/runtime-api-base";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("runtime API base", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setGatewayBaseUrlForTests(null);
    window.__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setGatewayBaseUrlForTests(null);
    delete window.__TAURI_INTERNALS__;
  });

  it("keeps browser requests on the Vite /api proxy", async () => {
    delete window.__TAURI_INTERNALS__;

    await expect(resolveGatewayBaseUrl()).resolves.toBe("/api");
    await expect(resolveApiInput("/api/auth/bootstrap-status")).resolves.toBe(
      "/api/auth/bootstrap-status"
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("switches /api requests to the dynamically allocated desktop gateway", async () => {
    invokeMock.mockResolvedValueOnce({
      state: "ready",
      gatewayBaseUrl: "http://127.0.0.1:43127/",
      desktopApiToken: "synthetic-desktop-token",
    });

    await expect(resolveGatewayBaseUrl()).resolves.toBe("http://127.0.0.1:43127");
    await expect(resolveApiInput("/api/auth/bootstrap-status")).resolves.toBe(
      "http://127.0.0.1:43127/auth/bootstrap-status"
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_runtime_status");
  });

  it("attaches the desktop transport token without replacing caller headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    invokeMock.mockResolvedValueOnce({
      state: "ready",
      gatewayBaseUrl: "http://127.0.0.1:43128",
      desktopApiToken: "synthetic-desktop-token",
    });

    await apiFetch("/api/config", { headers: { Accept: "application/json" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43128/config",
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "application/json",
          "x-braindrive-desktop-token": "synthetic-desktop-token",
        }),
      })
    );
  });

  it("does not allow a caller to replace the native desktop transport token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    invokeMock.mockResolvedValueOnce({
      state: "ready",
      gatewayBaseUrl: "http://127.0.0.1:43128",
      desktopApiToken: "synthetic-desktop-token",
    });

    await apiFetch("/api/config", {
      headers: { "x-braindrive-desktop-token": "caller-token" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43128/config",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-braindrive-desktop-token": "synthetic-desktop-token",
        }),
      })
    );
  });

  it.each([
    [{ state: "starting", gatewayBaseUrl: "", desktopApiToken: "" }, "starting"],
    [{ state: "failed", gatewayBaseUrl: "", desktopApiToken: "" }, "failed"],
    [
      { state: "ready", gatewayBaseUrl: "", desktopApiToken: "synthetic-desktop-token" },
      "missing gateway URL",
    ],
    [
      { state: "ready", gatewayBaseUrl: "http://127.0.0.1:43129", desktopApiToken: "" },
      "missing transport token",
    ],
  ])("fails closed when the desktop handoff is incomplete: %s", async (status, expected) => {
    invokeMock.mockResolvedValue(status);

    await expect(resolveGatewayBaseUrl()).rejects.toThrow(expected);
    await expect(resolveApiInput("/api/config")).rejects.toThrow(expected);
  });
});
