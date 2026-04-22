import { authenticatedFetch } from "./auth-adapter";
import { GatewayError } from "./types";

export type UpdateStatusPayload = {
  channel: string | null;
  current_version: string | null;
  latest_stable_version: string | null;
  update_available: boolean | null;
  last_checked_at: string;
  diagnostic: string | null;
};

export type UpdateConversationStartStatus = "started" | "resumed" | "completed";

export type UpdateConversationStartPayload = {
  status: UpdateConversationStartStatus;
  project_id: string;
  conversation_id: string | null;
  update_id: string | null;
  bootstrap_sent: boolean;
};

type ErrorPayload = {
  detail?: string;
  message?: string;
  error?: string;
  code?: string;
};

type PartialUpdateStatusPayload = Partial<UpdateStatusPayload>;
type PartialUpdateConversationStartPayload = Partial<UpdateConversationStartPayload>;

const EMPTY_STATUS: UpdateStatusPayload = {
  channel: null,
  current_version: null,
  latest_stable_version: null,
  update_available: null,
  last_checked_at: new Date(0).toISOString(),
  diagnostic: null,
};

export async function getUpdateStatus(): Promise<UpdateStatusPayload> {
  const response = await authenticatedFetch("/api/updates/status", {
    method: "GET",
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as PartialUpdateStatusPayload;
  return normalizeStatusPayload(payload);
}

export async function startUpdateConversation(): Promise<UpdateConversationStartPayload> {
  const response = await authenticatedFetch("/api/updates/conversation/start", {
    method: "POST",
  });

  if (!response.ok) {
    throw await toGatewayError(response);
  }

  const payload = (await response.json()) as PartialUpdateConversationStartPayload;
  return normalizeUpdateConversationStartPayload(payload);
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

function normalizeUpdateConversationStartPayload(
  payload: PartialUpdateConversationStartPayload
): UpdateConversationStartPayload {
  const status = toStartStatus(payload.status);
  return {
    status,
    project_id:
      typeof payload.project_id === "string" && payload.project_id.trim().length > 0
        ? payload.project_id
        : "braindrive-plus-one",
    conversation_id:
      typeof payload.conversation_id === "string" && payload.conversation_id.trim().length > 0
        ? payload.conversation_id
        : null,
    update_id:
      typeof payload.update_id === "string" && payload.update_id.trim().length > 0
        ? payload.update_id
        : null,
    bootstrap_sent: payload.bootstrap_sent === true,
  };
}

function toStartStatus(value: unknown): UpdateConversationStartStatus {
  if (value === "started" || value === "resumed" || value === "completed") {
    return value;
  }
  return "completed";
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
