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

  it("sanitizes credential failures", () => {
    const event = classifyProviderError(new Error("API key invalid"));

    expect(event).toEqual({
      type: "error",
      code: "provider_error",
      message: "Model provider credentials were rejected — check your API key in Settings",
    });
  });
});
