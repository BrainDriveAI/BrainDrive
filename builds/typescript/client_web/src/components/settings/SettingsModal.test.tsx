import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  GatewayMemoryBackupRestoreRequest,
  GatewayMemoryBackupRunRequest,
  GatewayMemoryBackupSettingsUpdateRequest,
  GatewayModelCatalog,
  GatewaySettings
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
const getRootAgentMock = vi.fn<
  () => Promise<{ managedContent: string; overlayContent: string | null }>
>();
const updateRootAgentOverlayMock = vi.fn<(content: string) => Promise<void>>();

vi.mock("@/api/gateway-adapter", () => ({
  getSettings: () => getSettingsMock(),
  updateSettings: (
    patch: Partial<Pick<GatewaySettings, "default_model" | "active_provider_profile">>
  ) => updateSettingsMock(patch),
  getCreditsStatus: () => getCreditsStatusMock(),
  createCreditsCheckout: (payload: { amount: number; email: string }) => createCreditsCheckoutMock(payload),
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

vi.mock("@/api/desktop-browser-access", () => ({
  getBrowserAccessStatus: () => getBrowserAccessStatusMock(),
  updateBrowserAccessSettings: (settings: unknown) => updateBrowserAccessSettingsMock(settings),
  restartBrowserAccess: () => restartBrowserAccessMock(),
  applyBrowserAccessFirewallRule: (enabled: boolean) => applyBrowserAccessFirewallRuleMock(enabled),
}));

const baseSettings: GatewaySettings = {
  default_model: "openai/gpt-4o-mini",
  approval_mode: "ask-on-write",
  active_provider_profile: "openrouter",
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

describe("SettingsModal", () => {
  beforeEach(() => {
    localStorage.clear();
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    getProviderModelsMock.mockReset();
    getCreditsStatusMock.mockReset();
    createCreditsCheckoutMock.mockReset();
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
    getRootAgentMock.mockReset();
    updateRootAgentOverlayMock.mockReset();
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
    delete window.__TAURI_INTERNALS__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.__TAURI_INTERNALS__;
  });

  it("loads local settings and saves provider profile updates", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Model Providers" })[0]!);
    await user.click(screen.getAllByRole("button", { name: /Ollama/i })[0]!);

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({
        active_provider_profile: "ollama",
      });
    });
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

  it("does not show API-key paste as the default BrainDrive Models purchase step", async () => {
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getAllByText("Add BrainDrive Models Credits").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/No copy\/paste needed/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("Enter your BrainDrive API key")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Paste your emailed BrainDrive Models key/i)).not.toBeInTheDocument();
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

    await user.type(screen.getAllByPlaceholderText("Email for receipt and key backup")[0]!, "owner@example.com");
    await user.click(screen.getAllByRole("button", { name: "$5" })[0]!);

    await waitFor(() => {
      expect(createCreditsCheckoutMock).toHaveBeenCalledWith({ amount: 5, email: expect.stringContaining("owner@") });
    });
    expect(JSON.stringify(createCreditsCheckoutMock.mock.calls)).not.toContain("sk-");
    expect(openSpy).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay_test", "_blank", "noopener,noreferrer");
    expect((await screen.findAllByText("Activating")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/After Stripe confirms payment/i).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/BrainDrive Models is ready on this computer/i).length).toBeGreaterThan(0);
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

    expect((await screen.findAllByText("Repair needed")).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: /repair with emailed key/i })[0]!);
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
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getAllByText(/Use Migrate to move your BrainDrive and its encrypted keys/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Backups restore your library, but they do not carry API keys/i).length).toBeGreaterThan(0);
  });

  it("keeps direct OpenRouter and Ollama selectable independently of BrainDrive Models credits", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(brainDriveModelsSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Model Providers" })[0]!);
    expect(screen.getAllByText("OpenRouter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ollama").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: /Ollama/i })[0]!);

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith({
        active_provider_profile: "ollama",
      });
    });
    expect(createCreditsCheckoutMock).not.toHaveBeenCalled();
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
    expect(screen.getAllByText("Only browsers on this computer.").length).toBeGreaterThan(0);
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
    expect(confirmMock).toHaveBeenCalledTimes(1);
    confirmMock.mockRestore();
  });
});
