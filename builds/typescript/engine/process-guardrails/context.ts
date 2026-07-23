import type { GatewayMessage } from "../../contracts.js";
import type { ProcessGuardrailInstructionSnapshot } from "./instruction-loader.js";
import type { ProcessGuardrailStage } from "./state-machine.js";

export type { ProcessGuardrailInstructionSnapshot } from "./instruction-loader.js";

type AcceptedPrerequisiteInput =
  | {
      kind: ProcessGuardrailStage;
      status: "accepted";
      path: string;
      digest: string;
      content: string;
    }
  | {
      kind: ProcessGuardrailStage;
      status: "accepted";
      path?: never;
      digest?: never;
      content?: never;
    }
  | {
      kind: ProcessGuardrailStage;
      status: "absent_by_owner_choice";
    };

type PrerequisiteInput =
  | AcceptedPrerequisiteInput
  | {
      kind: ProcessGuardrailStage;
      status: "missing";
    };

export type ProcessGuardrailStageContextManifest = {
  stage: ProcessGuardrailStage;
  owner_message_ids: string[];
  instruction_refs: Array<{ path: string; digest: string }>;
  prerequisites: Array<
    | { kind: ProcessGuardrailStage; status: "accepted"; path: string; digest: string }
    | { kind: ProcessGuardrailStage; status: "accepted" }
    | { kind: ProcessGuardrailStage; status: "absent_by_owner_choice" }
  >;
  estimated_tokens: number;
  token_budget: number;
};

export class ProcessGuardrailContextError extends Error {
  constructor(
    readonly code: "context_prerequisite_missing" | "context_budget_exceeded" | "context_mismatch",
    message: string
  ) {
    super(message);
    this.name = "ProcessGuardrailContextError";
  }
}

export function buildProcessGuardrailStageContext(input: {
  stage: ProcessGuardrailStage;
  safetyContext: string;
  ownerDirection: {
    messageIds: string[];
    content: string;
  };
  instructions: ProcessGuardrailInstructionSnapshot;
  prerequisites: PrerequisiteInput[];
  structuralFeedbackCodes?: string[];
  tokenBudget: number;
}): {
  messages: GatewayMessage[];
  manifest: ProcessGuardrailStageContextManifest;
} {
  if (input.instructions.stage !== input.stage) {
    throw new ProcessGuardrailContextError(
      "context_mismatch",
      "Instruction snapshot does not match the active stage"
    );
  }
  const missing = input.prerequisites.find((item) => item.status === "missing");
  if (missing) {
    throw new ProcessGuardrailContextError(
      "context_prerequisite_missing",
      `Required prerequisite is missing: ${missing.kind}`
    );
  }
  const usablePrerequisites = input.prerequisites.filter(
    (item): item is AcceptedPrerequisiteInput =>
      item.status !== "missing"
  );

  const instructionBlocks = input.instructions.sources.map((source) =>
    [
      `### ${source.kind === "managed" ? "Managed instruction" : "Owner overlay"}: ${source.path}`,
      source.content,
    ].join("\n")
  );
  const prerequisiteBlocks = usablePrerequisites.map((item) => {
    if (item.status === "absent_by_owner_choice") {
      return `${item.kind}: absent_by_owner_choice`;
    }
    if (!item.path) {
      return `${item.kind}: accepted (no artifact)`;
    }
    return [
      `${item.kind}: accepted (${item.path}, sha256:${item.digest})`,
      item.content,
    ].join("\n");
  });
  const systemContent = [
    input.safetyContext,
    "",
    "## Guarded Process Boundary",
    `Active guarded stage: ${input.stage}`,
    "Use only the active instructions and explicit prerequisites below.",
    "Internal process controls report structural outcomes only.",
    "",
    ...instructionBlocks,
    ...(prerequisiteBlocks.length > 0
      ? ["", "## Explicit Prerequisites", ...prerequisiteBlocks]
      : []),
    ...(input.structuralFeedbackCodes?.length
      ? [
          "",
          "## Structural Retry Feedback",
          ...input.structuralFeedbackCodes.map((code) => `- ${code}`),
        ]
      : []),
  ].join("\n");
  const messages: GatewayMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: input.ownerDirection.content },
  ];
  const estimatedTokens = estimateTokens(messages);
  if (estimatedTokens > input.tokenBudget) {
    throw new ProcessGuardrailContextError(
      "context_budget_exceeded",
      `Allowlisted stage context exceeds context budget (${estimatedTokens}/${input.tokenBudget})`
    );
  }

  return {
    messages,
    manifest: {
      stage: input.stage,
      owner_message_ids: [...input.ownerDirection.messageIds],
      instruction_refs: input.instructions.sources.map((source) => ({
        path: source.path,
        digest: source.digest,
      })),
      prerequisites: usablePrerequisites.map((item) => item.status === "accepted"
        ? item.path
          ? {
            kind: item.kind,
            status: item.status,
            path: item.path,
            digest: item.digest,
          }
          : {
              kind: item.kind,
              status: item.status,
            }
        : {
            kind: item.kind,
            status: item.status,
          }),
      estimated_tokens: estimatedTokens,
      token_budget: input.tokenBudget,
    },
  };
}

function estimateTokens(messages: GatewayMessage[]): number {
  const chars = messages.reduce((total, message) => total + message.content.length, 0);
  return Math.max(1, Math.ceil(chars / 4) + messages.length * 4);
}
