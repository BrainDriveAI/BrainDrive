import { parseSSE } from "./sse-parser";

function createChunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      }
    })
  );
}

describe("parseSSE", () => {
  it("parses events split across chunks", async () => {
    const response = createChunkedResponse([
      "event: text-delta\ndata: {\"type\":\"text",
      "-delta\",\"delta\":\"Hel\"}\n\n",
      "event: done\ndata: {\"type\":\"done\",\"finish_reason\":\"stop\",\"conversation_id\":\"conv-1\"}\n\n"
    ]);

    const events = [];
    for await (const event of parseSSE(response)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        event: "text-delta",
        data: "{\"type\":\"text-delta\",\"delta\":\"Hel\"}"
      },
      {
        event: "done",
        data: "{\"type\":\"done\",\"finish_reason\":\"stop\",\"conversation_id\":\"conv-1\"}"
      }
    ]);
  });

  it("skips frames with no data and preserves empty data fields", async () => {
    const response = createChunkedResponse([
      "event: text-delta\n\n",
      "event: error\ndata:\n\n"
    ]);

    const events = [];
    for await (const event of parseSSE(response)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        event: "error",
        data: ""
      }
    ]);
  });
});
