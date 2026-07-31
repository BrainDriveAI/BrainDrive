import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TailscaleAccessStatus } from "@/api/desktop-tailscale-access";

import type {
  GatewayMemoryBackupRestoreRequest,
  GatewayMemoryBackupRunRequest,
  GatewayMemoryBackupSettingsUpdateRequest,
  GatewayModelCatalog,
  GatewaySettings,
  Session
} from "@/api/types";

import SettingsModal from "./SettingsModal";

type BrowserAccessStatus = {
  enabled: boolean;
  state: string;
  networkScope: "thisComputer" | "privateNetwork";
  bindAddress: string;
  requestedPort: number;
  port: number | null;
  urls: string[];
  configPath: string;
  firewallHint: string;
  lastError: string | null;
  accountInitialized: boolean | null;
};

const getSettingsMock = vi.fn<() => Promise<GatewaySettings>>();
const updateSettingsMock = vi.fn<
  (patch: Partial<Pick<GatewaySettings, "default_model" | "active_provider_profile">>) => Promise<GatewaySettings>
>();
const getProviderModelsMock = vi.fn<
  (providerProfile?: string) => Promise<GatewayModelCatalog>
>();
const getCreditsStatusMock = vi.fn();
const createCreditsCheckoutMock = vi.fn();
const getEmailCreditCapabilityMock = vi.fn();
const claimEmailCreditMock = vi.fn();
const refreshEmailCreditStatusMock = vi.fn();
const downloadLibraryExportMock = vi.fn<
  () => Promise<{ fileName: string; blob: Blob }>
>();
const importLibraryArchiveMock = vi.fn();
const updateProviderCredentialMock = vi.fn<
  (payload?: unknown) => Promise<{ settings: GatewaySettings }>
>();
const updateMemoryBackupSettingsMock = vi.fn<
  (payload: GatewayMemoryBackupSettingsUpdateRequest) => Promise<GatewaySettings>
>();
const runMemoryBackupNowMock = vi.fn<
  (
    payload?: GatewayMemoryBackupRunRequest
  ) => Promise<{ result: { result: "success" | "failed" | "noop" | "conflict"; message?: string }; settings: GatewaySettings }>
>();
const restoreMemoryBackupMock = vi.fn<
  (payload?: GatewayMemoryBackupRestoreRequest) => Promise<{ result: { commit: string }; settings: GatewaySettings }>
>();
const getBrowserAccessStatusMock = vi.fn<() => Promise<BrowserAccessStatus>>();
const updateBrowserAccessSettingsMock = vi.fn();
const restartBrowserAccessMock = vi.fn();
const applyBrowserAccessFirewallRuleMock = vi.fn();
const getTailscaleAccessStatusMock = vi.fn<() => Promise<TailscaleAccessStatus>>();
const enableTailscaleAccessMock = vi.fn<() => Promise<TailscaleAccessStatus>>();
const retryTailscaleAccessMock = vi.fn<() => Promise<TailscaleAccessStatus>>();
const disableTailscaleAccessMock = vi.fn<() => Promise<TailscaleAccessStatus>>();
const getSessionMock = vi.fn<() => Promise<Session>>();
const logoutMock = vi.fn<() => Promise<void>>();
const getRootAgentMock = vi.fn<
  () => Promise<{ managedContent: string; overlayContent: string | null }>
>();
const updateRootAgentOverlayMock = vi.fn<(content: string) => Promise<void>>();
const resetGatewayChatRuntimeMock = vi.fn();

vi.mock("@/api/gateway-adapter", () => ({
  getSettings: () => getSettingsMock(),
  updateSettings: (
    patch: Partial<Pick<GatewaySettings, "default_model" | "active_provider_profile">>
  ) => updateSettingsMock(patch),
  getCreditsStatus: () => getCreditsStatusMock(),
  createCreditsCheckout: (payload: { amount: number; email: string }) => createCreditsCheckoutMock(payload),
  getEmailCreditCapability: () => getEmailCreditCapabilityMock(),
  claimEmailCredit: (payload: { email: string }) => claimEmailCreditMock(payload),
  refreshEmailCreditStatus: () => refreshEmailCreditStatusMock(),
  updateProviderCredential: (payload: unknown) => updateProviderCredentialMock(payload),
  updateMemoryBackupSettings: (payload: GatewayMemoryBackupSettingsUpdateRequest) =>
    updateMemoryBackupSettingsMock(payload),
  runMemoryBackupNow: (payload?: GatewayMemoryBackupRunRequest) => runMemoryBackupNowMock(payload),
  restoreMemoryBackup: (payload?: GatewayMemoryBackupRestoreRequest) => restoreMemoryBackupMock(payload),
  getProviderModels: (providerProfile?: string) => getProviderModelsMock(providerProfile),
  downloadLibraryExport: () => downloadLibraryExportMock(),
  importLibraryArchive: (file: Blob) => importLibraryArchiveMock(file),
  getRootAgent: () => getRootAgentMock(),
  updateRootAgentOverlay: (content: string) => updateRootAgentOverlayMock(content),
}));

vi.mock("@/api/auth-adapter", () => ({
  getSession: () => getSessionMock(),
  logout: () => logoutMock(),
}));

vi.mock("@/api/useGatewayChat", () => ({
  resetGatewayChatRuntime: () => resetGatewayChatRuntimeMock(),
}));

vi.mock("@/api/desktop-browser-access", () => ({
  getBrowserAccessStatus: () => getBrowserAccessStatusMock(),
  updateBrowserAccessSettings: (settings: unknown) => updateBrowserAccessSettingsMock(settings),
  restartBrowserAccess: () => restartBrowserAccessMock(),
  applyBrowserAccessFirewallRule: (enabled: boolean) => applyBrowserAccessFirewallRuleMock(enabled),
}));

vi.mock("@/api/desktop-tailscale-access", () => ({
  getTailscaleAccessStatus: () => getTailscaleAccessStatusMock(),
  enableTailscaleAccess: () => enableTailscaleAccessMock(),
  retryTailscaleAccess: () => retryTailscaleAccessMock(),
  disableTailscaleAccess: () => disableTailscaleAccessMock(),
}));

const baseSettings: GatewaySettings = {
  default_model: "openai/gpt-4o-mini",
  approval_mode: "ask-on-write",
  active_provider_profile: "openrouter",
  provider_activation_revision: 0,
  default_provider_profile: "openrouter",
  available_models: ["openai/gpt-4o-mini", "llama3.1"],
  memory_backup: null,
  provider_profiles: [
    {
      id: "openrouter",
      provider_id: "openrouter",
      base_url: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      credential_mode: "secret_ref",
      credential_ref: "provider/openrouter/api-key",
    },
    {
      id: "ollama",
      provider_id: "ollama",
      base_url: "http://host.docker.internal:11434/v1",
      model: "",
      credential_mode: "plain",
      credential_ref: null,
    },
  ],
  braindrive_models_key: null,
};

const brainDriveModelsSettings: GatewaySettings = {
  ...baseSettings,
  default_model: "braindrive-models-default",
  active_provider_profile: "braindrive-models",
  default_provider_profile: "braindrive-models",
  available_models: ["braindrive-models-default"],
  provider_profiles: [
    {
      id: "braindrive-models",
      provider_id: "braindrive-models",
      base_url: "https://my.braindrive.ai/credits/v1",
      model: "braindrive-models-default",
      credential_mode: "unset",
      credential_ref: null,
    },
    ...baseSettings.provider_profiles,
  ],
};

const brainDriveModelsReadySettings: GatewaySettings = {
  ...brainDriveModelsSettings,
  provider_profiles: brainDriveModelsSettings.provider_profiles.map((profile) =>
    profile.provider_id === "braindrive-models"
      ? { ...profile, credential_mode: "secret_ref", credential_ref: "provider/ai-gateway/api_key" }
      : profile
  ),
  braindrive_models_key: {
    status: "ready",
    checkout_pending: false,
    masked_key: "sk-...-key",
  },
};

const openRouterActiveWithBrainDriveModels: GatewaySettings = {
  ...brainDriveModelsSettings,
  default_model: "openai/gpt-4o-mini",
  active_provider_profile: "openrouter",
  provider_activation_revision: 0,
};

const providerCatalog: GatewayModelCatalog = {
  provider_profile: "openrouter",
  provider_id: "openrouter",
  source: "provider",
  models: [
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o Mini",
      provider: "OpenAI",
      tags: ["chat"],
    },
    {
      id: "meta-llama/llama-3.1-8b-instruct:free",
      name: "Llama 3.1 8B Instruct",
      provider: "Meta",
      is_free: true,
      tags: ["free"],
    },
  ],
};

const settingsWithBackup: GatewaySettings = {
  ...baseSettings,
  memory_backup: {
    repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
    frequency: "manual",
    token_configured: true,
    last_result: "success",
    last_error: null,
    last_save_at: "2026-04-07T12:00:01.000Z",
  },
};

const browserAccessStatus: BrowserAccessStatus = {
  enabled: true,
  state: "running",
  networkScope: "privateNetwork",
  bindAddress: "0.0.0.0",
  requestedPort: 18088,
  port: 18088,
  urls: ["http://127.0.0.1:18088", "http://192.168.1.10:18088"],
  configPath: "/Users/test/Library/Application Support/ai.braindrive.desktop/browser-access.json",
  firewallHint: "macOS may ask you to allow incoming connections for BrainDrive.",
  lastError: null,
  accountInitialized: true,
};

const tailscaleAccessStatus: TailscaleAccessStatus = {
  state: "ready",
  desiredEnabled: false,
  readiness: {
    state: "ready",
    installedVersion: { major: 1, minor: 98, patch: 8 },
    minimumSupportedVersion: { major: 1, minor: 98, patch: 8 },
    backendState: "Running",
    online: true,
    dnsNameAvailable: true,
    errorCode: null,
  },
  ownership: "absent",
  bridgeState: "stopped",
  accessUrl: null,
  setupUrl: null,
  availableActions: ["enable", "checkAgain"],
  message: "Tailscale is ready for private BrainDrive access.",
  detail: null,
  errorCode: null,
  checkedAtUnixMs: 1,
};

function localSession(email: string): Session {
  return {
    mode: "local",
    user: {
      id: "owner",
      name: "Local Owner",
      initials: "LO",
      email,
      role: "owner",
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("SettingsModal", () => {
  beforeEach(() => {
    localStorage.clear();
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    getProviderModelsMock.mockReset();
    getCreditsStatusMock.mockReset();
    createCreditsCheckoutMock.mockReset();
    getEmailCreditCapabilityMock.mockReset();
    claimEmailCreditMock.mockReset();
    refreshEmailCreditStatusMock.mockReset();
    downloadLibraryExportMock.mockReset();
    importLibraryArchiveMock.mockReset();
    updateProviderCredentialMock.mockReset();
    updateMemoryBackupSettingsMock.mockReset();
    runMemoryBackupNowMock.mockReset();
    restoreMemoryBackupMock.mockReset();
    getBrowserAccessStatusMock.mockReset();
    updateBrowserAccessSettingsMock.mockReset();
    restartBrowserAccessMock.mockReset();
    applyBrowserAccessFirewallRuleMock.mockReset();
    getTailscaleAccessStatusMock.mockReset();
    enableTailscaleAccessMock.mockReset();
    retryTailscaleAccessMock.mockReset();
    disableTailscaleAccessMock.mockReset();
    getSessionMock.mockReset();
    logoutMock.mockReset();
    getRootAgentMock.mockReset();
    updateRootAgentOverlayMock.mockReset();
    resetGatewayChatRuntimeMock.mockReset();
    getSettingsMock.mockResolvedValue(baseSettings);
    updateSettingsMock.mockResolvedValue(baseSettings);
    updateProviderCredentialMock.mockResolvedValue({ settings: baseSettings });
    updateMemoryBackupSettingsMock.mockResolvedValue(settingsWithBackup);
    runMemoryBackupNowMock.mockResolvedValue({
      result: { result: "success", message: "Backup saved successfully." },
      settings: settingsWithBackup,
    });
    restoreMemoryBackupMock.mockResolvedValue({
      result: { commit: "abc123def456" },
      settings: settingsWithBackup,
    });
    getRootAgentMock.mockResolvedValue({
      managedContent: "# BrainDrive Agent\n\nUse the default global instructions.\n",
      overlayContent: null,
    });
    updateRootAgentOverlayMock.mockResolvedValue();
    getProviderModelsMock.mockResolvedValue(providerCatalog);
    getCreditsStatusMock.mockResolvedValue({
      remaining_usd: 0,
      total_purchased_usd: 0,
      total_spent_usd: 0,
      key_valid: true,
      purchase_status: "zero_balance",
    });
    createCreditsCheckoutMock.mockResolvedValue({
      checkout_url: "https://checkout.stripe.com/c/pay_test",
      purchase_status: "activating",
    });
    getEmailCreditCapabilityMock.mockResolvedValue({ available: false, version: null });
    refreshEmailCreditStatusMock.mockRejectedValue(
      Object.assign(new Error("No claim"), { code: "no_claim_operation" })
    );
    downloadLibraryExportMock.mockResolvedValue({
      fileName: "memory-export-123.tar.gz",
      blob: new Blob(["tar-bytes"], { type: "application/gzip" }),
    });
    importLibraryArchiveMock.mockResolvedValue({
      imported_at: "2026-04-03T00:00:00.000Z",
      schema_version: 1,
      source_format: "migration-v1",
      restored: {
        memory: true,
        secrets: true,
      },
      warnings: [],
      settings: baseSettings,
    });
    getBrowserAccessStatusMock.mockResolvedValue(browserAccessStatus);
    updateBrowserAccessSettingsMock.mockResolvedValue(browserAccessStatus);
    restartBrowserAccessMock.mockResolvedValue(browserAccessStatus);
    applyBrowserAccessFirewallRuleMock.mockResolvedValue({
      ok: true,
      message: "Opened macOS System Settings. In Network > Firewall, allow incoming connections for BrainDrive if prompted.",
      command: "open -b com.apple.systempreferences",
    });
    getTailscaleAccessStatusMock.mockResolvedValue(tailscaleAccessStatus);
    enableTailscaleAccessMock.mockResolvedValue(tailscaleAccessStatus);
    retryTailscaleAccessMock.mockResolvedValue(tailscaleAccessStatus);
    disableTailscaleAccessMock.mockResolvedValue(tailscaleAccessStatus);
    getSessionMock.mockResolvedValue(localSession("owner@local.braindrive"));
    logoutMock.mockResolvedValue();
    delete window.__TAURI_INTERNALS__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.__TAURI_INTERNALS__;
  });

  it("expands a provider without activating it or fetching its catalog", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "AI Models" })[0]!);
    const ollamaCard = screen.getAllByRole("button", {
      name: /Ollama provider settings/i,
    })[0]!;
    await user.click(ollamaCard);

    expect(ollamaCard).toHaveAttribute("aria-expanded", "true");
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(getProviderModelsMock).not.toHaveBeenCalledWith("ollama");
  });

  it("supports keyboard expansion and a separate deliberate Ollama activation", async () => {
    const user = userEvent.setup();
    const activatedSettings: GatewaySettings = {
      ...baseSettings,
      active_provider_profile: "ollama",
      provider_activation_revision: 1,
    };
    updateSettingsMock.mockResolvedValueOnce(activatedSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    const ollamaCard = screen.getAllByRole("button", {
      name: /Ollama provider settings/i,
    })[0]!;
    ollamaCard.focus();
    await user.keyboard("{Enter}");

    expect(ollamaCard).toHaveAttribute("aria-expanded", "true");
    expect(updateSettingsMock).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "Use Ollama" })[0]!);
    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledTimes(1);
      expect(updateSettingsMock).toHaveBeenCalledWith({
        active_provider_profile: "ollama",
      });
    });
    expect(
      screen.getAllByRole("button", { name: /Ollama provider settings/i })[0]
    ).toHaveAttribute("aria-current", "true");
    expect(resetGatewayChatRuntimeMock).not.toHaveBeenCalled();
  });

  it("downloads export from the export tab", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Migrate" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Download" })[0]!);

    await waitFor(() => {
      expect(downloadLibraryExportMock).toHaveBeenCalledTimes(1);
    });
  });

  it("imports a migration archive from the export tab", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Migrate" })[0]!);

    const importInput = screen.getByLabelText("Choose file") as HTMLInputElement;
    const file = new File(["archive"], "memory-migration.tar.gz", { type: "application/gzip" });
    await user.upload(importInput, file);
    await user.click(screen.getAllByRole("button", { name: "Import" })[0]!);

    await waitFor(() => {
      expect(importLibraryArchiveMock).toHaveBeenCalledTimes(1);
    });
    expect(resetGatewayChatRuntimeMock).toHaveBeenCalledTimes(1);
  });

  it("keeps import button disabled until a migration archive is selected", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Migrate" })[0]!);

    const importButton = screen.getAllByRole("button", { name: "Import" })[0] as HTMLButtonElement;
    expect(importButton).toBeDisabled();
    await user.click(importButton);
    expect(importLibraryArchiveMock).not.toHaveBeenCalled();

    const importInput = screen.getByLabelText("Choose file") as HTMLInputElement;
    const file = new File(["archive"], "memory-migration.tar.gz", { type: "application/gzip" });
    await user.upload(importInput, file);

    expect(importButton).toBeEnabled();
  });

  it("filters provider models in real time and saves selected model", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(getProviderModelsMock).toHaveBeenCalled();
    });

    await user.click(screen.getAllByRole("button", { name: /Browse model catalog/i })[0]!);
    const searchInput = screen.getAllByPlaceholderText("Search models...")[0]!;
    await user.type(searchInput, "free");

    await waitFor(() => {
      expect(screen.getAllByText("meta-llama/llama-3.1-8b-instruct:free").length).toBeGreaterThan(0);
    });
    const freeModelButton = screen
      .getAllByText("meta-llama/llama-3.1-8b-instruct:free")[0]!
      .closest("button");
    expect(freeModelButton).not.toBeNull();
    await user.click(freeModelButton as HTMLButtonElement);

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({
        default_model: "meta-llama/llama-3.1-8b-instruct:free",
      });
    });
  });

  it("offers inline checkout in Model Providers without API-key paste as the default purchase step", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "AI Models" })[0]!);

    expect((await screen.findAllByText("BrainDrive Models")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recommended").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Continue to checkout/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Enter your BrainDrive API key")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste your emailed BrainDrive Models key/i)).not.toBeInTheDocument();
  });

  it("does not check the receipt email when email credit capability is off", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);

    await waitFor(() => expect(getEmailCreditCapabilityMock).toHaveBeenCalled());
    expect(screen.queryByRole("heading", { name: "Available email credit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply credit" })).not.toBeInTheDocument();
    expect(claimEmailCreditMock).not.toHaveBeenCalled();
  });

  it("automatically claims a valid receipt email and announces the applied amount", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    claimEmailCreditMock.mockResolvedValueOnce({
      state: "completed",
      operation_id: "operation-1",
      applied_cents: 2500,
      balance: {
        remaining_usd: 25,
        total_purchased_usd: 25,
        total_spent_usd: 0,
        purchase_status: "ready",
      },
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);

    await user.type(await screen.findByLabelText("Email for your receipt"), "recipient@example.com");
    await waitFor(() => {
      expect(claimEmailCreditMock).toHaveBeenCalledWith({ email: "recipient@example.com" });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("$25.00 email credit applied.");
    expect(screen.queryByRole("heading", { name: "Available email credit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply credit" })).not.toBeInTheDocument();
    expect(createCreditsCheckoutMock).not.toHaveBeenCalled();
    expect(updateProviderCredentialMock).not.toHaveBeenCalled();
  });

  it("reconciles automatic claim settings into the authoritative active provider", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(openRouterActiveWithBrainDriveModels);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    claimEmailCreditMock.mockResolvedValueOnce({
      state: "completed",
      operation_id: "operation-authoritative",
      applied_cents: 2500,
      balance: { remaining_usd: 25, purchase_status: "ready" },
      settings: {
        ...brainDriveModelsReadySettings,
        provider_activation_revision: 1,
      },
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    await user.click(
      screen.getAllByRole("button", { name: /BrainDrive Models provider settings/i })[0]!
    );
    await user.type(await screen.findByLabelText("Email for your receipt"), "recipient@example.com");

    expect(await screen.findByRole("status")).toHaveTextContent("$25.00 email credit applied.");
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button", { name: /BrainDrive Models provider settings/i })
          .every((button) => button.getAttribute("aria-current") === "true")
      ).toBe(true);
    });
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Apply credit/i })).not.toBeInTheDocument();
  });

  it("keeps a newer explicit provider response over an older deferred claim response", async () => {
    const user = userEvent.setup();
    const claim = createDeferred<{
      state: "completed";
      operation_id: string;
      applied_cents: number;
      balance: { remaining_usd: number; purchase_status: "ready" };
      settings: GatewaySettings;
    }>();
    getSettingsMock.mockResolvedValueOnce(openRouterActiveWithBrainDriveModels);
    getEmailCreditCapabilityMock.mockResolvedValue({ available: true, version: "1" });
    claimEmailCreditMock.mockReturnValueOnce(claim.promise);
    updateSettingsMock.mockResolvedValueOnce({
      ...openRouterActiveWithBrainDriveModels,
      active_provider_profile: "ollama",
      provider_activation_revision: 2,
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);

    await user.click(
      screen.getAllByRole("button", { name: /BrainDrive Models provider settings/i })[0]!
    );
    fireEvent.change(await screen.findByLabelText("Email for your receipt"), {
      target: { value: "recipient@example.com" },
    });
    await waitFor(() => expect(claimEmailCreditMock).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getAllByRole("button", { name: /Ollama provider settings/i })[1]!
    );
    await user.click(screen.getByRole("button", { name: "Use Ollama" }));
    await waitFor(() =>
      expect(updateSettingsMock).toHaveBeenCalledWith({
        active_provider_profile: "ollama",
      })
    );

    await act(async () => {
      claim.resolve({
        state: "completed",
        operation_id: "operation-stale",
        applied_cents: 500,
        balance: { remaining_usd: 5, purchase_status: "ready" },
        settings: {
          ...brainDriveModelsReadySettings,
          provider_activation_revision: 1,
        },
      });
    });

    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button", { name: /Ollama provider settings/i })
          .every((button) => button.getAttribute("aria-current") === "true")
      ).toBe(true);
    });
    expect(updateSettingsMock).toHaveBeenCalledTimes(1);
  });

  it("shares one automatic claim across the mounted desktop and mobile panels", async () => {
    const user = userEvent.setup();
    localStorage.setItem("bd_billing_email", "saved@example.com");
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValue({ available: true, version: "1" });
    claimEmailCreditMock.mockResolvedValueOnce({
      state: "completed",
      operation_id: "operation-shared",
      applied_cents: 100,
      balance: { remaining_usd: 0, purchase_status: "zero_balance" },
      settings: {
        ...brainDriveModelsReadySettings,
        provider_activation_revision: 1,
      },
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);

    await waitFor(() => expect(claimEmailCreditMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(claimEmailCreditMock).toHaveBeenCalledWith({ email: "saved@example.com" });
    expect(claimEmailCreditMock).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByRole("status")).toHaveLength(2);
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByRole("button", { name: /BrainDrive Models provider settings/i })
        .every((button) => button.getAttribute("aria-current") === "true")
    ).toBe(true);
  });

  it("does not automatically claim a synthetic session email", async () => {
    const user = userEvent.setup();
    getSessionMock.mockResolvedValueOnce(localSession("owner@local.paa"));
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);

    const input = await screen.findByLabelText("Email for your receipt");
    await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Apply credit" })).not.toBeInTheDocument();
    expect(claimEmailCreditMock).not.toHaveBeenCalled();
  });

  it("shows proven automatically applied credit when the balance refresh is unavailable", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    claimEmailCreditMock.mockResolvedValueOnce({
      state: "partial_success",
      operation_id: "operation-partial",
      applied_cents: 1000,
      error_code: "balance_refresh_unavailable",
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    fireEvent.change(await screen.findByLabelText("Email for your receipt"), {
      target: { value: "recipient@example.com" },
    });

    expect(await screen.findByRole("status")).toHaveTextContent("$10.00 email credit applied.");
    expect(screen.getByRole("status")).toHaveTextContent("Credit applied; balance refresh unavailable.");
    expect(screen.queryByRole("button", { name: "Refresh this claim" })).not.toBeInTheDocument();
  });

  it("checks each normalized receipt email at most once while the panel remains mounted", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    claimEmailCreditMock.mockResolvedValueOnce({
      state: "completed",
      operation_id: "operation-first",
      applied_cents: 100,
      balance: { remaining_usd: 0, purchase_status: "zero_balance" },
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);

    const input = await screen.findByLabelText("Email for your receipt");
    fireEvent.change(input, { target: { value: "Recipient@Example.com" } });
    await waitFor(() => expect(claimEmailCreditMock).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "recipient@example.com" } });

    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(claimEmailCreditMock).toHaveBeenCalledTimes(1);
  });

  it("silently continues the purchase flow when no email credit is available", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    claimEmailCreditMock.mockRejectedValueOnce(
      Object.assign(new Error("No available email credit was found"), { code: "no_available_credit" })
    );
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    fireEvent.change(await screen.findByLabelText("Email for your receipt"), {
      target: { value: "recipient@example.com" },
    });

    await waitFor(() => expect(claimEmailCreditMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/No available email credit/i)).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Continue to checkout/i }).some((button) => !button.hasAttribute("disabled"))
    ).toBe(true);
  });

  it.each([
    ["invalid_email", "Enter a valid email address."],
    ["key_preparation_failed", "BrainDrive Models could not be prepared. Try again."],
    ["throttled", "Please wait before trying again."],
    ["campaign_unavailable", "Available email credit is temporarily unavailable. Try again later."],
  ])("shows a safe non-blocking message for automatic claim error %s", async (code, message) => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    claimEmailCreditMock.mockRejectedValueOnce(Object.assign(new Error("upstream detail"), { code }));
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    fireEvent.change(await screen.findByLabelText("Email for your receipt"), {
      target: { value: "recipient@example.com" },
    });

    expect(await screen.findByRole("status")).toHaveTextContent(message);
    expect(screen.queryByText("upstream detail")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Continue to checkout/i }).some((button) => !button.hasAttribute("disabled"))
    ).toBe(true);
  });

  it("offers the established repair action for an automatic claim key repair error", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    claimEmailCreditMock.mockRejectedValueOnce(
      Object.assign(new Error("hidden"), { code: "key_repair_required" })
    );
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    fireEvent.change(await screen.findByLabelText("Email for your receipt"), {
      target: { value: "recipient@example.com" },
    });

    expect(await screen.findByRole("button", { name: "Repair BrainDrive Models key" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Repair BrainDrive Models key" }));
    expect(screen.getByPlaceholderText(/Paste your emailed BrainDrive Models key/i)).toBeInTheDocument();
  });

  it("reopens a pending claim without submitting the receipt email again", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    refreshEmailCreditStatusMock.mockResolvedValueOnce({
      state: "pending",
      operation_id: "operation-persisted",
      error_code: "pending_reconciliation",
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);

    expect(await screen.findByText(/being reconciled/i)).toBeInTheDocument();
    expect(claimEmailCreditMock).not.toHaveBeenCalled();
  });

  it("does not start a duplicate automatic claim while a claim is active", async () => {
    const user = userEvent.setup();
    let resolveClaim!: (value: unknown) => void;
    claimEmailCreditMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveClaim = resolve;
      })
    );
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getEmailCreditCapabilityMock.mockResolvedValueOnce({ available: true, version: "1" });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    const input = await screen.findByLabelText("Email for your receipt");
    fireEvent.change(input, { target: { value: "recipient@example.com" } });

    await waitFor(() => expect(claimEmailCreditMock).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "RECIPIENT@example.com" } });
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(claimEmailCreditMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveClaim({ state: "pending", operation_id: "operation-1" });
    });
  });

  it.each(["davidwaring@local.paa", "owner@local.braindrive"])(
    "does not prefill synthetic session email %s for BrainDrive Models checkout",
    async (sessionEmail) => {
      const user = userEvent.setup();
      getSessionMock.mockResolvedValueOnce(localSession(sessionEmail));
      getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
      render(<SettingsModal mode="local" onClose={() => {}} />);

      await waitFor(() => {
        expect(getSettingsMock).toHaveBeenCalledTimes(1);
      });

      await user.click(screen.getAllByRole("button", { name: "AI Models" })[0]!);
      const emailInput = await screen.findByLabelText("Email for your receipt");

      await waitFor(() => {
        expect(getSessionMock).toHaveBeenCalled();
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(emailInput).toHaveValue("");
      expect(screen.getAllByRole("button", { name: /Continue to checkout/i })[0]).toBeDisabled();
      expect(createCreditsCheckoutMock).not.toHaveBeenCalled();
    }
  );

  it("clears stale synthetic saved billing email and keeps checkout disabled", async () => {
    const user = userEvent.setup();
    localStorage.setItem("bd_billing_email", "owner@local.paa");
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "AI Models" })[0]!);
    const emailInput = await screen.findByLabelText("Email for your receipt");

    expect(emailInput).toHaveValue("");
    expect(screen.getAllByRole("button", { name: /Continue to checkout/i })[0]).toBeDisabled();
    expect(localStorage.getItem("bd_billing_email")).toBeNull();
    expect(createCreditsCheckoutMock).not.toHaveBeenCalled();
  });

  it("shows activating after checkout starts and keeps the raw key out of browser payloads", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    getCreditsStatusMock.mockResolvedValue({
      remaining_usd: 0,
      total_purchased_usd: 0,
      total_spent_usd: 0,
      key_valid: true,
      purchase_status: "activating",
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "AI Models" })[0]!);
    const emailInput = await screen.findByLabelText("Email for your receipt");
    fireEvent.change(emailInput, { target: { value: "owner@example.com" } });
    await waitFor(() => {
      expect(emailInput).toHaveValue("owner@example.com");
    });
    await user.click(screen.getAllByRole("button", { name: "$5" })[0]!);
    await user.click(screen.getAllByRole("button", { name: /Continue to checkout/i })[0]!);

    await waitFor(() => {
      expect(createCreditsCheckoutMock).toHaveBeenCalledWith({ amount: 5, email: "owner@example.com" });
    });
    expect(JSON.stringify(createCreditsCheckoutMock.mock.calls)).not.toContain("sk-");
    expect(openSpy).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay_test", "_blank", "noopener,noreferrer");
    expect((await screen.findAllByText(/Waiting for checkout to finish/i)).length).toBeGreaterThan(0);
    openSpy.mockRestore();
  });

  it("shows ready when credits status reports funded balance", async () => {
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsReadySettings);
    getCreditsStatusMock.mockResolvedValue({
      remaining_usd: 12,
      total_purchased_usd: 25,
      total_spent_usd: 13,
      key_valid: true,
      purchase_status: "ready",
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    expect((await screen.findAllByText("$12.00")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("credits remaining").length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("button", { name: "Add credits" })).length).toBeGreaterThan(0);
  });

  it("supports the repair path with a pasted emailed key", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      ...brainDriveModelsReadySettings,
      braindrive_models_key: {
        status: "repair_required",
        checkout_pending: false,
        masked_key: "sk-...-old",
      },
    });
    getCreditsStatusMock.mockResolvedValue({
      remaining_usd: 0,
      total_purchased_usd: 0,
      total_spent_usd: 0,
      key_valid: false,
      purchase_status: "repair_required",
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "AI Models" })[0]!);
    expect((await screen.findAllByText(/use its key on this computer/i)).length).toBeGreaterThan(0);
    await user.type(
      screen.getAllByPlaceholderText("Paste your emailed BrainDrive Models key")[0]!,
      "sk-repairkey123456789"
    );
    await user.click(screen.getAllByRole("button", { name: "Save Key" })[0]!);

    await waitFor(() => {
      expect(updateProviderCredentialMock).toHaveBeenCalledTimes(1);
    });
  });

  it("explains that migration carries secrets and backups do not", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "AI Models" })[0]!);
    await user.click((await screen.findAllByRole("button", { name: /Already have a key/i }))[0]!);

    expect(screen.getAllByText(/Use the Migrate tab instead/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/it carries your keys; backups don/i).length).toBeGreaterThan(0);
  });

  it("keeps deliberate OpenRouter and Ollama activation independent of BrainDrive Models credits", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    updateSettingsMock.mockResolvedValueOnce({
      ...brainDriveModelsSettings,
      active_provider_profile: "ollama",
      provider_activation_revision: 1,
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "AI Models" })[0]!);
    expect(screen.getAllByText("OpenRouter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ollama").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: /Ollama provider settings/i })[0]!);
    expect(updateSettingsMock).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Use Ollama" })[0]!);

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({
        active_provider_profile: "ollama",
      });
    });
    expect(createCreditsCheckoutMock).not.toHaveBeenCalled();
  });

  it("preserves the active provider and shows safe guidance when activation is not ready", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    updateSettingsMock.mockRejectedValueOnce(
      Object.assign(new Error("Configure this provider before activating it"), {
        code: "provider_not_ready",
      })
    );
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    await user.click(
      screen.getAllByRole("button", { name: /OpenRouter provider settings/i })[0]!
    );
    await user.click(screen.getAllByRole("button", { name: "Use OpenRouter" })[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Configure OpenRouter before activating it."
    );
    expect(
      screen
        .getAllByRole("button", { name: /BrainDrive Models provider settings/i })
        .every((button) => button.getAttribute("aria-current") === "true")
    ).toBe(true);
  });

  it("shows configured OpenRouter as active only after authoritative activation succeeds", async () => {
    const user = userEvent.setup();
    const activation = createDeferred<GatewaySettings>();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    updateSettingsMock.mockReturnValueOnce(activation.promise);
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    await user.click(
      screen.getAllByRole("button", { name: /OpenRouter provider settings/i })[0]!
    );
    await user.click(screen.getByRole("button", { name: "Use OpenRouter" }));

    expect(
      screen
        .getAllByRole("button", { name: /BrainDrive Models provider settings/i })
        .every((button) => button.getAttribute("aria-current") === "true")
    ).toBe(true);

    await act(async () => {
      activation.resolve({
        ...baseSettings,
        provider_activation_revision: 1,
      });
    });
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button", { name: /OpenRouter provider settings/i })
          .every((button) => button.getAttribute("aria-current") === "true")
      ).toBe(true);
    });
  });

  it("keeps unconfigured OpenRouter activation unavailable while exposing configuration", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      ...brainDriveModelsSettings,
      provider_profiles: brainDriveModelsSettings.provider_profiles.map((profile) =>
        profile.id === "openrouter"
          ? { ...profile, credential_mode: "unset", credential_ref: null }
          : profile
      ),
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    await user.click(
      screen.getAllByRole("button", { name: /OpenRouter provider settings/i })[0]!
    );

    expect(screen.getByRole("button", { name: "Use OpenRouter" })).toBeDisabled();
    expect(screen.getByText("Configure OpenRouter before activating it.")).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it("does not let a late activation failure erase a newer successful provider", async () => {
    const user = userEvent.setup();
    const olderOpenRouter = createDeferred<GatewaySettings>();
    updateSettingsMock.mockImplementation((patch) => {
      if (patch.active_provider_profile === "openrouter") {
        return olderOpenRouter.promise;
      }
      return Promise.resolve({
        ...brainDriveModelsSettings,
        active_provider_profile: "ollama",
        provider_activation_revision: 2,
      });
    });
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);

    await user.click(
      screen.getAllByRole("button", { name: /OpenRouter provider settings/i })[0]!
    );
    await user.click(screen.getByRole("button", { name: "Use OpenRouter" }));
    await user.click(
      screen.getAllByRole("button", { name: /Ollama provider settings/i })[1]!
    );
    await user.click(screen.getByRole("button", { name: "Use Ollama" }));

    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button", { name: /Ollama provider settings/i })
          .every((button) => button.getAttribute("aria-current") === "true")
      ).toBe(true);
    });
    await act(async () => {
      olderOpenRouter.reject(
        Object.assign(new Error("stale hidden failure"), { code: "provider_not_ready" })
      );
    });

    await waitFor(() => expect(updateSettingsMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: /Ollama provider settings/i })
        .every((button) => button.getAttribute("aria-current") === "true")
    ).toBe(true);
  });

  it("consumes credential-save activation settings without resetting chat", async () => {
    const user = userEvent.setup();
    const unconfiguredOpenRouter: GatewaySettings = {
      ...brainDriveModelsSettings,
      provider_profiles: brainDriveModelsSettings.provider_profiles.map((profile) =>
        profile.id === "openrouter"
          ? { ...profile, credential_mode: "unset", credential_ref: null }
          : profile
      ),
    };
    getSettingsMock.mockResolvedValueOnce(unconfiguredOpenRouter);
    updateProviderCredentialMock.mockResolvedValueOnce({
      settings: {
        ...baseSettings,
        provider_activation_revision: 1,
      },
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click((await screen.findAllByRole("button", { name: "AI Models" }))[0]!);
    await user.click(
      screen.getAllByRole("button", { name: /OpenRouter provider settings/i })[0]!
    );
    await user.type(screen.getByLabelText("API Key"), "sk-test-openrouter-key");
    await user.click(screen.getByRole("button", { name: "Save API Key" }));

    await waitFor(() => expect(updateProviderCredentialMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button", { name: /OpenRouter provider settings/i })
          .every((button) => button.getAttribute("aria-current") === "true")
      ).toBe(true);
    });
    expect(resetGatewayChatRuntimeMock).not.toHaveBeenCalled();
  });

  it("renders backup and migrate tabs in local mode", async () => {
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    const tabLabels = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.trim() ?? "")
      .filter(Boolean);

    const backupIndex = tabLabels.indexOf("Backup");
    const migrateIndex = tabLabels.indexOf("Migrate");
    expect(migrateIndex).toBeGreaterThanOrEqual(0);
    expect(backupIndex).toBeGreaterThanOrEqual(0);
  });

  it("shows Remote Access only in the local desktop app", async () => {
    const { unmount } = render(<SettingsModal mode="local" onClose={() => {}} />);
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Remote Access" })).not.toBeInTheDocument();
    unmount();

    window.__TAURI_INTERNALS__ = {};
    const desktop = render(<SettingsModal mode="local" onClose={() => {}} />);
    expect(screen.getAllByRole("button", { name: "Remote Access" })).toHaveLength(2);
    desktop.rerender(<SettingsModal mode="managed" onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Remote Access" })).not.toBeInTheDocument();
  });

  it("opens the desktop Remote Access tab without changing Browser Access", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await user.click(screen.getAllByRole("button", { name: "Remote Access" })[0]!);
    await waitFor(() => expect(getTailscaleAccessStatusMock).toHaveBeenCalled());

    expect(screen.getAllByText("Powered by Tailscale").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Browser Access" })).toHaveLength(2);
    expect(getBrowserAccessStatusMock).not.toHaveBeenCalled();
  });

  it("renders platform-specific Browser Access firewall guidance in the desktop app", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await user.click(screen.getAllByRole("button", { name: "Browser Access" })[0]!);

    await waitFor(() => {
      expect(getBrowserAccessStatusMock).toHaveBeenCalled();
    });
    expect(screen.getAllByText("macOS may ask you to allow incoming connections for BrainDrive.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Private-network access may require a Windows Firewall rule.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Only web browsers on this computer.").length).toBeGreaterThan(0);
  });

  it("shows the macOS firewall handoff result from Browser Access", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await user.click(screen.getAllByRole("button", { name: "Browser Access" })[0]!);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Firewall/i }).length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole("button", { name: /Firewall/i })[0]!);

    await waitFor(() => {
      expect(applyBrowserAccessFirewallRuleMock).toHaveBeenCalledWith(true);
    });
    expect(
      screen.getAllByText("Opened macOS System Settings. In Network > Firewall, allow incoming connections for BrainDrive if prompted.").length
    ).toBeGreaterThan(0);
  });

  it("requires widening confirmation when enabling with a stored Home network scope", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    getBrowserAccessStatusMock.mockResolvedValue({
      ...browserAccessStatus,
      enabled: false,
      state: "stopped",
      urls: [],
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "Browser Access" })[0]!);
    const toggle = (await screen.findAllByRole("switch", { name: "Enable Browser Access" }))[0]!;

    await user.click(toggle);

    expect(await screen.findByText(/will be able to open BrainDrive in a browser/i)).toBeInTheDocument();
    expect(updateBrowserAccessSettingsMock).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "Turn on Home network" })[0]!);
    await waitFor(() => expect(updateBrowserAccessSettingsMock).toHaveBeenCalledTimes(1));
    expect(updateBrowserAccessSettingsMock).toHaveBeenCalledWith({
      enabled: true,
      networkScope: "privateNetwork",
      port: 18088,
    });
  });

  it("keeps the committed scope until Home network is confirmed, and cancel dismisses", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    getBrowserAccessStatusMock.mockResolvedValue({
      ...browserAccessStatus,
      networkScope: "thisComputer",
      urls: ["http://127.0.0.1:18088"],
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "Browser Access" })[0]!);
    const homeNetwork = (await screen.findAllByRole("radio", { name: /Home network/ }))[0]!;

    await user.click(homeNetwork);

    expect(await screen.findByText(/will be able to open BrainDrive in a browser/i)).toBeInTheDocument();
    expect(homeNetwork).toHaveAttribute("aria-checked", "false");
    expect(updateBrowserAccessSettingsMock).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "Cancel" })[0]!);
    expect(screen.queryByText(/will be able to open BrainDrive in a browser/i)).not.toBeInTheDocument();
    expect(updateBrowserAccessSettingsMock).not.toHaveBeenCalled();
  });

  it("submits the persisted port for toggle changes, not the unsaved Advanced draft", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    getBrowserAccessStatusMock.mockResolvedValue({
      ...browserAccessStatus,
      enabled: false,
      state: "stopped",
      networkScope: "thisComputer",
      requestedPort: 18090,
      port: 18090,
      urls: [],
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "Browser Access" })[0]!);
    const toggle = (await screen.findAllByRole("switch", { name: "Enable Browser Access" }))[0]!;

    const portInput = screen.getAllByRole("spinbutton")[0]!;
    await user.clear(portInput);
    await user.type(portInput, "18095");
    await user.click(toggle);

    await waitFor(() => expect(updateBrowserAccessSettingsMock).toHaveBeenCalledTimes(1));
    expect(updateBrowserAccessSettingsMock).toHaveBeenCalledWith({
      enabled: true,
      networkScope: "thisComputer",
      port: 18090,
    });
  });

  it("reports a failed apply as an error even when the setting persisted", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    getBrowserAccessStatusMock.mockResolvedValue({
      ...browserAccessStatus,
      enabled: false,
      state: "stopped",
      networkScope: "thisComputer",
      urls: [],
    });
    updateBrowserAccessSettingsMock.mockResolvedValue({
      ...browserAccessStatus,
      enabled: true,
      state: "failed",
      networkScope: "thisComputer",
      urls: [],
      lastError: "Port 18088 is already in use.",
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "Browser Access" })[0]!);
    const toggle = (await screen.findAllByRole("switch", { name: "Enable Browser Access" }))[0]!;

    await user.click(toggle);

    expect((await screen.findAllByText("Port 18088 is already in use.")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Browser Access is running.")).not.toBeInTheDocument();
    expect(screen.queryByText("Browser Access settings saved.")).not.toBeInTheDocument();
  });

  it("refreshes status from the backend when an apply is rejected", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    const initial = {
      ...browserAccessStatus,
      enabled: false,
      state: "stopped" as const,
      networkScope: "thisComputer" as const,
      urls: [],
    };
    const refreshed = {
      ...initial,
      enabled: true,
      state: "failed" as const,
      lastError: "bridge spawn failed",
    };
    let statusCalls = 0;
    getBrowserAccessStatusMock.mockImplementation(() => Promise.resolve(++statusCalls <= 2 ? initial : refreshed));
    updateBrowserAccessSettingsMock.mockRejectedValue(new Error("bridge spawn failed"));
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "Browser Access" })[0]!);
    const toggle = (await screen.findAllByRole("switch", { name: "Enable Browser Access" }))[0]!;

    await user.click(toggle);

    await waitFor(() => expect(getBrowserAccessStatusMock).toHaveBeenCalledTimes(3));
    expect((await screen.findAllByText(/bridge spawn failed/)).length).toBeGreaterThan(0);
  });

  it("does not render a QR for a non-private LAN address", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    getBrowserAccessStatusMock.mockResolvedValue({
      ...browserAccessStatus,
      urls: ["http://127.0.0.1:18088", "http://8.8.8.8:18088"],
    });
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "Browser Access" })[0]!);
    expect(await screen.findAllByRole("switch", { name: "Enable Browser Access" })).not.toHaveLength(0);

    expect(screen.queryAllByRole("img", { name: /QR code/i })).toHaveLength(0);
  });

  it("renders a QR for a valid private LAN address on the expected port", async () => {
    const user = userEvent.setup();
    window.__TAURI_INTERNALS__ = {};
    render(<SettingsModal mode="local" onClose={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "Browser Access" })[0]!);

    expect((await screen.findAllByRole("img", { name: /QR code/i })).length).toBeGreaterThan(0);
  });

  it("edits the owner global agent overlay from the Your Agent tab", async () => {
    const user = userEvent.setup();
    getRootAgentMock
      .mockResolvedValueOnce({
        managedContent: "# BrainDrive Agent\n\nUse the default global instructions.\n",
        overlayContent: null,
      })
      .mockResolvedValueOnce({
        managedContent: "# BrainDrive Agent\n\nUse the default global instructions.\n",
        overlayContent: "Use concise answers.\n",
      });
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Your Agent" })[0]!);

    await waitFor(() => {
      expect(getRootAgentMock).toHaveBeenCalled();
    });

    expect(screen.getAllByText("AGENT.md").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Use the default global instructions/)).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Managed Default/i })[0]!);
    expect(await screen.findByText(/Use the default global instructions/)).toBeInTheDocument();

    const textarea = screen.getAllByLabelText("Your agent customization")[0]!;
    await user.type(textarea, "Use concise answers.");
    await user.click(screen.getAllByRole("button", { name: "Save" })[0]!);

    await waitFor(() => {
      expect(updateRootAgentOverlayMock).toHaveBeenCalledWith("Use concise answers.");
    });
    expect(await screen.findByText("Your agent customization was saved.")).toBeInTheDocument();
  });

  it("saves memory backup settings", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(baseSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Backup" })[0]!);
    await user.clear(screen.getAllByLabelText("Repository URL")[0]!);
    await user.type(
      screen.getAllByLabelText("Repository URL")[0]!,
      "https://github.com/BrainDriveAI/braindrive-memory.git"
    );
    await user.type(screen.getAllByLabelText("Token")[0]!, "ghp_test");
    await user.click(screen.getAllByRole("button", { name: "Every day" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Save Settings" })[0]!);

    await waitFor(() => {
      expect(updateMemoryBackupSettingsMock).toHaveBeenCalledWith({
        repository_url: "https://github.com/BrainDriveAI/braindrive-memory.git",
        frequency: "daily",
        git_token: "ghp_test",
      });
    });
  });

  it("runs manual save from memory backup tab", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(settingsWithBackup);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Backup" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Back Up Now" })[0]!);

    await waitFor(() => {
      expect(runMemoryBackupNowMock).toHaveBeenCalledTimes(1);
    });
  });

  it("offers a simple backup source choice when the GitHub repo already has a backup", async () => {
    const user = userEvent.setup();
    const settingsWithBackupConflict: GatewaySettings = {
      ...settingsWithBackup,
      memory_backup: {
        ...settingsWithBackup.memory_backup!,
        last_result: "failed",
        last_error:
          "This backup repository already contains a BrainDrive backup. Choose whether to restore it or use this BrainDrive as the backup source.",
      },
    };
    getSettingsMock.mockResolvedValueOnce(settingsWithBackupConflict);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Backup" })[0]!);
    expect(screen.getAllByText("Choose what to do").length).toBeGreaterThan(0);
    expect(screen.queryByText("Backup needs attention")).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Back Up This BrainDrive" })[0]!);

    await waitFor(() => {
      expect(runMemoryBackupNowMock).toHaveBeenCalledWith({ on_remote_conflict: "replace_remote" });
    });
  });

  it("runs restore from memory backup tab after confirmation", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(settingsWithBackup);
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Backup" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Restore from Backup" })[0]!);

    await waitFor(() => {
      expect(restoreMemoryBackupMock).toHaveBeenCalledTimes(1);
    });
    expect(resetGatewayChatRuntimeMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    confirmMock.mockRestore();
  });
});
