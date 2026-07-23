import { z } from "zod";

import type { ToolDefinition } from "../../contracts.js";
import { PROCESS_GUARDRAIL_PROCESS_KIND, PROCESS_GUARDRAIL_STAGES } from "./state-machine.js";

const startSchema = z.object({
  process_kind: z.literal(PROCESS_GUARDRAIL_PROCESS_KIND),
}).strict();

const outcomeSchema = z.object({
  stage: z.enum(PROCESS_GUARDRAIL_STAGES),
  outcome: z.enum(["candidate_ready", "needs_owner_action", "handoff_complete_no_entry"]),
}).strict().superRefine((value, context) => {
  if (
    value.outcome === "handoff_complete_no_entry" &&
    value.stage !== "journal_handoff"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outcome"],
      message: "No-entry handoff is valid only for journal_handoff",
    });
  }
});

const overrideSchema = z.object({
  category: z.enum(["skip", "reorder", "redo", "stop", "resume"]),
  target_stage: z.enum(PROCESS_GUARDRAIL_STAGES).optional(),
}).strict();

export function processGuardrailControlTools(): ToolDefinition[] {
  return [
    structuralTool(
      "process_start",
      "Start the one registered guarded process",
      {
        type: "object",
        properties: {
          process_kind: { type: "string", enum: [PROCESS_GUARDRAIL_PROCESS_KIND] },
        },
        required: ["process_kind"],
        additionalProperties: false,
      },
      (input) => startSchema.parse(input)
    ),
    structuralTool(
      "process_stage_outcome",
      "Report the structural outcome of the active guarded stage",
      {
        type: "object",
        properties: {
          stage: { type: "string", enum: PROCESS_GUARDRAIL_STAGES },
          outcome: {
            type: "string",
            enum: ["candidate_ready", "needs_owner_action", "handoff_complete_no_entry"],
          },
        },
        required: ["stage", "outcome"],
        additionalProperties: false,
      },
      (input) => outcomeSchema.parse(input)
    ),
    structuralTool(
      "process_owner_override",
      "Report an explicit owner-directed structural override",
      {
        type: "object",
        properties: {
          category: { type: "string", enum: ["skip", "reorder", "redo", "stop", "resume"] },
          target_stage: { type: "string", enum: PROCESS_GUARDRAIL_STAGES },
        },
        required: ["category"],
        additionalProperties: false,
      },
      (input) => overrideSchema.parse(input)
    ),
  ];
}

function structuralTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  parse: (input: Record<string, unknown>) => unknown
): ToolDefinition {
  return {
    name,
    description,
    requiresApproval: false,
    readOnly: true,
    inputSchema,
    execute: async (_context, input) => ({
      accepted: true,
      control: name,
      value: parse(input),
    }),
  };
}
