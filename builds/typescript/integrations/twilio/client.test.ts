import { afterEach, describe, expect, it, vi } from "vitest";

import { sanitizeOutboundSmsToGsm7, sendTwilioOutboundSms } from "./client.js";

describe("twilio client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends outbound SMS over Twilio REST with SmartEncoded enabled", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (input: unknown, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://api.twilio.com/2010-04-01/Accounts/AC1234567890abcdef1234567890abcd/Messages.json"
        );
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          "Content-Type": "application/x-www-form-urlencoded",
        });

        const body = init?.body as URLSearchParams;
        expect(body.get("To")).toBe("+14155553333");
        expect(body.get("From")).toBe("+14155552671");
        expect(body.get("Body")).toBe("test message");
        expect(body.get("SmartEncoded")).toBe("true");

        return new Response(JSON.stringify({ sid: "SM123", status: "queued" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      });

    const result = await sendTwilioOutboundSms({
      account_sid: "AC1234567890abcdef1234567890abcd",
      auth_token: "token",
      from_number: "+14155552671",
      to_number: "+14155553333",
      message: "test message",
      smart_encoded: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      status_code: 201,
      message_sid: "SM123",
      status: "queued",
    });
  });

  it("sanitizes outbound content to GSM-7-friendly text", () => {
    const sanitized = sanitizeOutboundSmsToGsm7("Café — hi 😊");
    expect(sanitized).toBe("Cafe - hi ?");
  });
});
