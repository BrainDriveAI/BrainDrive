import { buildLocalOwnerHeaders } from "./local-auth";
import { GatewayError } from "./types";

export type UpdateStatusPayload = {
  channel: string | null;
  current_version: string | null;
  latest_stable_version: string | null;
  update_available: boolean | null;
  last_checked_at: string;
  diagnostic: string | null;
};

type ErrorPayload = {
  detail?: string;
  message?: string;
  error?: string;
  code?: string;
};

type PartialUpdateStatusPayload = Partial<UpdateStatusPayload>;

const EMPTY_STATUS: UpdateStatusPayload = {
  channel: null,
  current_version: null,
  latest_stable_version: null,
  update_available: null,
  last_checked_at: new Date(0).toISOString(),
  diagnostic: null,
};

export async function getUpdateStatus(): Promise<UpdateStatusPayload> {
  const response = await fetch("/api/updates/status", {
    method: "GET",
    headers: buildLocalOwnerHeaders(),
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as PartialUpdateStatusPayload;
  return normalizeStatusPayload(payload);
}

function normalizeStatusPayload(payload: PartialUpdateStatusPayload): UpdateStatusPayload {
  return {
    channel: typeof payload.channel === "string" ? payload.channel : null,
    current_version: typeof payload.current_version === "string" ? payload.current_version : null,
    latest_stable_version:
      typeof payload.latest_stable_version === "string" ? payload.latest_stable_version : null,
    update_available: typeof payload.update_available === "boolean" ? payload.update_available : null,
    last_checked_at:
      typeof payload.last_checked_at === "string" ? payload.last_checked_at : EMPTY_STATUS.last_checked_at,
    diagnostic: typeof payload.diagnostic === "string" ? payload.diagnostic : null,
  };
}

async function toGatewayError(response: Response): Promise<GatewayError> {
  const payload = await readErrorPayload(response);
  const message =
    payload?.detail ??
    payload?.message ??
    payload?.error ??
    `Update status request failed with status ${response.status}`;

  return new GatewayError(message, response.status, payload?.code);
}

async function readErrorPayload(response: Response): Promise<ErrorPayload | null> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return (await response.json()) as ErrorPayload;
  } catch {
    return null;
  }
}
