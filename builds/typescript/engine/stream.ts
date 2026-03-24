import type { StreamEvent } from "../contracts.js";

export function formatSseEvent(event: StreamEvent): string {
  const { type, ...payload } = event;
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}
