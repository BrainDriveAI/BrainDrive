export const INTERVIEW_TOPICS = [
  "contact",
  "direction",
  "employment",
  "accomplishments",
  "education",
  "credentials",
  "skills",
  "projects",
  "leadership_volunteer",
  "links",
] as const;

export type InterviewTopic = (typeof INTERVIEW_TOPICS)[number];
export type ResumeBuilderStage =
  | "preflight"
  | "interview"
  | "fact_review"
  | "general_review"
  | "job"
  | "evidence"
  | "tailored_review"
  | "preview"
  | "history"
  | "revision";

export type WarningBuckets = {
  factual: string[];
  document: string[];
  evidence_gaps: string[];
};

export type EvidenceFailureIdentity = {
  semanticInputDigest: string;
  strategyRevisionId: string;
  providerProfileId: string;
  modelId: string;
};

export function evidenceFailureEquivalent(left: EvidenceFailureIdentity, right: EvidenceFailureIdentity): boolean {
  return left.semanticInputDigest === right.semanticInputDigest
    && left.strategyRevisionId === right.strategyRevisionId
    && left.providerProfileId === right.providerProfileId
    && left.modelId === right.modelId;
}

export function evidenceFailurePrimaryAction(repeatedEquivalentFailure: boolean): "try_again" | "review_confirmed_evidence" {
  return repeatedEquivalentFailure ? "review_confirmed_evidence" : "try_again";
}

export type RecoverySlot = {
  session_id: string;
  job_fact_revision_id: string | null;
  question_id: string;
  field_id: string;
};

export type { RecoverySaveStatus } from "./recovery-save.js";
import type { RecoverySaveStatus } from "./recovery-save.js";

import { EVIDENCE_DIMENSIONS, OPPORTUNITY_DIMENSION_PRIORITY } from "./opportunities.js";

export const JOB_EVIDENCE_DIMENSIONS = EVIDENCE_DIMENSIONS;

export type JobEvidenceDimension = (typeof JOB_EVIDENCE_DIMENSIONS)[number];
export type JobEvidenceOutcome = "answered" | "skipped" | "unknown" | "not_applicable" | "deferred" | "conflicting";
export type JobEvidenceOutcomes = Partial<Record<JobEvidenceDimension, JobEvidenceOutcome>>;

export type JobInterviewState = {
  activeJobRevisionId: string | null;
  currentDimension: JobEvidenceDimension | null;
  outcomes: JobEvidenceOutcomes;
  history: JobEvidenceDimension[];
};

export type RememberedJobCandidate = { revision_id: string; label: string };
export type RememberedJobMatch = {
  kind: "matched" | "ambiguous" | "none";
  method: "explicit_revision" | "exact_label" | "none";
  matches: RememberedJobCandidate[];
};

type ConfirmedFactCandidate = { revision_id: string; fact_kind: string; value: string };
type SuccessorStatement = {
  statement_id: string;
  section_id: string;
  kind: "factual" | "presentation";
  display_role?: "heading" | "bullet" | "line";
  text: string;
  supporting_confirmed_fact_revision_ids: string[];
};

export type RecoveryState = {
  slot: RecoverySlot | null;
  value: string;
  valueDigest: string | null;
  acknowledgedRevision: number | null;
  acknowledgedAt: string | null;
  status: RecoverySaveStatus;
  expectedRevision: number | null;
  operationId: string | null;
  editGeneration: number;
  serverValue: string | null;
  serverValueDigest: string | null;
};

export type ComparisonState = {
  selectedRevisionIds: string[];
  status: "idle" | "loading" | "ready" | "unavailable";
  expandedUnchanged: boolean;
};

export type RevisionClassification = "presentation" | "factual" | "mixed" | "ambiguous";
export type RevisionWorkflowState = {
  requestRecordId: string | null;
  requestRevisionId: string | null;
  sourceRevisionId: string | null;
  scope: "statement" | "section" | "resume" | null;
  classification: RevisionClassification | null;
  clarification: string | null;
  proposalRevisionId: string | null;
  status: "idle" | "submitted" | "clarification_needed" | "awaiting_confirmation" | "generating" | "proposed" | "accepted" | "edited" | "rejected" | "regenerate" | "failed";
};

export type DurableWorkflowSnapshot = {
  entry_point: "direct" | "career";
  known_topics: InterviewTopic[];
  confirmed_fact_count: number;
  interview: null | {
    status: "not_started" | "in_progress" | "paused" | "review_needed" | "completed";
    current_topic: string | null;
    completed_topics: string[];
    skipped_topics: string[];
    active_job_fact_revision_id?: string | null;
    current_question_id?: string | null;
    current_field_id?: string | null;
    job_dimension?: JobEvidenceDimension | "identity" | null;
    recovery_draft?: null | {
      slot: RecoverySlot;
      value: string;
      value_digest: string;
      saved_at: string;
      acknowledged_revision: number;
    };
  };
  general_definitions: Array<{ revision_id: string; status: "draft" | "proposed" | "approved" }>;
  jobs: Array<{ revision_id: string }>;
  targeted_definitions: Array<{ revision_id: string; status: "draft" | "proposed" | "approved"; parent_revision_id: string }>;
  artifacts: Array<{ revision_id: string; definition_revision_id: string; accepted: boolean }>;
};

export type RewriteProposal = {
  id: string;
  text: string;
  original_text: string;
  status: "proposed" | "accepted" | "edited" | "rejected" | "regenerate";
};

export type ResumeBuilderWorkflowState = {
  stage: ResumeBuilderStage;
  entryPoint: "direct" | "career";
  snapshot: DurableWorkflowSnapshot | null;
  currentTopic: InterviewTopic | null;
  completedTopics: InterviewTopic[];
  skippedTopics: InterviewTopic[];
  rewrite: RewriteProposal | null;
  warnings: WarningBuckets;
  connection: "connected" | "lost";
  error: null | { code: string; message: string; recoverable: boolean };
  recovery: RecoveryState;
  jobInterview: JobInterviewState;
  comparison: ComparisonState;
  revision: RevisionWorkflowState;
};

export type ResumeBuilderWorkflowAction =
  | { type: "durable.loaded"; snapshot: DurableWorkflowSnapshot }
  | { type: "interview.completed_topic"; topic: InterviewTopic }
  | { type: "interview.skipped_topic"; topic: InterviewTopic }
  | { type: "interview.paused" }
  | { type: "interview.resumed" }
  | { type: "stage.selected"; stage: ResumeBuilderStage }
  | { type: "rewrite.proposed"; proposal: Omit<RewriteProposal, "status"> }
  | { type: "rewrite.accepted" }
  | { type: "rewrite.edited"; text: string }
  | { type: "rewrite.rejected" }
  | { type: "rewrite.regenerate" }
  | { type: "warnings.updated"; warnings: WarningBuckets }
  | { type: "connection.lost" }
  | { type: "connection.recovered" }
  | { type: "operation.failed"; code: string; message: string; recoverable: boolean }
  | { type: "operation.cleared" }
  | { type: "recovery.changed"; slot: RecoverySlot; value: string; valueDigest: string }
  | { type: "recovery.started"; operationId: string; expectedRevision: number | null; editGeneration: number }
  | { type: "recovery.reconciling"; operationId: string; expectedRevision: number | null; editGeneration: number }
  | { type: "recovery.acknowledged"; slot: RecoverySlot; value: string; valueDigest: string; revision: number; savedAt: string; operationId: string; expectedRevision: number | null; editGeneration: number }
  | { type: "recovery.failed"; code: string; operationId: string; editGeneration: number }
  | { type: "recovery.verification_failed"; code: string; operationId: string; editGeneration: number }
  | { type: "recovery.conflicted"; serverValue: string; serverValueDigest: string; serverRevision: number; serverSavedAt: string; operationId: string; editGeneration: number }
  | { type: "recovery.server_selected" }
  | { type: "recovery.local_selected" }
  | { type: "recovery.discarded" }
  | { type: "job.selected"; jobRevisionId: string; knownDimensions: JobEvidenceDimension[] }
  | { type: "job.dimension_recorded"; dimension: JobEvidenceDimension; outcome: JobEvidenceOutcome }
  | { type: "job.back" }
  | { type: "job.completed_for_now" }
  | { type: "job.reopened"; jobRevisionId: string; dimension: JobEvidenceDimension }
  | { type: "comparison.selection_toggled"; revisionId: string }
  | { type: "comparison.started" }
  | { type: "comparison.completed"; available: boolean }
  | { type: "comparison.unchanged_toggled" }
  | { type: "comparison.cleared" }
  | { type: "revision.submitted"; requestRecordId: string; requestRevisionId: string; sourceRevisionId: string; scope: "statement" | "section" | "resume" }
  | { type: "revision.classified"; classification: RevisionClassification; clarification: string | null }
  | { type: "revision.proposed"; proposalRevisionId: string }
  | { type: "revision.outcome"; outcome: "accept" | "edit" | "reject" | "regenerate" }
  | { type: "revision.failed" }
  | { type: "revision.cleared" };

const idleRecovery = (): RecoveryState => ({
  slot: null,
  value: "",
  valueDigest: null,
  acknowledgedRevision: null,
  acknowledgedAt: null,
  status: "idle",
  expectedRevision: null,
  operationId: null,
  editGeneration: 0,
  serverValue: null,
  serverValueDigest: null,
});

const idleComparison = (): ComparisonState => ({ selectedRevisionIds: [], status: "idle", expandedUnchanged: false });
const idleRevision = (): RevisionWorkflowState => ({ requestRecordId: null, requestRevisionId: null, sourceRevisionId: null, scope: null, classification: null, clarification: null, proposalRevisionId: null, status: "idle" });

export function revisionRoute(classification: RevisionClassification): RevisionWorkflowState["status"] {
  if (classification === "ambiguous") return "clarification_needed";
  if (classification === "factual" || classification === "mixed") return "awaiting_confirmation";
  return "generating";
}

export function comparisonSelectionLabel(selectedRevisionIds: readonly string[]): string {
  return `${selectedRevisionIds.length} version${selectedRevisionIds.length === 1 ? "" : "s"} selected`;
}

export const initialWorkflowState: ResumeBuilderWorkflowState = {
  stage: "preflight",
  entryPoint: "direct",
  snapshot: null,
  currentTopic: null,
  completedTopics: [],
  skippedTopics: [],
  rewrite: null,
  warnings: { factual: [], document: [], evidence_gaps: [] },
  connection: "connected",
  error: null,
  recovery: idleRecovery(),
  jobInterview: { activeJobRevisionId: null, currentDimension: null, outcomes: {}, history: [] },
  comparison: idleComparison(),
  revision: idleRevision(),
};

export function nextJobEvidenceDimension(outcomes: JobEvidenceOutcomes): JobEvidenceDimension | null {
  return OPPORTUNITY_DIMENSION_PRIORITY.find((dimension) => outcomes[dimension] === undefined) ?? null;
}

function normalizeRememberedValue(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function matchRememberedJob(
  jobs: readonly RememberedJobCandidate[],
  input: { explicit_revision_id: string | null; description: string },
): RememberedJobMatch {
  if (input.explicit_revision_id) {
    const selected = jobs.find((job) => job.revision_id === input.explicit_revision_id);
    return selected
      ? { kind: "matched", method: "explicit_revision", matches: [selected] }
      : { kind: "none", method: "none", matches: [] };
  }
  const description = normalizeRememberedValue(input.description);
  if (!description) return { kind: "none", method: "none", matches: [] };
  const matches = jobs.filter((job) => normalizeRememberedValue(job.label) === description);
  if (matches.length === 1) return { kind: "matched", method: "exact_label", matches };
  if (matches.length > 1) return { kind: "ambiguous", method: "exact_label", matches };
  return { kind: "none", method: "none", matches: [] };
}

export function confirmedFactDuplicate<T extends ConfirmedFactCandidate>(
  facts: readonly T[],
  factKind: string,
  value: string,
): T | null {
  const normalizedValue = normalizeRememberedValue(value);
  return facts.find((fact) => fact.fact_kind === factKind && normalizeRememberedValue(fact.value) === normalizedValue) ?? null;
}

function statementMeaning(statement: SuccessorStatement): string {
  return JSON.stringify({
    section_id: statement.section_id,
    kind: statement.kind,
    display_role: statement.display_role ?? null,
    text: statement.text,
    supporting_confirmed_fact_revision_ids: [...statement.supporting_confirmed_fact_revision_ids],
  });
}

export function prepareRememberedSuccessorStatements<T extends SuccessorStatement>(
  predecessor: readonly T[],
  generated: readonly T[],
): T[] {
  const usedIds = new Set<string>();
  return generated.map((statement) => {
    const exactId = predecessor.find((candidate) => candidate.statement_id === statement.statement_id && statementMeaning(candidate) === statementMeaning(statement));
    const unchanged = exactId ?? predecessor.find((candidate) => !usedIds.has(candidate.statement_id) && statementMeaning(candidate) === statementMeaning(statement));
    if (!unchanged) return statement;
    usedIds.add(unchanged.statement_id);
    return { ...statement, statement_id: unchanged.statement_id };
  });
}

export function jobEvidenceProgress(outcomes: JobEvidenceOutcomes): { answered: number; deferred: number; remaining: number; total: number } {
  const values = Object.values(outcomes);
  return {
    answered: values.filter((outcome) => outcome === "answered").length,
    deferred: values.filter((outcome) => outcome !== "answered" && outcome !== "conflicting").length,
    remaining: JOB_EVIDENCE_DIMENSIONS.filter((dimension) => outcomes[dimension] === undefined).length,
    total: JOB_EVIDENCE_DIMENSIONS.length,
  };
}

function uniqueTopics(topics: readonly string[]): InterviewTopic[] {
  return INTERVIEW_TOPICS.filter((topic) => topics.includes(topic));
}

export function nextInterviewTopic(
  known: readonly InterviewTopic[],
  completed: readonly InterviewTopic[],
  skipped: readonly InterviewTopic[],
): InterviewTopic | null {
  return INTERVIEW_TOPICS.find((topic) =>
    !known.includes(topic) && !completed.includes(topic) && !skipped.includes(topic)
  ) ?? null;
}

export function deriveStage(snapshot: DurableWorkflowSnapshot): ResumeBuilderStage {
  const approvedTargeted = snapshot.targeted_definitions.some((definition) => definition.status === "approved");
  const approvedGeneral = snapshot.general_definitions.some((definition) => definition.status === "approved");
  const anyGeneral = snapshot.general_definitions.length > 0;
  if (approvedTargeted) return "preview";
  if (snapshot.targeted_definitions.length > 0) return "tailored_review";
  if (snapshot.jobs.length > 0 && approvedGeneral) return "evidence";
  if (approvedGeneral) return "job";
  if (anyGeneral) return "general_review";
  if (snapshot.interview?.status === "review_needed" || snapshot.interview?.status === "completed") return "fact_review";
  return "interview";
}

export function resumeBuilderWorkflowReducer(
  state: ResumeBuilderWorkflowState,
  action: ResumeBuilderWorkflowAction,
): ResumeBuilderWorkflowState {
  switch (action.type) {
    case "durable.loaded": {
      const completedTopics = uniqueTopics(action.snapshot.interview?.completed_topics ?? []);
      const skippedTopics = uniqueTopics(action.snapshot.interview?.skipped_topics ?? []);
      const durableRecovery = action.snapshot.interview?.recovery_draft;
      return {
        ...state,
        stage: deriveStage(action.snapshot),
        entryPoint: action.snapshot.entry_point,
        snapshot: action.snapshot,
        completedTopics,
        skippedTopics,
        currentTopic: action.snapshot.interview?.status === "paused"
          ? null
          : uniqueTopics([action.snapshot.interview?.current_topic ?? ""])[0]
            ?? nextInterviewTopic(action.snapshot.known_topics, completedTopics, skippedTopics),
        recovery: durableRecovery ? {
          slot: durableRecovery.slot,
          value: durableRecovery.value,
          valueDigest: durableRecovery.value_digest,
          acknowledgedRevision: durableRecovery.acknowledged_revision,
          acknowledgedAt: durableRecovery.saved_at,
          status: "saved",
          expectedRevision: durableRecovery.acknowledged_revision === 1 ? null : durableRecovery.acknowledged_revision - 1,
          operationId: null,
          editGeneration: 0,
          serverValue: null,
          serverValueDigest: null,
        } : idleRecovery(),
        connection: "connected",
        error: null,
        jobInterview: action.snapshot.interview?.active_job_fact_revision_id ? {
          activeJobRevisionId: action.snapshot.interview.active_job_fact_revision_id,
          currentDimension: JOB_EVIDENCE_DIMENSIONS.includes(action.snapshot.interview.job_dimension as JobEvidenceDimension)
            ? action.snapshot.interview.job_dimension as JobEvidenceDimension
            : null,
          outcomes: {},
          history: [],
        } : state.jobInterview,
      };
    }
    case "interview.completed_topic": {
      const completedTopics = uniqueTopics([...state.completedTopics, action.topic]);
      return {
        ...state,
        completedTopics,
        currentTopic: nextInterviewTopic(state.snapshot?.known_topics ?? [], completedTopics, state.skippedTopics),
      };
    }
    case "interview.skipped_topic": {
      const skippedTopics = uniqueTopics([...state.skippedTopics, action.topic]);
      return {
        ...state,
        skippedTopics,
        currentTopic: nextInterviewTopic(state.snapshot?.known_topics ?? [], state.completedTopics, skippedTopics),
      };
    }
    case "interview.paused":
      return { ...state, currentTopic: null };
    case "interview.resumed":
      return { ...state, currentTopic: nextInterviewTopic(state.snapshot?.known_topics ?? [], state.completedTopics, state.skippedTopics) };
    case "stage.selected":
      return { ...state, stage: action.stage, error: null };
    case "rewrite.proposed":
      return { ...state, rewrite: { ...action.proposal, status: "proposed" } };
    case "rewrite.accepted":
      return state.rewrite ? { ...state, rewrite: { ...state.rewrite, status: "accepted" } } : state;
    case "rewrite.edited":
      return state.rewrite ? { ...state, rewrite: { ...state.rewrite, text: action.text, status: "edited" } } : state;
    case "rewrite.rejected":
      return state.rewrite ? { ...state, rewrite: { ...state.rewrite, status: "rejected" } } : state;
    case "rewrite.regenerate":
      return state.rewrite ? { ...state, rewrite: { ...state.rewrite, status: "regenerate" } } : state;
    case "warnings.updated":
      return { ...state, warnings: action.warnings };
    case "connection.lost":
      return { ...state, connection: "lost", error: { code: "connection_lost", message: "The app connection was interrupted. Your saved work is still available.", recoverable: true } };
    case "connection.recovered":
      return { ...state, connection: "connected", error: null };
    case "operation.failed":
      return { ...state, error: { code: action.code, message: action.message, recoverable: action.recoverable } };
    case "operation.cleared":
      return { ...state, error: null };
    case "recovery.changed":
      return {
        ...state,
        recovery: {
          ...state.recovery,
          slot: action.slot,
          value: action.value,
          valueDigest: action.valueDigest,
          status: "saving",
          operationId: null,
          expectedRevision: null,
          editGeneration: state.recovery.editGeneration + 1,
          serverValue: null,
          serverValueDigest: null,
        },
      };
    case "recovery.started":
      return action.editGeneration !== state.recovery.editGeneration ? state : {
        ...state,
        recovery: { ...state.recovery, status: "saving", operationId: action.operationId, expectedRevision: action.expectedRevision },
      };
    case "recovery.reconciling":
      return action.editGeneration !== state.recovery.editGeneration || state.recovery.operationId !== action.operationId ? state : {
        ...state,
        recovery: { ...state.recovery, status: "reconciling", expectedRevision: action.expectedRevision },
      };
    case "recovery.acknowledged": {
      const expectedResultRevision = (action.expectedRevision ?? 0) + 1;
      const stillCurrent = state.recovery.valueDigest === action.valueDigest
        && state.recovery.value === action.value
        && sameRecoverySlot(state.recovery.slot, action.slot)
        && state.recovery.operationId === action.operationId
        && state.recovery.expectedRevision === action.expectedRevision
        && state.recovery.editGeneration === action.editGeneration
        && action.revision === expectedResultRevision;
      if (!stillCurrent) return state;
      return {
        ...state,
        recovery: {
          ...state.recovery,
          slot: action.slot,
          value: action.value,
          valueDigest: action.valueDigest,
          acknowledgedRevision: action.revision,
          acknowledgedAt: action.savedAt,
          status: "saved",
          serverValue: null,
          serverValueDigest: null,
        },
      };
    }
    case "recovery.failed":
      return action.editGeneration !== state.recovery.editGeneration || action.operationId !== state.recovery.operationId
        ? state
        : { ...state, recovery: { ...state.recovery, status: "not_saved", operationId: null } };
    case "recovery.verification_failed":
      return action.editGeneration !== state.recovery.editGeneration || action.operationId !== state.recovery.operationId
        ? state
        : { ...state, recovery: { ...state.recovery, status: "verification_failed", operationId: null } };
    case "recovery.conflicted":
      return action.editGeneration !== state.recovery.editGeneration || action.operationId !== state.recovery.operationId ? state : {
        ...state,
        recovery: {
          ...state.recovery,
          acknowledgedRevision: action.serverRevision,
          acknowledgedAt: action.serverSavedAt,
          status: "conflict",
          operationId: null,
          serverValue: action.serverValue,
          serverValueDigest: action.serverValueDigest,
        },
      };
    case "recovery.server_selected":
      return state.recovery.serverValue === null ? state : {
        ...state,
        recovery: {
          ...state.recovery,
          value: state.recovery.serverValue,
          valueDigest: state.recovery.serverValueDigest,
          status: "saved",
          operationId: null,
          serverValue: null,
          serverValueDigest: null,
        },
      };
    case "recovery.local_selected":
      return { ...state, recovery: { ...state.recovery, status: "saving", operationId: null, expectedRevision: state.recovery.acknowledgedRevision, editGeneration: state.recovery.editGeneration + 1, serverValue: null, serverValueDigest: null } };
    case "recovery.discarded":
      return { ...state, recovery: idleRecovery() };
    case "job.selected": {
      const outcomes = Object.fromEntries(action.knownDimensions.map((dimension) => [dimension, "answered"])) as JobEvidenceOutcomes;
      return {
        ...state,
        jobInterview: {
          activeJobRevisionId: action.jobRevisionId,
          currentDimension: nextJobEvidenceDimension(outcomes),
          outcomes,
          history: [],
        },
      };
    }
    case "job.dimension_recorded": {
      if (state.jobInterview.activeJobRevisionId === null || state.jobInterview.currentDimension !== action.dimension) return state;
      const outcomes = { ...state.jobInterview.outcomes, [action.dimension]: action.outcome };
      return {
        ...state,
        jobInterview: {
          ...state.jobInterview,
          currentDimension: nextJobEvidenceDimension(outcomes),
          outcomes,
          history: [...state.jobInterview.history, action.dimension],
        },
      };
    }
    case "job.back": {
      const history = [...state.jobInterview.history];
      const dimension = history.pop();
      if (!dimension) return state;
      return { ...state, jobInterview: { ...state.jobInterview, currentDimension: dimension, history } };
    }
    case "job.completed_for_now": {
      const outcomes = { ...state.jobInterview.outcomes };
      for (const dimension of JOB_EVIDENCE_DIMENSIONS) {
        if (outcomes[dimension] === undefined) outcomes[dimension] = "deferred";
      }
      return { ...state, jobInterview: { activeJobRevisionId: null, currentDimension: null, outcomes, history: state.jobInterview.history } };
    }
    case "job.reopened": {
      const outcomes = { ...state.jobInterview.outcomes };
      if (["unknown", "not_applicable", "skipped", "deferred", "conflicting"].includes(outcomes[action.dimension] ?? "")) {
        delete outcomes[action.dimension];
      }
      return {
        ...state,
        jobInterview: {
          activeJobRevisionId: action.jobRevisionId,
          currentDimension: action.dimension,
          outcomes,
          history: state.jobInterview.history.filter((dimension) => dimension !== action.dimension),
        },
      };
    }
    case "comparison.selection_toggled": {
      const selected = state.comparison.selectedRevisionIds;
      const selectedRevisionIds = selected.includes(action.revisionId)
        ? selected.filter((revisionId) => revisionId !== action.revisionId)
        : selected.length < 2
          ? [...selected, action.revisionId]
          : selected;
      return { ...state, comparison: { selectedRevisionIds, status: "idle", expandedUnchanged: false } };
    }
    case "comparison.started":
      return state.comparison.selectedRevisionIds.length === 2
        ? { ...state, comparison: { ...state.comparison, status: "loading", expandedUnchanged: false } }
        : state;
    case "comparison.completed":
      return { ...state, comparison: { ...state.comparison, status: action.available ? "ready" : "unavailable", expandedUnchanged: false } };
    case "comparison.unchanged_toggled":
      return { ...state, comparison: { ...state.comparison, expandedUnchanged: !state.comparison.expandedUnchanged } };
    case "comparison.cleared":
      return { ...state, comparison: idleComparison() };
    case "revision.submitted":
      return { ...state, revision: { requestRecordId: action.requestRecordId, requestRevisionId: action.requestRevisionId, sourceRevisionId: action.sourceRevisionId, scope: action.scope, classification: null, clarification: null, proposalRevisionId: null, status: "submitted" } };
    case "revision.classified":
      return { ...state, revision: { ...state.revision, classification: action.classification, clarification: action.clarification, status: revisionRoute(action.classification) } };
    case "revision.proposed":
      return { ...state, revision: { ...state.revision, proposalRevisionId: action.proposalRevisionId, status: "proposed" } };
    case "revision.outcome":
      return { ...state, revision: { ...state.revision, status: action.outcome === "accept" ? "accepted" : action.outcome === "edit" ? "edited" : action.outcome === "reject" ? "rejected" : "regenerate" } };
    case "revision.failed":
      return { ...state, revision: { ...state.revision, status: "failed" } };
    case "revision.cleared":
      return { ...state, revision: idleRevision() };
  }
}

export function recoveryOperationId(slot: RecoverySlot, valueDigest: string, expectedRevision: number | null): string {
  const input = `${slot.session_id}|${slot.job_fact_revision_id ?? ""}|${slot.question_id}|${slot.field_id}|${valueDigest}|${expectedRevision ?? "new"}`;
  let seed = 0x811c9dc5;
  const words: string[] = [];
  for (let round = 0; round < 4; round += 1) {
    let hash = (seed ^ round) >>> 0;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    words.push(hash.toString(16).padStart(8, "0"));
    seed = hash;
  }
  const hex = words.join("").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4]!;
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function recoveryBindingKey(slot: RecoverySlot, valueDigest: string, expectedRevision: number | null): string {
  return `${recoveryOperationId(slot, valueDigest, expectedRevision)}|${valueDigest}|${expectedRevision ?? "new"}`;
}

function sameRecoverySlot(left: RecoverySlot | null, right: RecoverySlot): boolean {
  return Boolean(left
    && left.session_id === right.session_id
    && left.job_fact_revision_id === right.job_fact_revision_id
    && left.question_id === right.question_id
    && left.field_id === right.field_id);
}

export function progressSummary(state: ResumeBuilderWorkflowState): {
  completed: number;
  skipped: number;
  remaining: number;
  total: number;
} {
  const known = state.snapshot?.known_topics.length ?? 0;
  const completed = new Set([...state.completedTopics, ...(state.snapshot?.known_topics ?? [])]).size;
  const skipped = state.skippedTopics.length;
  return { completed, skipped, remaining: Math.max(0, INTERVIEW_TOPICS.length - completed - skipped), total: INTERVIEW_TOPICS.length };
}
