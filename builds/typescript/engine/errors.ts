import type { StreamEvent } from "../contracts.js";

export function classifyProviderError(error: unknown): StreamEvent {
  const providerMessage = error instanceof Error ? error.message : "The assistant could not finish that reply";
  const normalizedMessage = providerMessage.toLowerCase();

  if (isContextOverflowMessage(normalizedMessage)) {
    return {
      type: "error",
      code: "context_overflow",
      message: "This conversation has grown too large to continue in one reply. Your saved Memory files remain available. Start a new conversation to continue from saved files.",
    };
  }

  return {
    type: "error",
    code: "provider_error",
    message: ownerSafeProviderFailureMessage(),
  };
}

function ownerSafeProviderFailureMessage(): string {
  return [
    "The assistant could not finish that reply.",
    "Your conversation and files are still here.",
    "Try again in a moment. If this keeps happening, contact your BrainDrive admin with the time of this failure.",
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
