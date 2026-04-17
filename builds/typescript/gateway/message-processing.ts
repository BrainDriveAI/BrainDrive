import type { GatewayAdapter } from "../adapters/gateway-base.js";
import { createModelAdapter, resolveAdapterConfigForPreferences } from "../adapters/index.js";
import { loadPreferences } from "../config.js";
import type {
  AdapterConfig,
  AuthContext,
  ClientMessageRequest,
  GatewayEngineRequest,
  RuntimeConfig,
  StreamEvent,
} from "../contracts.js";
import { ApprovalStore } from "../engine/approval-store.js";
import { classifyProviderError } from "../engine/errors.js";
import { runAgentLoop } from "../engine/loop.js";
import { ToolExecutor } from "../engine/tool-executor.js";
import { auditLog } from "../logger.js";
import { resolveProviderCredentialForStartup } from "../secrets/resolver.js";
import { prepareContextWindow, type ContextWindowWarning } from "./context-window.js";
import { GatewayConversationService } from "./conversations.js";
import { GatewayProjectService, isProjectMetadata } from "./projects.js";
import { GatewaySkillService } from "./skills.js";

export class ConversationNotFoundError extends Error {
  readonly code = "conversation_not_found";

  constructor(readonly conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

export type GatewayPreparedConversationTurn = {
  conversationId: string;
  authContext: AuthContext;
  engineRequest: GatewayEngineRequest;
  contextWindowWarning: ContextWindowWarning | null;
};

export type GatewayRunConversationTurnResult = {
  conversationId: string;
  lastAssistantMessageId: string | null;
  lastAssistantMessageContent: string | null;
  errorEvent: StreamEvent | null;
};

export type GatewayMessageProcessingEventContext = {
  conversationId: string;
  messageId: string;
};

export type GatewayMessageProcessingServiceOptions = {
  runtimeConfig: RuntimeConfig;
  adapterConfig: AdapterConfig;
  gatewayAdapter: GatewayAdapter;
  conversations: GatewayConversationService;
  projects: GatewayProjectService;
  skills: GatewaySkillService;
  approvalStore: ApprovalStore;
  toolExecutor: ToolExecutor;
  systemPrompt: string;
};

export class GatewayMessageProcessingService {
  private readonly runtimeConfig: RuntimeConfig;
  private readonly adapterConfig: AdapterConfig;
  private readonly gatewayAdapter: GatewayAdapter;
  private readonly conversations: GatewayConversationService;
  private readonly projects: GatewayProjectService;
  private readonly skills: GatewaySkillService;
  private readonly approvalStore: ApprovalStore;
  private readonly toolExecutor: ToolExecutor;
  private readonly systemPrompt: string;

  constructor(options: GatewayMessageProcessingServiceOptions) {
    this.runtimeConfig = options.runtimeConfig;
    this.adapterConfig = options.adapterConfig;
    this.gatewayAdapter = options.gatewayAdapter;
    this.conversations = options.conversations;
    this.projects = options.projects;
    this.skills = options.skills;
    this.approvalStore = options.approvalStore;
    this.toolExecutor = options.toolExecutor;
    this.systemPrompt = options.systemPrompt;
  }

  async prepareConversationTurn(input: {
    requestedConversationId?: string;
    message: ClientMessageRequest;
    authContext: AuthContext;
  }): Promise<GatewayPreparedConversationTurn> {
    if (
      input.requestedConversationId &&
      !this.conversations.hasConversation(input.requestedConversationId)
    ) {
      throw new ConversationNotFoundError(input.requestedConversationId);
    }

    const body = normalizeCanonicalMessage(input.message);
    const { conversationId } = this.conversations.persistUserMessage(input.requestedConversationId, body);
    const projectId = isProjectMetadata(body.metadata) ? body.metadata.project.trim() : null;

    if (projectId) {
      await this.projects.attachConversation(projectId, conversationId);
    }

    const conversationSkillIds = this.conversations.getConversationSkills(conversationId) ?? [];
    const projectSkillIds = projectId ? (await this.projects.getProjectSkills(projectId)) ?? [] : [];
    const promptWithSkills = await this.skills.composePromptWithSkills(this.systemPrompt, [
      ...projectSkillIds,
      ...conversationSkillIds,
    ]);

    auditLog("skills.apply", {
      conversation_id: conversationId,
      project_id: projectId,
      applied_skill_ids: promptWithSkills.applied,
      missing_skill_ids: promptWithSkills.missing,
      truncated: promptWithSkills.truncated,
    });

    const projectContext = projectId
      ? `\n\n## Active Project\n\nYou are currently in the **${projectId}** project. Read this project's AGENT.md, spec.md, and plan.md from the documents/${projectId}/ folder. Stay focused on this domain — do not read or reference other projects unless the conversation specifically calls for cross-domain connections.`
      : "";
    const finalPrompt = promptWithSkills.prompt + projectContext;

    const correlationId = crypto.randomUUID();
    const contextWindow = await prepareContextWindow({
      memoryRoot: this.runtimeConfig.memory_root,
      conversationId,
      correlationId,
      messages: this.conversations.buildConversationMessages(conversationId, finalPrompt),
      tools: this.toolExecutor.listTools(input.authContext),
    });

    auditLog("context.window", {
      conversation_id: conversationId,
      estimated_prompt_tokens_before: contextWindow.usage.estimatedPromptTokensBefore,
      estimated_prompt_tokens_after: contextWindow.usage.estimatedPromptTokensAfter,
      budget_tokens: contextWindow.usage.budgetTokens,
      ratio_before: Number(contextWindow.usage.ratioBefore.toFixed(3)),
      ratio_after: Number(contextWindow.usage.ratioAfter.toFixed(3)),
      warning_threshold: contextWindow.usage.threshold,
      dropped_units: contextWindow.usage.droppedUnits,
      dropped_messages: contextWindow.usage.droppedMessages,
      summary_applied: contextWindow.usage.summaryApplied,
      summary_artifact_path: contextWindow.usage.summaryArtifactPath,
      summary_artifact_write_error: contextWindow.usage.summaryArtifactWriteError,
    });

    const engineRequest = this.gatewayAdapter.buildEngineRequest({
      conversationId,
      correlationId,
      messages: contextWindow.messages,
      ...(body.metadata ? { clientMetadata: body.metadata } : {}),
    });

    return {
      conversationId,
      authContext: input.authContext,
      engineRequest,
      contextWindowWarning: contextWindow.warning,
    };
  }

  async runPreparedConversationTurn(
    prepared: GatewayPreparedConversationTurn,
    options: {
      onEvent?: (
        event: StreamEvent,
        context: GatewayMessageProcessingEventContext
      ) => void | Promise<void>;
    } = {}
  ): Promise<GatewayRunConversationTurnResult> {
    let assistantBuffer = "";
    let currentAssistantMessageId = crypto.randomUUID();
    let lastPersistedAssistantMessageId: string | null = null;
    let lastPersistedAssistantContent: string | null = null;
    const pendingToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>();

    try {
      const livePreferences = await loadPreferences(this.runtimeConfig.memory_root);
      const liveAdapterConfig = resolveAdapterConfigForPreferences(this.adapterConfig, livePreferences);
      const liveProviderCredential = await resolveProviderCredentialForStartup(
        this.runtimeConfig.provider_adapter,
        liveAdapterConfig,
        livePreferences
      );
      if (liveProviderCredential) {
        auditLog("secret.resolve", {
          provider_id: liveProviderCredential.providerId,
          provider_profile:
            livePreferences.active_provider_profile ?? this.adapterConfig.default_provider_profile,
          source: liveProviderCredential.source,
          secret_ref: liveProviderCredential.secretRef,
        });
      }

      const modelAdapter = createModelAdapter(
        this.runtimeConfig.provider_adapter,
        liveAdapterConfig,
        livePreferences,
        {
          apiKey: liveProviderCredential?.apiKey,
        }
      );

      for await (const event of runAgentLoop(
        modelAdapter,
        this.toolExecutor,
        this.approvalStore,
        prepared.engineRequest,
        prepared.authContext,
        {
          memoryRoot: this.runtimeConfig.memory_root,
          approvalMode: livePreferences.approval_mode,
          safetyIterationLimit: this.runtimeConfig.safety_iteration_limit,
        }
      )) {
        if (event.type === "tool-call") {
          pendingToolCalls.set(event.id, {
            name: event.name,
            input: event.input,
          });
        }

        if (event.type === "text-delta") {
          assistantBuffer += event.delta;
        }

        if (event.type === "tool-result") {
          const toolCall = pendingToolCalls.get(event.id);
          pendingToolCalls.delete(event.id);

          if (assistantBuffer.trim().length > 0) {
            this.conversations.appendAssistantMessage(
              prepared.conversationId,
              currentAssistantMessageId,
              assistantBuffer
            );
            lastPersistedAssistantMessageId = currentAssistantMessageId;
            lastPersistedAssistantContent = assistantBuffer;
            assistantBuffer = "";
            currentAssistantMessageId = crypto.randomUUID();
          }

          this.conversations.appendToolMessage(
            prepared.conversationId,
            event.id,
            JSON.stringify({
              status: event.status,
              output: event.output,
            }),
            toolCall
          );
        }

        const messageId = lastPersistedAssistantMessageId ?? currentAssistantMessageId;
        const outgoingEvent = this.gatewayAdapter.toClientStreamEvent(event, {
          conversationId: prepared.conversationId,
          messageId,
        });
        await options.onEvent?.(outgoingEvent, {
          conversationId: prepared.conversationId,
          messageId,
        });
      }

      if (assistantBuffer.trim().length > 0) {
        this.conversations.appendAssistantMessage(
          prepared.conversationId,
          currentAssistantMessageId,
          assistantBuffer
        );
        lastPersistedAssistantMessageId = currentAssistantMessageId;
        lastPersistedAssistantContent = assistantBuffer;
      }
    } catch (error) {
      auditLog("gateway.error", {
        conversation_id: prepared.conversationId,
        message: error instanceof Error ? error.message : "Unknown error",
      });

      const classifiedError = classifyProviderError(error);
      await options.onEvent?.(classifiedError, {
        conversationId: prepared.conversationId,
        messageId: lastPersistedAssistantMessageId ?? currentAssistantMessageId,
      });

      return {
        conversationId: prepared.conversationId,
        lastAssistantMessageId: lastPersistedAssistantMessageId,
        lastAssistantMessageContent: lastPersistedAssistantContent,
        errorEvent: classifiedError,
      };
    }

    return {
      conversationId: prepared.conversationId,
      lastAssistantMessageId: lastPersistedAssistantMessageId,
      lastAssistantMessageContent: lastPersistedAssistantContent,
      errorEvent: null,
    };
  }
}

function normalizeCanonicalMessage(message: ClientMessageRequest): ClientMessageRequest {
  return {
    content: message.content,
    ...(message.metadata ? { metadata: message.metadata } : {}),
  };
}
