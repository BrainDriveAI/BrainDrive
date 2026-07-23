export const PROCESS_GUARDRAIL_SCOPES = ["none", "local", "cloud", "all"] as const;

export type ProcessGuardrailScope = (typeof PROCESS_GUARDRAIL_SCOPES)[number];

export type ProcessGuardrailProviderClass = "local" | "cloud" | "unclassified";

export type ProcessGuardrailPageEligibility =
  | "missing"
  | "root_ineligible"
  | "process_files_missing"
  | "eligible";

export type ProcessGuardrailActivationDecisionCode =
  | "scope_disabled"
  | "provider_unclassified"
  | "provider_disabled_by_scope"
  | "page_missing"
  | "page_root_ineligible"
  | "page_process_files_missing"
  | "process_start_available"
  | "process_start_eligible"
  | "resumable_state_eligible";

export type ProcessGuardrailActivationInput = {
  scope: ProcessGuardrailScope;
  providerId?: string | null;
  page: {
    id: string;
    files: readonly string[];
  } | null;
  processStartRequested: boolean;
  resumableStateEligible: boolean;
};

export type ProcessGuardrailRequestedWork = {
  state: boolean;
  trace: boolean;
  validation: boolean;
  guardedModel: boolean;
};

export type ProcessGuardrailActivationDiagnostic = {
  resolved_scope: ProcessGuardrailScope;
  provider_id: "ollama" | "braindrive-models" | "openrouter" | "unclassified";
  provider_class: ProcessGuardrailProviderClass;
  page_eligibility: ProcessGuardrailPageEligibility;
  process_start_requested: boolean;
  resumable_state_eligible: boolean;
  decision_code: ProcessGuardrailActivationDecisionCode;
};

export type ProcessGuardrailActivationDecision = {
  decisionCode: ProcessGuardrailActivationDecisionCode;
  providerClass: ProcessGuardrailProviderClass;
  pageEligibility: ProcessGuardrailPageEligibility;
  exposeProcessStart: boolean;
  enterGuardrails: boolean;
  resumeProcess: boolean;
  requestedWork: ProcessGuardrailRequestedWork;
  diagnostic: ProcessGuardrailActivationDiagnostic;
};
