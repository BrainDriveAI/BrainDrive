import type { PendingApproval } from "../contracts.js";

type PendingResolver = {
  approval: PendingApproval;
  resolve: (decision: "approved" | "denied") => void;
};

export class ApprovalStore {
  private readonly pending = new Map<string, PendingResolver>();

  create(approval: PendingApproval): Promise<"approved" | "denied"> {
    return new Promise((resolve) => {
      this.pending.set(approval.requestId, {
        approval,
        resolve,
      });
    });
  }

  resolve(requestId: string, decision: "approved" | "denied"): PendingApproval | null {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return null;
    }

    this.pending.delete(requestId);
    pending.resolve(decision);
    return pending.approval;
  }
}
