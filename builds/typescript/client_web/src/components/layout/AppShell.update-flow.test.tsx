import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AppShell from "./AppShell";

const { hooksMock, updateAdapterMock, gatewayChatMock, gatewayAdapterMock } = vi.hoisted(() => ({
  hooksMock: {
    useProjects: vi.fn(),
    useUpdateStatus: vi.fn(),
  },
  updateAdapterMock: {
    startUpdateConversation: vi.fn(),
  },
  gatewayChatMock: {
    clearGatewayChatDraftState: vi.fn(),
  },
  gatewayAdapterMock: {
    getOnboardingStatus: vi.fn(async () => ({
      active_provider_profile: null,
      default_provider_profile: null,
      providers: [],
    })),
  },
}));

vi.mock("@/hooks/useProjects", () => ({
  useProjects: hooksMock.useProjects,
}));

vi.mock("@/hooks/useUpdateStatus", () => ({
  useUpdateStatus: hooksMock.useUpdateStatus,
}));

vi.mock("@/api/update-adapter", () => ({
  startUpdateConversation: updateAdapterMock.startUpdateConversation,
}));

vi.mock("@/api/useGatewayChat", () => ({
  clearGatewayChatDraftState: gatewayChatMock.clearGatewayChatDraftState,
}));

vi.mock("@/api/gateway-adapter", () => ({
  getOnboardingStatus: gatewayAdapterMock.getOnboardingStatus,
}));

vi.mock("@/components/chat/ChatPanel", () => ({
  default: () => <div data-testid="chat-panel" />,
}));

vi.mock("@/components/document/DocumentView", () => ({
  default: () => <div data-testid="document-view" />,
}));

vi.mock("@/components/settings/SettingsModal", () => ({
  default: () => <div data-testid="settings-modal" />,
}));

vi.mock("./Sidebar", () => ({
  default: ({ showUpdateIndicator, onUpdateIndicatorClick }: { showUpdateIndicator: boolean; onUpdateIndicatorClick: () => void }) => (
    <div>
      {showUpdateIndicator ? (
        <button type="button" onClick={onUpdateIndicatorClick}>
          Start update flow
        </button>
      ) : null}
    </div>
  ),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("AppShell update flow", () => {
  const selectProject = vi.fn();
  const refreshProjects = vi.fn();

  beforeEach(() => {
    selectProject.mockReset();
    refreshProjects.mockReset();
    updateAdapterMock.startUpdateConversation.mockReset();
    gatewayChatMock.clearGatewayChatDraftState.mockReset();

    hooksMock.useProjects.mockReturnValue({
      projects: [],
      selectedProjectId: null,
      selectedProject: null,
      projectFiles: [],
      isLoadingProjects: false,
      isLoadingFiles: false,
      activeConversationId: null,
      selectProject,
      deselectProject: vi.fn(),
      refreshProjects,
      addProject: vi.fn(),
      removeProject: vi.fn(),
      renameProject: vi.fn(),
    });
    hooksMock.useUpdateStatus.mockReturnValue({
      updateStatus: {
        channel: "stable",
        current_version: "26.4.18",
        latest_stable_version: "26.4.19",
        update_available: true,
        last_checked_at: "2026-04-18T15:00:00.000Z",
        diagnostic: null,
      },
      hasUpdateAvailable: true,
      isLoading: false,
      error: null,
      refreshStatus: vi.fn(),
    });
  });

  it("bootstraps the BD+1 update conversation and gates duplicate starts", async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<void>();
    updateAdapterMock.startUpdateConversation.mockReturnValue(deferred.promise);

    render(<AppShell />);

    const startButton = screen.getByRole("button", { name: "Start update flow" });
    await user.click(startButton);
    await user.click(startButton);

    expect(selectProject).toHaveBeenCalledWith("braindrive-plus-one");
    expect(gatewayChatMock.clearGatewayChatDraftState).toHaveBeenCalledTimes(1);
    expect(gatewayChatMock.clearGatewayChatDraftState).toHaveBeenCalledWith("braindrive-plus-one");
    expect(updateAdapterMock.startUpdateConversation).toHaveBeenCalledTimes(1);

    deferred.resolve();

    await waitFor(() => {
      expect(refreshProjects).toHaveBeenCalledTimes(1);
    });

    const secondDeferred = createDeferred<void>();
    updateAdapterMock.startUpdateConversation.mockReturnValue(secondDeferred.promise);

    await user.click(startButton);
    expect(updateAdapterMock.startUpdateConversation).toHaveBeenCalledTimes(2);

    secondDeferred.resolve();
    await waitFor(() => {
      expect(refreshProjects).toHaveBeenCalledTimes(2);
    });
  });

  it("renders update indicator trigger only when update availability is true", () => {
    hooksMock.useUpdateStatus.mockReturnValue({
      updateStatus: {
        channel: "stable",
        current_version: "26.4.19",
        latest_stable_version: "26.4.19",
        update_available: false,
        last_checked_at: "2026-04-18T16:00:00.000Z",
        diagnostic: null,
      },
      hasUpdateAvailable: false,
      isLoading: false,
      error: null,
      refreshStatus: vi.fn(),
    });

    const { rerender } = render(<AppShell />);
    expect(screen.queryByRole("button", { name: "Start update flow" })).not.toBeInTheDocument();

    hooksMock.useUpdateStatus.mockReturnValue({
      updateStatus: {
        channel: "stable",
        current_version: "26.4.18",
        latest_stable_version: "26.4.19",
        update_available: true,
        last_checked_at: "2026-04-18T16:01:00.000Z",
        diagnostic: null,
      },
      hasUpdateAvailable: true,
      isLoading: false,
      error: null,
      refreshStatus: vi.fn(),
    });

    rerender(<AppShell />);
    expect(screen.getByRole("button", { name: "Start update flow" })).toBeInTheDocument();
  });

  it("refreshes projects even when bootstrap start fails", async () => {
    const user = userEvent.setup();
    updateAdapterMock.startUpdateConversation.mockRejectedValue(new Error("gateway unavailable"));

    render(<AppShell />);

    await user.click(screen.getByRole("button", { name: "Start update flow" }));

    await waitFor(() => {
      expect(refreshProjects).toHaveBeenCalledTimes(1);
    });
  });
});
