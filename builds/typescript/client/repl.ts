import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { AuthState } from "../contracts.js";
import { authHeadersFromState } from "../auth/headers.js";

type StreamEnvelope = {
  event: string;
  data: string;
};

export async function startRepl(baseUrl = "http://127.0.0.1:8787"): Promise<void> {
  const rl = readline.createInterface({ input, output });
  let conversationId: string | undefined;
  const authHeaders = ownerAuthHeaders();

  output.write("PAA MVP ready. Type /exit to quit.\n");

  while (true) {
    const line = (await rl.question("> ")).trim();
    if (line.length === 0) {
      continue;
    }

    if (line === "/exit") {
      break;
    }

    const response = await fetch(`${baseUrl}/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        ...(conversationId ? { "x-conversation-id": conversationId } : {}),
      },
      body: JSON.stringify({
        content: line,
        metadata: {
          client: "paa-cli",
        },
      }),
    });

    if (!response.ok || !response.body) {
      output.write(`Request failed: ${response.status}\n`);
      continue;
    }

    const headerConversationId = response.headers.get("x-conversation-id");
    if (headerConversationId) {
      conversationId = headerConversationId;
    }

    for await (const envelope of parseSse(response.body)) {
      if (envelope.event === "text-delta") {
        const payload = JSON.parse(envelope.data) as { delta: string };
        output.write(payload.delta);
        continue;
      }

      if (envelope.event === "approval-request") {
        const payload = JSON.parse(envelope.data) as {
          request_id: string;
          tool_name: string;
          summary: string;
        };
        output.write(`\nApproval needed: ${payload.summary}\n`);
        const answer = (await rl.question("Approve? [y/N] ")).trim().toLowerCase();
        const decision = answer === "y" || answer === "yes" ? "approved" : "denied";
        await fetch(`${baseUrl}/approvals/${payload.request_id}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({ decision }),
        });
        continue;
      }

      if (envelope.event === "approval-result") {
        const payload = JSON.parse(envelope.data) as { decision: string };
        output.write(`\nApproval ${payload.decision}.\n`);
        continue;
      }

      if (envelope.event === "tool-result") {
        continue;
      }

      if (envelope.event === "done") {
        const payload = JSON.parse(envelope.data) as { conversation_id: string };
        conversationId = payload.conversation_id;
        output.write("\n");
        continue;
      }

      if (envelope.event === "error") {
        const payload = JSON.parse(envelope.data) as { code: string; message: string };
        output.write(`\nError [${payload.code}]: ${payload.message}\n`);
      }
    }
  }

  rl.close();
}

function ownerAuthHeaders(): Record<string, string> {
  const authState: AuthState = {
    actor_id: "owner",
    actor_type: "owner",
    mode: "local-owner",
    permissions: {
      memory_access: true,
      tool_access: true,
      system_actions: true,
      delegation: true,
      approval_authority: true,
      administration: true,
    },
    created_at: "",
    updated_at: "",
  };

  return authHeadersFromState(authState);
}

async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamEnvelope> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseEvent(rawEvent);
      if (event) {
        yield event;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function parseEvent(rawEvent: string): StreamEnvelope | null {
  const lines = rawEvent.split(/\r?\n/);
  let event = "message";
  let data = "";

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      event = line.slice(7);
    }
    if (line.startsWith("data: ")) {
      data = line.slice(6);
    }
  }

  if (data.length === 0) {
    return null;
  }

  return { event, data };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startRepl().catch((error) => {
    output.write(`${error instanceof Error ? error.message : "Unknown CLI error"}\n`);
    process.exitCode = 1;
  });
}
