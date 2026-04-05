import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { GatewayModelCatalog, GatewaySettings } from "@/api/types";

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

vi.mock("@/api/gateway-adapter", () => ({
  getSettings: () => getSettingsMock(),
  updateSettings: (
    patch: Partial<Pick<GatewaySettings, "default_model" | "active_provider_profile">>
  ) => updateSettingsMock(patch),
  updateProviderCredential: () => updateProviderCredentialMock(),
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

describe("SettingsModal", () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    getProviderModelsMock.mockReset();
    downloadLibraryExportMock.mockReset();
    importLibraryArchiveMock.mockReset();
    updateProviderCredentialMock.mockReset();
    getSettingsMock.mockResolvedValue(baseSettings);
    updateSettingsMock.mockResolvedValue(baseSettings);
    updateProviderCredentialMock.mockResolvedValue({ settings: baseSettings });
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
});
