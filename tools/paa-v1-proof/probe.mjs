import { readFileSync } from "node:fs";

const baseUrl = process.env.PAA_PROOF_GATEWAY_URL ?? "http://127.0.0.1:8799";
const authPath = process.env.PAA_PROOF_AUTH_FILE;
if (!authPath) throw new Error("PAA_PROOF_AUTH_FILE is required");
const { token } = JSON.parse(readFileSync(authPath, "utf8"));
if (!token) throw new Error("Auth file has no token");
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const results = [];
let firstMessageStream = "";

async function request(path, method = "GET", body) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, text: await response.text() };
}

function check(id, ok, observed) {
  results.push({ id, result: ok ? "pass" : "fail", observed });
}

for (const profile of ["openrouter", "ollama"]) {
  const models = await request(`/settings/models?provider_profile=${profile}`);
  const parsed = models.status === 200 ? JSON.parse(models.text) : {};
  check(`US-5-model-list-${profile}`,
    models.status === 200 && parsed.source === "provider" &&
      ["mock-a", "mock-b"].every((id) => parsed.models?.some((model) => model.id === id)),
    { status: models.status, source: parsed.source ?? null });
}

for (const [profile, model, expected] of [
  ["openrouter", "mock-a", "provider-a:mock-a"],
  ["openrouter", "mock-b", "provider-a:mock-b"],
  ["ollama", "mock-a", "provider-b:mock-a"],
]) {
  const update = await request("/settings", "PUT", {
    active_provider_profile: profile,
    default_model: model,
  });
  const message = await request("/message", "POST", { content: "Say hello" });
  if (!firstMessageStream) firstMessageStream = message.text;
  check(`US-5-next-message-${profile}-${model}`,
    update.status === 200 && message.status === 200 && message.text.includes(expected),
    { update_status: update.status, message_status: message.status, expected_seen: message.text.includes(expected) });
}

const firstEventData = firstMessageStream.split("\n")
  .find((line) => line.startsWith("data: "));
const firstEvent = firstEventData ? JSON.parse(firstEventData.slice(6)) : null;
check("US-13-canonical-client-event",
  firstEvent?._event_type === "text-delta" && typeof firstEvent.content === "string",
  { event_type: firstEvent?._event_type ?? null, content_type: typeof firstEvent?.content });

const conversations = await request("/conversations");
const conversationBody = conversations.status === 200 ? JSON.parse(conversations.text) : null;
check("US-13-canonical-conversation-list",
  conversations.status === 200 && Array.isArray(conversationBody?.conversations) &&
    Number.isInteger(conversationBody?.total),
  { status: conversations.status, is_array: Array.isArray(conversationBody) });

const toolMessage = await request("/message", "POST", {
  content: "PAA_PROOF_CALL_TOOL",
});
check("US-8-separate-mcp-tool-call",
  toolMessage.status === 200 &&
    toolMessage.text.includes("event: tool-call") &&
    toolMessage.text.includes("event: tool-result") &&
    toolMessage.text.includes("provider-b:tool-complete"),
  {
    status: toolMessage.status,
    tool_call_seen: toolMessage.text.includes("event: tool-call"),
    tool_result_seen: toolMessage.text.includes("event: tool-result"),
    continuation_seen: toolMessage.text.includes("provider-b:tool-complete"),
  });

for (const [marker, expected] of [
  ["PAA_PROOF_BRAND_A", "provider-b:brand-a"],
  ["PAA_PROOF_BRAND_B", "provider-b:brand-b"],
]) {
  const update = await request("/agent", "PUT", { overlay_content: marker });
  const message = await request("/message", "POST", { content: "Which product is this?" });
  check(`US-17-owner-content-${marker}`,
    update.status === 200 && message.status === 200 && message.text.includes(expected),
    {
      update_status: update.status,
      message_status: message.status,
      expected_seen: message.text.includes(expected),
    });
}

const canonicalRoute = await request("/conversations/messages", "POST", {
  content: [{ type: "text", text: "Hello" }],
});
check("US-13-canonical-gateway-route", canonicalRoute.status === 200, {
  status: canonicalRoute.status,
});
const canonicalShape = await request("/message", "POST", {
  content: [{ type: "text", text: "Hello" }],
});
check("US-13-canonical-content-on-legacy-route", canonicalShape.status === 200, {
  status: canonicalShape.status,
});

console.log(JSON.stringify({
  candidate: process.env.PAA_PROOF_CANDIDATE_SHA ?? null,
  target: baseUrl,
  results,
}, null, 2));
if (results.some((entry) => entry.result === "fail")) process.exitCode = 1;
