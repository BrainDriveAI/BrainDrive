import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  TailscaleAccessState,
  TailscaleAccessStatus,
} from "@/api/desktop-tailscale-access";
import TailscaleAccessSection from "@/components/settings/TailscaleAccessSection";

const getStatusMock = vi.fn<() => Promise<TailscaleAccessStatus>>();
const enableMock = vi.fn<() => Promise<TailscaleAccessStatus>>();
const retryMock = vi.fn<() => Promise<TailscaleAccessStatus>>();
const disableMock = vi.fn<() => Promise<TailscaleAccessStatus>>();
const openExternalUrlMock = vi.fn<(url: string) => Promise<boolean>>();
const clipboardWriteMock = vi.fn<(value: string) => Promise<void>>();

vi.mock("@/api/desktop-tailscale-access", () => ({
  getTailscaleAccessStatus: () => getStatusMock(),
  enableTailscaleAccess: () => enableMock(),
  retryTailscaleAccess: () => retryMock(),
  disableTailscaleAccess: () => disableMock(),
}));

vi.mock("@/utils/external-url", () => ({
  isHttpUrl: (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  },
  openExternalUrl: (url: string) => openExternalUrlMock(url),
}));

function makeStatus(
  state: TailscaleAccessState,
  overrides: Partial<TailscaleAccessStatus> = {}
): TailscaleAccessStatus {
  const actionsByState: Record<TailscaleAccessState, TailscaleAccessStatus["availableActions"]> = {
    off: ["enable", "checkAgain"],
    needsSetup: ["retry", "checkAgain"],
    ready: ["enable", "checkAgain"],
    starting: [],
    running: ["checkAgain", "disable"],
    conflict: ["retry", "checkAgain"],
    needsAttention: ["retry", "checkAgain"],
  };

  return {
    state,
    desiredEnabled: state === "starting" || state === "running",
    readiness: {
      state: state === "needsSetup" ? "missing" : "ready",
      installedVersion: { major: 1, minor: 98, patch: 8 },
      minimumSupportedVersion: { major: 1, minor: 98, patch: 8 },
      backendState: "Running",
      online: true,
      dnsNameAvailable: true,
      errorCode: null,
    },
    ownership: state === "running" ? "ownedExact" : "absent",
    bridgeState: state === "running" ? "running" : "stopped",
    accessUrl: state === "running" ? "https://brain.example.ts.net" : null,
    setupUrl: null,
    availableActions: actionsByState[state],
    message: `${state} message`,
    detail: `${state} detail`,
    errorCode: null,
    checkedAtUnixMs: 1,
    ...overrides,
  };
}

async function renderState(status: TailscaleAccessStatus) {
  getStatusMock.mockResolvedValueOnce(status);
  render(<TailscaleAccessSection />);
  await screen.findByRole("heading", { name: /Remote Access/i });
  await waitFor(() => expect(screen.queryByText(/Checking Remote Access/i)).not.toBeInTheDocument());
}

describe("TailscaleAccessSection", () => {
  beforeEach(() => {
    getStatusMock.mockReset();
    enableMock.mockReset();
    retryMock.mockReset();
    disableMock.mockReset();
    openExternalUrlMock.mockReset();
    openExternalUrlMock.mockResolvedValue(true);
    clipboardWriteMock.mockReset();
    clipboardWriteMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteMock },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ["off", "Off", "Enable Remote Access"],
    ["needsSetup", "Needs setup", "Retry"],
    ["ready", "Ready to enable", "Enable Remote Access"],
    ["starting", "Starting", "Starting…"],
    ["running", "Running", "Open Remote Access"],
    ["conflict", "Conflict", "Retry"],
    ["needsAttention", "Needs attention", "Retry"],
  ] as const)("renders %s with one state-derived primary action", async (state, label, primary) => {
    await renderState(makeStatus(state));

    expect(screen.getByRole("heading", { name: `Remote Access — ${label}` })).toBeInTheDocument();
    const primaryActions = screen.queryAllByTestId("remote-access-primary-action");
    expect(primaryActions).toHaveLength(1);
    expect(primaryActions[0]).toHaveAccessibleName(primary);
    if (state === "starting") expect(primaryActions[0]).toBeDisabled();
  });

  it("shows the private-use, ownership, login, and host-availability disclosures", async () => {
    await renderState(makeStatus("ready"));

    expect(screen.getByText(/separately installed and owned/i)).toBeInTheDocument();
    expect(screen.getAllByText(/private tailnet/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/BrainDrive login is still required/i)).toBeInTheDocument();
    expect(screen.getByText(/host computer must stay awake, online, connected to Tailscale, and running BrainDrive/i)).toBeInTheDocument();
    expect(screen.getByText(/does not create a public link or cross-user sharing/i)).toBeInTheDocument();
  });

  it("enables once, suppresses duplicate clicks, refreshes, and restores focus", async () => {
    const ready = makeStatus("ready");
    const running = makeStatus("running");
    let resolveEnable!: (status: TailscaleAccessStatus) => void;
    enableMock.mockReturnValueOnce(new Promise((resolve) => { resolveEnable = resolve; }));
    getStatusMock.mockResolvedValueOnce(ready).mockResolvedValueOnce(running);
    const user = userEvent.setup();
    render(<TailscaleAccessSection />);

    const enable = await screen.findByRole("button", { name: "Enable Remote Access" });
    await user.dblClick(enable);
    expect(enableMock).toHaveBeenCalledTimes(1);
    expect(enable).toBeDisabled();

    resolveEnable(running);
    await screen.findByText("Running");
    await waitFor(() => expect(getStatusMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { name: /Remote Access — Running/i })).toHaveFocus();
  });

  it("keeps an actionable failed enable result instead of hiding it behind a fresh ready check", async () => {
    const ready = makeStatus("ready");
    const attention = makeStatus("needsAttention", {
      message: "Private access could not be verified safely.",
      detail: "Check Tailscale configuration before retrying.",
      errorCode: "ambiguousOutcome",
    });
    getStatusMock.mockResolvedValueOnce(ready).mockResolvedValueOnce(ready);
    enableMock.mockResolvedValueOnce(attention);
    const user = userEvent.setup();
    render(<TailscaleAccessSection />);

    await user.click(await screen.findByRole("button", { name: "Enable Remote Access" }));

    expect(screen.getByRole("heading", { name: /Needs attention/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be verified safely/i);
    expect(screen.getAllByText(/Check Tailscale configuration before retrying/i).length).toBeGreaterThan(0);
    expect(getStatusMock).toHaveBeenCalledTimes(1);
  });

  it("opens a validated consent URL only on click, then refreshes", async () => {
    const setup = makeStatus("needsSetup", {
      readiness: { ...makeStatus("needsSetup").readiness, state: "consentRequired" },
      setupUrl: "https://login.tailscale.com/admin/machines/new-linux",
      availableActions: ["completeSetup", "retry"],
    });
    getStatusMock.mockResolvedValue(setup);
    const user = userEvent.setup();
    render(<TailscaleAccessSection />);

    const action = await screen.findByRole("button", { name: "Complete Tailscale setup" });
    expect(openExternalUrlMock).not.toHaveBeenCalled();
    await user.click(action);

    expect(openExternalUrlMock).toHaveBeenCalledWith(setup.setupUrl);
    await waitFor(() => expect(getStatusMock).toHaveBeenCalledTimes(2));
  });

  it("does not open an invalid setup URL and falls back to the structured retry action", async () => {
    await renderState(makeStatus("needsSetup", {
      setupUrl: "javascript:alert(1)",
      availableActions: ["completeSetup", "retry"],
    }));

    expect(screen.getByTestId("remote-access-primary-action")).toHaveAccessibleName("Retry");
    expect(screen.getByText(/setup address was not safe to open/i)).toBeInTheDocument();
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it("copies, opens, refreshes, and turns off a validated running URL", async () => {
    const running = makeStatus("running");
    const off = makeStatus("off");
    getStatusMock.mockResolvedValueOnce(running).mockResolvedValueOnce(running).mockResolvedValueOnce(off);
    disableMock.mockResolvedValueOnce(off);
    const user = userEvent.setup();
    const writeTextMock = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<TailscaleAccessSection />);

    await user.click(await screen.findByRole("button", { name: "Copy Remote Access address" }));
    expect(writeTextMock).toHaveBeenCalledWith(running.accessUrl);
    await user.click(screen.getByRole("button", { name: "Open Remote Access" }));
    expect(openExternalUrlMock).toHaveBeenCalledWith(running.accessUrl);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(disableMock).toHaveBeenCalledTimes(1));
  });

  it.each([null, "http://brain.example.ts.net", "https://example.com", "not a url"])(
    "fails closed for an invalid running URL: %s",
    async (accessUrl) => {
      await renderState(makeStatus("running", { accessUrl }));

      expect(screen.getByRole("heading", { name: "Remote Access — Needs attention" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Open Remote Access" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copy Remote Access address" })).not.toBeInTheDocument();
    }
  );

  it("reports command, clipboard, and external-open failures without changing backend state", async () => {
    const running = makeStatus("running");
    getStatusMock.mockResolvedValue(running);
    openExternalUrlMock.mockResolvedValue(false);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<TailscaleAccessSection />);

    await user.click(await screen.findByRole("button", { name: "Copy Remote Access address" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not copy/i);
    await user.click(screen.getByRole("button", { name: "Open Remote Access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not open/i);
    expect(enableMock).not.toHaveBeenCalled();
    expect(retryMock).not.toHaveBeenCalled();
    expect(disableMock).not.toHaveBeenCalled();
  });

  it("surfaces a rejected command and allows retry", async () => {
    const attention = makeStatus("needsAttention");
    getStatusMock.mockResolvedValueOnce(attention).mockResolvedValueOnce(attention);
    retryMock.mockRejectedValueOnce(new Error("Desktop command failed")).mockResolvedValueOnce(attention);
    const user = userEvent.setup();
    render(<TailscaleAccessSection />);

    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Desktop command failed");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retryMock).toHaveBeenCalledTimes(2));
  });

  it("supports keyboard activation and exposes progress through a live status region", async () => {
    const ready = makeStatus("ready");
    getStatusMock.mockResolvedValue(ready);
    enableMock.mockResolvedValue(ready);
    const user = userEvent.setup();
    render(<TailscaleAccessSection />);

    const enable = await screen.findByRole("button", { name: "Enable Remote Access" });
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    await user.tab();
    expect(enable).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(enableMock).toHaveBeenCalledTimes(1));
  });

  it("hides conflict cleanup when the mapping is not exact-owned", async () => {
    await renderState(makeStatus("conflict", {
      desiredEnabled: true,
      ownership: "ownedDrifted",
      availableActions: ["retry", "checkAgain", "disable"],
    }));
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
  });

  it("keeps Turn off visible for an exact-owned conflict when the backend supplies disable", async () => {
    await renderState(makeStatus("conflict", {
      desiredEnabled: true,
      ownership: "ownedExact",
      availableActions: ["retry", "checkAgain", "disable"],
    }));
    expect(screen.getByRole("button", { name: "Turn off" })).toBeEnabled();
  });

  it("polls Starting at a bounded cadence and clears polling on unmount", async () => {
    vi.useFakeTimers();
    const starting = makeStatus("starting");
    getStatusMock.mockResolvedValue(starting);
    const { unmount } = render(<TailscaleAccessSection />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("status")).toHaveTextContent(/starting/i);

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(getStatusMock).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getStatusMock).toHaveBeenCalledTimes(2);
  });

  it("stops Starting polling at the configured bound", async () => {
    vi.useFakeTimers();
    getStatusMock.mockResolvedValue(makeStatus("starting"));
    render(<TailscaleAccessSection />);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(getStatusMock).toHaveBeenCalledTimes(13);
    expect(screen.getByRole("alert")).toHaveTextContent(/still starting/i);
  });

  it("ignores a stale initial response after unmount", async () => {
    let resolveStatus!: (status: TailscaleAccessStatus) => void;
    getStatusMock.mockReturnValueOnce(new Promise((resolve) => { resolveStatus = resolve; }));
    const { unmount } = render(<TailscaleAccessSection />);
    unmount();

    await act(async () => { resolveStatus(makeStatus("ready")); });
    expect(enableMock).not.toHaveBeenCalled();
  });

  it("reports non-Tauri adapter refusal as an actionable alert", async () => {
    getStatusMock.mockRejectedValueOnce(
      new Error("Remote Access is only available in the BrainDrive desktop app.")
    );
    render(<TailscaleAccessSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/only available.*desktop app/i);
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });
});
