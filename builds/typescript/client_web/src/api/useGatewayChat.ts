import { useEffect, useRef, useState } from "react";

import type { Message } from "@/types/ui";

import {
  getConversationSkills,
  getProjectSkills,
  listSkills,
  sendMessage,
  submitApprovalDecision,
  updateConversationSkills,
  updateProjectSkills,
} from "./gateway-adapter";
import type { ActivityEvent, ApprovalDecision, PendingApproval } from "./types";

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_ACTIVITY: ActivityEvent[] = [];
const EMPTY_APPROVALS: PendingApproval[] = [];
const MAX_ACTIVITY_EVENTS = 30;
const GATEWAY_CHAT_RUNTIME_RESET_EVENT = "braindrive:gateway-chat-runtime-reset";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

type ConversationState = {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  toolStatus: string | null;
  pendingApprovals: PendingApproval[];
  activity: ActivityEvent[];
  conversationId: string | null;
  abortController: AbortController | null;
  requestToken: number;
  messageCounter: number;
  activityCounter: number;
};

// Background conversation states — persists across hook re-renders
const backgroundStates = new Map<string, ConversationState>();

// Active background streams — update their cached state as events arrive
const backgroundStreams = new Map<string, { requestToken: number }>();

export function resetGatewayChatRuntime(): void {
  for (const state of backgroundStates.values()) {
    state.abortController?.abort();
  }

  backgroundStates.clear();
  backgroundStreams.clear();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GATEWAY_CHAT_RUNTIME_RESET_EVENT));
  }
}

type UseGatewayChatOptions = {
  conversationId?: string | null;
  projectId?: string | null;
  initialMessages?: Message[];
  draftKey?: string | null;
};

export function useGatewayChat(options: UseGatewayChatOptions = {}): {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  conversationId: string | null;
  toolStatus: string | null;
  pendingApprovals: PendingApproval[];
  activity: ActivityEvent[];
  append: (content: string, options?: { metadata?: Record<string, unknown> }) => void;
  resolveApproval: (requestId: string, decision: ApprovalDecision) => Promise<void>;
  stop: () => void;
} {
  const externalConversationId = options.conversationId ?? null;
  const externalProjectId = options.projectId ?? null;
  const externalMessages = options.initialMessages ?? EMPTY_MESSAGES;
  const draftKey = options.draftKey ?? null;

  // Use a project-scoped key for draft chats so separate projects do not share the same draft.
  const cacheKey = externalConversationId ?? (draftKey ? `__draft__:${draftKey}` : "__draft__");

  // Check if there's a background state for this conversation
  const cached = backgroundStates.get(cacheKey);

  const [messages, setMessages] = useState<Message[]>(cached?.messages ?? externalMessages);
  const [isLoading, setIsLoading] = useState(cached?.isLoading ?? false);
  const [error, setError] = useState<Error | null>(cached?.error ?? null);
  const [conversationId, setConversationId] = useState<string | null>(
    cached?.conversationId ?? externalConversationId
  );
  const [toolStatus, setToolStatus] = useState<string | null>(cached?.toolStatus ?? null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>(
    cached?.pendingApprovals ?? EMPTY_APPROVALS
  );
  const [activity, setActivity] = useState<ActivityEvent[]>(cached?.activity ?? EMPTY_ACTIVITY);

  const abortControllerRef = useRef<AbortController | null>(cached?.abortController ?? null);
  const requestTokenRef = useRef(cached?.requestToken ?? 0);
  const messageCounterRef = useRef(cached?.messageCounter ?? 0);
  const activityCounterRef = useRef(cached?.activityCounter ?? 0);
  const conversationIdRef = useRef<string | null>(cached?.conversationId ?? externalConversationId);
  const projectIdRef = useRef<string | null>(externalProjectId);
  const cacheKeyRef = useRef(cacheKey);

  useEffect(() => {
    projectIdRef.current = externalProjectId;
  }, [externalProjectId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleRuntimeReset() {
      requestTokenRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;

      setIsLoading(false);
      setError(null);
      setToolStatus(null);
      setPendingApprovals([]);
      setActivity([]);
    }

    window.addEventListener(GATEWAY_CHAT_RUNTIME_RESET_EVENT, handleRuntimeReset);
    return () => {
      window.removeEventListener(GATEWAY_CHAT_RUNTIME_RESET_EVENT, handleRuntimeReset);
    };
  }, []);

  // When conversation changes: save current state to background, restore new state
  useEffect(() => {
    const prevKey = cacheKeyRef.current;

    // Save current state to background cache (stream keeps running)
    if (prevKey !== cacheKey) {
      backgroundStates.set(prevKey, {
        messages: messages,
        isLoading,
        error,
        toolStatus,
        pendingApprovals,
        activity,
        conversationId,
        abortController: abortControllerRef.current,
        requestToken: requestTokenRef.current,
        messageCounter: messageCounterRef.current,
        activityCounter: activityCounterRef.current,
      });
    }

    cacheKeyRef.current = cacheKey;

    // Restore from cache if available, otherwise use external props
    const restored = backgroundStates.get(cacheKey);
    if (restored) {
      setMessages(restored.messages);
      setIsLoading(restored.isLoading);
      setError(restored.error);
      setToolStatus(restored.toolStatus);
      setPendingApprovals(restored.pendingApprovals);
      setActivity(restored.activity);
      setConversationId(restored.conversationId);
      abortControllerRef.current = restored.abortController;
      requestTokenRef.current = restored.requestToken;
      messageCounterRef.current = restored.messageCounter;
      activityCounterRef.current = restored.activityCounter;
      conversationIdRef.current = restored.conversationId;
      backgroundStates.delete(cacheKey);
    } else {
      setMessages(externalMessages);
      setIsLoading(false);
      setError(null);
      setToolStatus(null);
      setPendingApprovals([]);
      setActivity([]);
      setConversationId(externalConversationId);
      abortControllerRef.current = null;
      requestTokenRef.current = 0;
      messageCounterRef.current = 0;
      activityCounterRef.current = 0;
      conversationIdRef.current = externalConversationId;
    }
  }, [cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (
      externalConversationId !== null &&
      !isLoading &&
      messages.length === 0 &&
      externalMessages.length > 0
    ) {
      setMessages(externalMessages);
    }
  }, [externalConversationId, externalMessages, isLoading, messages.length]);

  function nextMessageId(): string {
    messageCounterRef.current += 1;
    return `message-${messageCounterRef.current}`;
  }

  function nextActivityId(): string {
    activityCounterRef.current += 1;
    return `activity-${activityCounterRef.current}`;
  }

  function updateConversationId(nextConversationId: string | undefined) {
    if (!nextConversationId) {
      return;
    }

    conversationIdRef.current = nextConversationId;
    setConversationId(nextConversationId);
  }

  function stop() {
    requestTokenRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  }

  async function resolveApproval(requestId: string, decision: ApprovalDecision): Promise<void> {
    await submitApprovalDecision(requestId, decision);
    setPendingApprovals((current) => current.filter((approval) => approval.requestId !== requestId));
    setToolStatus(`Approval ${decision}`);
    setActivity((current) =>
      appendActivity(current, {
        id: nextActivityId(),
        type: "approval-result",
        message: `Approval ${decision}`,
        createdAt: new Date().toISOString(),
        status: decision,
      })
    );
  }

  function append(content: string, options?: { metadata?: Record<string, unknown> }) {
    const trimmed = content.trim();
    if (trimmed === "") {
      return;
    }

    const slashCommand = parseSlashSkillCommand(trimmed);
    if (slashCommand) {
      const userMessage: Message = {
        id: nextMessageId(),
        role: "user",
        content: trimmed,
      };

      setError(null);
      setIsLoading(true);
      setToolStatus("Running slash command...");
      setMessages((current) => [...current, userMessage]);

      void (async () => {
        try {
          const responseText = await executeSlashSkillCommand(
            slashCommand,
            conversationIdRef.current,
            projectIdRef.current
          );
          const assistantMessage: Message = {
            id: nextMessageId(),
            role: "assistant",
            content: responseText,
          };
          setMessages((current) => [...current, assistantMessage]);
          setToolStatus(null);
        } catch (error) {
          setError(toError(error));
          setToolStatus(null);
        } finally {
          setIsLoading(false);
        }
      })();

      return;
    }

    requestTokenRef.current += 1;
    const requestToken = requestTokenRef.current;
    const activeCacheKey = cacheKeyRef.current;

    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const userMessage: Message = {
      id: nextMessageId(),
      role: "user",
      content: trimmed
    };
    const assistantMessageId = nextMessageId();

    setError(null);
    setIsLoading(true);
    setMessages((current) => [...current, userMessage]);

    // Track this as a background stream so state updates route correctly
    backgroundStreams.set(activeCacheKey, { requestToken });

    void (async () => {
      // Helper: update state either directly (if active) or in background cache
      function isActive() {
        return cacheKeyRef.current === activeCacheKey;
      }

      function updateBackground(updater: (state: ConversationState) => Partial<ConversationState>) {
        const bg = backgroundStates.get(activeCacheKey);
        if (bg) {
          Object.assign(bg, updater(bg));
        }
      }

      function recordActivity(entry: Omit<ActivityEvent, "id" | "createdAt">) {
        const nextEvent: ActivityEvent = {
          id: nextActivityId(),
          createdAt: new Date().toISOString(),
          ...entry,
        };

        if (isActive()) {
          setActivity((current) => appendActivity(current, nextEvent));
          return;
        }

        updateBackground((bg) => ({
          activity: appendActivity(bg.activity, nextEvent),
        }));
      }

      function addPendingApproval(approval: PendingApproval) {
        if (isActive()) {
          setPendingApprovals((current) => {
            if (current.some((entry) => entry.requestId === approval.requestId)) {
              return current;
            }
            return [...current, approval];
          });
          return;
        }

        updateBackground((bg) => {
          if (bg.pendingApprovals.some((entry) => entry.requestId === approval.requestId)) {
            return {};
          }
          return {
            pendingApprovals: [...bg.pendingApprovals, approval],
          };
        });
      }

      function removePendingApproval(requestId: string) {
        if (isActive()) {
          setPendingApprovals((current) =>
            current.filter((approval) => approval.requestId !== requestId)
          );
          return;
        }

        updateBackground((bg) => ({
          pendingApprovals: bg.pendingApprovals.filter(
            (approval) => approval.requestId !== requestId
          ),
        }));
      }

      const pendingToolCalls = new Map<string, string>();

      try {
        for await (const event of sendMessage(conversationIdRef.current, trimmed, {
          signal: controller.signal,
          metadata: options?.metadata
        })) {
          if (requestToken !== requestTokenRef.current && isActive()) {
            return;
          }

          // Check if this stream's conversation was backgrounded
          const bgStream = backgroundStreams.get(activeCacheKey);
          if (bgStream && bgStream.requestToken !== requestToken) {
            return; // superseded by a newer request
          }

          if (event.conversation_id) {
            if (isActive()) {
              updateConversationId(event.conversation_id);
            } else {
              updateBackground(() => ({ conversationId: event.conversation_id! }));
            }
          }

          switch (event.type) {
            case "text-delta":
              if (isActive()) {
                setToolStatus(null);
                setMessages((current) => {
                  const assistantIndex = current.findIndex(
                    (message) => message.id === assistantMessageId
                  );

                  if (assistantIndex === -1) {
                    return [
                      ...current,
                      {
                        id: assistantMessageId,
                        role: "assistant",
                        content: event.delta
                      }
                    ];
                  }

                  return current.map((message) =>
                    message.id === assistantMessageId
                      ? { ...message, content: `${message.content}${event.delta}` }
                      : message
                  );
                });
              } else {
                updateBackground((bg) => {
                  const existing = bg.messages.find((m) => m.id === assistantMessageId);
                  if (!existing) {
                    return {
                      toolStatus: null,
                      messages: [...bg.messages, { id: assistantMessageId, role: "assistant" as const, content: event.delta }]
                    };
                  }
                  return {
                    toolStatus: null,
                    messages: bg.messages.map((m) =>
                      m.id === assistantMessageId
                        ? { ...m, content: `${m.content}${event.delta}` }
                        : m
                    )
                  };
                });
              }
              break;
            case "done":
              if (isActive()) {
                setToolStatus(null);
                updateConversationId(event.conversation_id);
              } else {
                updateBackground(() => ({
                  toolStatus: null,
                  isLoading: false,
                  conversationId: event.conversation_id ?? null,
                }));
              }
              backgroundStreams.delete(activeCacheKey);
              return;
            case "error":
              if (isActive()) {
                setToolStatus(null);
                setError(new Error(event.message));
              } else {
                updateBackground(() => ({
                  toolStatus: null,
                  isLoading: false,
                  error: new Error(event.message),
                }));
              }
              backgroundStreams.delete(activeCacheKey);
              return;
            case "tool-call":
              pendingToolCalls.set(event.id, event.name);
              if (isActive()) {
                setToolStatus(event.name ?? null);
              } else {
                updateBackground(() => ({ toolStatus: event.name ?? null }));
              }
              recordActivity({
                type: "tool-call",
                message: `Requested ${humanizeToolName(event.name)}`,
              });
              break;
            case "tool-result":
              recordActivity({
                type: "tool-result",
                message: `${humanizeToolName(pendingToolCalls.get(event.id) ?? event.id)}: ${event.status}`,
                status: event.status,
              });
              break;
            case "approval-request":
              addPendingApproval({
                requestId: event.request_id,
                toolName: event.tool_name,
                summary: event.summary,
                createdAt: new Date().toISOString(),
              });
              recordActivity({
                type: "approval-request",
                message: `Approval required for ${humanizeToolName(event.tool_name)}`,
              });
              if (isActive()) {
                setToolStatus(`Approval required: ${event.tool_name}`);
              } else {
                updateBackground(() => ({ toolStatus: `Approval required: ${event.tool_name}` }));
              }
              break;
            case "approval-result":
              removePendingApproval(event.request_id);
              recordActivity({
                type: "approval-result",
                message: `Approval ${event.decision}`,
                status: event.decision,
              });
              if (isActive()) {
                setToolStatus(`Approval ${event.decision}`);
              } else {
                updateBackground(() => ({ toolStatus: `Approval ${event.decision}` }));
              }
              break;
          }
        }
      } catch (caughtError) {
        if (isAbortError(caughtError)) {
          return;
        }
        if (!isActive()) {
          updateBackground(() => ({
            isLoading: false,
            error: toError(caughtError),
          }));
          backgroundStreams.delete(activeCacheKey);
          return;
        }
        if (requestToken !== requestTokenRef.current) {
          return;
        }

        setError(toError(caughtError));
      } finally {
        backgroundStreams.delete(activeCacheKey);
        if (isActive() && requestToken === requestTokenRef.current) {
          if (abortControllerRef.current === controller) {
            abortControllerRef.current = null;
          }

          setIsLoading(false);
        }
      }
    })();
  }

  return {
    messages,
    isLoading,
    error,
    conversationId,
    toolStatus,
    pendingApprovals,
    activity,
    append,
    resolveApproval,
    stop
  };
}

function appendActivity(current: ActivityEvent[], next: ActivityEvent): ActivityEvent[] {
  const withNext = [...current, next];
  if (withNext.length <= MAX_ACTIVITY_EVENTS) {
    return withNext;
  }
  return withNext.slice(withNext.length - MAX_ACTIVITY_EVENTS);
}

function humanizeToolName(toolName: string): string {
  return toolName.replace(/_/g, " ");
}

type SlashSkillCommand =
  | { type: "list-skills" }
  | { type: "conversation-list" }
  | { type: "conversation-add"; skillId: string }
  | { type: "conversation-remove"; skillId: string }
  | { type: "project-list" }
  | { type: "project-add"; skillId: string }
  | { type: "project-remove"; skillId: string };

function parseSlashSkillCommand(input: string): SlashSkillCommand | null {
  const value = input.trim();
  if (!value.startsWith("/")) {
    return null;
  }

  if (value === "/skills") {
    return { type: "list-skills" };
  }

  const tokens = value.split(/\s+/);
  const command = (tokens[0] ?? "").toLowerCase();
  const action = (tokens[1] ?? "").toLowerCase();
  const skillId = (tokens[2] ?? "").trim().toLowerCase();

  if (command === "/skill") {
    if (action === "list") {
      return { type: "conversation-list" };
    }
    if ((action === "use" || action === "add" || action === "activate") && skillId) {
      return { type: "conversation-add", skillId };
    }
    if ((action === "remove" || action === "deactivate") && skillId) {
      return { type: "conversation-remove", skillId };
    }
    return null;
  }

  if (command === "/project-skill") {
    if (action === "list") {
      return { type: "project-list" };
    }
    if ((action === "use" || action === "add" || action === "activate") && skillId) {
      return { type: "project-add", skillId };
    }
    if ((action === "remove" || action === "deactivate") && skillId) {
      return { type: "project-remove", skillId };
    }
    return null;
  }

  return null;
}

async function executeSlashSkillCommand(
  command: SlashSkillCommand,
  conversationId: string | null,
  projectId: string | null
): Promise<string> {
  switch (command.type) {
    case "list-skills": {
      const skills = await listSkills();
      if (skills.length === 0) {
        return "No skills are available yet.";
      }
      return `Available skills:\n${skills.map((skill) => `- ${skill.id}: ${skill.name}`).join("\n")}`;
    }
    case "conversation-list": {
      if (!conversationId) {
        return "No active conversation yet. Start a conversation first, then run /skill list.";
      }
      const skillIds = await getConversationSkills(conversationId);
      if (skillIds.length === 0) {
        return "No skills are active for this conversation.";
      }
      return `Conversation skills:\n${skillIds.map((skillId) => `- ${skillId}`).join("\n")}`;
    }
    case "conversation-add": {
      if (!conversationId) {
        return "No active conversation yet. Start a conversation first, then run /skill use <skill-id>.";
      }
      const current = await getConversationSkills(conversationId);
      const next = dedupeStrings([...current, command.skillId]);
      const updated = await updateConversationSkills(conversationId, next, "slash");
      return `Conversation skills updated:\n${updated.map((skillId) => `- ${skillId}`).join("\n")}`;
    }
    case "conversation-remove": {
      if (!conversationId) {
        return "No active conversation yet. Start a conversation first, then run /skill remove <skill-id>.";
      }
      const current = await getConversationSkills(conversationId);
      const next = current.filter((skillId) => skillId !== command.skillId);
      const updated = await updateConversationSkills(conversationId, next, "slash");
      if (updated.length === 0) {
        return "Conversation skills cleared.";
      }
      return `Conversation skills updated:\n${updated.map((skillId) => `- ${skillId}`).join("\n")}`;
    }
    case "project-list": {
      if (!projectId) {
        return "No active project selected. Select a project first, then run /project-skill list.";
      }
      const skillIds = await getProjectSkills(projectId);
      if (skillIds.length === 0) {
        return "No default skills are set for this project.";
      }
      return `Project skills:\n${skillIds.map((skillId) => `- ${skillId}`).join("\n")}`;
    }
    case "project-add": {
      if (!projectId) {
        return "No active project selected. Select a project first, then run /project-skill use <skill-id>.";
      }
      const current = await getProjectSkills(projectId);
      const next = dedupeStrings([...current, command.skillId]);
      const updated = await updateProjectSkills(projectId, next, "slash");
      return `Project skills updated:\n${updated.map((skillId) => `- ${skillId}`).join("\n")}`;
    }
    case "project-remove": {
      if (!projectId) {
        return "No active project selected. Select a project first, then run /project-skill remove <skill-id>.";
      }
      const current = await getProjectSkills(projectId);
      const next = current.filter((skillId) => skillId !== command.skillId);
      const updated = await updateProjectSkills(projectId, next, "slash");
      if (updated.length === 0) {
        return "Project skills cleared.";
      }
      return `Project skills updated:\n${updated.map((skillId) => `- ${skillId}`).join("\n")}`;
    }
  }
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}
