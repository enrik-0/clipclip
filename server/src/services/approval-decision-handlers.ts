import type { approvals } from "@paperclipai/db";

type ApprovalRecord = typeof approvals.$inferSelect;

/**
 * Lets the module that created a board approval own what a decision on it
 * does. The approvals routes keep access checks; the owner applies the
 * decision, resolves the approval row itself, logs the change and tells the
 * requester.
 *
 * Without a matching handler, the approvals routes resolve the approval and
 * wake the requester as before.
 */
export interface ApprovalDecisionHandler {
  /** True when this handler owns decisions for the approval. */
  handles(approval: Pick<ApprovalRecord, "type" | "payload">): boolean;
  /** Applies one board decision. Must be safe to call again with the same decision. */
  decide(input: {
    approval: ApprovalRecord;
    decision: "approved" | "rejected";
    decidedByUserId: string;
    decisionNote?: string | null;
  }): Promise<void>;
}

export function findApprovalDecisionHandler(
  handlers: readonly ApprovalDecisionHandler[] | undefined,
  approval: Pick<ApprovalRecord, "type" | "payload">,
): ApprovalDecisionHandler | null {
  return handlers?.find((handler) => handler.handles(approval)) ?? null;
}
