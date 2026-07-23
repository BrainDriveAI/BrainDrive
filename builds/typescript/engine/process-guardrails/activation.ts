import { isRootAgentProjectId } from "../../memory/root-agent.js";

import type {
  ProcessGuardrailActivationDecision,
  ProcessGuardrailActivationDecisionCode,
  ProcessGuardrailActivationInput,
  ProcessGuardrailPageEligibility,
  ProcessGuardrailProviderClass,
  ProcessGuardrailRequestedWork,
} from "./contracts.js";

export const PROCESS_GUARDRAIL_REQUIRED_PAGE_FILES = [
  "AGENT.md",
  "run-interview.md",
  "spec.md",
  "run-planning.md",
  "plan.md",
  "run-journal.md",
  "journal.md",
] as const;

const NO_GUARDRAIL_WORK: ProcessGuardrailRequestedWork = {
  state: false,
  trace: false,
  validation: false,
  guardedModel: false,
};

const GUARDED_WORK: ProcessGuardrailRequestedWork = {
  state: true,
  trace: true,
  validation: true,
  guardedModel: true,
};

export function classifyProcessGuardrailProvider(
  providerId: string | null | undefined
): ProcessGuardrailProviderClass {
  switch (providerId) {
    case "ollama":
      return "local";
    case "braindrive-models":
    case "openrouter":
      return "cloud";
    default:
      return "unclassified";
  }
}

export function decideProcessGuardrailActivation(
  input: ProcessGuardrailActivationInput
): ProcessGuardrailActivationDecision {
  const providerClass = classifyProcessGuardrailProvider(input.providerId);
  const pageEligibility = classifyPageEligibility(input.page);

  let decisionCode: ProcessGuardrailActivationDecisionCode;
  let exposeProcessStart = false;
  let enterGuardrails = false;
  let resumeProcess = false;

  if (input.scope === "none") {
    decisionCode = "scope_disabled";
  } else if (providerClass === "unclassified") {
    decisionCode = "provider_unclassified";
  } else if (!scopeEnablesProvider(input.scope, providerClass)) {
    decisionCode = "provider_disabled_by_scope";
  } else if (pageEligibility === "missing") {
    decisionCode = "page_missing";
  } else if (pageEligibility === "root_ineligible") {
    decisionCode = "page_root_ineligible";
  } else if (pageEligibility === "process_files_missing") {
    decisionCode = "page_process_files_missing";
  } else if (input.resumableStateEligible) {
    decisionCode = "resumable_state_eligible";
    enterGuardrails = true;
    resumeProcess = true;
  } else if (input.processStartRequested) {
    decisionCode = "process_start_eligible";
    exposeProcessStart = true;
    enterGuardrails = true;
  } else {
    decisionCode = "process_start_available";
    exposeProcessStart = true;
  }

  const requestedWork = enterGuardrails ? GUARDED_WORK : NO_GUARDRAIL_WORK;
  const diagnosticProviderId =
    providerClass === "unclassified"
      ? "unclassified"
      : input.providerId as "ollama" | "braindrive-models" | "openrouter";

  return {
    decisionCode,
    providerClass,
    pageEligibility,
    exposeProcessStart,
    enterGuardrails,
    resumeProcess,
    requestedWork: { ...requestedWork },
    diagnostic: {
      resolved_scope: input.scope,
      provider_id: diagnosticProviderId,
      provider_class: providerClass,
      page_eligibility: pageEligibility,
      process_start_requested: input.processStartRequested,
      resumable_state_eligible: input.resumableStateEligible,
      decision_code: decisionCode,
    },
  };
}

function scopeEnablesProvider(
  scope: ProcessGuardrailActivationInput["scope"],
  providerClass: Exclude<ProcessGuardrailProviderClass, "unclassified">
): boolean {
  return scope === "all" || scope === providerClass;
}

function classifyPageEligibility(
  page: ProcessGuardrailActivationInput["page"]
): ProcessGuardrailPageEligibility {
  if (!page || page.id.trim().length === 0) {
    return "missing";
  }
  if (isRootAgentProjectId(page.id)) {
    return "root_ineligible";
  }

  const files = new Set(page.files);
  return PROCESS_GUARDRAIL_REQUIRED_PAGE_FILES.every((file) => files.has(file))
    ? "eligible"
    : "process_files_missing";
}
