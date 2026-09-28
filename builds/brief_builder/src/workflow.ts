export type BriefWorkflowStage = "source" | "generating" | "review" | "approved" | "unavailable";

export type BriefWorkflowState = {
  stage: BriefWorkflowStage;
  source: string;
  draftTitle: string;
  statements: readonly { text: string; supportLabel: string }[];
  approvedRevisionId: string | null;
  error: { code: string; safeMessage: string } | null;
};

export type BriefWorkflowAction =
  | { type: "source.changed"; source: string }
  | { type: "generation.started" }
  | { type: "generation.completed"; title: string; statements: readonly { text: string; supportLabel: string }[] }
  | { type: "draft.edited"; title: string; statements: readonly { text: string; supportLabel: string }[] }
  | { type: "approval.completed"; approvedRevisionId: string }
  | { type: "approval.rejected" }
  | { type: "operation.failed"; code: string; safeMessage: string }
  | { type: "operation.cancelled" }
  | { type: "durable.reopened"; state: Omit<BriefWorkflowState, "error"> };

export const initialBriefWorkflowState: BriefWorkflowState = { stage: "source", source: "", draftTitle: "", statements: [], approvedRevisionId: null, error: null };

export function reduceBriefWorkflow(state: BriefWorkflowState, action: BriefWorkflowAction): BriefWorkflowState {
  switch (action.type) {
    case "source.changed": return { ...state, source: action.source, stage: "source", error: null };
    case "generation.started": return { ...state, stage: "generating", error: null };
    case "generation.completed": return { ...state, stage: "review", draftTitle: action.title, statements: action.statements, error: null };
    case "draft.edited": return { ...state, stage: "review", draftTitle: action.title, statements: action.statements, error: null };
    case "approval.completed": return { ...state, stage: "approved", approvedRevisionId: action.approvedRevisionId, error: null };
    case "approval.rejected": return { ...state, stage: state.approvedRevisionId ? "approved" : "source", draftTitle: "", statements: [], error: null };
    case "operation.failed": return { ...state, stage: state.approvedRevisionId ? "approved" : "unavailable", error: { code: action.code, safeMessage: action.safeMessage } };
    case "operation.cancelled": return { ...state, stage: state.approvedRevisionId ? "approved" : state.draftTitle ? "review" : "source", error: null };
    case "durable.reopened": return { ...action.state, error: null };
  }
}
