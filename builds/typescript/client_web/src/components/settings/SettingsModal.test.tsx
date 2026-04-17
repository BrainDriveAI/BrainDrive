import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  GatewayMemoryBackupRestoreRequest,
  GatewayMemoryBackupSettingsUpdateRequest,
  GatewayModelCatalog,
  GatewaySettings,
  GatewayTwilioSmsSettingsUpdateRequest,
  GatewayTwilioSmsTestSendRequest,
  GatewayTwilioSmsTestSendResponse,
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
const updateTwilioSmsSettingsMock = vi.fn<
  (payload: GatewayTwilioSmsSettingsUpdateRequest) => Promise<GatewaySettings>
>();
const sendTwilioTestSmsMock = vi.fn<
  (payload: GatewayTwilioSmsTestSendRequest) => Promise<GatewayTwilioSmsTestSendResponse>
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
  updateTwilioSmsSettings: (payload: GatewayTwilioSmsSettingsUpdateRequest) =>
    updateTwilioSmsSettingsMock(payload),
  sendTwilioTestSms: (payload: GatewayTwilioSmsTestSendRequest) => sendTwilioTestSmsMock(payload),
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
  twilio_sms: {
    enabled: true,
    account_sid: "AC1234567890abcdef1234567890abcd",
    from_number: "+14155552671",
    public_base_url: "https://example.com",
    auto_reply: true,
    strict_owner_mode: false,
    owner_phone_number: null,
    rate_limit_period: 60,
    rate_limit_cap_round_trips: 5,
    rate_limit_current_count: 1,
    token_configured: true,
    test_recipient: "+14155553333",
    last_inbound_at: "2026-04-07T12:00:00.000Z",
    last_outbound_at: "2026-04-07T12:05:00.000Z",
    last_result: "success",
    last_error: null,
    webhook_url: "https://example.com/twilio/sms/webhook",
  },
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
    updateTwilioSmsSettingsMock.mockReset();
    sendTwilioTestSmsMock.mockReset();

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
    updateTwilioSmsSettingsMock.mockResolvedValue(baseSettings);
    sendTwilioTestSmsMock.mockResolvedValue({
      result: "success",
      recipient: "+14155553333",
      message: "hello",
      sent_at: "2026-04-07T12:10:03.000Z",
      provider: {
        message_sid: "SM11111111111111111111111111111111",
        status: "queued",
      },
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

  it("downloads export from the migrate tab", async () => {
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

  it("imports a migration archive from the migrate tab", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "Migrate" })[0]!);

    const importInput = screen.getAllByLabelText("Choose file")[0] as HTMLInputElement;
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

    const importInput = screen.getAllByLabelText("Choose file")[0] as HTMLInputElement;
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

    await user.click(screen.getAllByRole("button", { name: "AI Model" })[0]!);
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

  it("renders SMS (Twilio) tab only for dev install mode", async () => {
    const { rerender } = render(<SettingsModal mode="local" installMode="dev" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getAllByRole("button", { name: "SMS (Twilio)" }).length).toBeGreaterThan(0);

    rerender(<SettingsModal mode="local" installMode="local" onClose={() => {}} />);
    expect(screen.queryAllByRole("button", { name: "SMS (Twilio)" }).length).toBe(0);
  });

  it("keeps auth token field write-only after loading twilio settings", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" installMode="dev" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "SMS (Twilio)" })[0]!);
    const authTokenInput = screen.getAllByLabelText("Auth Token")[0] as HTMLInputElement;
    expect(authTokenInput.value).toBe("");
    expect(authTokenInput.placeholder).toContain("Leave blank");
  });

  it("renders Twilio webhook/runtime status values and copies webhook URL", async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn<(text: string) => Promise<void>>(async () => {});
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });

    render(<SettingsModal mode="local" installMode="dev" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "SMS (Twilio)" })[0]!);

    expect(screen.getAllByDisplayValue("https://example.com/twilio/sms/webhook").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1/5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Success").length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "Copy Webhook URL" })[0]!);
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("https://example.com/twilio/sms/webhook");
    });
    expect(screen.getAllByText("Webhook URL copied.").length).toBeGreaterThan(0);
  });

  it("saves twilio sms settings", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" installMode="dev" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "SMS (Twilio)" })[0]!);
    await user.clear(screen.getAllByLabelText("Account SID")[0]!);
    await user.type(screen.getAllByLabelText("Account SID")[0]!, "AC99999999999999999999999999999999");
    await user.clear(screen.getAllByLabelText("From Number")[0]!);
    await user.type(screen.getAllByLabelText("From Number")[0]!, "+14155550000");
    await user.clear(screen.getAllByLabelText("Public Base URL")[0]!);
    await user.type(screen.getAllByLabelText("Public Base URL")[0]!, "https://new.example.com");
    await user.type(screen.getAllByLabelText("Auth Token")[0]!, "twilio_secret_v2");
    await user.click(screen.getAllByRole("button", { name: "Save SMS Settings" })[0]!);

    await waitFor(() => {
      expect(updateTwilioSmsSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          account_sid: "AC99999999999999999999999999999999",
          from_number: "+14155550000",
          public_base_url: "https://new.example.com",
          auth_token: "twilio_secret_v2",
        })
      );
    });
  });

  it("sends twilio test sms", async () => {
    const user = userEvent.setup();
    render(<SettingsModal mode="local" installMode="dev" onClose={() => {}} />);

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getAllByRole("button", { name: "SMS (Twilio)" })[0]!);
    await user.clear(screen.getAllByLabelText("Test Recipient")[0]!);
    await user.type(screen.getAllByLabelText("Test Recipient")[0]!, "+14155558888");
    await user.clear(screen.getAllByLabelText("Test Message")[0]!);
    await user.type(screen.getAllByLabelText("Test Message")[0]!, "hello from test");
    await user.click(screen.getAllByRole("button", { name: "Send Test SMS" })[0]!);

    await waitFor(() => {
      expect(sendTwilioTestSmsMock).toHaveBeenCalledWith({
        recipient: "+14155558888",
        message: "hello from test",
      });
    });
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

  it("runs manual save from backup tab", async () => {
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

  it("runs restore from backup tab after confirmation", async () => {
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
