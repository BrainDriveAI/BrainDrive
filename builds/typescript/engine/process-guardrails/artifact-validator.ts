import path from "node:path";

import {
  artifactContractFor,
  isProcessGuardrailPageId,
} from "./process-definition.js";
import type { ProcessGuardrailStage } from "./state-machine.js";

export const PROCESS_GUARDRAIL_VALIDATION_CODES = [
  "artifact_path_invalid",
  "overlay_write_forbidden",
  "diagnostics_forbidden",
  "delete_forbidden",
  "artifact_required",
  "required_section_missing",
  "duplicate_section",
  "prerequisite_missing",
  "stage_order_invalid",
  "destructive_replacement",
  "owner_content_removed",
  "journal_ineligible",
  "journal_duplicate_entry",
] as const;

export type ProcessGuardrailValidationCode =
  (typeof PROCESS_GUARDRAIL_VALIDATION_CODES)[number];

export type ProcessGuardrailPrerequisite = {
  kind: ProcessGuardrailStage;
  status: "accepted" | "absent_by_owner_choice" | "missing";
};

export type ProcessGuardrailArtifactValidationInput = {
  pageId: string;
  stage: ProcessGuardrailStage;
  toolName: string;
  targetPath: string;
  candidateContent: string;
  originalContent: string | null;
  prerequisites: ProcessGuardrailPrerequisite[];
  journalEligibility: "eligible" | "ineligible" | "not_applicable";
  edit?: {
    find: string;
    replace: string;
  };
};

export type ProcessGuardrailValidationResult = {
  ok: boolean;
  codes: ProcessGuardrailValidationCode[];
};

export function validateProcessGuardrailArtifact(
  input: ProcessGuardrailArtifactValidationInput
): ProcessGuardrailValidationResult {
  const codes = new Set<ProcessGuardrailValidationCode>();
  const normalizedPath = input.targetPath.replace(/\\/g, "/").replace(/^\.\//, "");

  if (normalizedPath === "diagnostics/process-guardrails" ||
      normalizedPath.startsWith("diagnostics/process-guardrails/")) {
    codes.add("diagnostics_forbidden");
  }
  if (/(?:^|\/)[^/]+-user\.md$/i.test(normalizedPath)) {
    codes.add("overlay_write_forbidden");
  }
  if (input.toolName === "memory_delete") {
    codes.add("delete_forbidden");
  }
  if (!isProcessGuardrailPageId(input.pageId) || input.stage === "interview") {
    codes.add("artifact_path_invalid");
    return result(codes);
  }

  const contract = artifactContractFor(input.pageId, input.stage);
  const expectedPath = path.posix.join("documents", input.pageId, contract.fileName);
  if (normalizedPath !== expectedPath) {
    codes.add("artifact_path_invalid");
  }
  if (input.candidateContent.trim().length === 0) {
    codes.add("artifact_required");
  }

  for (const heading of contract.requiredHeadings) {
    const count = countHeading(input.candidateContent, heading);
    if (count === 0) {
      codes.add("required_section_missing");
    } else if (count > 1) {
      codes.add("duplicate_section");
    }
  }

  const prerequisite = input.prerequisites.find((item) => item.kind === contract.prerequisite);
  if (!prerequisite) {
    codes.add("stage_order_invalid");
  } else if (prerequisite.status === "missing") {
    codes.add("prerequisite_missing");
  }

  if (
    input.toolName === "memory_write" &&
    input.originalContent !== null &&
    input.candidateContent !== input.originalContent
  ) {
    codes.add("destructive_replacement");
  }
  if (
    input.toolName === "memory_edit" &&
    input.originalContent !== null &&
    input.edit &&
    (
      (
        input.edit.find === input.originalContent &&
        input.edit.replace !== input.originalContent
      ) ||
      contract.requiredHeadings.filter((heading) =>
        countHeading(input.edit!.find, heading) > 0
      ).length > 1 ||
      (
        input.stage !== "journal_handoff" &&
        !editTargetsContractSection(
          input.originalContent,
          input.edit.find,
          contract.requiredHeadings
        )
      )
    )
  ) {
    codes.add("owner_content_removed");
  }

  if (input.stage === "journal_handoff") {
    if (input.journalEligibility !== "eligible") {
      codes.add("journal_ineligible");
    }
    const datedHeadings = journalHeadings(input.candidateContent);
    const originalDatedHeadings = journalHeadings(input.originalContent ?? "");
    const editedHeadings = journalHeadings(input.edit?.find ?? "");
    if (
      new Set(datedHeadings).size !== datedHeadings.length ||
      datedHeadings.length > originalDatedHeadings.length + 1 ||
      datedHeadings.length < originalDatedHeadings.length ||
      editedHeadings.length > 1
    ) {
      codes.add("journal_duplicate_entry");
    }
  }

  return result(codes);
}

export function validateProcessGuardrailStageOutcome(input: {
  stage: ProcessGuardrailStage;
  outcome: "artifact_candidate" | "handoff_complete_no_entry";
  artifactPath: string | null;
}): ProcessGuardrailValidationResult {
  const codes = new Set<ProcessGuardrailValidationCode>();
  if (
    input.outcome === "handoff_complete_no_entry" &&
    (input.stage !== "journal_handoff" || input.artifactPath !== null)
  ) {
    codes.add("artifact_path_invalid");
  }
  return result(codes);
}

function countHeading(content: string, heading: string): number {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trimEnd() === heading)
    .length;
}

function journalHeadings(content: string): string[] {
  return content.match(/^## \d{4}-\d{2}-\d{2} - .+$/gm) ?? [];
}

function editTargetsContractSection(
  original: string,
  find: string,
  requiredHeadings: readonly string[]
): boolean {
  const index = original.indexOf(find);
  if (index < 0) {
    return false;
  }
  const priorLines = original.slice(0, index + find.length).split(/\r?\n/);
  const nearestHeading = priorLines
    .filter((line) => /^#{1,2} /.test(line))
    .at(-1);
  return nearestHeading !== undefined && requiredHeadings.includes(nearestHeading);
}

function result(codes: Set<ProcessGuardrailValidationCode>): ProcessGuardrailValidationResult {
  const ordered = PROCESS_GUARDRAIL_VALIDATION_CODES.filter((code) => codes.has(code));
  return { ok: ordered.length === 0, codes: ordered };
}
