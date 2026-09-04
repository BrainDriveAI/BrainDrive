import { describe, expect, it } from "vitest";

import type { ToolDefinition } from "../contracts.js";
import { selectMessageToolsForRequest } from "./server.js";

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} test tool`,
    requiresApproval: false,
    readOnly: true,
    inputSchema: { type: "object", properties: {}, required: [] },
    execute: async () => ({}),
  };
}

describe("app-chat message tool selection", () => {
  it("uses only app-chat tools when an app-chat session is active", () => {
    const memoryList = tool("memory_list");
    const appAction = tool("app_action_resume_state_read");

    expect(selectMessageToolsForRequest([memoryList], [appAction]).map((candidate) => candidate.name)).toEqual([
      "app_action_resume_state_read",
    ]);
    expect(selectMessageToolsForRequest([memoryList], []).map((candidate) => candidate.name)).toEqual([]);
  });

  it("uses the base gateway tools outside app-chat", () => {
    const memoryList = tool("memory_list");

    expect(selectMessageToolsForRequest([memoryList], null).map((candidate) => candidate.name)).toEqual([
      "memory_list",
    ]);
  });
});
