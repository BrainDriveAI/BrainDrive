import { describe, expect, it } from "vitest";

import { classifyProviderError } from "./errors.js";

describe("classifyProviderError", () => {
  it("maps context/token failures to human-readable context_overflow messaging", () => {
    const event = classifyProviderError(new Error("Request failed: context length exceeded"));

    expect(event).toEqual({
      type: "error",
      code: "context_overflow",
      message: "This session has gotten long. Start a new conversation to continue - all your work is saved.",
    });
  });

  it("surfaces setup guidance when provider key is missing", () => {
    const event = classifyProviderError(new Error("Required secret reference provider/openrouter/api_key is missing"));

    expect(event).toEqual({
      type: "error",
      code: "provider_error",
      message: [
        "Provider setup is incomplete: no API key is configured.",
        "What to check:",
        "1. Open Settings > Model Providers.",
        "2. Select the provider you want to use and save an API key.",
        "3. Confirm that provider is selected as Active.",
      ].join("\n"),
    });
  });

  it("sanitizes rejected credential failures with actionable checks", () => {
    const event = classifyProviderError(new Error("API key invalid"));

    expect(event).toEqual({
      type: "error",
      code: "provider_error",
      message: [
        "Provider rejected the API key for this request.",
        "What to check:",
        "1. Re-copy the full API key and save it again in Settings > Model Providers.",
        "2. Make sure the key belongs to the selected provider account.",
        "3. Verify the key is still active and not revoked.",
      ].join("\n"),
    });
  });

  it("surfaces no-credit guidance", () => {
    const event = classifyProviderError(new Error("insufficient_quota: credit balance too low"));

    expect(event).toEqual({
      type: "error",
      code: "provider_error",
      message: [
        "Provider account has no available credits or quota.",
        "What to check:",
        "1. Add credits or billing to the provider account tied to this API key.",
        "2. Confirm usage/quota limits are not exhausted.",
        "3. Retry after the account balance updates.",
      ].join("\n"),
    });
  });

  it("surfaces connectivity guidance", () => {
    const event = classifyProviderError(new Error("fetch failed: ECONNREFUSED"));

    expect(event).toEqual({
      type: "error",
      code: "provider_error",
      message: [
        "BrainDrive could not reach the provider.",
        "What to check:",
        "1. Internet connection, VPN/proxy, and firewall rules.",
        "2. Provider Base URL in Settings > Model Providers.",
        "3. Provider service status page for outages.",
      ].join("\n"),
    });
  });
});
