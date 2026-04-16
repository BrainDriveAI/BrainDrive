import { z } from "zod";

import type { ClientMessageRequest } from "../contracts.js";

export type TwilioSmsWebhookFormParameters = Record<string, string[]>;

export type TwilioSmsWebhookCanonicalInput = {
  client_message: ClientMessageRequest;
  metadata: {
    transport: "twilio_sms";
    trigger: "twilio_sms_webhook";
    account_sid: string;
    message_sid: string;
    from_number: string;
    to_number: string;
    received_at: string;
  };
  form_parameters: TwilioSmsWebhookFormParameters;
};

export type TwilioSmsWebhookNormalizationFailure = {
  reason: "invalid_request";
  issueCount: number;
};

export type TwilioSmsWebhookNormalizationResult =
  | {
      ok: true;
      webhook: TwilioSmsWebhookCanonicalInput;
    }
  | {
      ok: false;
      failure: TwilioSmsWebhookNormalizationFailure;
    };

const requiredWebhookFieldsSchema = z.object({
  account_sid: z.string().trim().min(1),
  message_sid: z.string().trim().min(1),
  from_number: z.string().trim().min(1),
  to_number: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

export function normalizeTwilioSmsWebhookPayload(
  payload: unknown,
  options: { receivedAt?: string } = {}
): TwilioSmsWebhookNormalizationResult {
  const parsedForm = parseTwilioSmsWebhookFormPayload(payload);
  if (!parsedForm.ok) {
    return {
      ok: false,
      failure: {
        reason: "invalid_request",
        issueCount: parsedForm.issueCount,
      },
    };
  }

  const requiredFields = {
    account_sid: readFirstFormValue(parsedForm.form_parameters, "AccountSid"),
    message_sid: readFirstFormValue(parsedForm.form_parameters, "MessageSid"),
    from_number: readFirstFormValue(parsedForm.form_parameters, "From"),
    to_number: readFirstFormValue(parsedForm.form_parameters, "To"),
    body: readFirstFormValue(parsedForm.form_parameters, "Body"),
  };
  const parsedRequired = requiredWebhookFieldsSchema.safeParse(requiredFields);
  if (!parsedRequired.success) {
    return {
      ok: false,
      failure: {
        reason: "invalid_request",
        issueCount: parsedRequired.error.issues.length,
      },
    };
  }

  const receivedAt = normalizeReceivedAt(options.receivedAt);
  const body = parsedRequired.data.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  return {
    ok: true,
    webhook: {
      client_message: {
        content: body,
      },
      metadata: {
        transport: "twilio_sms",
        trigger: "twilio_sms_webhook",
        account_sid: parsedRequired.data.account_sid,
        message_sid: parsedRequired.data.message_sid,
        from_number: parsedRequired.data.from_number,
        to_number: parsedRequired.data.to_number,
        received_at: receivedAt,
      },
      form_parameters: parsedForm.form_parameters,
    },
  };
}

export function parseTwilioSmsWebhookFormPayload(payload: unknown):
  | { ok: true; form_parameters: TwilioSmsWebhookFormParameters }
  | { ok: false; issueCount: number } {
  if (typeof payload === "string") {
    return {
      ok: true,
      form_parameters: formParametersFromUrlEncodedBody(payload),
    };
  }

  if (payload instanceof URLSearchParams) {
    return {
      ok: true,
      form_parameters: formParametersFromUrlSearchParams(payload),
    };
  }

  if (!isRecord(payload)) {
    return {
      ok: false,
      issueCount: 1,
    };
  }

  const formParameters: TwilioSmsWebhookFormParameters = {};
  let issueCount = 0;

  for (const [rawKey, rawValue] of Object.entries(payload)) {
    if (typeof rawKey !== "string") {
      issueCount += 1;
      continue;
    }

    const key = rawKey.trim();
    if (!key) {
      issueCount += 1;
      continue;
    }

    const values = toStringArray(rawValue);
    if (!values) {
      issueCount += 1;
      continue;
    }

    formParameters[key] = values;
  }

  if (issueCount > 0) {
    return {
      ok: false,
      issueCount,
    };
  }

  return {
    ok: true,
    form_parameters: formParameters,
  };
}

function formParametersFromUrlEncodedBody(rawBody: string): TwilioSmsWebhookFormParameters {
  const params = new URLSearchParams(rawBody);
  return formParametersFromUrlSearchParams(params);
}

function formParametersFromUrlSearchParams(params: URLSearchParams): TwilioSmsWebhookFormParameters {
  const formParameters: TwilioSmsWebhookFormParameters = {};

  for (const [key, value] of params) {
    if (!(key in formParameters)) {
      formParameters[key] = [];
    }
    formParameters[key].push(value);
  }

  return formParameters;
}

function readFirstFormValue(formParameters: TwilioSmsWebhookFormParameters, key: string): string {
  return formParameters[key]?.[0] ?? "";
}

function normalizeReceivedAt(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : Date.now();
  if (!Number.isFinite(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

function toStringArray(value: unknown): string[] | null {
  if (typeof value === "string") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return null;
    }
    values.push(entry);
  }

  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
