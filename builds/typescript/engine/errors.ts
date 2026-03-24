import type { StreamEvent } from "../contracts.js";

export function classifyProviderError(error: unknown): StreamEvent {
  const providerMessage = error instanceof Error ? error.message : "The model provider failed to complete the request";
  const normalizedMessage = providerMessage.toLowerCase();

  if (normalizedMessage.includes("context") || normalizedMessage.includes("token")) {
    return {
      type: "error",
      code: "context_overflow",
      message: "The model context limit was exceeded",
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
    return "The model provider credentials were rejected";
  }

  if (
    message.includes("model") &&
    (message.includes("not found") ||
      message.includes("unknown") ||
      message.includes("unsupported") ||
      message.includes("no endpoints"))
  ) {
    return "The configured model is unavailable from the provider";
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
    return "The model provider could not be reached";
  }

  return "The model provider failed to complete the request";
}
