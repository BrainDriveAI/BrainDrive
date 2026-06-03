import { describe, expect, it } from "vitest";

import { classifyProviderError } from "./errors.js";

describe("classifyProviderError", () => {
  it("maps context/token failures to human-readable context_overflow messaging", () => {
    const event = classifyProviderError(new Error("Request failed: context length exceeded"));

    expect(event).toEqual({
      type: "error",
      code: "context_overflow",
      message: "This conversation has grown too large to continue in one reply. Your saved Memory files remain available. Start a new conversation to continue from saved files.",
    });
  });

  it("uses owner-safe recovery copy when provider setup fails", () => {
    const event = classifyProviderError(new Error("Required secret reference provider/openrouter/api_key is missing"));

    expect(event).toEqual({
      type: "error",
      code: "provider_error",
      message: [
        "The assistant could not finish that reply.",
        "Your conversation and files are still here.",
        "Try again in a moment. If this keeps happening, contact your BrainDrive admin with the time of this failure.",
      ].join("\n"),
    });
  });

  it("does not expose provider operations for credit or connectivity failures", () => {
    const creditEvent = classifyProviderError(
      new Error("requested up to 8192 tokens, but can only afford 4258")
    );
    const connectivityEvent = classifyProviderError(new Error("fetch failed: ECONNREFUSED"));
    expect(creditEvent.type).toBe("error");
    expect(connectivityEvent.type).toBe("error");
    if (creditEvent.type !== "error" || connectivityEvent.type !== "error") {
      throw new Error("Expected provider failures to classify as error events.");
    }
    const visibleText = `${creditEvent.message}\n${connectivityEvent.message}`;

    expect(creditEvent.code).toBe("provider_error");
    expect(connectivityEvent.code).toBe("provider_error");
    expect(visibleText).not.toMatch(/provider|api key|credits|quota|connectivity/i);
    expect(visibleText).toContain("The assistant could not finish that reply.");
  });
});
