import { afterEach, describe, expect, it, vi } from "vitest";

import { isTrustedBillingUrl, openTrustedBillingUrl } from "./billing-url";

describe("billing-url", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts https Stripe domains", () => {
    expect(isTrustedBillingUrl("https://checkout.stripe.com/c/pay_123")).toBe(true);
    expect(isTrustedBillingUrl("https://billing.stripe.com/p/session_123")).toBe(true);
    expect(isTrustedBillingUrl("https://subdomain.stripe.com/path")).toBe(true);
  });

  it("rejects non-https and non-Stripe domains", () => {
    expect(isTrustedBillingUrl("http://checkout.stripe.com/c/pay_123")).toBe(false);
    expect(isTrustedBillingUrl("https://example.com/checkout")).toBe(false);
    expect(isTrustedBillingUrl("https://stripe.com.evil.example/checkout")).toBe(false);
    expect(isTrustedBillingUrl("not-a-url")).toBe(false);
  });

  it("opens trusted links with noopener+noreferrer", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    const opened = openTrustedBillingUrl("https://checkout.stripe.com/c/pay_123");

    expect(opened).toBe(true);
    expect(openSpy).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/pay_123",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("does not open untrusted links", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    const opened = openTrustedBillingUrl("https://example.com/checkout");

    expect(opened).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
