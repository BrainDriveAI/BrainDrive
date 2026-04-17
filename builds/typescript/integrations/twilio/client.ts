const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

const GSM7_BASIC_CHARS =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED_CHARS = "^{}\\[~]|€";

const GSM7_TRANSLITERATION_MAP: Record<string, string> = {
  "\u00A0": " ",
  "\u1680": " ",
  "\u2000": " ",
  "\u2001": " ",
  "\u2002": " ",
  "\u2003": " ",
  "\u2004": " ",
  "\u2005": " ",
  "\u2006": " ",
  "\u2007": " ",
  "\u2008": " ",
  "\u2009": " ",
  "\u200A": " ",
  "\u202F": " ",
  "\u205F": " ",
  "\u3000": " ",
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": "\"",
  "\u201D": "\"",
  "\u201E": "\"",
  "\u201F": "\"",
  "\u2032": "'",
  "\u2033": "\"",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2015": "-",
  "\u2212": "-",
  "\u2026": "...",
  "\u2022": "*",
  "\u2027": "*",
  "\u2219": "*",
  "\u2028": "\n",
  "\u2029": "\n",
};

const GSM7_ALLOWED_CHARS = new Set([...GSM7_BASIC_CHARS, ...GSM7_EXTENDED_CHARS]);

export type TwilioOutboundSmsSendRequest = {
  account_sid: string;
  auth_token: string;
  from_number: string;
  to_number: string;
  message: string;
  smart_encoded: boolean;
};

export type TwilioOutboundSmsSendSuccess = {
  ok: true;
  status_code: number;
  message_sid: string;
  status: string | null;
};

export type TwilioOutboundSmsSendFailure = {
  ok: false;
  status_code: number;
  error_code: number | null;
  error_message: string;
};

export type TwilioOutboundSmsSendResult = TwilioOutboundSmsSendSuccess | TwilioOutboundSmsSendFailure;

type TwilioMessageResponse = {
  sid?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
};

export async function sendTwilioOutboundSms(
  input: TwilioOutboundSmsSendRequest
): Promise<TwilioOutboundSmsSendResult> {
  const accountSid = input.account_sid.trim();
  const authToken = input.auth_token.trim();

  const requestBody = new URLSearchParams();
  requestBody.set("To", input.to_number);
  requestBody.set("From", input.from_number);
  requestBody.set("Body", input.message);
  requestBody.set("SmartEncoded", input.smart_encoded ? "true" : "false");

  const response = await fetch(`${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: requestBody,
  });

  const payload = (await parseJsonResponse(response)) as TwilioMessageResponse | null;

  if (!response.ok) {
    return {
      ok: false,
      status_code: response.status,
      error_code: toNumericErrorCode(payload?.code),
      error_message: toSafeProviderErrorMessage(payload?.message),
    };
  }

  return {
    ok: true,
    status_code: response.status,
    message_sid: typeof payload?.sid === "string" && payload.sid.trim().length > 0 ? payload.sid : "",
    status: typeof payload?.status === "string" && payload.status.trim().length > 0 ? payload.status : null,
  };
}

export function sanitizeOutboundSmsToGsm7(input: string): string {
  const normalized = normalizeToCommonSmsCharacters(input);
  let sanitized = "";

  for (const character of normalized) {
    if (GSM7_ALLOWED_CHARS.has(character)) {
      sanitized += character;
      continue;
    }

    if (character === "\t") {
      sanitized += " ";
      continue;
    }

    if (character === "\v" || character === "\f") {
      sanitized += "\n";
      continue;
    }

    sanitized += "?";
  }

  return sanitized;
}

function normalizeToCommonSmsCharacters(value: string): string {
  let normalized = "";

  for (const character of value) {
    normalized += GSM7_TRANSLITERATION_MAP[character] ?? character;
  }

  const withoutCombiningMarks = normalized.normalize("NFKD").replace(/\p{M}+/gu, "");
  return withoutCombiningMarks.replace(/\r\n/g, "\n");
}

async function parseJsonResponse(response: Response): Promise<unknown | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toNumericErrorCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toSafeProviderErrorMessage(value: unknown): string {
  if (typeof value !== "string") {
    return "Twilio request failed";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Twilio request failed";
  }

  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}
