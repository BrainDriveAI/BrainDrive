import { createHmac, timingSafeEqual } from "node:crypto";

import type { TwilioSmsWebhookFormParameters } from "../adapters/gateway-twilio-sms.js";
import type { GatewayTwilioSmsSettings } from "../contracts.js";

export const TWILIO_SMS_WEBHOOK_PATH = "/twilio/sms/webhook";
export const TWILIO_SMS_EMPTY_TWIML_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
export const TWILIO_SMS_MESSAGE_SID_DEDUP_TTL_SECONDS = 60 * 60 * 24 * 7;

export type TwilioSmsAutoReplyRateLimitSettings = Pick<
  GatewayTwilioSmsSettings,
  "auto_reply" | "rate_limit_period" | "rate_limit_cap_round_trips"
>;

export function isAutoReplyRateLimitActive(input: TwilioSmsAutoReplyRateLimitSettings): boolean {
  return input.auto_reply && input.rate_limit_period > 0 && input.rate_limit_cap_round_trips > 0;
}

export function computeTwilioRequestSignature(input: {
  authToken: string;
  webhookUrl: string;
  formParameters: TwilioSmsWebhookFormParameters;
}): string {
  const webhookUrl = input.webhookUrl.trim();
  if (!webhookUrl) {
    return "";
  }

  let payload = webhookUrl;
  const sortedKeys = Object.keys(input.formParameters).sort((left, right) => left.localeCompare(right));
  for (const key of sortedKeys) {
    const values = [...(input.formParameters[key] ?? [])].sort((left, right) => left.localeCompare(right));
    for (const value of values) {
      payload += `${key}${value}`;
    }
  }

  return createHmac("sha1", input.authToken).update(payload, "utf8").digest("base64");
}

export function validateTwilioRequestSignature(input: {
  authToken: string;
  webhookUrl: string;
  formParameters: TwilioSmsWebhookFormParameters;
  providedSignature: unknown;
}): boolean {
  const expectedSignature = computeTwilioRequestSignature({
    authToken: input.authToken,
    webhookUrl: input.webhookUrl,
    formParameters: input.formParameters,
  });
  if (!expectedSignature) {
    return false;
  }

  const providedSignature = normalizeSignatureHeader(input.providedSignature);
  if (!providedSignature) {
    return false;
  }

  return constantTimeEquals(expectedSignature, providedSignature);
}

export function isStrictOwnerSenderAllowed(ownerPhoneNumber: string | undefined, senderPhoneNumber: string): boolean {
  if (!ownerPhoneNumber) {
    return false;
  }

  return normalizePhoneForCompare(ownerPhoneNumber) === normalizePhoneForCompare(senderPhoneNumber);
}

function normalizeSignatureHeader(header: unknown): string {
  if (Array.isArray(header)) {
    return typeof header[0] === "string" ? header[0].trim() : "";
  }

  return typeof header === "string" ? header.trim() : "";
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizePhoneForCompare(value: string): string {
  return value.replace(/\s+/g, "").trim();
}
