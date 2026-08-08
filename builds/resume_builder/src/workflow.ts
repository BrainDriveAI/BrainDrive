export const INTERVIEW_TOPICS = [
  "contact",
  "employment",
  "accomplishments",
  "education",
  "skills",
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
  | "history";

export type WarningBuckets = {
  factual: string[];
  document: string[];
  evidence_gaps: string[];
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
  | { type: "operation.cleared" };

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
};

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
      return {
        ...state,
        stage: deriveStage(action.snapshot),
        entryPoint: action.snapshot.entry_point,
        snapshot: action.snapshot,
        completedTopics,
        skippedTopics,
        currentTopic: action.snapshot.interview?.status === "paused"
          ? null
          : nextInterviewTopic(action.snapshot.known_topics, completedTopics, skippedTopics),
        connection: "connected",
        error: null,
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
  }
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
