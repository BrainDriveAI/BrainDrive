import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  Smartphone,
} from "lucide-react";
import { renderSVG } from "uqr";

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
const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

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
  retry: "Try again",
  disable: "Turn off",
  checkAgain: "Check again",
  completeSetup: "Complete Tailscale setup",
};

type BusyAction = TailscaleAccessAction | null;

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
  const qrSvg = useMemo(() => (accessUrl ? renderSVG(accessUrl) : null), [accessUrl]);
  const setupUrl = validatedSetupUrl(status?.setupUrl ?? null);
  const invalidRunningUrl = status?.state === "running" && !accessUrl;
  const effectiveState: TailscaleAccessState | null = invalidRunningUrl ? "needsAttention" : status?.state ?? null;
  const primaryAction = status ? selectPrimaryAction(status, effectiveState, setupUrl) : null;
  const isBusy = busyAction !== null;
  const setupReadiness = status?.readiness.state ?? null;
  // Treat needsAttention as a setup problem ONLY for the fresh-install shape:
  // nothing enabled, no owned config, and an unmet Tailscale prerequisite.
  // Genuine runtime failures (desiredEnabled, drifted ownership) keep their
  // warning presentation and the backend's own message.
  const isSetupProblem = Boolean(
    status &&
      setupReadiness !== "ready" &&
      (status.state === "needsSetup" ||
        status.state === "off" ||
        (status.state === "needsAttention" && !status.desiredEnabled && status.ownership === "absent"))
  );
  const stateLabel = effectiveState
    ? effectiveState === "needsAttention" && !invalidRunningUrl && isSetupProblem
      ? STATE_LABELS.needsSetup
      : STATE_LABELS[effectiveState]
    : null;
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
          Use your BrainDrive from your phone or another computer you trust.
        </p>
      </div>

      <div className="rounded-lg border border-bd-border bg-bd-bg-secondary/60 p-4 shadow-[0_0_24px_rgba(50,93,135,0.08)]">
        {isLoading ? (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-bd-text-secondary">
            <LoaderCircle className="animate-spin" size={16} strokeWidth={1.5} />
            Checking Remote Access status…
          </div>
        ) : status && stateLabel ? (
          <>
            {/* Live region covers only the state heading and short messages so
                assistive tech never re-announces the whole checklist. */}
            <div role="status" aria-live="polite">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {isSetupProblem && !invalidRunningUrl ? null : <StateIcon state={effectiveState!} />}
                  <div className="min-w-0">
                    <h4
                      ref={stateHeadingRef}
                      tabIndex={-1}
                      className="font-heading text-base font-semibold text-bd-text-heading outline-none"
                    >
                      Remote Access — {stateLabel}
                    </h4>
                    {invalidRunningUrl ? (
                      <p className="mt-1 text-sm leading-5 text-bd-text-primary">
                        BrainDrive did not receive a safe Tailscale address. Check again before using Remote Access.
                      </p>
                    ) : isSetupProblem && setupGuidance ? (
                      <p className="mt-1 text-sm leading-5 text-bd-text-secondary">
                        <GuidanceText text={setupGuidance} />
                      </p>
                    ) : (
                      <p className="mt-1 text-sm leading-5 text-bd-text-primary">{status.message}</p>
                    )}
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
            {isSetupProblem && setupGuidance && !invalidRunningUrl ? (
              <div className="mt-4">
                <ol className="space-y-2">
                  {setupChecklist(status.readiness.state).map((step, index) => (
                    <li key={step.label} className="flex items-start gap-2.5 text-sm leading-5">
                      <SetupStepIcon state={step.state} number={index + 1} />
                      <span
                        className={
                          step.state === "active"
                            ? "font-medium text-bd-text-heading"
                            : step.state === "done"
                              ? "text-bd-text-secondary"
                              : "text-bd-text-muted"
                        }
                      >
                        {step.label}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-xs leading-4 text-bd-text-muted">
                  Once Remote Access is running, you&apos;ll get an address and a code to set up your phone.
                </p>
                {status.setupUrl && !setupUrl ? (
                  <p className="mt-2 text-xs leading-4 text-bd-danger">
                    The setup address was not safe to open. Use the Tailscale app, then retry.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {localError ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-bd-danger/30 bg-bd-danger/10 px-3 py-2.5 text-sm leading-5 text-bd-text-primary">
          <AlertTriangle className="mt-0.5 shrink-0 text-bd-danger" size={16} strokeWidth={1.5} />
          <span>{localError}</span>
        </div>
      ) : null}

      {status?.state === "conflict" ? (
        <div className="space-y-2 rounded-lg border border-bd-amber/40 bg-bd-amber/10 p-4 text-sm leading-5 text-bd-text-primary">
          <p>
            Tailscale on this computer already has sharing settings that BrainDrive didn&apos;t create, so BrainDrive
            won&apos;t change them.
          </p>
          <p>
            If you set them up for something else, leave them in place. If you&apos;re sure nothing else on this computer
            uses Tailscale sharing, you can clear them: open Terminal, run{" "}
            <code className="rounded bg-bd-bg-secondary px-1.5 py-0.5 font-mono text-xs">tailscale serve reset</code>, then
            push Try again. Not sure? Check Technical details below before clearing.
          </p>
          <p>Your local BrainDrive and Browser Access are unaffected.</p>
        </div>
      ) : null}

      {status?.state === "running" && accessUrl ? (
        <div className="rounded-lg border border-bd-border p-4">
          <div className="flex items-center gap-2">
            <Smartphone className="shrink-0 text-bd-text-secondary" size={16} strokeWidth={1.5} />
            <h4 className="text-sm font-medium text-bd-text-heading">Use BrainDrive on your phone</h4>
          </div>
          <div className="mt-3 flex flex-col items-start gap-5 sm:flex-row">
            <ol className="min-w-0 flex-1 list-decimal space-y-2 pl-4 text-sm leading-5 text-bd-text-primary">
              <li>Install the Tailscale app on your phone (App Store or Google Play).</li>
              <li>Sign in to Tailscale with the same account you use on this computer.</li>
              <li>Scan this code with your camera.</li>
              <li>Add the link to your bookmarks.</li>
            </ol>
            {qrSvg ? (
              <div
                role="img"
                aria-label="QR code for your BrainDrive address"
                className="h-40 w-40 shrink-0 self-center rounded-lg bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : null}
          </div>
          <p className="mt-3 text-xs leading-4 text-bd-text-secondary">
            Your phone will still ask for your BrainDrive sign-in — access stays yours.
          </p>
          <details className="mt-4 rounded-lg border border-bd-border px-3 py-2.5">
            <summary className="cursor-pointer text-sm font-medium text-bd-text-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bd-amber/60">
              Using another computer instead?
            </summary>
            <p className="mt-2 text-sm leading-5 text-bd-text-secondary">
              Install Tailscale on that computer, sign in with the same account, then open this address in its browser:
            </p>
            <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
              <input
                id={addressId}
                readOnly
                aria-label="Your BrainDrive address"
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
          </details>
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

          {status?.availableActions.includes("checkAgain") &&
          !status.availableActions.includes("retry") &&
          primaryAction !== "checkAgain" &&
          effectiveState !== "starting" ? (
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
        <h4 className="text-sm font-medium text-bd-text-heading">How Tailscale works</h4>
        <p>
          Tailscale is a free app that creates a private, secure network just between your devices. BrainDrive uses it
          to power Remote Access.
        </p>
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 shrink-0" size={16} strokeWidth={1.5} />
          <p>Tailscale is separately installed and owned by you. BrainDrive does not install it, sign you in, or change your tailnet policy.</p>
        </div>
        <div className="flex items-start gap-2">
          <LockKeyhole className="mt-0.5 shrink-0" size={16} strokeWidth={1.5} />
          <p>Only trusted devices on your private Tailscale network can connect — and they still need your BrainDrive sign-in.</p>
        </div>
        <p>This computer must stay awake, online, connected to Tailscale, and running BrainDrive for your other devices to reach it.</p>
        <p>This never creates a public link. Only your signed-in devices can connect.</p>
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
  setupUrl: string | null
): TailscaleAccessAction | null {
  const has = (action: TailscaleAccessAction) => status.availableActions.includes(action);
  if (effectiveState === "starting") return null;
  if (effectiveState === "running") return null;
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
    missing: "Install the Tailscale app on this computer from tailscale.com and sign in, then choose Try again.",
    permissionDenied: "Open the Tailscale app and check that your account is allowed to share devices, then choose Try again.",
    unsupportedVersion: "Your Tailscale app needs an update. Update it, then choose Try again.",
    daemonUnavailable:
      "The Tailscale app isn't running — or isn't installed yet. Open or install it free from tailscale.com, then choose Try again.",
    signedOut: "Open the Tailscale app and sign in, then choose Try again.",
    offline: "Tailscale is turned off or disconnected. Open the Tailscale app and turn the connection on, then choose Try again.",
    missingDns: "Tailscale is still giving this computer its private address. Wait a moment, then choose Try again.",
    consentRequired: "Tailscale needs one more approval from you. Finish the step it opens, then choose Try again.",
    ready: "Tailscale is ready — turn on Remote Access to continue.",
  };
  return guidance[state];
}

type SetupStepState = "done" | "active" | "pending";

function setupChecklist(readiness: TailscaleReadinessState): { label: string; state: SetupStepState }[] {
  // daemonUnavailable counts as not-installed until the backend can distinguish
  // a stopped Tailscale app from an absent one (probe reports commandFailed for both).
  const firstStepByReadiness: Partial<Record<TailscaleReadinessState, string>> = {
    missing: "Install Tailscale on this computer and sign in",
    daemonUnavailable: "Install Tailscale on this computer and sign in",
    unsupportedVersion: "Update the Tailscale app on this computer",
    signedOut: "Open Tailscale and sign in",
    offline: "Open Tailscale and turn its connection on",
    permissionDenied: "Check that your Tailscale account can share devices",
  };
  const firstLabel = firstStepByReadiness[readiness];
  const ready = firstLabel === undefined;
  const secondLabel =
    readiness === "consentRequired"
      ? "Finish the Tailscale approval, then push Try again"
      : "Come back and push the Try again button";
  return [
    {
      label: firstLabel ?? "Install Tailscale on this computer and sign in",
      state: ready ? "done" : "active",
    },
    { label: secondLabel, state: ready ? "active" : "pending" },
  ];
}

function GuidanceText({ text }: { text: string }) {
  const parts = text.split("tailscale.com");
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <button
        type="button"
        aria-label="tailscale.com — opens the free Tailscale download"
        onClick={() => void openExternalUrl(TAILSCALE_DOWNLOAD_URL)}
        className="inline-flex items-baseline gap-0.5 text-bd-amber underline underline-offset-2 transition-colors hover:text-bd-amber-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bd-amber/60"
      >
        tailscale.com
        <ExternalLink className="self-center" size={11} strokeWidth={2} />
      </button>
      {parts.slice(1).join("tailscale.com")}
    </>
  );
}

function SetupStepIcon({ state, number }: { state: SetupStepState; number: number }) {
  if (state === "done") {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bd-success/15"
      >
        <Check className="text-bd-success" size={13} strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={[
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
        state === "active" ? "border-bd-amber text-bd-amber" : "border-bd-border text-bd-text-muted",
      ].join(" ")}
    >
      {number}
    </span>
  );
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
