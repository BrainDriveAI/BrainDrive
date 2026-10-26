// Local-only deterministic Model API stand-in. Set PAA_PROOF_PROVIDER_LOG to a
// task-owned path; the log contains selection metadata but no prompt content.
import http from "node:http";
import { appendFileSync } from "node:fs";

const evidencePath = process.env.PAA_PROOF_PROVIDER_LOG;
if (!evidencePath) throw new Error("PAA_PROOF_PROVIDER_LOG is required");

for (const [port, provider] of [[8801, "provider-a"], [8802, "provider-b"]]) {
  http.createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        data: [
          { id: "mock-a", name: "Mock A", context_length: 8192 },
          { id: "mock-b", name: "Mock B", context_length: 4096 },
        ],
      }));
      return;
    }

    if (request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }

    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    appendFileSync(evidencePath, JSON.stringify({
      provider,
      model: body.model,
      stream: body.stream,
      tool_names: body.tools?.map((tool) => tool.function?.name) ?? [],
    }) + "\n");

    const wantsTool = body.messages?.some((message) =>
      message.role === "user" && typeof message.content === "string" &&
      message.content.includes("PAA_PROOF_CALL_TOOL")
    );
    const toolCompleted = body.messages?.some((message) => message.role === "tool");
    const brand = body.messages?.some((message) =>
      message.role === "system" && String(message.content).includes("PAA_PROOF_BRAND_A")
    ) ? "brand-a" : body.messages?.some((message) =>
      message.role === "system" && String(message.content).includes("PAA_PROOF_BRAND_B")
    ) ? "brand-b" : null;
    const answer = toolCompleted ? `${provider}:tool-complete` :
      brand ? `${provider}:${brand}` : `${provider}:${body.model}`;

    if (!body.stream) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        id: "paa-proof",
        model: body.model,
        choices: [{ message: { content: answer }, finish_reason: "stop" }],
      }));
      return;
    }

    response.writeHead(200, { "content-type": "text/event-stream" });
    if (wantsTool && !toolCompleted) {
      response.write(`data: ${JSON.stringify({
        id: "paa-proof",
        model: body.model,
        choices: [{
          delta: { tool_calls: [{ index: 0, id: "paa-proof-tool-call", function: {
            name: "auth_whoami", arguments: "{}",
          } }] },
          finish_reason: null,
        }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: "paa-proof",
        model: body.model,
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
      })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    response.write(`data: ${JSON.stringify({
      id: "paa-proof",
      model: body.model,
      choices: [{ delta: { content: answer }, finish_reason: null }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      id: "paa-proof",
      model: body.model,
      choices: [{ delta: {}, finish_reason: "stop" }],
    })}\n\n`);
    response.end("data: [DONE]\n\n");
  }).listen(port, "127.0.0.1");
}

console.log("Controlled providers ready on loopback ports 8801 and 8802");
