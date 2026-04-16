import { describe, expect, it } from "vitest";

import {
  normalizeTwilioSmsWebhookPayload,
  parseTwilioSmsWebhookFormPayload,
} from "./gateway-twilio-sms.js";

describe("gateway twilio sms adapter", () => {
  it("normalizes Twilio form payloads into canonical client message input plus metadata", () => {
    const payload =
      "MessageSid=SM1234567890abcdef1234567890abcd&AccountSid=AC1234567890abcdef1234567890abcd&From=%2B14155551234&To=%2B14155550000&Body=Hello%20from%20Twilio&NumMedia=0";

    const normalized = normalizeTwilioSmsWebhookPayload(payload, {
      receivedAt: "2026-04-15T16:00:00.000Z",
    });

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }

    expect(normalized.webhook.client_message).toEqual({
      content: "Hello from Twilio",
    });
    expect(normalized.webhook.metadata).toEqual({
      transport: "twilio_sms",
      trigger: "twilio_sms_webhook",
      account_sid: "AC1234567890abcdef1234567890abcd",
      message_sid: "SM1234567890abcdef1234567890abcd",
      from_number: "+14155551234",
      to_number: "+14155550000",
      received_at: "2026-04-15T16:00:00.000Z",
    });
    expect(normalized.webhook.form_parameters).toMatchObject({
      MessageSid: ["SM1234567890abcdef1234567890abcd"],
      AccountSid: ["AC1234567890abcdef1234567890abcd"],
      From: ["+14155551234"],
      To: ["+14155550000"],
      Body: ["Hello from Twilio"],
      NumMedia: ["0"],
    });
  });

  it("retains repeated form parameters for full signature validation", () => {
    const parsed = parseTwilioSmsWebhookFormPayload("MediaUrl=https%3A%2F%2Fa&MediaUrl=https%3A%2F%2Fb");

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    expect(parsed.form_parameters.MediaUrl).toEqual(["https://a", "https://b"]);
  });

  it("fails validation when required Twilio webhook fields are missing", () => {
    const normalized = normalizeTwilioSmsWebhookPayload(
      "AccountSid=AC1234567890abcdef1234567890abcd&From=%2B14155551234&To=%2B14155550000"
    );

    expect(normalized.ok).toBe(false);
    if (!normalized.ok) {
      expect(normalized.failure.reason).toBe("invalid_request");
      expect(normalized.failure.issueCount).toBeGreaterThan(0);
    }
  });
});
