import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  Power,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import {
  disableTailscaleAccess,
  enableTailscaleAccess,
  getTailscaleAccessStatus,
  retryTailscaleAccess,
  type TailscaleAccessAction,
  type TailscaleAccessState,
  type TailscaleAccessStatus,
  type TailscaleReadinessState,
} from "@/api/desktop-tailscale-access";
import { isHttpUrl, openExternalUrl } from "@/utils/external-url";

const STARTING_POLL_INTERVAL_MS = 2_000;
const STARTING_POLL_LIMIT = 12;

const STATE_LABELS: Record<TailscaleAccessState, string> = {
  off: "Off",
  needsSetup: "Needs setup",
  ready: "Ready to enable",
  starting: "Starting",
  running: "Running",
  conflict: "Conflict",
  needsAttention: "Needs attention",
};

const ACTION_LABELS: Record<TailscaleAccessAction, string> = {
  enable: "Enable Remote Access",
  retry: "Retry",
  disable: "Turn off",
  checkAgain: "Check again",
  completeSetup: "Complete Tailscale setup",
};

type BusyAction = TailscaleAccessAction | "openAccess" | null;

export default function TailscaleAccessSection() {
  const titleId = useId();
  const addressId = useId();
  const [status, setStatus] = useState<TailscaleAccessStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const stateHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    void refreshStatus(true);

    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (focusVersion > 0) {
      stateHeadingRef.current?.focus();
    }
  }, [focusVersion]);

  useEffect(() => {
    if (status?.state !== "starting") return;

    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;

    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (cancelled || !mountedRef.current) return;
        attempts += 1;
        const generation = ++requestGenerationRef.current;

        try {
          const nextStatus = await getTailscaleAccessStatus();
          if (cancelled || !isCurrentRequest(generation)) return;
          setStatus(nextStatus);
          setLocalError(null);
          if (nextStatus.state === "starting" && attempts < STARTING_POLL_LIMIT) {
            schedule();
          } else if (nextStatus.state === "starting") {
            setLocalError("Remote Access is still starting. Check again when Tailscale is ready.");
          }
        } catch (error) {
          if (cancelled || !isCurrentRequest(generation)) return;
          setLocalError(errorMessage(error));
          if (attempts < STARTING_POLL_LIMIT) schedule();
        }
      }, STARTING_POLL_INTERVAL_MS);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [status?.state]);

  function isCurrentRequest(generation: number): boolean {
    return mountedRef.current && generation === requestGenerationRef.current;
  }

  async function refreshStatus(initial = false): Promise<void> {
    const generation = ++requestGenerationRef.current;
    if (initial) setIsLoading(true);
    setLocalError(null);

    try {
      const nextStatus = await getTailscaleAccessStatus();
      if (!isCurrentRequest(generation)) return;
      setStatus(nextStatus);
    } catch (error) {
      if (!isCurrentRequest(generation)) return;
      setLocalError(errorMessage(error));
    } finally {
      if (isCurrentRequest(generation)) setIsLoading(false);
    }
  }

  async function runBackendAction(action: TailscaleAccessAction): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyAction(action);
    setLocalError(null);
    setLocalMessage(null);
    const generation = ++requestGenerationRef.current;
    let actionStatus: TailscaleAccessStatus | null = null;

    try {
      if (action === "completeSetup") {
        const setupUrl = validatedSetupUrl(status?.setupUrl ?? null);
        if (!setupUrl || !(await openExternalUrl(setupUrl))) {
          throw new Error("BrainDrive could not open the Tailscale setup page. Try again or open Tailscale directly.");
        }
        setLocalMessage("Tailscale setup opened. Finish there, then check again.");
      } else if (action === "enable") {
        actionStatus = await enableTailscaleAccess();
      } else if (action === "retry") {
        actionStatus = await retryTailscaleAccess();
      } else if (action === "disable") {
        actionStatus = await disableTailscaleAccess();
      }

      if (!isCurrentRequest(generation)) return;
      if (actionStatus) {
        setStatus(actionStatus);
        if (shouldHoldActionStatus(actionStatus)) {
          setLocalError(actionStatusMessage(actionStatus));
          return;
        }
      }

      const refreshed = await getTailscaleAccessStatus();
      if (!isCurrentRequest(generation)) return;
      setStatus(refreshed);
      if (action === "disable" && refreshed.state === "off") {
        setLocalMessage("Remote Access is off.");
      }
    } catch (error) {
      if (!isCurrentRequest(generation)) return;
      if (actionStatus) setStatus(actionStatus);
      setLocalError(errorMessage(error));

      try {
        const refreshed = await getTailscaleAccessStatus();
        if (isCurrentRequest(generation)) setStatus(refreshed);
      } catch {
        // Keep the original actionable error. The next explicit retry remains available.
      }
    } finally {
      if (isCurrentRequest(generation)) {
        busyRef.current = false;
        setBusyAction(null);
        setFocusVersion((value) => value + 1);
      }
    }
  }

  async function handleCheckAgain(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyAction("checkAgain");
    setLocalError(null);
    setLocalMessage(null);
    const generation = ++requestGenerationRef.current;

    try {
      const nextStatus = await getTailscaleAccessStatus();
      if (isCurrentRequest(generation)) setStatus(nextStatus);
    } catch (error) {
      if (isCurrentRequest(generation)) setLocalError(errorMessage(error));
    } finally {
      if (isCurrentRequest(generation)) {
        busyRef.current = false;
        setBusyAction(null);
        setFocusVersion((value) => value + 1);
      }
    }
  }

  async function handleOpenAccess(): Promise<void> {
    const accessUrl = validatedAccessUrl(status?.accessUrl ?? null);
    if (!accessUrl || busyRef.current) return;
    busyRef.current = true;
    setBusyAction("openAccess");
    setLocalError(null);
    setLocalMessage(null);
    const generation = ++requestGenerationRef.current;

    try {
      if (!(await openExternalUrl(accessUrl))) {
        throw new Error("BrainDrive could not open the Remote Access address. Copy it and try your browser directly.");
      }
      const refreshed = await getTailscaleAccessStatus();
      if (isCurrentRequest(generation)) setStatus(refreshed);
    } catch (error) {
      if (isCurrentRequest(generation)) setLocalError(errorMessage(error));
    } finally {
      if (isCurrentRequest(generation)) {
        busyRef.current = false;
        setBusyAction(null);
        setFocusVersion((value) => value + 1);
      }
    }
  }

  async function handleCopy(): Promise<void> {
    const accessUrl = validatedAccessUrl(status?.accessUrl ?? null);
    if (!accessUrl) return;
    setLocalError(null);
    try {
      await navigator.clipboard.writeText(accessUrl);
      setLocalMessage("Remote Access address copied.");
    } catch {
      setLocalMessage(null);
      setLocalError("BrainDrive could not copy the Remote Access address. Select the address and copy it manually.");
    }
  }

  const accessUrl = validatedAccessUrl(status?.accessUrl ?? null);
  const setupUrl = validatedSetupUrl(status?.setupUrl ?? null);
  const invalidRunningUrl = status?.state === "running" && !accessUrl;
  const effectiveState: TailscaleAccessState | null = invalidRunningUrl ? "needsAttention" : status?.state ?? null;
  const primaryAction = status ? selectPrimaryAction(status, effectiveState, setupUrl, accessUrl) : null;
  const isBusy = busyAction !== null;
  const stateLabel = effectiveState ? STATE_LABELS[effectiveState] : null;
  const setupGuidance = status ? readinessGuidance(status.readiness.state) : null;
  const canTurnOff = Boolean(
    status?.availableActions.includes("disable") &&
      (status.state !== "conflict" || status.ownership === "ownedExact")
  );

  return (
    <section aria-busy={isBusy} aria-labelledby={titleId} className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={titleId} className="font-heading text-lg font-semibold text-bd-text-heading">
            Remote Access
          </h3>
          <span className="rounded-full border border-bd-steel/60 bg-bd-bg-tertiary px-2.5 py-1 text-[11px] text-bd-text-secondary">
            Powered by Tailscale
          </span>
        </div>
        <p className="mt-2 text-sm leading-5 text-bd-text-secondary">
          Reach this BrainDrive from your own trusted devices on your private tailnet.
        </p>
      </div>

      <div className="rounded-lg border border-bd-border bg-bd-bg-secondary/60 p-4 shadow-[0_0_24px_rgba(50,93,135,0.08)]">
        {isLoading ? (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-bd-text-secondary">
            <LoaderCircle className="animate-spin" size={16} strokeWidth={1.5} />
            Checking Remote Access status…
          </div>
        ) : status && stateLabel ? (
          <div role="status" aria-live="polite" aria-atomic="true">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <StateIcon state={effectiveState!} />
                <div className="min-w-0">
                  <h4
                    ref={stateHeadingRef}
                    tabIndex={-1}
                    className="font-heading text-base font-semibold text-bd-text-heading outline-none"
                  >
                    Remote Access — {stateLabel}
                  </h4>
                  <p className="mt-1 text-sm leading-5 text-bd-text-primary">
                    {invalidRunningUrl
                      ? "BrainDrive did not receive a safe Tailscale address. Check again before using Remote Access."
                      : status.message}
                  </p>
                </div>
              </div>
              {isBusy ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-bd-steel/50 px-2.5 py-1 text-xs text-bd-text-secondary">
                  <LoaderCircle className="animate-spin" size={13} strokeWidth={1.5} />
                  Working…
                </span>
              ) : null}
            </div>
            {localMessage ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-bd-success">
                <Check className="mt-0.5 shrink-0" size={15} strokeWidth={1.5} />
                {localMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {localError ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-bd-danger/30 bg-bd-danger/10 px-3 py-2.5 text-sm leading-5 text-bd-text-primary">
          <AlertTriangle className="mt-0.5 shrink-0 text-bd-danger" size={16} strokeWidth={1.5} />
          <span>{localError}</span>
        </div>
      ) : null}

      {status && setupGuidance && status.state === "needsSetup" ? (
        <div className="rounded-lg border border-bd-border bg-bd-bg-tertiary/40 p-4">
          <h4 className="text-sm font-medium text-bd-text-heading">What to do next</h4>
          <p className="mt-1 text-sm leading-5 text-bd-text-secondary">{setupGuidance}</p>
          {status.setupUrl && !setupUrl ? (
            <p className="mt-2 text-xs leading-4 text-bd-danger">The setup address was not safe to open. Use the Tailscale app, then retry.</p>
          ) : null}
        </div>
      ) : null}

      {status?.state === "conflict" ? (
        <div className="rounded-lg border border-bd-danger/30 bg-bd-danger/10 p-4 text-sm leading-5 text-bd-text-primary">
          BrainDrive found an existing Tailscale configuration and will not overwrite or reset it. Local BrainDrive and Browser Access remain unchanged.
        </div>
      ) : null}

      {status?.state === "running" && accessUrl ? (
        <div className="rounded-lg border border-bd-border p-4">
          <label htmlFor={addressId} className="text-sm font-medium text-bd-text-heading">
            Private Remote Access address
          </label>
          <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
            <input
              id={addressId}
              readOnly
              value={accessUrl}
              className="h-10 min-w-0 flex-1 rounded-lg border border-bd-border bg-bd-bg-secondary px-3 font-mono text-xs text-bd-text-primary outline-none focus:border-bd-amber"
            />
            <button
              type="button"
              aria-label="Copy Remote Access address"
              onClick={handleCopy}
              disabled={isBusy}
              className={secondaryButtonClasses}
            >
              <Copy size={15} strokeWidth={1.5} />
              Copy
            </button>
          </div>
        </div>
      ) : null}

      {!isLoading ? (
        <div className="flex flex-wrap gap-2">
          {effectiveState === "starting" ? (
            <button
              type="button"
              data-testid="remote-access-primary-action"
              disabled
              className={primaryButtonClasses}
            >
              <LoaderCircle className="animate-spin" size={15} strokeWidth={1.5} />
              Starting…
            </button>
          ) : primaryAction === "openAccess" ? (
            <button
              type="button"
              data-testid="remote-access-primary-action"
              onClick={handleOpenAccess}
              disabled={isBusy}
              className={primaryButtonClasses}
            >
              <ExternalLink size={15} strokeWidth={1.5} />
              Open Remote Access
            </button>
          ) : primaryAction ? (
            <button
              type="button"
              data-testid="remote-access-primary-action"
              onClick={() => void runBackendAction(primaryAction)}
              disabled={isBusy}
              className={primaryButtonClasses}
            >
              {primaryActionIcon(primaryAction)}
              {ACTION_LABELS[primaryAction]}
            </button>
          ) : !status ? (
            <button
              type="button"
              data-testid="remote-access-primary-action"
              onClick={() => void handleCheckAgain()}
              disabled={isBusy}
              className={primaryButtonClasses}
            >
              <RefreshCw size={15} strokeWidth={1.5} />
              Check again
            </button>
          ) : null}

          {status?.availableActions.includes("checkAgain") && primaryAction !== "checkAgain" && effectiveState !== "starting" ? (
            <button type="button" onClick={() => void handleCheckAgain()} disabled={isBusy} className={secondaryButtonClasses}>
              <RefreshCw size={15} strokeWidth={1.5} />
              Check again
            </button>
          ) : null}

          {canTurnOff && primaryAction !== "disable" ? (
            <button type="button" onClick={() => void runBackendAction("disable")} disabled={isBusy} className={dangerButtonClasses}>
              <Power size={15} strokeWidth={1.5} />
              Turn off
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3 rounded-lg border border-bd-border bg-bd-bg-secondary/40 p-4 text-sm leading-5 text-bd-text-secondary">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 shrink-0" size={16} strokeWidth={1.5} />
          <p>Tailscale is separately installed and owned by you. BrainDrive does not install it, sign you in, or change your tailnet policy.</p>
        </div>
        <div className="flex items-start gap-2">
          <LockKeyhole className="mt-0.5 shrink-0" size={16} strokeWidth={1.5} />
          <p>Access is for your trusted owner devices on your private tailnet. BrainDrive login is still required.</p>
        </div>
        <p>The host computer must stay awake, online, connected to Tailscale, and running BrainDrive.</p>
        <p>This does not create a public link or cross-user sharing.</p>
      </div>

      {status ? (
        <details className="rounded-lg border border-bd-border px-4 py-3 text-sm text-bd-text-secondary">
          <summary className="cursor-pointer font-medium text-bd-text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bd-amber/60">
            Technical details
          </summary>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
            <dt>Readiness</dt><dd className="text-bd-text-primary">{formatCode(status.readiness.state)}</dd>
            <dt>Ownership</dt><dd className="text-bd-text-primary">{formatCode(status.ownership)}</dd>
            <dt>Bridge</dt><dd className="text-bd-text-primary">{formatCode(status.bridgeState)}</dd>
            {status.errorCode ? <><dt>Error</dt><dd className="text-bd-text-primary">{formatCode(status.errorCode)}</dd></> : null}
          </dl>
          {status.detail ? <p className="mt-3 break-words text-xs leading-5 text-bd-text-primary">{status.detail}</p> : null}
        </details>
      ) : null}
    </section>
  );
}

function selectPrimaryAction(
  status: TailscaleAccessStatus,
  effectiveState: TailscaleAccessState | null,
  setupUrl: string | null,
  accessUrl: string | null
): TailscaleAccessAction | "openAccess" | null {
  const has = (action: TailscaleAccessAction) => status.availableActions.includes(action);
  if (effectiveState === "starting") return null;
  if (effectiveState === "running" && accessUrl) return "openAccess";
  if (effectiveState === "ready" || effectiveState === "off") {
    if (has("enable")) return "enable";
  }
  if (effectiveState === "needsSetup" && setupUrl && has("completeSetup")) return "completeSetup";
  if (has("retry")) return "retry";
  if (has("checkAgain")) return "checkAgain";
  return null;
}

function validatedAccessUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.toLowerCase().endsWith(".ts.net") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function validatedSetupUrl(value: string | null): string | null {
  return value && isHttpUrl(value) ? value : null;
}

function readinessGuidance(state: TailscaleReadinessState): string {
  const guidance: Record<TailscaleReadinessState, string> = {
    missing: "Install Tailscale separately from its official app or website, sign in, then retry here.",
    permissionDenied: "Open Tailscale and check that your account can manage private access, then retry.",
    unsupportedVersion: "Update the separately installed Tailscale app, then retry.",
    daemonUnavailable: "Open or restart the Tailscale app, then retry.",
    signedOut: "Open Tailscale and sign in to your own tailnet, then retry.",
    offline: "Reconnect this computer to Tailscale, then retry.",
    missingDns: "Wait for Tailscale to assign this computer a private DNS name, then retry.",
    consentRequired: "Complete Tailscale's setup or consent step in the page supplied by Tailscale, then retry.",
    ready: "Tailscale is ready. Check again to continue.",
  };
  return guidance[state];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldHoldActionStatus(status: TailscaleAccessStatus): boolean {
  return Boolean(
    status.errorCode ||
      status.state === "needsAttention" ||
      status.state === "needsSetup" ||
      status.state === "conflict"
  );
}

function actionStatusMessage(status: TailscaleAccessStatus): string {
  return status.detail ? `${status.message} ${status.detail}` : status.message;
}

function formatCode(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (first) => first.toUpperCase());
}

function StateIcon({ state }: { state: TailscaleAccessState }) {
  const common = "mt-0.5 shrink-0";
  if (state === "running" || state === "ready") {
    return <ShieldCheck aria-hidden="true" className={`${common} text-bd-success`} size={20} strokeWidth={1.5} />;
  }
  if (state === "starting") {
    return <LoaderCircle aria-hidden="true" className={`${common} animate-spin text-bd-amber`} size={20} strokeWidth={1.5} />;
  }
  if (state === "conflict" || state === "needsAttention" || state === "needsSetup") {
    return <AlertTriangle aria-hidden="true" className={`${common} text-bd-amber`} size={20} strokeWidth={1.5} />;
  }
  return <Power aria-hidden="true" className={`${common} text-bd-text-muted`} size={20} strokeWidth={1.5} />;
}

function primaryActionIcon(action: TailscaleAccessAction) {
  if (action === "enable") return <ShieldCheck size={15} strokeWidth={1.5} />;
  if (action === "completeSetup") return <ExternalLink size={15} strokeWidth={1.5} />;
  if (action === "disable") return <Power size={15} strokeWidth={1.5} />;
  return <RefreshCw size={15} strokeWidth={1.5} />;
}

const primaryButtonClasses =
  "inline-flex min-h-10 items-center gap-2 rounded-lg bg-bd-amber px-4 py-2 text-sm font-medium text-bd-bg-primary transition-colors hover:bg-bd-amber-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bd-amber/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bd-bg-secondary disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClasses =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-bd-border bg-bd-bg-secondary px-3 py-2 text-sm font-medium text-bd-text-secondary transition-colors hover:border-bd-amber/60 hover:bg-bd-bg-hover hover:text-bd-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bd-amber/60 disabled:cursor-not-allowed disabled:opacity-60";
const dangerButtonClasses =
  "inline-flex min-h-10 items-center gap-2 rounded-lg border border-bd-danger/50 bg-bd-danger/10 px-3 py-2 text-sm font-medium text-bd-text-primary transition-colors hover:bg-bd-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bd-danger/60 disabled:cursor-not-allowed disabled:opacity-60";
