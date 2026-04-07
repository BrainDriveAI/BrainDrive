import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  GatewayMemoryBackupRestoreRequest,
  GatewayMemoryBackupSettingsUpdateRequest,
  GatewayModelCatalog,
  GatewaySettings
} from "@/api/types";

import SettingsModal from "./SettingsModal";

const getSettingsMock = vi.fn<() => Promise<GatewaySettings>>();
const updateSettingsMock = vi.fn<
  (patch: Partial<Pick<GatewaySettings, "default_model" | "active_provider_profile">>) => Promise<GatewaySettings>
>();
const getProviderModelsMock = vi.fn<
  (providerProfile?: string) => Promise<GatewayModelCatalog>
>();
const downloadLibraryExportMock = vi.fn<
  () => Promise<{ fileName: string; blob: Blob }>
>();
const importLibraryArchiveMock = vi.fn();
const updateProviderCredentialMock = vi.fn<
  () => Promise<{ settings: GatewaySettings }>
>();
const updateMemoryBackupSettingsMock = vi.fn<
  (payload: GatewayMemoryBackupSettingsUpdateRequest) => Promise<GatewaySettings>
>();
const runMemoryBackupNowMock = vi.fn<
  () => Promise<{ result: { result: "success" | "failed" | "noop"; message?: string }; settings: GatewaySettings }>
>();
const restoreMemoryBackupMock = vi.fn<
  (payload?: GatewayMemoryBackupRestoreRequest) => Promise<{ result: { commit: string }; settings: GatewaySettings }>
>();

vi.mock("@/api/gateway-adapter", () => ({
  getSettings: () => getSettingsMock(),
  updateSettings: (
    patch: Partial<Pick<GatewaySettings, "default_model" | "active_provider_profile">>
  ) => updateSettingsMock(patch),
  updateProviderCredential: () => updateProviderCredentialMock(),
  updateMemoryBackupSettings: (payload: GatewayMemoryBackupSettingsUpdateRequest) =>
    updateMemoryBackupSettingsMock(payload),
  runMemoryBackupNow: () => runMemoryBackupNowMock(),
  restoreMemoryBackup: (payload?: GatewayMemoryBackupRestoreRequest) => restoreMemoryBackupMock(payload),
  getProviderModels: (providerProfile?: string) => getProviderModelsMock(providerProfile),
  downloadLibraryExport: () => downloadLibraryExportMock(),
  importLibraryArchive: (file: Blob) => importLibraryArchiveMock(file),
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
      base_url: "http://127.0.0.1:11434/v1",
      model: "llama3.1",
      credential_mode: "plain",
      credential_ref: null,
    },
  ],
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

describe("SettingsModal", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    getProviderModelsMock.mockReset();
    downloadLibraryExportMock.mockReset();
    importLibraryArchiveMock.mockReset();
    updateProviderCredentialMock.mockReset();
    updateMemoryBackupSettingsMock.mockReset();
    runMemoryBackupNowMock.mockReset();
    restoreMemoryBackupMock.mockReset();
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
    getProviderModelsMock.mockResolvedValue(providerCatalog);
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    await user.click(screen.getAllByRole("button", { name: "Migrate Library" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Download Library (.tar.gz)" })[0]!);

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

    await user.click(screen.getAllByRole("button", { name: "Migrate Library" })[0]!);

    const importInput = screen.getByLabelText("Migration Archive (.tar.gz)") as HTMLInputElement;
    const file = new File(["archive"], "memory-migration.tar.gz", { type: "application/gzip" });
    await user.upload(importInput, file);
    await user.click(screen.getAllByRole("button", { name: "Import Library (.tar.gz)" })[0]!);

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

    await user.click(screen.getAllByRole("button", { name: "Migrate Library" })[0]!);

    const importButton = screen.getAllByRole("button", { name: "Import Library (.tar.gz)" })[0] as HTMLButtonElement;
    expect(importButton).toBeDisabled();
    await user.click(importButton);
    expect(importLibraryArchiveMock).not.toHaveBeenCalled();

    const importInput = screen.getByLabelText("Migration Archive (.tar.gz)") as HTMLInputElement;
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

    await user.click(screen.getAllByRole("button", { name: "Default Model" })[0]!);
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

  it("renders memory backup tab below migrate library in local mode", async () => {
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    const tabLabels = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.trim() ?? "")
      .filter(Boolean);

    const migrateIndex = tabLabels.indexOf("Migrate Library");
    const backupIndex = tabLabels.indexOf("Memory Backup");
    expect(migrateIndex).toBeGreaterThanOrEqual(0);
    expect(backupIndex).toBeGreaterThan(migrateIndex);
  });

  it("saves memory backup settings", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce(baseSettings);
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Memory Backup" })[0]!);
    await user.clear(screen.getAllByLabelText("Repository URL")[0]!);
    await user.type(
      screen.getAllByLabelText("Repository URL")[0]!,
      "https://github.com/BrainDriveAI/braindrive-memory.git"
    );
    await user.type(screen.getAllByLabelText("Git Token (PAT/Classic)")[0]!, "ghp_test");
    await user.selectOptions(screen.getAllByLabelText("Frequency")[0]!, "daily");
    await user.click(screen.getAllByRole("button", { name: "Save Backup Settings" })[0]!);

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

    await user.click(screen.getAllByRole("button", { name: "Memory Backup" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Save Now" })[0]!);

    await waitFor(() => {
      expect(runMemoryBackupNowMock).toHaveBeenCalledTimes(1);
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

    await user.click(screen.getAllByRole("button", { name: "Memory Backup" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Restore from Backup Repo" })[0]!);

    await waitFor(() => {
      expect(restoreMemoryBackupMock).toHaveBeenCalledTimes(1);
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    confirmMock.mockRestore();
  });
});
