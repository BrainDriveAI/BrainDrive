import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, KeyRound, LoaderCircle, Server } from "lucide-react";

import type {
  GatewayCredentialUpdateRequest,
  GatewayOnboardingStatus,
} from "@/api/types";

type ProviderCredentialsOnboardingProps = {
  status: GatewayOnboardingStatus | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  onRetry: () => void;
  onSubmit: (payload: GatewayCredentialUpdateRequest) => Promise<void>;
};

export default function ProviderCredentialsOnboarding({
  status,
  isLoading,
  isSaving,
  error,
  onRetry,
  onSubmit,
}: ProviderCredentialsOnboardingProps) {
  const [selectedProfile, setSelectedProfile] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!status || status.providers.length === 0) {
      return;
    }

    const preferred =
      status.active_provider_profile ??
      status.default_provider_profile ??
      status.providers[0]?.profile_id ??
      "";

    setSelectedProfile(preferred);
  }, [status]);

  const selectedProvider = useMemo(() => {
    if (!status) {
      return null;
    }

    return status.providers.find((provider) => provider.profile_id === selectedProfile) ?? status.providers[0] ?? null;
  }, [selectedProfile, status]);

  if (isLoading && !status) {
    return (
      <FullScreenShell>
        <div className="flex items-center gap-2 text-bd-text-secondary">
          <LoaderCircle className="animate-spin" size={16} />
          <span className="text-sm">Preparing onboarding...</span>
        </div>
      </FullScreenShell>
    );
  }

  if (!status) {
    return (
      <FullScreenShell>
        <div className="max-w-lg rounded-xl border border-bd-danger-border bg-bd-danger-bg p-4 text-sm text-bd-text-primary">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle size={16} />
            <span>Unable to load onboarding status</span>
          </div>
          <p className="mt-2 text-bd-text-secondary">{error ?? "Please retry."}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg bg-bd-amber px-3 py-1.5 text-xs font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover"
          >
            Retry
          </button>
        </div>
      </FullScreenShell>
    );
  }

  if (status.providers.length === 0) {
    return (
      <FullScreenShell>
        <div className="max-w-lg rounded-xl border border-bd-danger-border bg-bd-danger-bg p-4 text-sm text-bd-text-primary">
          <p>No provider profiles are configured. Add a provider profile to continue.</p>
        </div>
      </FullScreenShell>
    );
  }

  const requiresSecret = Boolean(selectedProvider?.requires_secret);

  return (
    <FullScreenShell>
      <div className="w-full max-w-xl rounded-2xl border border-bd-border bg-bd-bg-secondary p-6 shadow-2xl">
        <div className="mb-6 space-y-2">
          <h2 className="font-heading text-lg font-semibold text-bd-text-heading">Finish Setup</h2>
          <p className="text-sm text-bd-text-muted">
            Add your provider credentials so BrainDrive can send model requests.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="onboarding-provider-profile"
              className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
            >
              Provider Profile
            </label>
            <select
              id="onboarding-provider-profile"
              value={selectedProfile}
              onChange={(event) => {
                setSelectedProfile(event.target.value);
                setFormError(null);
              }}
              className="h-10 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary px-3 text-sm text-bd-text-primary outline-none focus:border-bd-amber"
            >
              {status.providers.map((provider) => (
                <option key={provider.profile_id} value={provider.profile_id}>
                  {provider.profile_id}
                </option>
              ))}
            </select>
          </div>

          {selectedProvider && (
            <div className="rounded-lg border border-bd-border bg-bd-bg-tertiary p-3 text-xs text-bd-text-muted">
              <div className="mb-1 font-medium text-bd-text-secondary">{selectedProvider.provider_id}</div>
              <div>Credential mode: {selectedProvider.credential_mode}</div>
              {selectedProvider.credential_ref && <div>Secret ref: {selectedProvider.credential_ref}</div>}
            </div>
          )}

          {requiresSecret ? (
            <div>
              <label
                htmlFor="onboarding-api-key"
                className="mb-1.5 block text-sm font-medium text-bd-text-secondary"
              >
                API Key
              </label>
              <div className="relative">
                <KeyRound
                  size={14}
                  strokeWidth={1.7}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bd-text-muted"
                />
                <input
                  id="onboarding-api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setFormError(null);
                  }}
                  placeholder="Paste your provider API key"
                  className="h-10 w-full rounded-lg border border-bd-border bg-bd-bg-tertiary pl-9 pr-3 text-sm text-bd-text-primary outline-none focus:border-bd-amber"
                />
              </div>
              <p className="mt-1 text-xs text-bd-text-muted">
                Key values are encrypted in the server-side vault. The UI does not persist raw key values.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-bd-border bg-bd-bg-tertiary p-3 text-sm text-bd-text-secondary">
              <div className="flex items-center gap-2">
                <Server size={14} />
                <span>This provider does not require an API key in this setup.</span>
              </div>
            </div>
          )}

          {(formError || error) && (
            <div className="rounded-lg border border-bd-danger-border bg-bd-danger-bg px-3 py-2 text-sm text-bd-text-primary">
              {formError ?? error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-bd-border px-3 py-1.5 text-xs text-bd-text-secondary transition-colors hover:bg-bd-bg-hover"
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={isSaving || !selectedProvider}
              onClick={() => {
                if (!selectedProvider) {
                  return;
                }

                if (requiresSecret && apiKey.trim().length === 0) {
                  setFormError("API key is required for this provider profile.");
                  return;
                }

                const payload: GatewayCredentialUpdateRequest = requiresSecret
                  ? {
                      provider_profile: selectedProvider.profile_id,
                      mode: "secret_ref",
                      api_key: apiKey.trim(),
                      secret_ref: selectedProvider.credential_ref ?? undefined,
                      required: true,
                      set_active_provider: true,
                    }
                  : {
                      provider_profile: selectedProvider.profile_id,
                      mode: "plain",
                      required: false,
                      set_active_provider: true,
                    };

                void onSubmit(payload).then(() => {
                  setApiKey("");
                  setFormError(null);
                }).catch((submitError) => {
                  setFormError(submitError instanceof Error ? submitError.message : String(submitError));
                });
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-bd-amber px-3 py-1.5 text-xs font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? <LoaderCircle className="animate-spin" size={12} /> : null}
              {requiresSecret ? "Save and Continue" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </FullScreenShell>
  );
}

function FullScreenShell({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 px-4">
      {children}
    </div>
  );
}

