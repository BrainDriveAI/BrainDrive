import {
  PROCESS_GUARDRAIL_PROCESS_KIND,
  type ProcessGuardrailStage,
} from "./state-machine.js";

export const PROCESS_GUARDRAIL_PAGE_IDS = [
  "career",
  "finance",
  "fitness",
  "relationships",
  "new-project",
] as const;

export type ProcessGuardrailPageId = (typeof PROCESS_GUARDRAIL_PAGE_IDS)[number];

type FixedStageDefinition = {
  kind: ProcessGuardrailStage;
  procedure: "run-interview.md" | "run-planning.md" | "run-journal.md";
  prerequisite: ProcessGuardrailStage | null;
  artifact: "spec.md" | "plan.md" | "journal.md" | null;
  allowedReads: readonly string[];
  allowedWrites: readonly string[];
};

const FIXED_STAGES = [
  {
    kind: "interview",
    procedure: "run-interview.md",
    prerequisite: null,
    artifact: null,
    allowedReads: ["AGENT.md", "run-interview.md", "spec.md", "plan.md", "me/profile.md"],
    allowedWrites: [],
  },
  {
    kind: "specification",
    procedure: "run-interview.md",
    prerequisite: "interview",
    artifact: "spec.md",
    allowedReads: ["AGENT.md", "run-interview.md", "spec.md", "plan.md", "me/profile.md"],
    allowedWrites: ["spec.md"],
  },
  {
    kind: "plan",
    procedure: "run-planning.md",
    prerequisite: "specification",
    artifact: "plan.md",
    allowedReads: ["AGENT.md", "run-planning.md", "spec.md", "plan.md", "me/profile.md"],
    allowedWrites: ["plan.md"],
  },
  {
    kind: "journal_handoff",
    procedure: "run-journal.md",
    prerequisite: "plan",
    artifact: "journal.md",
    allowedReads: [
      "AGENT.md",
      "run-journal.md",
      "spec.md",
      "plan.md",
      "journal.md",
      "me/profile.md",
    ],
    allowedWrites: ["journal.md"],
  },
] as const satisfies readonly FixedStageDefinition[];

export const PROCESS_GUARDRAIL_DEFINITION: {
  kind: typeof PROCESS_GUARDRAIL_PROCESS_KIND;
  contractVersion: 1;
  stages: readonly FixedStageDefinition[];
} = Object.freeze({
  kind: PROCESS_GUARDRAIL_PROCESS_KIND,
  contractVersion: 1,
  stages: Object.freeze(FIXED_STAGES),
});

const COMMON_SPEC_HEADINGS = [
  "# Your Goals",
  "## What You Want",
  "## Where You Are",
  "## What's In The Way",
  "## What Good Looks Like",
  "## Assumptions And Unknowns",
  "## The Plan",
  "## What's Still Missing",
  "## Changelog",
] as const;

const COMMON_PLAN_HEADINGS = [
  "# Your Plan",
  "## Right Now - Your First Step",
  "## The Roadmap",
  "## Decisions To Make",
  "## Review Status",
  "## The Destination",
  "## What Needs More Work",
  "## Changelog",
] as const;

const NEW_PROJECT_PLAN_HEADINGS = [
  "# Your Plan",
  "## Right Now - Your First Step",
  "## The Roadmap",
  "## Routing Decision",
  "## Created Page Handoff",
  "## Future Capability Candidates",
  "## Review Status",
  "## The Destination",
  "## What Needs More Work",
  "## Changelog",
] as const;

const JOURNAL_TITLES: Record<ProcessGuardrailPageId, string> = {
  career: "# Your Career Journal",
  finance: "# Your Finance Journal",
  fitness: "# Your Fitness Journal",
  relationships: "# Your Relationships Journal",
  "new-project": "# Your New Project Journal",
};

export type ProcessGuardrailArtifactContract = {
  stage: "specification" | "plan" | "journal_handoff";
  fileName: "spec.md" | "plan.md" | "journal.md";
  requiredHeadings: readonly string[];
  prerequisite: ProcessGuardrailStage;
};

export function isProcessGuardrailPageId(value: string): value is ProcessGuardrailPageId {
  return (PROCESS_GUARDRAIL_PAGE_IDS as readonly string[]).includes(value);
}

export function stageDefinitionFor(stage: ProcessGuardrailStage): FixedStageDefinition {
  return PROCESS_GUARDRAIL_DEFINITION.stages.find((candidate) => candidate.kind === stage)!;
}

export function artifactContractFor(
  pageId: string,
  stage: "specification" | "plan" | "journal_handoff"
): ProcessGuardrailArtifactContract {
  if (!isProcessGuardrailPageId(pageId)) {
    throw new Error(`Unsupported process guardrail page: ${pageId}`);
  }
  if (stage === "specification") {
    const headings = pageId === "new-project"
      ? [
          ...COMMON_SPEC_HEADINGS.slice(0, 4),
          "## Why This Belongs Here",
          ...COMMON_SPEC_HEADINGS.slice(4),
        ]
      : [...COMMON_SPEC_HEADINGS];
    return {
      stage,
      fileName: "spec.md",
      requiredHeadings: headings,
      prerequisite: "interview",
    };
  }
  if (stage === "plan") {
    return {
      stage,
      fileName: "plan.md",
      requiredHeadings: pageId === "new-project"
        ? [...NEW_PROJECT_PLAN_HEADINGS]
        : [...COMMON_PLAN_HEADINGS],
      prerequisite: "specification",
    };
  }
  return {
    stage,
    fileName: "journal.md",
    requiredHeadings: [JOURNAL_TITLES[pageId]],
    prerequisite: "plan",
  };
}
