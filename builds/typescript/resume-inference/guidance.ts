import type { z } from "zod";

import type { InferenceDataBlockSchema } from "../app-platform/contracts/inference.js";
import { ResumeGuidanceResultSchema } from "./results.js";

type DataBlock = z.infer<typeof InferenceDataBlockSchema>;

export function deterministicGuidanceFallback(blocks: DataBlock[]) {
  const facts = ((blocks.find((block) => block.category === "confirmed_fact_snapshot")?.data as {
    facts?: Array<{ revision_id?: unknown; fact_kind?: unknown }>;
  } | undefined)?.facts ?? []).filter((fact): fact is { revision_id: string; fact_kind: string } => typeof fact.revision_id === "string" && typeof fact.fact_kind === "string");
  const deterministic = (blocks.find((block) => block.category === "deterministic_findings")?.data as {
    findings?: Array<{ code?: unknown; evidence_revision_ids?: unknown[]; safe_message?: unknown }>;
  } | undefined)?.findings ?? [];
  const items: Array<{
    category: "strong_evidence" | "missing_detail" | "unresolved_conflict" | "unsupported_requirement" | "intentional_omission";
    evidence_revision_ids: string[];
    evidence_labels: string[];
    message: string;
  }> = facts.slice(0, 3).map((fact) => ({
    category: "strong_evidence",
    evidence_revision_ids: [fact.revision_id],
    evidence_labels: [`Confirmed ${fact.fact_kind.replaceAll("_", " ")} evidence`],
    message: `Confirmed ${fact.fact_kind.replaceAll("_", " ")} evidence supports the current resume.`,
  }));
  for (const item of deterministic.slice(0, 12)) {
    const code = typeof item.code === "string" ? item.code : "missing_detail";
    const category = code.includes("conflict") ? "unresolved_conflict" as const
      : code.includes("unsupported") ? "unsupported_requirement" as const
      : code.includes("omission") ? "intentional_omission" as const
      : "missing_detail" as const;
    items.push({
      category,
      evidence_revision_ids: (item.evidence_revision_ids ?? []).filter((id): id is string => typeof id === "string"),
      evidence_labels: ["Deterministic resume finding"],
      message: typeof item.safe_message === "string" ? item.safe_message : "More confirmed detail could improve specificity.",
    });
  }
  if (!items.some((item) => item.category === "intentional_omission")) items.push({
    category: "intentional_omission",
    evidence_revision_ids: [],
    evidence_labels: ["Owner choices"],
    message: "Skipped or intentionally omitted information remains outside the resume.",
  });
  return ResumeGuidanceResultSchema.parse({ guidance_version: 1, items, optional_questions: [] });
}
