import { timingSafeEqual } from "node:crypto";

export const SIGNUP_BOOTSTRAP_TOKEN_HEADER = "x-paa-bootstrap-token";

export type SignupBootstrapDecision =
  | {
      allowed: true;
      reason: "loopback" | "bootstrap_token";
    }
  | {
      allowed: false;
      reason: "signup_bootstrap_token_required" | "signup_local_only";
    };

export function evaluateSignupBootstrapAccess(
  input: {
    ip?: string;
    headers?: Record<string, unknown>;
  },
  configuredBootstrapToken?: string
): SignupBootstrapDecision {
  const expectedToken = configuredBootstrapToken?.trim() ?? "";
  if (expectedToken.length > 0) {
    const providedToken = readHeaderValue(input.headers, SIGNUP_BOOTSTRAP_TOKEN_HEADER);
    if (providedToken && constantTimeEquals(providedToken, expectedToken)) {
      return {
        allowed: true,
        reason: "bootstrap_token",
      };
    }

    return {
      allowed: false,
      reason: "signup_bootstrap_token_required",
    };
  }

  if (isLoopbackIp(input.ip)) {
    return {
      allowed: true,
      reason: "loopback",
    };
  }

  return {
    allowed: false,
    reason: "signup_local_only",
  };
}

export function isLoopbackIp(ip: string | undefined): boolean {
  const normalized = normalizeIp(ip);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function normalizeIp(ip: string | undefined): string {
  const trimmed = ip?.trim() ?? "";
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice("::ffff:".length);
  }

  return trimmed;
}

function readHeaderValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  const headerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== headerName) {
      continue;
    }

    return firstHeaderValue(value);
  }

  return undefined;
}

function firstHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
