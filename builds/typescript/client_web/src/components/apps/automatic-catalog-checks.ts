export const AUTOMATIC_CATALOG_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const AUTOMATIC_CATALOG_CHECK_INTERVAL_LABEL = "every 6 hours";
export const AUTOMATIC_CATALOG_CHECK_STORAGE_KEY = "braindrive.apps.check-automatically";
export const AUTOMATIC_CATALOG_CHECK_CLOCK_EVENT = "braindrive:desktop-verifier-clock-advanced";

export const CATALOG_CHECK_DISCLOSURE =
  "BrainDrive checks its apps repository anonymously. It sends nothing about you, your installed apps, or how you use them.";

type VerifierClockWindow = Window & {
  __BRAINDRIVE_DESKTOP_VERIFIER_CLOCK__?: { now: number };
};

export function readAutomaticChecksEnabled(): boolean {
  try {
    return window.localStorage.getItem(AUTOMATIC_CATALOG_CHECK_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function persistAutomaticChecksEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(AUTOMATIC_CATALOG_CHECK_STORAGE_KEY, String(enabled));
  } catch {
    // A non-persistent browser profile must still keep the preference safe: off.
  }
}

export function verifierClockNow(): number {
  const clock = (window as VerifierClockWindow).__BRAINDRIVE_DESKTOP_VERIFIER_CLOCK__;
  return typeof clock?.now === "number" && Number.isFinite(clock.now) ? clock.now : Date.now();
}
