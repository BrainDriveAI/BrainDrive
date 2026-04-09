import type { StreamEvent } from "../contracts.js";

export function classifyProviderError(error: unknown): StreamEvent {
  const providerMessage = error instanceof Error ? error.message : "The model provider failed to complete the request";
  const normalizedMessage = providerMessage.toLowerCase();

  if (normalizedMessage.includes("context") || normalizedMessage.includes("token")) {
    return {
      type: "error",
      code: "context_overflow",
      message: "This session has gotten long. Start a new conversation to continue - all your work is saved.",
    };
  }

  return {
    type: "error",
    code: "provider_error",
    message: sanitizeProviderMessage(normalizedMessage),
  };
}

function sanitizeProviderMessage(message: string): string {
  if (
    message.includes("api key") ||
    message.includes("credential") ||
    message.includes("no auth") ||
    message.includes("authentication") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("401") ||
    message.includes("403")
  ) {
    return "Model provider credentials were rejected — check your API key in Settings";
  }

  if (
    message.includes("model") &&
    (message.includes("not found") ||
      message.includes("unknown") ||
      message.includes("unsupported") ||
      message.includes("no endpoints"))
  ) {
    return "The configured model is unavailable — check your model selection in Settings";
  }

  if (
    message.includes("tool_call_id") ||
    message.includes("tool call id") ||
    message.includes("tool message") ||
    message.includes("assistant message with 'tool_calls'")
  ) {
    return "The provider rejected tool-call message formatting";
  }

  if (message.includes("rate") || message.includes("quota") || message.includes("429") || message.includes("capacity")) {
    return "The model provider is temporarily rate limited";
  }

  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("abort")
  ) {
    return "The model provider did not respond in time";
  }

  if (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("connect")
  ) {
    return "The model provider could not be reached — check your connection and provider settings";
  }

  return "The model provider failed to complete the request";
}
