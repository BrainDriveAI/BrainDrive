export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export interface Project {
  id: string;
  name: string;
  icon: string;
  conversationId: string | null;
}

export interface ProjectFile {
  name: string;
  path: string;
  displayName?: string;
  readOnly?: boolean;
  sourceLabel?: string;
  ownerLabel?: string;
  statementMonth?: string | null;
  destinationLabel?: string;
  sourceType?: string;
  accountName?: string | null;
  quality?: {
    state: "review_not_run" | "review_incomplete" | "needs_correction" | "evidence_limited" | "product_craft_passed" | "owner_approved" | "pre_correction_review";
    label: string;
  };
}

export type UserProfile = {
  name: string;
  initials: string;
  email: string;
};
