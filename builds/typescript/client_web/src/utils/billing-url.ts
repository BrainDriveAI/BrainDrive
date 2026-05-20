import { openExternalUrl } from "./external-url";

const TRUSTED_BILLING_DOMAINS = ["stripe.com"] as const;

export function isTrustedBillingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();
    return TRUSTED_BILLING_DOMAINS.some(
      (trustedDomain) => hostname === trustedDomain || hostname.endsWith(`.${trustedDomain}`)
    );
  } catch {
    return false;
  }
}

export function openTrustedBillingUrl(url: string): boolean {
  if (!isTrustedBillingUrl(url)) {
    return false;
  }

  void openExternalUrl(url);
  return true;
}
