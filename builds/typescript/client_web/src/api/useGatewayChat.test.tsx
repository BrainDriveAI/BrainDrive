import { act, renderHook, waitFor } from "@testing-library/react";

import type { ChatEvent } from "./types";
import { useGatewayChat } from "./useGatewayChat";

const sendMessageMock = vi.fn<
  (
    conversationId: string | null,
    content: string,
    options?: { signal?: AbortSignal; metadata?: Record<string, unknown> }
  ) => AsyncIterable<ChatEvent>
>();

const submitApprovalDecisionMock = vi.fn<
  (requestId: string, decision: "approved" | "denied") => Promise<{ request_id: string; decision: "approved" | "denied" }>
>();
const listSkillsMock = vi.fn<
  () => Promise<
    Array<{
      id: string;
      name: string;
      description: string;
      scope: "global";
      version: number;
      status: "active" | "archived";
      tags: string[];
      updated_at: string;
    }>
  >
>();
const getConversationSkillsMock = vi.fn<(conversationId: string) => Promise<string[]>>();
const updateConversationSkillsMock = vi.fn<
  (conversationId: string, skillIds: string[], source?: "ui" | "slash" | "nl" | "api") => Promise<string[]>
>();
const getProjectSkillsMock = vi.fn<(projectId: string) => Promise<string[]>>();
const updateProjectSkillsMock = vi.fn<
  (projectId: string, skillIds: string[], source?: "ui" | "slash" | "nl" | "api") => Promise<string[]>
>();

vi.mock("./gateway-adapter", () => ({
  sendMessage: (
    conversationId: string | null,
    content: string,
    options?: { signal?: AbortSignal; metadata?: Record<string, unknown> }
  ) => sendMessageMock(conversationId, content, options),
  submitApprovalDecision: (requestId: string, decision: "approved" | "denied") =>
    submitApprovalDecisionMock(requestId, decision),
  listSkills: () => listSkillsMock(),
  getConversationSkills: (conversationId: string) => getConversationSkillsMock(conversationId),
  updateConversationSkills: (
    conversationId: string,
    skillIds: string[],
    source?: "ui" | "slash" | "nl" | "api"
  ) => updateConversationSkillsMock(conversationId, skillIds, source),
  getProjectSkills: (projectId: string) => getProjectSkillsMock(projectId),
  updateProjectSkills: (projectId: string, skillIds: string[], source?: "ui" | "slash" | "nl" | "api") =>
    updateProjectSkillsMock(projectId, skillIds, source),
}));

async function* streamEvents(events: ChatEvent[]): AsyncIterable<ChatEvent> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

describe("useGatewayChat", () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    submitApprovalDecisionMock.mockReset();
    listSkillsMock.mockReset();
    getConversationSkillsMock.mockReset();
    updateConversationSkillsMock.mockReset();
    getProjectSkillsMock.mockReset();
    updateProjectSkillsMock.mockReset();
    submitApprovalDecisionMock.mockResolvedValue({
      request_id: "apr-default",
      decision: "approved",
    });
  });

  it("appends user and assistant messages while streaming", async () => {
    sendMessageMock.mockImplementation(() =>
      streamEvents([
        { type: "text-delta", delta: "Hello" },
        { type: "text-delta", delta: " world" },
        {
          type: "done",
          finish_reason: "stop",
          conversation_id: "conv-1"
        }
      ])
    );

    const { result } = renderHook(() => useGatewayChat());

    act(() => {
      result.current.append("Hi");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.conversationId).toBe("conv-1");
    expect(result.current.error).toBeNull();
    expect(result.current.messages).toEqual([
      { id: "message-1", role: "user", content: "Hi" },
      { id: "message-2", role: "assistant", content: "Hello world" }
    ]);
  });

  it("handles a stream that only emits done", async () => {
    sendMessageMock.mockImplementation(() =>
      streamEvents([
        {
          type: "done",
          finish_reason: "stop",
          conversation_id: "conv-2"
        }
      ])
    );

    const { result } = renderHook(() => useGatewayChat());

    act(() => {
      result.current.append("Hello");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.conversationId).toBe("conv-2");
    expect(result.current.messages).toEqual([
      { id: "message-1", role: "user", content: "Hello" }
    ]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces gateway error events", async () => {
    sendMessageMock.mockImplementation(() =>
      streamEvents([
        {
          type: "error",
          code: "provider_error",
          message: "Provider unavailable"
        }
      ])
    );

    const { result } = renderHook(() => useGatewayChat());

    act(() => {
      result.current.append("Hello");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error?.message).toBe("Provider unavailable");
    expect(result.current.messages).toEqual([
      { id: "message-1", role: "user", content: "Hello" }
    ]);
  });

  it("tracks pending approvals and resolves decisions", async () => {
    sendMessageMock.mockImplementation(() =>
      streamEvents([
        {
          type: "approval-request",
          request_id: "apr-1",
          tool_name: "memory_write",
          summary: "Write documents/plan.md",
        },
        {
          type: "done",
          finish_reason: "stop",
          conversation_id: "conv-3",
        },
      ])
    );
    submitApprovalDecisionMock.mockResolvedValue({
      request_id: "apr-1",
      decision: "approved",
    });

    const { result } = renderHook(() => useGatewayChat());

    act(() => {
      result.current.append("Please save this.");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.pendingApprovals).toEqual([
      {
        requestId: "apr-1",
        toolName: "memory_write",
        summary: "Write documents/plan.md",
        createdAt: expect.any(String),
      },
    ]);

    await act(async () => {
      await result.current.resolveApproval("apr-1", "approved");
    });

    expect(submitApprovalDecisionMock).toHaveBeenCalledWith("apr-1", "approved");
    expect(result.current.pendingApprovals).toEqual([]);
    expect(result.current.activity.some((item) => item.type === "approval-request")).toBe(true);
    expect(result.current.activity.some((item) => item.type === "approval-result")).toBe(true);
  });

  it("handles /skills slash command without invoking message streaming", async () => {
    listSkillsMock.mockResolvedValue([
      {
        id: "plan",
        name: "Plan",
        description: "Planning helper",
        scope: "global",
        version: 1,
        status: "active",
        tags: [],
        updated_at: "2026-03-24T00:00:00.000Z",
      },
    ]);

    const { result } = renderHook(() => useGatewayChat({ conversationId: "conv-1" }));

    act(() => {
      result.current.append("/skills");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([
      { id: "message-1", role: "user", content: "/skills" },
      {
        id: "message-2",
        role: "assistant",
        content: "Available skills:\n- plan: Plan",
      },
    ]);
  });

  it("maps /skill use to conversation skill bindings", async () => {
    getConversationSkillsMock.mockResolvedValue(["interview"]);
    updateConversationSkillsMock.mockResolvedValue(["interview", "plan"]);

    const { result } = renderHook(() => useGatewayChat({ conversationId: "conv-1" }));

    act(() => {
      result.current.append("/skill use plan");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(updateConversationSkillsMock).toHaveBeenCalledWith(
      "conv-1",
      ["interview", "plan"],
      "slash"
    );
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(result.current.messages[1]?.content).toBe("Conversation skills updated:\n- interview\n- plan");
  });

  it("maps /project-skill use to project skill bindings", async () => {
    getProjectSkillsMock.mockResolvedValue([]);
    updateProjectSkillsMock.mockResolvedValue(["plan"]);

    const { result } = renderHook(() => useGatewayChat({ projectId: "project-1" }));

    act(() => {
      result.current.append("/project-skill use plan");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(updateProjectSkillsMock).toHaveBeenCalledWith("project-1", ["plan"], "slash");
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(result.current.messages[1]?.content).toBe("Project skills updated:\n- plan");
  });
});
