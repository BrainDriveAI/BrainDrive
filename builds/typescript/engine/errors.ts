import type { StreamEvent } from "../contracts.js";

export function classifyProviderError(error: unknown): StreamEvent {
  const providerMessage = error instanceof Error ? error.message : "The model provider failed to complete the request";
  const normalizedMessage = providerMessage.toLowerCase();

  if (isContextOverflowMessage(normalizedMessage)) {
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
  if (isMissingCredentialMessage(message)) {
    return [
      "Provider setup is incomplete: no API key is configured.",
      "What to check:",
      "1. Open Settings > Model Providers.",
      "2. Select the provider you want to use and save an API key.",
      "3. Confirm that provider is selected as Active.",
    ].join("\n");
  }

  if (isRejectedCredentialMessage(message)) {
    return [
      "Provider rejected the API key for this request.",
      "What to check:",
      "1. Re-copy the full API key and save it again in Settings > Model Providers.",
      "2. Make sure the key belongs to the selected provider account.",
      "3. Verify the key is still active and not revoked.",
    ].join("\n");
  }

  if (isInsufficientCreditsMessage(message)) {
    return [
      "Provider account has no available credits or quota.",
      "What to check:",
      "1. Add credits or billing to the provider account tied to this API key.",
      "2. Confirm usage/quota limits are not exhausted.",
      "3. Retry after the account balance updates.",
    ].join("\n");
  }

  if (
    message.includes("model") &&
    (message.includes("not found") ||
      message.includes("unknown") ||
      message.includes("unsupported") ||
      message.includes("no endpoints"))
  ) {
    return [
      "The selected model is unavailable for this provider.",
      "What to check:",
      "1. Open Settings > AI Model and pick a model that exists for this provider.",
      "2. Confirm the provider profile is correct for the selected model.",
    ].join("\n");
  }

  if (
    message.includes("tool_call_id") ||
    message.includes("tool call id") ||
    message.includes("tool message") ||
    message.includes("assistant message with 'tool_calls'")
  ) {
    return "The provider rejected tool-call message formatting";
  }

  if (isRateLimitMessage(message)) {
    return [
      "Provider is temporarily rate limited.",
      "What to check:",
      "1. Wait a minute and retry.",
      "2. Reduce request volume or model size.",
      "3. Raise limits with your provider if this keeps happening.",
    ].join("\n");
  }

  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("abort")
  ) {
    return [
      "Provider did not respond in time.",
      "What to check:",
      "1. Retry the request.",
      "2. Try a smaller prompt.",
      "3. Verify provider status if timeouts continue.",
    ].join("\n");
  }

  if (isConnectivityMessage(message)) {
    return [
      "BrainDrive could not reach the provider.",
      "What to check:",
      "1. Internet connection, VPN/proxy, and firewall rules.",
      "2. Provider Base URL in Settings > Model Providers.",
      "3. Provider service status page for outages.",
    ].join("\n");
  }

  return [
    "The model provider failed to complete the request.",
    "What to check:",
    "1. Provider/API key settings.",
    "2. Provider account credits/quota.",
    "3. Provider connectivity and status.",
  ].join("\n");
}

function isContextOverflowMessage(message: string): boolean {
  return (
    message.includes("context") ||
    message.includes("maximum context") ||
    message.includes("prompt is too long") ||
    message.includes("token limit") ||
    message.includes("too many tokens")
  );
}

function isMissingCredentialMessage(message: string): boolean {
  return (
    message.includes("required secret reference") ||
    message.includes("is missing") ||
    message.includes("missing api key") ||
    message.includes("api key is required") ||
    message.includes("no auth credentials") ||
    message.includes("credential is not configured") ||
    message.includes("provider credential is not configured")
  );
}

function isRejectedCredentialMessage(message: string): boolean {
  return (
    message.includes("api key invalid") ||
    message.includes("invalid api key") ||
    message.includes("incorrect api key") ||
    message.includes("authentication") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("401") ||
    message.includes("403")
  );
}

function isInsufficientCreditsMessage(message: string): boolean {
  return (
    message.includes("insufficient_quota") ||
    message.includes("insufficient quota") ||
    message.includes("insufficient credits") ||
    message.includes("insufficient balance") ||
    message.includes("no credits") ||
    message.includes("credit balance") ||
    message.includes("payment required") ||
    message.includes("billing hard limit")
  );
}

function isRateLimitMessage(message: string): boolean {
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429") ||
    message.includes("capacity")
  );
}

function isConnectivityMessage(message: string): boolean {
  return (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("connect") ||
    message.includes("could not resolve host")
  );
}
