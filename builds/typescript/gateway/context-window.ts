import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import type { GatewayMessage, ToolDefinition } from "../contracts.js";

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const DEFAULT_RESPONSE_HEADROOM_TOKENS = 8_000;
const DEFAULT_WARNING_THRESHOLD = 0.8;
const MIN_MESSAGE_BUDGET_TOKENS = 2_048;
const SUMMARY_MAX_LINES = 24;

const MAX_CONTENT_CHARS: Record<GatewayMessage["role"], number> = {
  system: 24_000,
  user: 8_000,
  assistant: 12_000,
  tool: 4_000,
};

type ContextUnit = {
  messages: GatewayMessage[];
  estimatedTokens: number;
};

export type ContextWindowSettings = {
  contextWindowTokens: number;
  responseHeadroomTokens: number;
  warningThreshold: number;
};

export type ContextWindowWarning = {
  estimated_tokens: number;
  budget_tokens: number;
  ratio: number;
  threshold: number;
  managed: boolean;
  message: string;
};

export type ContextWindowUsage = {
  estimatedPromptTokensBefore: number;
  estimatedPromptTokensAfter: number;
  budgetTokens: number;
  ratioBefore: number;
  ratioAfter: number;
  threshold: number;
  droppedUnits: number;
  droppedMessages: number;
  summaryApplied: boolean;
  summaryArtifactPath: string | null;
  summaryArtifactWriteError: string | null;
};

export type PreparedContextWindow = {
  messages: GatewayMessage[];
  usage: ContextWindowUsage;
  warning: ContextWindowWarning | null;
};

export type PrepareContextWindowInput = {
  memoryRoot: string;
  conversationId: string;
  correlationId: string;
  messages: GatewayMessage[];
  tools: ToolDefinition[];
  settings?: Partial<ContextWindowSettings>;
};

export function resolveContextWindowSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ContextWindowSettings {
  return {
    contextWindowTokens:
      parsePositiveInteger(env.BRAINDRIVE_CONTEXT_WINDOW_TOKENS) ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    responseHeadroomTokens:
      parsePositiveInteger(env.BRAINDRIVE_CONTEXT_RESPONSE_HEADROOM_TOKENS) ??
      DEFAULT_RESPONSE_HEADROOM_TOKENS,
    warningThreshold: parseRatio(env.BRAINDRIVE_CONTEXT_WARNING_THRESHOLD) ?? DEFAULT_WARNING_THRESHOLD,
  };
}

export async function prepareContextWindow(input: PrepareContextWindowInput): Promise<PreparedContextWindow> {
  const settings = {
    ...resolveContextWindowSettingsFromEnv(),
    ...(input.settings ?? {}),
  };

  if (input.messages.length === 0) {
    return {
      messages: [],
      usage: {
        estimatedPromptTokensBefore: 0,
        estimatedPromptTokensAfter: 0,
        budgetTokens: settings.contextWindowTokens,
        ratioBefore: 0,
        ratioAfter: 0,
        threshold: settings.warningThreshold,
        droppedUnits: 0,
        droppedMessages: 0,
        summaryApplied: false,
        summaryArtifactPath: null,
        summaryArtifactWriteError: null,
      },
      warning: null,
    };
  }

  const boundedMessages = input.messages.map((message) => boundedMessage(message));
  const toolTokens = estimateToolDefinitionTokens(input.tools);
  const promptBudgetTokens = Math.max(
    MIN_MESSAGE_BUDGET_TOKENS,
    settings.contextWindowTokens - settings.responseHeadroomTokens
  );
  const messageBudgetTokens = Math.max(MIN_MESSAGE_BUDGET_TOKENS, promptBudgetTokens - toolTokens);

  const estimatedPromptTokensBefore = estimateMessagesTokens(boundedMessages) + toolTokens;
  const ratioBefore = safeRatio(estimatedPromptTokensBefore, promptBudgetTokens);

  const fallbackSystemMessage: GatewayMessage = { role: "system", content: "" };
  const systemMessage: GatewayMessage =
    boundedMessages[0]?.role === "system" ? boundedMessages[0] : fallbackSystemMessage;
  const replayMessages = boundedMessages[0]?.role === "system" ? boundedMessages.slice(1) : boundedMessages;
  const replayUnits = buildReplayUnits(replayMessages);

  const selectedUnits: ContextUnit[] = [];
  const droppedUnits: ContextUnit[] = [];
  let usedTokens = estimateMessageTokens(systemMessage);

  for (let index = replayUnits.length - 1; index >= 0; index -= 1) {
    const unit = replayUnits[index];
    const wouldExceed = usedTokens + unit.estimatedTokens > messageBudgetTokens;
    if (!wouldExceed || selectedUnits.length === 0) {
      selectedUnits.unshift(unit);
      usedTokens += unit.estimatedTokens;
      continue;
    }

    droppedUnits.unshift(unit);
  }

  let summaryLines = droppedUnits.length > 0 ? buildSummaryLines(droppedUnits) : [];
  let summaryMessage = summaryLines.length > 0 ? buildSummaryMessage(summaryLines) : null;

  const rebuildMessages = (): GatewayMessage[] => {
    const replay = flattenUnits(selectedUnits);
    return [
      systemMessage,
      ...(summaryMessage ? [summaryMessage] : []),
      ...replay,
    ];
  };

  let managedMessages = rebuildMessages();
  let managedMessageTokens = estimateMessagesTokens(managedMessages);

  while (summaryLines.length > 1 && managedMessageTokens > messageBudgetTokens) {
    summaryLines = summaryLines.slice(0, Math.max(1, summaryLines.length - 2));
    summaryMessage = buildSummaryMessage(summaryLines);
    managedMessages = rebuildMessages();
    managedMessageTokens = estimateMessagesTokens(managedMessages);
  }

  while (managedMessageTokens > messageBudgetTokens && selectedUnits.length > 1) {
    const removed = selectedUnits.shift();
    if (removed) {
      droppedUnits.push(removed);
    }

    summaryLines = buildSummaryLines(droppedUnits);
    summaryMessage = buildSummaryMessage(summaryLines);
    managedMessages = rebuildMessages();
    managedMessageTokens = estimateMessagesTokens(managedMessages);

    while (summaryLines.length > 1 && managedMessageTokens > messageBudgetTokens) {
      summaryLines = summaryLines.slice(0, Math.max(1, summaryLines.length - 2));
      summaryMessage = buildSummaryMessage(summaryLines);
      managedMessages = rebuildMessages();
      managedMessageTokens = estimateMessagesTokens(managedMessages);
    }
  }

  if (managedMessageTokens > messageBudgetTokens) {
    managedMessages = aggressivelyTrimForBudget(managedMessages, messageBudgetTokens);
    managedMessageTokens = estimateMessagesTokens(managedMessages);
  }

  const summaryApplied = droppedUnits.length > 0 && summaryMessage !== null;

  let summaryArtifactPath: string | null = null;
  let summaryArtifactWriteError: string | null = null;
  if (droppedUnits.length > 0 && summaryMessage) {
    try {
      summaryArtifactPath = await writeSummaryArtifact({
        memoryRoot: input.memoryRoot,
        conversationId: input.conversationId,
        correlationId: input.correlationId,
        summaryContent: summaryMessage.content,
        droppedUnits,
        estimatedPromptTokensBefore,
        estimatedPromptTokensAfter: managedMessageTokens + toolTokens,
        budgetTokens: promptBudgetTokens,
      });
    } catch (error) {
      summaryArtifactWriteError = error instanceof Error ? error.message : String(error);
    }
  }

  const estimatedPromptTokensAfter = managedMessageTokens + toolTokens;
  const ratioAfter = safeRatio(estimatedPromptTokensAfter, promptBudgetTokens);
  const droppedMessages = droppedUnits.reduce((count, unit) => count + unit.messages.length, 0);

  const warningNeeded = ratioBefore >= settings.warningThreshold || droppedUnits.length > 0;
  const warning: ContextWindowWarning | null = warningNeeded
    ? {
        estimated_tokens: estimatedPromptTokensBefore,
        budget_tokens: promptBudgetTokens,
        ratio: roundTo(ratioBefore, 3),
        threshold: settings.warningThreshold,
        managed: summaryApplied,
        message: summaryApplied
          ? "This session is getting long. Earlier turns were compacted so you can keep chatting."
          : "This session is getting long. Consider starting a new conversation soon.",
      }
    : null;

  return {
    messages: managedMessages,
    usage: {
      estimatedPromptTokensBefore,
      estimatedPromptTokensAfter,
      budgetTokens: promptBudgetTokens,
      ratioBefore,
      ratioAfter,
      threshold: settings.warningThreshold,
      droppedUnits: droppedUnits.length,
      droppedMessages,
      summaryApplied,
      summaryArtifactPath,
      summaryArtifactWriteError,
    },
    warning,
  };
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseRatio(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    return null;
  }

  return parsed;
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function roundTo(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function estimateTokens(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  return Math.ceil(value.length / 4);
}

function estimateMessageTokens(message: GatewayMessage): number {
  const toolCallsTokens = message.tool_calls ? estimateTokens(JSON.stringify(message.tool_calls)) : 0;
  const toolCallIdTokens = message.tool_call_id ? estimateTokens(message.tool_call_id) : 0;
  return 6 + estimateTokens(message.content) + toolCallsTokens + toolCallIdTokens;
}

function estimateMessagesTokens(messages: GatewayMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function estimateToolDefinitionTokens(tools: ToolDefinition[]): number {
  const serializable = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  return estimateTokens(JSON.stringify(serializable));
}

function boundedMessage(message: GatewayMessage): GatewayMessage {
  const maxChars = MAX_CONTENT_CHARS[message.role] ?? 8_000;
  const boundedContent = truncateMiddle(message.content, maxChars);
  return {
    ...message,
    content: boundedContent,
  };
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const marker = `\n...[truncated ${value.length - maxChars} chars for context budget]...\n`;
  const remaining = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(remaining * 0.65);
  const tail = Math.max(0, remaining - head);
  return `${value.slice(0, head)}${marker}${value.slice(value.length - tail)}`;
}

function buildReplayUnits(messages: GatewayMessage[]): ContextUnit[] {
  const units: ContextUnit[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
      const unitMessages: GatewayMessage[] = [message];
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor]?.role === "tool") {
        unitMessages.push(messages[cursor]);
        cursor += 1;
      }

      units.push({
        messages: unitMessages,
        estimatedTokens: estimateMessagesTokens(unitMessages),
      });
      index = cursor - 1;
      continue;
    }

    units.push({
      messages: [message],
      estimatedTokens: estimateMessageTokens(message),
    });
  }

  return units;
}

function flattenUnits(units: ContextUnit[]): GatewayMessage[] {
  return units.flatMap((unit) => unit.messages);
}

function buildSummaryLines(units: ContextUnit[]): string[] {
  const lines: string[] = [];

  for (const unit of units) {
    for (const message of unit.messages) {
      if (message.role === "tool") {
        continue;
      }

      if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
        const names = message.tool_calls.map((toolCall) => toolCall.name).join(", ");
        lines.push(`- Assistant requested tools: ${names}`);
      }

      const snippet = compactSnippet(message.content);
      if (snippet.length === 0) {
        continue;
      }

      if (message.role === "user") {
        lines.push(`- User: ${snippet}`);
      } else if (message.role === "assistant") {
        lines.push(`- Assistant: ${snippet}`);
      }

      if (lines.length >= SUMMARY_MAX_LINES) {
        return lines;
      }
    }

    if (lines.length >= SUMMARY_MAX_LINES) {
      return lines;
    }
  }

  if (lines.length === 0) {
    lines.push("- Earlier turns were compressed to keep this session within context limits.");
  }

  return lines.slice(0, SUMMARY_MAX_LINES);
}

function compactSnippet(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return "";
  }

  return cleaned.length <= 180 ? cleaned : `${cleaned.slice(0, 180)}...`;
}

function buildSummaryMessage(lines: string[]): GatewayMessage {
  return {
    role: "system",
    content: [
      "Earlier conversation summary (auto-generated to keep this session running):",
      ...lines,
      "Use this summary as prior context for continuity.",
    ].join("\n"),
  };
}

function aggressivelyTrimForBudget(messages: GatewayMessage[], budgetTokens: number): GatewayMessage[] {
  const caps = [2_000, 1_200, 700, 400];
  let candidate = [...messages];

  for (const cap of caps) {
    candidate = candidate.map((message, index) => {
      if (index === 0 && message.role === "system") {
        return { ...message, content: truncateMiddle(message.content, Math.max(cap * 2, cap)) };
      }

      return {
        ...message,
        content: truncateMiddle(message.content, cap),
      };
    });

    if (estimateMessagesTokens(candidate) <= budgetTokens) {
      return candidate;
    }
  }

  while (candidate.length > 2 && estimateMessagesTokens(candidate) > budgetTokens) {
    candidate = [candidate[0], ...candidate.slice(2)];
  }

  return candidate;
}

async function writeSummaryArtifact(input: {
  memoryRoot: string;
  conversationId: string;
  correlationId: string;
  summaryContent: string;
  droppedUnits: ContextUnit[];
  estimatedPromptTokensBefore: number;
  estimatedPromptTokensAfter: number;
  budgetTokens: number;
}): Promise<string> {
  const safeConversationId = sanitizePathSegment(input.conversationId);
  const safeCorrelationId = sanitizePathSegment(input.correlationId);
  const relativePath = path.posix.join("conversations", "summaries", safeConversationId, `${safeCorrelationId}.md`);
  const absolutePath = path.join(input.memoryRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });

  const digest = createHash("sha256").update(input.summaryContent).digest("hex");
  const artifact = [
    "# Context Summary Artifact",
    "",
    `Conversation ID: ${input.conversationId}`,
    `Correlation ID: ${input.correlationId}`,
    `Generated At: ${new Date().toISOString()}`,
    "",
    "## Budget",
    `- Prompt tokens before management: ${input.estimatedPromptTokensBefore}`,
    `- Prompt tokens after management: ${input.estimatedPromptTokensAfter}`,
    `- Prompt budget tokens: ${input.budgetTokens}`,
    "",
    "## Compression",
    `- Dropped context units: ${input.droppedUnits.length}`,
    `- Dropped messages: ${input.droppedUnits.reduce((count, unit) => count + unit.messages.length, 0)}`,
    `- Summary digest (sha256): ${digest}`,
    "",
    "## Summary Text",
    input.summaryContent,
    "",
  ].join("\n");

  await writeFile(absolutePath, artifact, "utf8");
  return relativePath;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
