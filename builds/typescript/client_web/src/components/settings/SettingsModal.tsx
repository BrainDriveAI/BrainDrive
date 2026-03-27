import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CreditCard,
  Download,
  Key,
  Cpu,
  User,
  UserCog,
  X,
  Check,
  AlertCircle,
  Trash2
} from "lucide-react";

import { getSession } from "@/api/auth-adapter";
import {
  deleteProviderModel,
  downloadLibraryExport,
  getProviderModels,
  getSettings as getGatewaySettings,
  pullProviderModel,
  updateProviderCredential as updateGatewayProviderCredential,
  updateSettings as updateGatewaySettings,
} from "@/api/gateway-adapter";
import { resetGatewayChatRuntime } from "@/api/useGatewayChat";
import type {
  GatewayCredentialUpdateRequest,
  GatewayModelCatalog,
  GatewayModelCatalogEntry,
  GatewaySettings,
} from "@/api/types";
import type { UserProfile } from "@/types/ui";

type SettingsPatch = Partial<Pick<GatewaySettings, "default_model" | "active_provider_profile">> & {
  provider_base_url?: { provider_profile: string; base_url: string };
};

type SettingsModalProps = {
  mode?: "local" | "managed";
  onClose: () => void;
};

type SettingsTab = "provider" | "model" | "profile" | "account" | "billing" | "export";

type TabDef = { id: SettingsTab; label: string; icon: typeof Key; managedOnly?: boolean };

// Account and Billing only show for managed hosting (D35).
// Provider and Model sections adapt their content based on mode.
const allTabs: TabDef[] = [
  { id: "provider", label: "Model Provider", icon: Key },
  { id: "model", label: "Default Model", icon: Cpu },
  { id: "profile", label: "Owner Profile", icon: User },
  { id: "account", label: "Account", icon: UserCog, managedOnly: true },
  { id: "billing", label: "Billing", icon: CreditCard, managedOnly: true },
  { id: "export", label: "Export Library", icon: Download }
];

export default function SettingsModal({ mode = "local", onClose }: SettingsModalProps) {
  const tabs = allTabs.filter((tab) => !tab.managedOnly || mode === "managed");
  const [activeTab, setActiveTab] = useState<SettingsTab>("provider");
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(mode === "local");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [modelCatalog, setModelCatalog] = useState<GatewayModelCatalog | null>(null);
  const [isLoadingModelCatalog, setIsLoadingModelCatalog] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  function handleOverlayClick(event: React.MouseEvent) {
    if (event.target === overlayRef.current) {
      onClose();
    }
  }

  useEffect(() => {
    if (mode !== "local") {
      setIsLoadingSettings(false);
      setSettingsError(null);
      setModelCatalog(null);
      setModelCatalogError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingSettings(true);
    setSettingsError(null);

    void getGatewaySettings()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setSettings(payload);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setSettingsError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "local" || isLoadingSettings || settingsError || !settings) {
      setIsLoadingModelCatalog(false);
      setModelCatalogError(null);
      return;
    }

    const providerProfile =
      settings.active_provider_profile ??
      settings.default_provider_profile ??
      settings.provider_profiles[0]?.id ??
      null;

    if (!providerProfile) {
      setModelCatalog(null);
      setModelCatalogError("No provider profile configured.");
      return;
    }

    let cancelled = false;
    setIsLoadingModelCatalog(true);
    setModelCatalogError(null);

    void getProviderModels(providerProfile)
      .then((payload) => {
        if (!cancelled) {
          setModelCatalog(payload);
          setModelCatalogError(payload.warning ?? null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setModelCatalog(null);
          setModelCatalogError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingModelCatalog(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    isLoadingSettings,
    settingsError,
    settings,
    catalogRefreshKey,
  ]);

  async function saveSettings(
    patch: SettingsPatch
  ): Promise<GatewaySettings> {
    const updated = await updateGatewaySettings(patch);
    setSettings(updated);
    setSettingsError(null);
    return updated;
  }

  async function saveCredential(patch: GatewayCredentialUpdateRequest): Promise<void> {
    const updated = await updateGatewayProviderCredential(patch);
    setSettings(updated.settings);
    setSettingsError(null);
    resetGatewayChatRuntime();
  }

  async function handleDownloadExport(): Promise<void> {
    setIsExporting(true);
    setExportError(null);
    try {
      const exported = await downloadLibraryExport();
      const objectUrl = URL.createObjectURL(exported.blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = exported.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setExportError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    >
      {/* Desktop modal */}
      <div className="hidden h-[80vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-bd-border bg-bd-bg-secondary shadow-2xl md:flex">
        <div className="flex items-center justify-between border-b border-bd-border px-6 py-4">
          <h2 className="font-heading text-lg font-semibold text-bd-text-heading">
            Settings
          </h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-bd-text-muted transition-colors duration-200 hover:text-bd-text-secondary"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-bd-border p-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-all duration-200",
                    isActive
                      ? "bg-bd-bg-tertiary text-bd-text-primary"
                      : "text-bd-text-muted hover:bg-bd-bg-hover hover:text-bd-text-secondary"
                  ].join(" ")}
                >
                  <Icon size={16} strokeWidth={1.5} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-6">
            <TabContent
              tab={activeTab}
              mode={mode}
              settings={settings}
              isLoadingSettings={isLoadingSettings}
              settingsError={settingsError}
              modelCatalog={modelCatalog}
              isLoadingModelCatalog={isLoadingModelCatalog}
              modelCatalogError={modelCatalogError}
              onSaveSettings={saveSettings}
              onSaveCredential={saveCredential}
              onDownloadExport={handleDownloadExport}
              isExporting={isExporting}
              exportError={exportError}
              onRefreshCatalog={() => setCatalogRefreshKey((k) => k + 1)}
            />
          </div>
        </div>
      </div>

      {/* Mobile full-screen */}
      <div className="flex h-dvh w-full flex-col bg-bd-bg-secondary md:hidden">
        <div className="flex items-center justify-between border-b border-bd-border px-4 py-4">
          <h2 className="font-heading text-lg font-semibold text-bd-text-heading">
            Settings
          </h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-bd-text-muted transition-colors duration-200 hover:text-bd-text-secondary"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-bd-border px-4 py-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={[
                  "shrink-0 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                  isActive
                    ? "bg-bd-bg-tertiary text-bd-text-primary"
                    : "text-bd-text-muted"
                ].join(" ")}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <TabContent
            tab={activeTab}
            mode={mode}
            settings={settings}
            isLoadingSettings={isLoadingSettings}
            settingsError={settingsError}
            modelCatalog={modelCatalog}
            isLoadingModelCatalog={isLoadingModelCatalog}
            modelCatalogError={modelCatalogError}
            onSaveSettings={saveSettings}
            onRefreshCatalog={() => setCatalogRefreshKey((k) => k + 1)}
            onSaveCredential={saveCredential}
            onDownloadExport={handleDownloadExport}
            isExporting={isExporting}
            exportError={exportError}
          />
        </div>
      </div>
    </div>
  );
}

const DEFAULT_USER: UserProfile = {
  name: "Local Owner",
  initials: "LO",
  email: "owner@local.braindrive"
};

function useSettingsUser(): UserProfile {
  const [user, setUser] = useState<UserProfile>(DEFAULT_USER);

  useEffect(() => {
    let cancelled = false;

    void getSession()
      .then((session) => {
        if (cancelled) {
          return;
        }

        const nextUser = {
          name: session.user.name,
          initials: session.user.initials,
          email: session.user.email
        };

        if (
          nextUser.name !== DEFAULT_USER.name ||
          nextUser.initials !== DEFAULT_USER.initials ||
          nextUser.email !== DEFAULT_USER.email
        ) {
          setUser(nextUser);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(DEFAULT_USER);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}

type SettingsDataProps = {
  settings: GatewaySettings | null;
  isLoadingSettings: boolean;
  settingsError: string | null;
  onSaveSettings: (
    patch: SettingsPatch
  ) => Promise<GatewaySettings>;
  onSaveCredential: (patch: GatewayCredentialUpdateRequest) => Promise<void>;
};

function TabContent({
  tab,
  mode,
  settings,
  isLoadingSettings,
  settingsError,
  modelCatalog,
  isLoadingModelCatalog,
  modelCatalogError,
  onSaveSettings,
  onSaveCredential,
  onDownloadExport,
  isExporting,
  exportError,
  onRefreshCatalog,
}: {
  tab: SettingsTab;
  mode: "local" | "managed";
  settings: GatewaySettings | null;
  isLoadingSettings: boolean;
  settingsError: string | null;
  modelCatalog: GatewayModelCatalog | null;
  isLoadingModelCatalog: boolean;
  modelCatalogError: string | null;
  onSaveSettings: (
    patch: SettingsPatch
  ) => Promise<GatewaySettings>;
  onSaveCredential: (patch: GatewayCredentialUpdateRequest) => Promise<void>;
  onDownloadExport: () => Promise<void>;
  isExporting: boolean;
  exportError: string | null;
  onRefreshCatalog: () => void;
}) {
  switch (tab) {
    case "provider":
      return (
        <ProviderSection
          mode={mode}
          settings={settings}
          isLoadingSettings={isLoadingSettings}
          settingsError={settingsError}
          onSaveSettings={onSaveSettings}
          onSaveCredential={onSaveCredential}
        />
      );
    case "model":
      return (
        <ModelSection
          mode={mode}
          settings={settings}
          isLoadingSettings={isLoadingSettings}
          settingsError={settingsError}
          modelCatalog={modelCatalog}
          isLoadingModelCatalog={isLoadingModelCatalog}
          modelCatalogError={modelCatalogError}
          onSaveSettings={onSaveSettings}
          onRefreshCatalog={onRefreshCatalog}
        />
      );
    case "profile":
      return <ProfileSection />;
    case "account":
      return <AccountSection />;
    case "billing":
      return <BillingSection />;
    case "export":
      return (
        <ExportSection
          mode={mode}
          onDownload={onDownloadExport}
          isExporting={isExporting}
          exportError={exportError}
        />
      );
  }
}

function ProviderSection({
  mode,
  settings,
  isLoadingSettings,
  settingsError,
  onSaveSettings,
  onSaveCredential,
}: {
  mode: "local" | "managed";
} & SettingsDataProps) {
  const [selectedProfile, setSelectedProfile] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [providerApiKey, setProviderApiKey] = useState("");
  const [isSavingCredential, setIsSavingCredential] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const activeProfile = settings?.provider_profiles.find((profile) => profile.id === selectedProfile) ??
    settings?.provider_profiles[0] ?? null;
  const canUsePlainCredentialMode = activeProfile?.credential_mode === "plain" ||
    activeProfile?.provider_id?.toLowerCase() === "ollama";

  const [showApiKeyInput, setShowApiKeyInput] = useState(!canUsePlainCredentialMode);

  useEffect(() => {
    if (!settings) {
      return;
    }
    setSelectedProfile(settings.active_provider_profile ?? settings.default_provider_profile ?? "");
    const ollamaProfile = settings.provider_profiles.find(
      (p) => p.provider_id?.toLowerCase() === "ollama"
    );
    if (ollamaProfile) {
      setOllamaUrl(ollamaProfile.base_url ?? "");
    }
  }, [settings]);

  useEffect(() => {
    setShowApiKeyInput(!canUsePlainCredentialMode);
  }, [canUsePlainCredentialMode]);

  if (mode === "managed") {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="font-heading text-base font-semibold text-bd-text-heading">
            AI Model Provider
          </h3>
          <p className="mt-1 text-sm text-bd-text-muted">
            Your AI model access is included with your subscription.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-bd-bg-tertiary px-3 py-2.5">
          <Check size={16} strokeWidth={1.5} className="shrink-0 text-bd-success" />
          <span className="text-sm text-bd-text-secondary">
            Connected — managed by BrainDrive
          </span>
        </div>

        <p className="text-xs text-bd-text-muted">
          Model access is pre-configured and included in your plan. No API
          keys needed. To use your own provider instead, export your library
          and run BrainDrive locally.
        </p>
      </div>
    );
  }

  if (isLoadingSettings) {
    return (
      <div className="space-y-3">
        <h3 className="font-heading text-base font-semibold text-bd-text-heading">AI Model Provider</h3>
        <p className="text-sm text-bd-text-muted">Loading provider settings...</p>
      </div>
    );
  }

  if (settingsError) {
    return (
      <div className="space-y-3">
        <h3 className="font-heading text-base font-semibold text-bd-text-heading">AI Model Provider</h3>
        <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2.5 text-sm text-bd-text-primary">
          {settingsError}
        </div>
      </div>
    );
  }

  if (!settings) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading text-base font-semibold text-bd-text-heading">
          AI Model Provider
        </h3>
        <p className="mt-1 text-sm text-bd-text-muted">
          Connect BrainDrive to your AI model provider.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <div className="space-y-2">
            {settings.provider_profiles.map((profile) => {
              const isSelected = selectedProfile === profile.id;
              const isOllama = profile.provider_id?.toLowerCase() === "ollama";
              const profileCanUsePlain = profile.credential_mode === "plain" || isOllama;
              const showKeyForProfile = isSelected && showApiKeyInput;

              return (
                <div key={profile.id} className="space-y-0">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      setSelectedProfile(profile.id);
                      setCredentialError(null);
                      setProviderApiKey("");
                      setIsSaving(true);
                      setSaveError(null);
                      void onSaveSettings({ active_provider_profile: profile.id })
                        .then(() => {})
                        .catch((error) => {
                          setSaveError(error instanceof Error ? error.message : String(error));
                        })
                        .finally(() => {
                          setIsSaving(false);
                        });
                    }}
                    className={[
                      "flex w-full items-center gap-3 border px-4 py-3 text-left transition-all duration-200",
                      isSelected
                        ? "rounded-t-lg border-bd-amber border-b-0 bg-bd-bg-tertiary"
                        : "rounded-lg border-bd-border hover:border-bd-border hover:bg-bd-bg-hover"
                    ].join(" ")}
                  >
                    <div className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                      isSelected ? "border-bd-amber" : "border-bd-border"
                    ].join(" ")}>
                      {isSelected && <div className="h-2 w-2 rounded-full bg-bd-amber" />}
                    </div>
                    <div>
                      <div className={[
                        "text-sm font-medium",
                        isSelected ? "text-bd-text-primary" : "text-bd-text-secondary"
                      ].join(" ")}>
                        {isOllama ? "Ollama" : "OpenRouter"}
                      </div>
                      <div className="text-xs text-bd-text-muted">
                        {isOllama
                          ? <>Runs on your computer, free — <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="text-bd-text-muted hover:text-bd-text-secondary hover:underline" onClick={(e) => e.stopPropagation()}>ollama.com</a></>
                          : <>Cloud-based, requires API key — <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-bd-text-muted hover:text-bd-text-secondary hover:underline" onClick={(e) => e.stopPropagation()}>openrouter.ai/keys</a></>}
                      </div>
                    </div>
                  </button>

                  {isSelected && (
                    <div className={[
                      "border border-t-0 border-bd-amber bg-bd-bg-tertiary px-4 pb-3 pt-2 rounded-b-lg"
                    ].join(" ")}>
                      {isOllama && (
                        <div className="mb-3 space-y-1.5">
                          <label
                            htmlFor="ollama-server-url"
                            className="block text-sm font-medium text-bd-text-secondary"
                          >
                            Server URL
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              id="ollama-server-url"
                              type="url"
                              autoComplete="off"
                              value={ollamaUrl}
                              onChange={(event) => {
                                setOllamaUrl(event.target.value);
                                setUrlError(null);
                              }}
                              placeholder="http://localhost:11434/v1"
                              className="h-10 flex-1 rounded-lg border border-bd-border bg-bd-bg-secondary px-3 text-sm text-bd-text-primary outline-none focus:border-bd-amber"
                            />
                            <button
                              type="button"
                              disabled={isSavingUrl || ollamaUrl.trim().length === 0}
                              onClick={() => {
                                setIsSavingUrl(true);
                                setUrlError(null);
                                void onSaveSettings({
                                  provider_base_url: {
                                    provider_profile: profile.id,
                                    base_url: ollamaUrl.trim(),
                                  },
                                })
                                  .then(() => {})
                                  .catch((error) => {
                                    setUrlError(error instanceof Error ? error.message : String(error));
                                  })
                                  .finally(() => {
                                    setIsSavingUrl(false);
                                  });
                              }}
                              className="rounded-lg bg-bd-amber px-3 py-2 text-xs font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isSavingUrl ? "Saving..." : "Save"}
                            </button>
                          </div>
                          {urlError && (
                            <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2 text-sm text-bd-text-primary">
                              {urlError}
                            </div>
                          )}
                        </div>
                      )}
                      {!showKeyForProfile ? (
                        <button
                          type="button"
                          onClick={() => setShowApiKeyInput(true)}
                          className="text-xs text-bd-text-muted transition-colors hover:text-bd-text-secondary hover:underline"
                        >
                          {profileCanUsePlain
                            ? `Optional: set API key for remote ${isOllama ? "Ollama" : profile.provider_id}`
                            : profile.credential_mode === "secret_ref" ? "Update API key" : "Set API key"}
                        </button>
                      ) : (
                        <div className="space-y-3">
                          <div>
                            <label
                              htmlFor="provider-api-key"
                              className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
                            >
                              API Key
                            </label>
                            {profile.credential_mode === "secret_ref" && (
                              <div className="mb-2 flex items-center gap-2 text-xs text-bd-text-muted">
                                <Check size={14} strokeWidth={1.5} className="shrink-0 text-bd-success" />
                                API key configured — enter a new key below to replace it
                              </div>
                            )}
                            <input
                              id="provider-api-key"
                              type="password"
                              autoComplete="off"
                              value={providerApiKey}
                              onChange={(event) => {
                                setProviderApiKey(event.target.value);
                                setCredentialError(null);
                              }}
                              placeholder={profile.credential_mode === "secret_ref" ? "Enter new key to replace existing" : `Paste your ${profile.provider_id} API key`}
                              className="h-10 w-full rounded-lg border border-bd-border bg-bd-bg-secondary px-3 text-sm text-bd-text-primary outline-none focus:border-bd-amber"
                            />
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={isSavingCredential || providerApiKey.trim().length === 0}
                              onClick={() => {
                                setIsSavingCredential(true);
                                setCredentialError(null);
                                void onSaveCredential({
                                  provider_profile: profile.id,
                                  mode: "secret_ref",
                                  api_key: providerApiKey.trim(),
                                  secret_ref: profile.credential_ref ?? undefined,
                                  required: true,
                                  set_active_provider: true,
                                })
                                  .then(() => {
                                    setProviderApiKey("");
                                    setShowApiKeyInput(false);
                                  })
                                  .catch((error) => {
                                    setCredentialError(error instanceof Error ? error.message : String(error));
                                  })
                                  .finally(() => {
                                    setIsSavingCredential(false);
                                  });
                              }}
                              className="rounded-lg bg-bd-amber px-3 py-1.5 text-xs font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isSavingCredential ? "Saving key..." : "Save API Key"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowApiKeyInput(false);
                                setProviderApiKey("");
                                setCredentialError(null);
                              }}
                              className="rounded-lg border border-bd-border px-3 py-1.5 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
                            >
                              Cancel
                            </button>
                          </div>

                          {credentialError && (
                            <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2 text-sm text-bd-text-primary">
                              {credentialError}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {saveError && (
          <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2.5 text-sm text-bd-text-primary">
            {saveError}
          </div>
        )}
        <p className="text-xs text-bd-text-muted">
          Your API key is encrypted and stored locally.
        </p>
      </div>
    </div>
  );
}

function ModelSection({
  mode,
  settings,
  isLoadingSettings,
  settingsError,
  modelCatalog,
  isLoadingModelCatalog,
  modelCatalogError,
  onSaveSettings,
  onRefreshCatalog,
}: {
  mode: "local" | "managed";
  settings: GatewaySettings | null;
  isLoadingSettings: boolean;
  settingsError: string | null;
  modelCatalog: GatewayModelCatalog | null;
  isLoadingModelCatalog: boolean;
  modelCatalogError: string | null;
  onSaveSettings: (
    patch: SettingsPatch
  ) => Promise<GatewaySettings>;
  onRefreshCatalog: () => void;
}) {
  const managedModels = [
    { name: "Claude Sonnet 4.6", provider: "Anthropic" },
    { name: "Claude Opus 4.6", provider: "Anthropic" },
    { name: "GPT-4o", provider: "OpenAI" }
  ];

  const [defaultModel, setDefaultModel] = useState("");
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pullModelName, setPullModelName] = useState("");
  const [isPulling, setIsPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullSuccess, setPullSuccess] = useState<string | null>(null);
  const [pullStatus, setPullStatus] = useState("");
  const [pullProgress, setPullProgress] = useState<{ total: number; completed: number } | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const catalogSearchId = useId();

  const activeProfile = settings?.provider_profiles.find(
    (p) => p.id === (settings.active_provider_profile ?? settings.default_provider_profile)
  ) ?? settings?.provider_profiles[0] ?? null;
  const isOllama = activeProfile?.provider_id?.toLowerCase() === "ollama";

  useEffect(() => {
    if (!settings) {
      return;
    }
    setDefaultModel(settings.default_model);
  }, [settings]);

  const configuredModels = useMemo(
    () => toConfiguredCatalogEntries(settings?.available_models ?? []),
    [settings]
  );
  const allCatalogModels = useMemo(
    () => mergeCatalogEntries(modelCatalog?.models ?? [], configuredModels),
    [modelCatalog, configuredModels]
  );
  const filteredCatalogModels = useMemo(() => {
    const normalizedQuery = catalogQuery.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return allCatalogModels;
    }

    return allCatalogModels.filter((model) =>
      [
        model.id,
        model.name ?? "",
        model.provider ?? "",
        ...(model.tags ?? []),
      ].some((field) => field.toLowerCase().includes(normalizedQuery))
    );
  }, [allCatalogModels, catalogQuery]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading text-base font-semibold text-bd-text-heading">
          Default Model
        </h3>
        <p className="mt-1 text-sm text-bd-text-muted">
          {isOllama
            ? "Choose from the models installed on your computer."
            : "Choose the AI model your BrainDrive uses for conversations."}
        </p>
      </div>

      <div className="space-y-3">
        {mode === "local" && isLoadingSettings && (
          <div className="flex items-center gap-2 rounded-lg bg-bd-bg-tertiary px-3 py-2.5">
            <AlertCircle size={16} strokeWidth={1.5} className="shrink-0 text-bd-text-muted" />
            <span className="text-sm text-bd-text-muted">
              Loading model settings...
            </span>
          </div>
        )}
        {mode === "local" && settingsError && (
          <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2.5 text-sm text-bd-text-primary">
            {settingsError}
          </div>
        )}
        {mode === "local" && !isLoadingSettings && !settingsError && settings && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-bd-amber bg-bd-bg-tertiary px-4 py-3">
              <div>
                <div className="text-sm font-medium text-bd-text-primary">{defaultModel || "Not set"}</div>
                <div className="text-xs text-bd-text-muted">Current model</div>
              </div>
              <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-bd-amber">
                <div className="h-2 w-2 rounded-full bg-bd-amber" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsCatalogOpen((open) => !open)}
              className="w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-3 py-2 text-left text-sm text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
            >
              {isCatalogOpen
                ? isOllama ? "Hide installed models" : "Hide model catalog"
                : isOllama ? "Show installed models" : "Browse model catalog"}
            </button>

            {isCatalogOpen && (
              <div className="space-y-2">
                <input
                  id={catalogSearchId}
                  type="text"
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder="Search models..."
                  className="h-10 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-3 text-sm text-bd-text-primary outline-none focus:border-bd-amber"
                />

                <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-bd-border bg-bd-bg-tertiary p-2">
                  {isLoadingModelCatalog ? (
                    <p className="px-3 py-2 text-sm text-bd-text-muted">Loading models...</p>
                  ) : filteredCatalogModels.length === 0 ? (
                <p className="px-3 py-2 text-xs text-bd-text-muted">
                  No models match "{catalogQuery}".
                </p>
              ) : (
                filteredCatalogModels.map((model) => {
                  const isSelected = defaultModel.trim() === model.id;
                  const isDeleting = deletingModel === model.id;
                  const freeTag = model.is_free || (model.tags ?? []).includes("free");
                  return (
                    <div
                      key={model.id}
                      className={[
                        "flex items-center gap-1 rounded-md border transition-colors",
                        isSelected
                          ? "border-bd-amber bg-bd-bg-hover"
                          : "border-transparent hover:border-bd-border hover:bg-bd-bg-hover",
                      ].join(" ")}
                    >
                      <button
                        type="button"
                        disabled={isSaving || isDeleting}
                        onClick={() => {
                          setDefaultModel(model.id);
                          setIsSaving(true);
                          setSaveError(null);
                          void onSaveSettings({ default_model: model.id })
                            .catch((error) => {
                              setSaveError(error instanceof Error ? error.message : String(error));
                            })
                            .finally(() => {
                              setIsSaving(false);
                            });
                        }}
                        className="flex-1 px-3 py-2 text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-bd-text-primary">{model.id}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            {freeTag && (
                              <span className="rounded bg-bd-success/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-bd-success">
                                free
                              </span>
                            )}
                            {(model.tags ?? [])
                              .filter((tag) => tag.toLowerCase() !== "free")
                              .slice(0, 2)
                              .map((tag) => (
                                <span
                                  key={`${model.id}:${tag}`}
                                  className="rounded bg-bd-bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-bd-text-muted"
                                >
                                  {tag}
                                </span>
                              ))}
                          </div>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-bd-text-muted">
                          {model.name && <span>{model.name}</span>}
                          {model.provider && <span>{model.provider}</span>}
                          {typeof model.context_length === "number" && (
                            <span>{model.context_length.toLocaleString()} ctx</span>
                          )}
                        </div>
                      </button>
                      {isOllama && (
                        <button
                          type="button"
                          disabled={isDeleting || isSaving}
                          title={`Remove ${model.id}`}
                          onClick={() => {
                            setDeletingModel(model.id);
                            setDeleteError(null);
                            void deleteProviderModel(model.id, activeProfile?.id)
                              .then(() => {
                                if (defaultModel === model.id) {
                                  setDefaultModel("");
                                }
                                onRefreshCatalog();
                              })
                              .catch((error) => {
                                setDeleteError(error instanceof Error ? error.message : String(error));
                              })
                              .finally(() => {
                                setDeletingModel(null);
                              });
                          }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-bd-text-muted transition-colors hover:bg-bd-danger-bg hover:text-bd-danger disabled:opacity-40"
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

                {deleteError && (
                  <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2 text-sm text-bd-text-primary">
                    {deleteError}
                  </div>
                )}
                {modelCatalogError && (
                  <div className="rounded-lg border border-bd-border bg-bd-bg-tertiary px-3 py-2 text-xs text-bd-text-muted">
                    {modelCatalogError}
                  </div>
                )}

                {isOllama && (
                  <div className="space-y-2 rounded-lg border border-bd-border bg-bd-bg-tertiary p-3">
                    <div className="text-sm font-medium text-bd-text-secondary">
                      Pull a new model
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={pullModelName}
                        onChange={(event) => {
                          setPullModelName(event.target.value);
                          setPullError(null);
                          setPullSuccess(null);
                        }}
                        placeholder="e.g. llama3.2, gemma2, mistral"
                        disabled={isPulling}
                        className="h-10 flex-1 rounded-lg border border-bd-border bg-bd-bg-secondary px-3 text-sm text-bd-text-primary outline-none focus:border-bd-amber disabled:opacity-60"
                      />
                      <button
                        type="button"
                        disabled={isPulling || pullModelName.trim().length === 0}
                        onClick={() => {
                          const modelToPull = pullModelName.trim();
                          setIsPulling(true);
                          setPullError(null);
                          setPullSuccess(null);
                          setPullStatus("Starting download...");
                          setPullProgress(null);
                          void pullProviderModel(modelToPull, activeProfile?.id, (progress) => {
                            setPullStatus(progress.status);
                            if (typeof progress.total === "number" && progress.total > 0) {
                              setPullProgress({ total: progress.total, completed: progress.completed ?? 0 });
                            }
                          })
                            .then(() => {
                              setPullSuccess(`${modelToPull} installed successfully.`);
                              setPullModelName("");
                              setPullProgress(null);
                              setPullStatus("");
                              onRefreshCatalog();
                            })
                            .catch((error) => {
                              setPullError(error instanceof Error ? error.message : String(error));
                              setPullProgress(null);
                              setPullStatus("");
                            })
                            .finally(() => {
                              setIsPulling(false);
                            });
                        }}
                        className="rounded-lg bg-bd-amber px-3 py-2 text-xs font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isPulling ? "Pulling..." : "Pull"}
                      </button>
                    </div>
                    {isPulling && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-bd-text-muted">
                          <span>{pullStatus || "Preparing..."}</span>
                          {pullProgress && pullProgress.total > 0 && (
                            <span>
                              {Math.round((pullProgress.completed / pullProgress.total) * 100)}%
                            </span>
                          )}
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-bd-bg-secondary">
                          <div
                            className="h-full rounded-full bg-bd-amber transition-all duration-300"
                            style={{
                              width: pullProgress && pullProgress.total > 0
                                ? `${Math.round((pullProgress.completed / pullProgress.total) * 100)}%`
                                : "0%",
                            }}
                          />
                        </div>
                      </div>
                    )}
                    {pullError && (
                      <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2 text-sm text-bd-text-primary">
                        {pullError}
                      </div>
                    )}
                    {pullSuccess && (
                      <div className="flex items-center gap-2 text-xs text-bd-success">
                        <Check size={14} strokeWidth={1.5} className="shrink-0" />
                        {pullSuccess}
                      </div>
                    )}
                    <p className="text-xs text-bd-text-muted">
                      Browse available models at{" "}
                      <a
                        href="https://ollama.com/library"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-bd-text-muted hover:text-bd-text-secondary hover:underline"
                      >
                        ollama.com/library
                      </a>
                    </p>
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-bd-text-muted">
              Model changes take effect on your next message.
            </p>

            {saveError && (
              <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2.5 text-sm text-bd-text-primary">
                {saveError}
              </div>
            )}
          </div>
        )}
        {mode === "managed" && (
          <div className="rounded-lg border border-bd-border p-4">
            <div className="mb-3 text-sm font-medium text-bd-text-secondary">
              Available Models
            </div>
            {managedModels.map((model) => (
              <div
                key={model.name}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-bd-text-muted"
              >
                <span>{model.name}</span>
                <span className="text-xs">{model.provider}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function toConfiguredCatalogEntries(models: string[]): GatewayModelCatalogEntry[] {
  return models
    .map((model) => model.trim())
    .filter((model) => model.length > 0)
    .map((model) => ({
      id: model,
      tags: ["configured"],
    }));
}

function mergeCatalogEntries(
  primary: GatewayModelCatalogEntry[],
  fallback: GatewayModelCatalogEntry[]
): GatewayModelCatalogEntry[] {
  const merged = new Map<string, GatewayModelCatalogEntry>();

  for (const model of [...primary, ...fallback]) {
    const key = model.id.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, model);
      continue;
    }

    const tags = Array.from(new Set([...(existing.tags ?? []), ...(model.tags ?? [])]));
    merged.set(key, {
      ...existing,
      ...model,
      tags: tags.length > 0 ? tags : undefined,
    });
  }

  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function ProfileSection() {
  const user = useSettingsUser();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading text-base font-semibold text-bd-text-heading">
          Owner Profile
        </h3>
        <p className="mt-1 text-sm text-bd-text-muted">
          Your profile helps your AI partner understand who you are and what
          matters to you. Edit it through conversation — ask your partner to
          update your profile.
        </p>
      </div>

      <div className="rounded-lg border border-bd-border bg-bd-bg-tertiary p-4">
        <div className="flex items-center gap-3 pb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bd-amber text-lg font-bold text-bd-bg-primary">
            {user.initials}
          </div>
          <div>
            <div className="text-sm font-medium text-bd-text-primary">
              {user.name}
            </div>
            <div className="text-xs text-bd-text-muted">Owner</div>
          </div>
        </div>
        <div className="border-t border-bd-border pt-4">
          <p className="text-sm italic text-bd-text-muted">
            Profile data will be loaded from your library's me/profile.md
          </p>
        </div>
      </div>

      <p className="text-xs text-bd-text-muted">
        To update your profile, start a conversation: "Update my profile
        to reflect that I'm focused on launching BrainDrive."
      </p>
    </div>
  );
}

function AccountSection() {
  const user = useSettingsUser();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading text-base font-semibold text-bd-text-heading">
          Account
        </h3>
        <p className="mt-1 text-sm text-bd-text-muted">
          Manage your BrainDrive account details.
        </p>
      </div>

      <div className="rounded-lg border border-bd-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-bd-text-primary">Email</div>
            <div className="text-sm text-bd-text-muted">{user.email}</div>
          </div>
          <button
            type="button"
            className="rounded-lg bg-bd-bg-tertiary px-3 py-1.5 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
          >
            Change
          </button>
        </div>

        <div className="h-px bg-bd-border" />

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-bd-text-primary">Password</div>
            <div className="text-sm text-bd-text-muted">Last changed: Never</div>
          </div>
          <button
            type="button"
            className="rounded-lg bg-bd-bg-tertiary px-3 py-1.5 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
          >
            Change
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-bd-danger-border p-4">
        <div className="text-sm font-medium text-bd-danger">Danger Zone</div>
        <p className="mt-1 text-sm text-bd-text-muted">
          Permanently delete your account and all associated data. This cannot
          be undone. Export your library first.
        </p>
        <button
          type="button"
          className="mt-3 rounded-lg border border-bd-danger-border px-3 py-1.5 text-xs text-bd-danger transition-colors hover:bg-bd-danger-bg"
        >
          Delete Account
        </button>
      </div>
    </div>
  );
}

function BillingSection() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading text-base font-semibold text-bd-text-heading">
          Billing
        </h3>
        <p className="mt-1 text-sm text-bd-text-muted">
          Manage your subscription and payment method.
        </p>
      </div>

      <div className="rounded-lg border border-bd-border p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-bd-text-primary">
              Current Plan
            </div>
            <div className="mt-1 text-sm text-bd-text-muted">
              BrainDrive Managed Hosting
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-bd-text-heading">
              $20
            </div>
            <div className="text-xs text-bd-text-muted">/month</div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-bd-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-bd-text-primary">
              Payment Method
            </div>
            <div className="text-sm text-bd-text-muted">
              No payment method on file
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg bg-bd-bg-tertiary px-3 py-1.5 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
          >
            Add
          </button>
        </div>

        <div className="h-px bg-bd-border" />

        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-bd-text-primary">
              Next Invoice
            </div>
            <div className="text-sm text-bd-text-muted">—</div>
          </div>
        </div>
      </div>

      <p className="text-xs text-bd-text-muted">
        Cancel anytime. Your library is always exportable — you own your data
        regardless of subscription status.
      </p>
    </div>
  );
}

function ExportSection({
  mode,
  onDownload,
  isExporting,
  exportError,
}: {
  mode: "local" | "managed";
  onDownload: () => Promise<void>;
  isExporting: boolean;
  exportError: string | null;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading text-base font-semibold text-bd-text-heading">
          Export Library
        </h3>
        <p className="mt-1 text-sm text-bd-text-muted">
          {mode === "managed"
            ? "Download a complete copy of your library. Take it with you — run BrainDrive locally, switch providers, or just keep a backup. No lock-in, ever."
            : "Download a complete copy of your library — every file, conversation, and configuration, in its native format. Your data is yours — always."}
        </p>
      </div>

      <div className="rounded-lg border border-bd-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bd-bg-hover">
            <Download size={20} strokeWidth={1.5} className="text-bd-text-secondary" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-bd-text-primary">
              Full Library Export
            </div>
            <div className="text-xs text-bd-text-muted">
              All files, conversations, and configuration
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void onDownload();
          }}
          disabled={isExporting}
          className="mt-4 w-full rounded-xl bg-bd-amber px-4 py-2.5 text-sm font-medium text-bd-bg-primary transition-colors duration-200 hover:bg-bd-amber-hover"
        >
          {isExporting ? "Preparing Download..." : "Download Library (.tar.gz)"}
        </button>
        {exportError && (
          <div className="mt-3 rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2.5 text-sm text-bd-text-primary">
            {exportError}
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-bd-bg-tertiary px-3 py-2.5">
        <Check size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-bd-success" />
        <span className="text-sm text-bd-text-muted">
          Most of your library is plain markdown — readable with any text
          editor. The export includes everything needed to restore into a new
          BrainDrive instance.
        </span>
      </div>

      {mode === "managed" && (
        <div className="flex items-start gap-2 rounded-lg bg-bd-bg-tertiary px-3 py-2.5">
          <Check size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-bd-success" />
          <span className="text-sm text-bd-text-muted">
            Your export works with any AI system — BrainDrive, ChatGPT,
            Claude, or anything else that reads files. No conversion needed.
          </span>
        </div>
      )}
    </div>
  );
}
