import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeTwilioRequestSignature,
  isStrictOwnerSenderAllowed,
  validateTwilioRequestSignature,
} from "./twilio-sms.js";

describe("gateway twilio sms helpers", () => {
  it("computes Twilio signatures using webhook URL plus sorted form parameters", () => {
    const formParameters = {
      From: ["+14155551234"],
      Body: ["Hello"],
      MessageSid: ["SM111"],
      AccountSid: ["AC111"],
      To: ["+14155550000"],
      Extra: ["A", "B"],
    };
    const webhookUrl = "https://example.com/twilio/sms/webhook";
    const authToken = "secret-token";

    const manualPayload =
      webhookUrl +
      "AccountSidAC111" +
      "BodyHello" +
      "ExtraA" +
      "ExtraB" +
      "From+14155551234" +
      "MessageSidSM111" +
      "To+14155550000";
    const manualSignature = createHmac("sha1", authToken).update(manualPayload, "utf8").digest("base64");

    const computed = computeTwilioRequestSignature({
      authToken,
      webhookUrl,
      formParameters,
    });

    expect(computed).toBe(manualSignature);
  });

  it("validates signatures against the full form parameter set", () => {
    const fullFormParameters = {
      AccountSid: ["AC111"],
      MessageSid: ["SM111"],
      From: ["+14155551234"],
      To: ["+14155550000"],
      Body: ["Hello"],
      WaId: ["14155551234"],
    };

    const webhookUrl = "https://example.com/twilio/sms/webhook";
    const authToken = "secret-token";

    const validSignature = computeTwilioRequestSignature({
      authToken,
      webhookUrl,
      formParameters: fullFormParameters,
    });

    expect(
      validateTwilioRequestSignature({
        authToken,
        webhookUrl,
        formParameters: fullFormParameters,
        providedSignature: validSignature,
      })
    ).toBe(true);

    expect(
      validateTwilioRequestSignature({
        authToken,
        webhookUrl,
        formParameters: {
          AccountSid: ["AC111"],
          MessageSid: ["SM111"],
          From: ["+14155551234"],
          To: ["+14155550000"],
          Body: ["Hello"],
        },
        providedSignature: validSignature,
      })
    ).toBe(false);
  });

  it("compares strict owner sender phone numbers using normalized formatting", () => {
    expect(isStrictOwnerSenderAllowed(" +14155551234 ", "+14155551234")).toBe(true);
    expect(isStrictOwnerSenderAllowed("+14155550000", "+14155551234")).toBe(false);
    expect(isStrictOwnerSenderAllowed(undefined, "+14155551234")).toBe(false);
  });
});
