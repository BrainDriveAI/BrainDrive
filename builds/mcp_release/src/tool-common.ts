import { z } from "zod/v4";

export const CommonToolArgsSchema = {
  seed: z.union([z.string(), z.number()]).optional(),
  delay_ms: z.number().int().min(0).max(120_000).optional(),
  force_error: z.boolean().optional(),
};

export async function applyDelayAndError(
  args: { delay_ms?: number; force_error?: boolean },
  toolName: string
): Promise<void> {
  if (args.delay_ms && args.delay_ms > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, args.delay_ms);
    });
  }

  if (args.force_error) {
    throw new Error(`${toolName}: forced error`);
  }
}

export function textResult(payload: unknown): { type: "text"; text: string }[] {
  return [
    {
      type: "text",
      text: JSON.stringify(payload),
    },
  ];
}

