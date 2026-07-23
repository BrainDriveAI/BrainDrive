import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AdapterConfig,
  Preferences,
  RuntimeConfig,
  ToolDefinition,
} from "../contracts.js";
import {
  PROCESS_GUARDRAIL_PROCESS_KIND,
  parseProcessGuardrailState,
} from "../engine/process-guardrails/state-machine.js";
import { artifactContractFor } from "../engine/process-guardrails/process-definition.js";

let mockRuntimeConfig: RuntimeConfig;
let mockPreferences: Preferences;
let mockAdapterConfig: AdapterConfig;
let providerScript: (
  body: ProviderRequestBody,
  call: number
) => ProviderResponse = () => textResponse("Normal response.");
let providerCalls: ProviderRequestBody[] = [];

type ProviderRequestBody = {
  messages: Array<{ role: string; content?: string }>;
  tools: Array<{ function: { name: string } }>;
};

type ProviderResponse = {
  text?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  status?: number;
};

vi.mock("../config.js", () => ({
  loadRuntimeConfig: vi.fn(async () => mockRuntimeConfig),
  loadAdapterConfig: vi.fn(async () => mockAdapterConfig),
  loadPreferences: vi.fn(async () => mockPreferences),
  savePreferences: vi.fn(async (_memoryRoot: string, next: Preferences) => {
    mockPreferences = next;
  }),
  ensureMemoryLayout: vi.fn(async () => {}),
  ensureSystemAppConfig: vi.fn(async () => ({
    path: "/tmp/app-config.json",
    backupPath: "/tmp/app-config.bak.json",
    installMode: "local",
    installLocation: "local",
    updated: false,
  })),
  readBootstrapPrompt: vi.fn(async () => "System safety."),
}));

vi.mock("../git.js", () => ({
  ensureGitReady: vi.fn(async () => {}),
  commitMemoryChange: vi.fn(async () => {}),
  exportMemoryArchive: vi.fn(async () => {}),
}));

vi.mock("../secrets/resolver.js", () => ({
  resolveProviderCredentialForStartup: vi.fn(async () => null),
}));

vi.mock("../memory/backup.js", () => ({
  runMemoryBackup: vi.fn(async () => ({
    attempted_at: "2026-07-23T00:00:00.000Z",
    result: "success",
  })),
}));

vi.mock("../memory/backup-restore.js", () => ({
  restoreMemoryBackup: vi.fn(async () => ({
    attempted_at: "2026-07-23T00:00:00.000Z",
    restored_at: "2026-07-23T00:00:01.000Z",
    commit: "test",
    source_branch: "test",
    warnings: [],
  })),
}));

vi.mock("./memory-backup-scheduler.js", () => ({
  createMemoryBackupScheduler: vi.fn(() => ({
    initialize: vi.fn(async () => {}),
    reconfigure: vi.fn(async () => {}),
    close: vi.fn(),
    triggerManualBackup: vi.fn(async () => ({
      result: {
        attempted_at: "2026-07-23T00:00:00.000Z",
        result: "success",
      },
      preferences: mockPreferences,
    })),
  })),
}));

vi.mock("../tools.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tools.js")>();
  return {
    ...actual,
    discoverTools: vi.fn(async () => [memoryWriteTool, memoryEditTool]),
  };
});

const memoryWriteTool: ToolDefinition = {
  name: "memory_write",
  description: "Write a memory file",
  requiresApproval: false,
  readOnly: false,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  execute: async (context, input) => {
    const target = path.join(context.memoryRoot, String(input.path));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, String(input.content), "utf8");
    return { path: input.path };
  },
};

const memoryEditTool: ToolDefinition = {
  name: "memory_edit",
  description: "Edit a memory file",
  requiresApproval: false,
  readOnly: false,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      find: { type: "string" },
      replace: { type: "string" },
    },
    required: ["path", "find", "replace"],
  },
  execute: async (context, input) => {
    const target = path.join(context.memoryRoot, String(input.path));
    const current = await readFile(target, "utf8");
    await writeFile(
      target,
      current.replace(String(input.find), String(input.replace)),
      "utf8"
    );
    return { path: input.path };
  },
};

import { buildServer } from "./server.js";

type TestContext = {
  app: Awaited<ReturnType<typeof buildServer>>["app"];
  tempRoot: string;
  memoryRoot: string;
};

let contexts: TestContext[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const context of contexts.splice(0)) {
    await context.app.close();
    await rm(context.tempRoot, { recursive: true, force: true });
  }
  providerCalls = [];
  providerScript = () => textResponse("Normal response.");
});

describe("POST /message process guardrails", () => {
  it.each([
    {
      name: "scope none",
      scope: "none" as const,
      providerId: "ollama",
      projectId: "career",
      eligible: true,
      expectStartTool: false,
    },
    {
      name: "unknown provider",
      scope: "all" as const,
      providerId: "future-provider",
      projectId: "career",
      eligible: true,
      expectStartTool: false,
    },
    {
      name: "ineligible page",
      scope: "all" as const,
      providerId: "openrouter",
      projectId: "notes",
      eligible: false,
      expectStartTool: false,
    },
    {
      name: "root-agent page",
      scope: "all" as const,
      providerId: "openrouter",
      projectId: "your-agent",
      eligible: true,
      expectStartTool: false,
    },
    {
      name: "eligible page without a start signal",
      scope: "all" as const,
      providerId: "openrouter",
      projectId: "career",
      eligible: true,
      expectStartTool: true,
    },
  ])(
    "keeps $name on one unguarded model call with no process persistence",
    async ({ scope, providerId, projectId, eligible, expectStartTool }) => {
      const context = await createTestServer({
        scope,
        providerId,
        projectId,
        eligible,
      });
      providerScript = () => textResponse("Normal response.");

      const response = await postMessage(context, {
        content: "Help me with this.",
        project: projectId,
      });

      expect(response.statusCode).toBe(200);
      expect(providerCalls).toHaveLength(1);
      expect(toolNames(providerCalls[0]!)).toContain("memory_write");
      if (expectStartTool) {
        expect(toolNames(providerCalls[0]!)).toContain("process_start");
      } else {
        expect(toolNames(providerCalls[0]!)).not.toContain("process_start");
      }
      expect(response.body).toContain("event: text-delta");
      expect(response.body).toContain("Normal response.");
      expect(response.body).toContain("event: done");
      await expect(processDiagnosticsExist(context.memoryRoot)).resolves.toBe(false);
      await expect(
        pathExists(path.join(context.memoryRoot, "diagnostics/prompt-audit"))
      ).resolves.toBe(false);
    }
  );

  it.each(["ollama", "openrouter", "braindrive-models"] as const)(
    "uses one controller implementation for %s and hides internal controls from SSE",
    async (providerId) => {
      const context = await createTestServer({
        scope: "all",
        providerId,
        projectId: "career",
        eligible: true,
      });
      providerScript = (_body, call) => call === 1
        ? toolResponse("start-1", "process_start", {
            process_kind: PROCESS_GUARDRAIL_PROCESS_KIND,
          })
        : toolResponse("outcome-1", "process_stage_outcome", {
            stage: "interview",
            outcome: "candidate_ready",
          }, "Interview captured.");

      const response = await postMessage(context, {
        content: "Set up my career goals.",
        project: "career",
      });

      expect(response.statusCode).toBe(200);
      expect(providerCalls).toHaveLength(2);
      expect(toolNames(providerCalls[0]!)).toContain("process_start");
      expect(toolNames(providerCalls[1]!)).toEqual(expect.arrayContaining([
        "process_stage_outcome",
        "process_owner_override",
      ]));
      expect(response.body).toContain("Interview captured.");
      expect(response.body).not.toContain("process_start");
      expect(response.body).not.toContain("process_stage_outcome");
      expect(response.body.match(/event: done/g)).toHaveLength(1);

      const state = await readOnlyProcessState(context.memoryRoot);
      expect(state.provider_id).toBe(providerId);
      expect(state.stages.interview.status).toBe("accepted");
      expect(state.active_stage).toBe("specification");
      const traceDir = path.join(
        context.memoryRoot,
        "diagnostics/process-guardrails/traces"
      );
      const traceFiles = await readdir(traceDir);
      const trace = (
        await Promise.all(
          traceFiles.map((name) => readFile(path.join(traceDir, name), "utf8"))
        )
      ).join("\n");
      expect(trace).toContain(response.headers["x-conversation-id"]!);
      expect(trace).not.toContain("provider.example");
      expect(trace).not.toContain("TEST_API_KEY");
    }
  );

  it("resumes a persisted run directly without exposing or invoking process_start again", async () => {
    const context = await createTestServer({
      scope: "all",
      providerId: "openrouter",
      projectId: "career",
      eligible: true,
    });
    providerScript = (_body, call) => call === 1
      ? toolResponse("start-1", "process_start", {
          process_kind: PROCESS_GUARDRAIL_PROCESS_KIND,
        })
      : toolResponse("outcome-1", "process_stage_outcome", {
          stage: "interview",
          outcome: "candidate_ready",
        });
    const started = await postMessage(context, {
      content: "Start.",
      project: "career",
    });
    const conversationId = String(started.headers["x-conversation-id"]);
    providerCalls = [];
    providerScript = () => textResponse("What outcome matters most?");

    const resumed = await postMessage(context, {
      content: "Continue.",
      project: "career",
      conversationId,
    });

    expect(resumed.statusCode).toBe(200);
    expect(providerCalls).toHaveLength(1);
    expect(toolNames(providerCalls[0]!)).not.toContain("process_start");
    expect(toolNames(providerCalls[0]!)).toContain("process_stage_outcome");
    expect(resumed.body).toContain("What outcome matters most?");
    const state = await readOnlyProcessState(context.memoryRoot);
    expect(state.active_stage).toBe("specification");
    expect(state.stages.specification.status).toBe("active");
  });

  it("streams and persists canonical tool work through all fixed stages", async () => {
    const context = await createTestServer({
      scope: "all",
      providerId: "openrouter",
      projectId: "career",
      eligible: true,
    });
    providerScript = (body, call) => {
      if (call === 1) {
        return toolResponse("start-1", "process_start", {
          process_kind: PROCESS_GUARDRAIL_PROCESS_KIND,
        });
      }
      const system = body.messages[0]?.content ?? "";
      if (system.includes("Active guarded stage: interview")) {
        return toolResponse("interview-outcome", "process_stage_outcome", {
          stage: "interview",
          outcome: "candidate_ready",
        }, "Interview accepted.");
      }
      if (system.includes("Active guarded stage: specification")) {
        return {
          text: "Specification saved.",
          toolCalls: [
            {
              id: "spec-edit",
              name: "memory_edit",
              input: {
                path: "documents/career/spec.md",
                find: "Draft goals.",
                replace: "Accepted goals.",
              },
            },
            {
              id: "spec-outcome",
              name: "process_stage_outcome",
              input: {
                stage: "specification",
                outcome: "candidate_ready",
              },
            },
          ],
        };
      }
      if (system.includes("Active guarded stage: plan")) {
        return {
          text: "Plan saved.",
          toolCalls: [
            {
              id: "plan-edit",
              name: "memory_edit",
              input: {
                path: "documents/career/plan.md",
                find: "Draft plan.",
                replace: "Accepted plan.",
              },
            },
            {
              id: "plan-outcome",
              name: "process_stage_outcome",
              input: {
                stage: "plan",
                outcome: "candidate_ready",
              },
            },
          ],
        };
      }
      return toolResponse(
        "journal-outcome",
        "process_stage_outcome",
        {
          stage: "journal_handoff",
          outcome: "handoff_complete_no_entry",
        },
        "No journal entry was needed."
      );
    };

    const started = await postMessage(context, {
      content: "Build this with me.",
      project: "career",
    });
    const conversationId = String(started.headers["x-conversation-id"]);
    const specification = await postMessage(context, {
      content: "The goals are right.",
      project: "career",
      conversationId,
    });
    const plan = await postMessage(context, {
      content: "Use that plan.",
      project: "career",
      conversationId,
    });
    const handoff = await postMessage(context, {
      content: "Finish the handoff.",
      project: "career",
      conversationId,
    });

    expect(providerCalls).toHaveLength(5);
    expect(specification.body).toContain("event: tool-call");
    expect(specification.body).toContain('"name":"memory_edit"');
    expect(specification.body).toContain("event: tool-result");
    expect(plan.body).toContain('"name":"memory_edit"');
    expect(handoff.body).toContain("No journal entry was needed.");
    const state = await readOnlyProcessState(context.memoryRoot);
    expect(state.outcome).toBe("completed");
    expect(state.stages.journal_handoff.status).toBe(
      "handoff_complete_no_entry"
    );
    await expect(
      readFile(
        path.join(context.memoryRoot, "documents/career/spec.md"),
        "utf8"
      )
    ).resolves.toContain("Accepted goals.");
    await expect(
      readFile(
        path.join(context.memoryRoot, "documents/career/plan.md"),
        "utf8"
      )
    ).resolves.toContain("Accepted plan.");
    const conversation = await context.app.inject({
      method: "GET",
      url: `/conversations/${conversationId}`,
      headers: ownerHeaders(),
    });
    const persisted = JSON.parse(conversation.body) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(persisted.messages.filter((message) => message.role === "tool"))
      .toHaveLength(2);
    expect(JSON.stringify(persisted)).not.toContain("process_stage_outcome");
  });

  it("durably pauses an interrupted guarded stage before ending the existing error stream", async () => {
    const context = await createTestServer({
      scope: "all",
      providerId: "ollama",
      projectId: "career",
      eligible: true,
    });
    providerScript = (_body, call) => call === 1
      ? toolResponse("start-1", "process_start", {
          process_kind: PROCESS_GUARDRAIL_PROCESS_KIND,
        })
      : { status: 503 };

    const response = await postMessage(context, {
      content: "Start this process.",
      project: "career",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: error");
    expect(response.body).not.toContain("event: done");
    const state = await readOnlyProcessState(context.memoryRoot);
    expect(state.outcome).toBe("paused_recoverable");
    expect(state.recovery_reason).toBe("provider_unavailable");
  });

  it("resumes a paused run only after a narrow owner-override turn", async () => {
    const context = await createTestServer({
      scope: "all",
      providerId: "openrouter",
      projectId: "career",
      eligible: true,
    });
    providerScript = (_body, call) => call === 1
      ? toolResponse("start-1", "process_start", {
          process_kind: PROCESS_GUARDRAIL_PROCESS_KIND,
        })
      : { status: 503 };
    const interrupted = await postMessage(context, {
      content: "Start this process.",
      project: "career",
    });
    const conversationId = String(interrupted.headers["x-conversation-id"]);
    providerCalls = [];
    providerScript = (_body, call) => call === 1
      ? toolResponse("resume-1", "process_owner_override", {
          category: "resume",
        })
      : toolResponse("outcome-1", "process_stage_outcome", {
          stage: "interview",
          outcome: "candidate_ready",
        }, "Interview recovered.");

    const resumed = await postMessage(context, {
      content: "Resume now.",
      project: "career",
      conversationId,
    });

    expect(resumed.statusCode).toBe(200);
    expect(providerCalls).toHaveLength(2);
    expect(toolNames(providerCalls[0]!)).toEqual(["process_owner_override"]);
    expect(toolNames(providerCalls[1]!)).toContain("process_stage_outcome");
    expect(toolNames(providerCalls[1]!)).not.toContain("process_start");
    expect(resumed.body).toContain("Interview recovered.");
    expect(resumed.body).not.toContain("process_owner_override");
    expect(resumed.body.match(/event: done/g)).toHaveLength(1);
    const state = await readOnlyProcessState(context.memoryRoot);
    expect(state.outcome).toBe("active");
    expect(state.stages.interview.status).toBe("accepted");
    expect(state.active_stage).toBe("specification");
  });

  it("records guarded model calls only when prompt audit is enabled", async () => {
    const context = await createTestServer({
      scope: "all",
      providerId: "openrouter",
      projectId: "career",
      eligible: true,
      promptAudit: true,
    });
    providerScript = (_body, call) => call === 1
      ? toolResponse("start-1", "process_start", {
          process_kind: PROCESS_GUARDRAIL_PROCESS_KIND,
        })
      : toolResponse("outcome-1", "process_stage_outcome", {
          stage: "interview",
          outcome: "candidate_ready",
        });

    await postMessage(context, {
      content: "Start with auditing enabled.",
      project: "career",
    });

    const auditDir = path.join(context.memoryRoot, "diagnostics/prompt-audit");
    const audit = (
      await Promise.all(
        (await readdir(auditDir))
          .map((name) => readFile(path.join(auditDir, name), "utf8"))
      )
    ).join("\n");
    expect(audit).toContain('"event":"prompt_audit.model_request"');
    expect(audit).toContain('"trigger":"process_guardrail:interview"');
    expect(audit).not.toContain("TEST_API_KEY");
  });

  it("preserves context warning headers on a guarded request", async () => {
    const previousThreshold = process.env.BRAINDRIVE_CONTEXT_WARNING_THRESHOLD;
    process.env.BRAINDRIVE_CONTEXT_WARNING_THRESHOLD = "0.001";
    try {
      const context = await createTestServer({
        scope: "all",
        providerId: "openrouter",
        projectId: "career",
        eligible: true,
      });
      providerScript = (_body, call) => call === 1
        ? toolResponse("start-1", "process_start", {
            process_kind: PROCESS_GUARDRAIL_PROCESS_KIND,
          })
        : toolResponse("outcome-1", "process_stage_outcome", {
            stage: "interview",
            outcome: "candidate_ready",
          });

      const response = await postMessage(context, {
        content: "Start while this conversation is near its context warning.",
        project: "career",
      });

      expect(response.headers["x-context-window-warning"]).toBe("1");
      expect(response.headers["x-context-window-threshold"]).toBe("0.001");
      expect(response.headers["x-context-window-managed"]).toBeDefined();
      expect(response.body).toContain("event: done");
    } finally {
      if (previousThreshold === undefined) {
        delete process.env.BRAINDRIVE_CONTEXT_WARNING_THRESHOLD;
      } else {
        process.env.BRAINDRIVE_CONTEXT_WARNING_THRESHOLD = previousThreshold;
      }
    }
  });
});

async function createTestServer(input: {
  scope: RuntimeConfig["process_guardrails_scope"];
  providerId: string;
  projectId: string;
  eligible: boolean;
  promptAudit?: boolean;
}): Promise<TestContext> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "guardrail-gateway-"));
  const memoryRoot = path.join(tempRoot, "memory");
  await mkdir(path.join(memoryRoot, "documents", input.projectId), { recursive: true });
  await mkdir(path.join(memoryRoot, "preferences"), { recursive: true });
  await writeFile(
    path.join(memoryRoot, "documents", "projects.json"),
    `${JSON.stringify([
      {
        id: "your-agent",
        name: "Your Agent",
        icon: "sparkles",
        conversation_id: null,
        default_skill_ids: [],
      },
      {
        id: input.projectId,
        name: input.projectId,
        icon: "folder",
        conversation_id: null,
        default_skill_ids: [],
      },
    ])}\n`,
    "utf8"
  );
  await seedProjectFiles(memoryRoot, input.projectId, input.eligible);

  mockRuntimeConfig = {
    memory_root: memoryRoot,
    provider_adapter: "openai-compatible",
    conversation_store: "markdown",
    auth_mode: "local-owner",
    install_mode: "local",
    tool_sources: [],
    bind_address: "127.0.0.1",
    process_guardrails_scope: input.scope,
    safety_iteration_limit: 4,
    port: 8787,
  };
  mockPreferences = {
    default_model: "test-model",
    approval_mode: "auto-approve",
    secret_resolution: { on_missing: "fail_closed" },
    ...(input.promptAudit
      ? {
          prompt_audit: {
            enabled: true,
            detail: "standard",
            retention_days: 14,
            max_file_bytes: 5 * 1024 * 1024,
            include_provider_payload: true,
            include_provider_response: true,
            include_source_snapshots: true,
          },
        }
      : {}),
  };
  mockAdapterConfig = {
    base_url: "https://provider.example/v1",
    model: "test-model",
    api_key_env: "TEST_API_KEY",
    provider_id: input.providerId,
  };
  providerCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as ProviderRequestBody;
    providerCalls.push(body);
    return providerResponse(providerScript(body, providerCalls.length));
  }));

  const built = await buildServer(tempRoot);
  const context = { app: built.app, tempRoot, memoryRoot };
  contexts.push(context);
  return context;
}

async function seedProjectFiles(
  memoryRoot: string,
  projectId: string,
  eligible: boolean
): Promise<void> {
  const root = path.join(memoryRoot, "documents", projectId);
  const files: Record<string, string> = eligible
    ? {
        "AGENT.md": "Managed page behavior.",
        "run-interview.md": "Interview the owner, then report candidate_ready.",
        "spec.md": artifactContent("specification", "Draft goals."),
        "run-planning.md": "Create the plan.",
        "plan.md": artifactContent("plan", "Draft plan."),
        "run-journal.md": "Complete the handoff.",
        "journal.md": "# Your Career Journal\n",
      }
    : {
        "AGENT.md": "Ordinary notes page.",
      };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, name), content, "utf8");
  }
}

function artifactContent(
  stage: "specification" | "plan",
  firstBody: string
): string {
  return artifactContractFor("career", stage).requiredHeadings
    .map((heading, index) => `${heading}\n\n${index === 0 ? firstBody : "Owner content."}`)
    .join("\n\n");
}

async function postMessage(
  context: TestContext,
  input: {
    content: string;
    project: string;
    conversationId?: string;
  }
) {
  return context.app.inject({
    method: "POST",
    url: "/message",
    headers: {
      ...ownerHeaders(),
      ...(input.conversationId
        ? { "x-conversation-id": input.conversationId }
        : {}),
    },
    payload: {
      content: input.content,
      metadata: { project: input.project },
    },
  });
}

function ownerHeaders(): Record<string, string> {
  return {
    "x-actor-id": "owner",
    "x-actor-type": "owner",
    "x-auth-mode": "local-owner",
    "x-actor-permissions": JSON.stringify({
      memory_access: true,
      tool_access: true,
      system_actions: true,
      delegation: true,
      approval_authority: true,
      administration: true,
    }),
  };
}

function toolNames(body: ProviderRequestBody): string[] {
  return body.tools.map((tool) => tool.function.name);
}

function textResponse(text: string): ProviderResponse {
  return { text };
}

function toolResponse(
  id: string,
  name: string,
  input: Record<string, unknown>,
  text = ""
): ProviderResponse {
  return {
    text,
    toolCalls: [{ id, name, input }],
  };
}

function providerResponse(scripted: ProviderResponse): Response {
  if (scripted.status && scripted.status >= 400) {
    return new Response(
      JSON.stringify({ error: { message: "Provider unavailable" } }),
      {
        status: scripted.status,
        headers: { "content-type": "application/json" },
      }
    );
  }
  const chunks: string[] = [];
  if (scripted.text) {
    chunks.push(JSON.stringify({
      choices: [{ delta: { content: scripted.text } }],
    }));
  }
  for (const [index, toolCall] of (scripted.toolCalls ?? []).entries()) {
    chunks.push(JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index,
            id: toolCall.id,
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.input),
            },
          }],
        },
      }],
    }));
  }
  chunks.push(JSON.stringify({
    choices: [{
      finish_reason: scripted.toolCalls?.length ? "tool_calls" : "stop",
      delta: {},
    }],
  }));
  const payload = chunks.map((chunk) => `data: ${chunk}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(payload, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function processDiagnosticsExist(memoryRoot: string): Promise<boolean> {
  try {
    await readFile(
      path.join(memoryRoot, "diagnostics/process-guardrails"),
      "utf8"
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") {
      return true;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await readFile(target, "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EISDIR") {
      return true;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readOnlyProcessState(memoryRoot: string) {
  const stateDir = path.join(memoryRoot, "diagnostics/process-guardrails/state");
  const entries = await readdir(stateDir);
  expect(entries).toHaveLength(1);
  const parsed = JSON.parse(await readFile(path.join(stateDir, entries[0]!), "utf8"));
  return parseProcessGuardrailState(parsed);
}
