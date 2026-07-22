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
    ["needsSetup", "Needs setup", "Try again"],
    ["ready", "Ready to enable", "Enable Remote Access"],
    ["starting", "Starting", "Starting…"],
    ["running", "Running", null],
    ["conflict", "Conflict", "Try again"],
    ["needsAttention", "Needs attention", "Try again"],
  ] as const)("renders %s with at most one state-derived primary action", async (state, label, primary) => {
    await renderState(makeStatus(state));

    expect(screen.getByRole("heading", { name: `Remote Access — ${label}` })).toBeInTheDocument();
    const primaryActions = screen.queryAllByTestId("remote-access-primary-action");
    if (primary === null) {
      expect(primaryActions).toHaveLength(0);
    } else {
      expect(primaryActions).toHaveLength(1);
      expect(primaryActions[0]).toHaveAccessibleName(primary);
    }
    if (state === "starting") expect(primaryActions[0]).toBeDisabled();
  });

  it.each([
    ["complete", "Cleanup complete", /removed its Remote Access mapping/i, false],
    ["notNeeded", "No cleanup needed", /No BrainDrive Remote Access mapping remained/i, false],
    ["deferred", "Cleanup deferred", /access is stopped.*cleanup was deferred/i, true],
    ["failed", "Cleanup needs attention", /access is stopped.*targeted cleanup did not complete/i, true],
  ] as const)(
    "renders confirmed Off with %s cleanup as secondary status",
    async (cleanupState, cleanupLabel, cleanupCopy, hasCleanupRetry) => {
      await renderState(
        makeStatus("off", {
          cleanupState,
          message: "Backend cleanup message",
          detail: "Structured backend detail",
          availableActions: hasCleanupRetry ? ["disable", "checkAgain"] : ["enable", "checkAgain"],
        })
      );

      expect(screen.getByRole("heading", { name: "Remote Access — Off" })).toBeInTheDocument();
      expect(screen.getByText(/BrainDrive is no longer available through Remote Access/i)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: cleanupLabel })).toBeInTheDocument();
      expect(screen.getByText(cleanupCopy)).toBeInTheDocument();
      if (hasCleanupRetry) {
        expect(screen.getByRole("button", { name: "Try cleanup again" })).toBeEnabled();
      } else {
        expect(screen.queryByRole("button", { name: "Try cleanup again" })).not.toBeInTheDocument();
      }
    }
  );

  it("renders clean Off without inventing a cleanup result", async () => {
    await renderState(makeStatus("off", { cleanupState: null }));

    expect(screen.getByRole("heading", { name: "Remote Access — Off" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable Remote Access" })).toBeEnabled();
    expect(screen.queryByText(/Cleanup (complete|deferred|needs attention)/i)).not.toBeInTheDocument();
  });

  it("shows the private-use, ownership, login, and host-availability disclosures", async () => {
    await renderState(makeStatus("ready"));

    expect(screen.getByText(/separately installed and owned/i)).toBeInTheDocument();
    expect(screen.getAllByText(/private Tailscale network/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/still need your BrainDrive sign-in/i)).toBeInTheDocument();
    expect(screen.getByText(/computer must stay awake, online, connected to Tailscale, and running BrainDrive/i)).toBeInTheDocument();
    expect(screen.getByText(/never creates a public link/i)).toBeInTheDocument();
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

    expect(screen.getByTestId("remote-access-primary-action")).toHaveAccessibleName("Try again");
    expect(screen.getByText(/setup address was not safe to open/i)).toBeInTheDocument();
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it("copies and turns off a validated running URL", async () => {
    const running = makeStatus("running");
    const off = makeStatus("off");
    getStatusMock.mockResolvedValueOnce(running).mockResolvedValueOnce(off);
    disableMock.mockResolvedValueOnce(off);
    const user = userEvent.setup();
    const writeTextMock = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<TailscaleAccessSection />);

    await user.click(await screen.findByRole("button", { name: "Copy Remote Access address" }));
    expect(writeTextMock).toHaveBeenCalledWith(running.accessUrl);
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

  it("reports clipboard failures without changing backend state", async () => {
    const running = makeStatus("running");
    getStatusMock.mockResolvedValue(running);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<TailscaleAccessSection />);

    await user.click(await screen.findByRole("button", { name: "Copy Remote Access address" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not copy/i);
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

    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Desktop command failed");
    await user.click(screen.getByRole("button", { name: "Try again" }));
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

  it("shows a setup checklist with the active step derived from readiness", async () => {
    await renderState(
      makeStatus("needsSetup", {
        readiness: { ...makeStatus("needsSetup").readiness, state: "offline" },
      })
    );

    expect(screen.getByText("Open Tailscale and turn its connection on")).toBeInTheDocument();
    expect(screen.getByText("Come back and push the Try again button")).toBeInTheDocument();
    expect(screen.getByText(/turned off or disconnected/i)).toBeInTheDocument();
    expect(screen.queryByText("needsSetup message")).not.toBeInTheDocument();
  });

  it("shows the setup checklist for a not-ready needsAttention state (fresh install)", async () => {
    await renderState(
      makeStatus("needsAttention", {
        readiness: { ...makeStatus("needsAttention").readiness, state: "daemonUnavailable" },
        errorCode: "commandFailed",
      })
    );

    expect(screen.getByRole("heading", { name: "Remote Access — Needs setup" })).toBeInTheDocument();
    expect(screen.getByText("Install Tailscale on this computer and sign in")).toBeInTheDocument();
    expect(screen.getByText(/isn't running — or isn't installed yet/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /tailscale\.com — opens the free Tailscale download/i }));
    expect(openExternalUrlMock).toHaveBeenCalledWith("https://tailscale.com/download");
  });

  it("keeps genuine needsAttention presentation when Remote Access was enabled", async () => {
    await renderState(
      makeStatus("needsAttention", {
        desiredEnabled: true,
        ownership: "ownedDrifted",
        readiness: { ...makeStatus("needsAttention").readiness, state: "daemonUnavailable" },
        message: "Private access stopped unexpectedly.",
        errorCode: "commandFailed",
      })
    );

    expect(screen.getByRole("heading", { name: "Remote Access — Needs attention" })).toBeInTheDocument();
    expect(screen.getByText("Private access stopped unexpectedly.")).toBeInTheDocument();
    expect(screen.queryByText("Come back and push the Try again button")).not.toBeInTheDocument();
  });

  it("shows a readiness-specific first step when Tailscale is signed out", async () => {
    await renderState(
      makeStatus("needsSetup", {
        readiness: { ...makeStatus("needsSetup").readiness, state: "signedOut" },
      })
    );

    expect(screen.getByText("Open Tailscale and sign in")).toBeInTheDocument();
    expect(screen.queryByText("Install Tailscale on this computer and sign in")).not.toBeInTheDocument();
  });

  it("shows phone setup steps and a QR code while running", async () => {
    await renderState(makeStatus("running"));

    expect(screen.getByText("Use BrainDrive on your phone")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /QR code/i })).toBeInTheDocument();
    expect(screen.getByText(/same account you use on this computer/i)).toBeInTheDocument();
    expect(screen.getByText("Using another computer instead?")).toBeInTheDocument();
  });

  it.each(["ownedExact", "ownedDrifted", "occupiedUnowned", "ambiguous"] as const)(
    "keeps Turn off visible for %s conflict without manual command guidance",
    async (ownership) => {
      await renderState(
        makeStatus("conflict", {
          desiredEnabled: true,
          ownership,
          bridgeState: "running",
          availableActions: ["retry", "checkAgain", "disable"],
        })
      );

      expect(screen.getByRole("button", { name: "Turn off" })).toBeEnabled();
      expect(screen.getByText(/Remote Access may still be available/i)).toBeInTheDocument();
      expect(screen.getByText(/won't change settings it cannot verify/i)).toBeInTheDocument();
      expect(document.querySelector("code")).toBeNull();
    }
  );

  it("does not claim Off when cutoff is unconfirmed and keeps the safe cutoff action", async () => {
    await renderState(
      makeStatus("needsAttention", {
        desiredEnabled: false,
        ownership: "ambiguous",
        bridgeState: "failed",
        cleanupState: "deferred",
        availableActions: ["disable", "checkAgain"],
        message: "BrainDrive could not confirm that Remote Access is off.",
        detail: "The local bridge may still be running.",
        errorCode: "bridgeUnavailable",
      })
    );

    expect(screen.getByRole("heading", { name: "Remote Access — Needs attention" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Remote Access — Off" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Remote Access may still be available/i);
    expect(screen.getByRole("button", { name: "Turn off" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  });

  it("retries pending cleanup exactly once through disable and keeps confirmed Off on success", async () => {
    const deferred = makeStatus("off", {
      cleanupState: "deferred",
      availableActions: ["disable", "checkAgain"],
    });
    const complete = makeStatus("off", {
      cleanupState: "complete",
      availableActions: ["enable", "checkAgain"],
    });
    getStatusMock.mockResolvedValueOnce(deferred);
    disableMock.mockResolvedValueOnce(complete);
    const user = userEvent.setup();
    render(<TailscaleAccessSection />);

    await user.click(await screen.findByRole("button", { name: "Try cleanup again" }));

    await screen.findByRole("heading", { name: "Cleanup complete" });
    expect(screen.getByRole("heading", { name: "Remote Access — Off" })).toBeInTheDocument();
    expect(disableMock).toHaveBeenCalledTimes(1);
    expect(getStatusMock).toHaveBeenCalledTimes(1);
    expect(enableMock).not.toHaveBeenCalled();
    expect(retryMock).not.toHaveBeenCalled();
  });

  it("keeps confirmed Off when cleanup retry returns a failed cleanup result", async () => {
    const deferred = makeStatus("off", {
      cleanupState: "deferred",
      availableActions: ["disable", "checkAgain"],
    });
    const failed = makeStatus("off", {
      cleanupState: "failed",
      availableActions: ["disable", "checkAgain"],
      errorCode: "commandFailed",
    });
    getStatusMock.mockResolvedValueOnce(deferred);
    disableMock.mockResolvedValueOnce(failed);
    const user = userEvent.setup();
    render(<TailscaleAccessSection />);

    await user.click(await screen.findByRole("button", { name: "Try cleanup again" }));

    await screen.findByRole("heading", { name: "Cleanup needs attention" });
    expect(screen.getByRole("heading", { name: "Remote Access — Off" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(disableMock).toHaveBeenCalledTimes(1);
    expect(getStatusMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Check again read-only", async () => {
    const deferred = makeStatus("off", {
      cleanupState: "deferred",
      availableActions: ["disable", "checkAgain"],
    });
    const notNeeded = makeStatus("off", {
      cleanupState: "notNeeded",
      availableActions: ["enable", "checkAgain"],
    });
    getStatusMock.mockResolvedValueOnce(deferred).mockResolvedValueOnce(notNeeded);
    const user = userEvent.setup();
    render(<TailscaleAccessSection />);

    await user.click(await screen.findByRole("button", { name: "Check again" }));

    await screen.findByRole("heading", { name: "No cleanup needed" });
    expect(getStatusMock).toHaveBeenCalledTimes(2);
    expect(disableMock).not.toHaveBeenCalled();
    expect(enableMock).not.toHaveBeenCalled();
    expect(retryMock).not.toHaveBeenCalled();
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
