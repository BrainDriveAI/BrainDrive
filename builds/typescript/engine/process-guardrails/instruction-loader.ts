import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { resolveMemoryPath } from "../../memory/paths.js";
import {
  isProcessGuardrailPageId,
  stageDefinitionFor,
} from "./process-definition.js";
import type { ProcessGuardrailStage } from "./state-machine.js";

export type ProcessGuardrailInstructionSource = {
  path: string;
  kind: "managed" | "overlay";
  digest: string;
  content: string;
};

export type ProcessGuardrailInstructionSnapshot = {
  page_id: string;
  stage: ProcessGuardrailStage;
  sources: ProcessGuardrailInstructionSource[];
};

export class ProcessGuardrailInstructionError extends Error {
  constructor(
    readonly code: "instruction_missing" | "instruction_unreadable" | "page_unsupported",
    readonly path: string,
    message: string
  ) {
    super(message);
    this.name = "ProcessGuardrailInstructionError";
  }
}

export async function loadProcessGuardrailInstructions(input: {
  memoryRoot: string;
  pageId: string;
  stage: ProcessGuardrailStage;
}): Promise<ProcessGuardrailInstructionSnapshot> {
  if (!isProcessGuardrailPageId(input.pageId)) {
    throw new ProcessGuardrailInstructionError(
      "page_unsupported",
      `documents/${input.pageId}`,
      `Unsupported process page: ${input.pageId}`
    );
  }

  const procedure = stageDefinitionFor(input.stage).procedure;
  const managedFiles = ["AGENT.md", procedure];
  const sources: ProcessGuardrailInstructionSource[] = [];

  for (const managedFile of managedFiles) {
    const managedPath = `documents/${input.pageId}/${managedFile}`;
    const content = await readRequired(input.memoryRoot, managedPath);
    sources.push(toSource(managedPath, "managed", content));

    const overlayPath = managedPath.replace(/\.md$/, "-user.md");
    const overlay = await readOptional(input.memoryRoot, overlayPath);
    if (overlay !== null) {
      sources.push(toSource(overlayPath, "overlay", overlay));
    }
  }

  return {
    page_id: input.pageId,
    stage: input.stage,
    sources,
  };
}

function toSource(
  sourcePath: string,
  kind: "managed" | "overlay",
  content: string
): ProcessGuardrailInstructionSource {
  return {
    path: sourcePath,
    kind,
    digest: createHash("sha256").update(content).digest("hex"),
    content,
  };
}

async function readRequired(memoryRoot: string, relativePath: string): Promise<string> {
  const target = resolveMemoryPath(memoryRoot, relativePath);
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    const missing = isNodeError(error, "ENOENT");
    throw new ProcessGuardrailInstructionError(
      missing ? "instruction_missing" : "instruction_unreadable",
      relativePath,
      missing
        ? `Required process instruction is missing: ${relativePath}`
        : `Required process instruction is unreadable: ${relativePath}`
    );
  }
}

async function readOptional(memoryRoot: string, relativePath: string): Promise<string | null> {
  const target = resolveMemoryPath(memoryRoot, relativePath);
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw new ProcessGuardrailInstructionError(
      "instruction_unreadable",
      relativePath,
      `Optional process instruction is unreadable: ${relativePath}`
    );
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}
