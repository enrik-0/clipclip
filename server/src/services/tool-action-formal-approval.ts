import { and, eq } from "drizzle-orm";
import { toolActionRequests, type Db } from "@paperclipai/db";
import { conflict } from "../errors.js";
import type { ApprovalDecisionHandler } from "./approval-decision-handlers.js";
import { approvalRecords } from "./approvals.js";
import { logActivity } from "./activity-log.js";

type ToolActionDecisions = {
  approveActionRequest(input: {
    companyId: string;
    actionRequestId: string;
    actor: { agentId?: string | null; userId?: string | null };
  }): Promise<unknown>;
  declineActionRequest(input: {
    companyId: string;
    actionRequestId: string;
    reason?: string;
    actor: { agentId?: string | null; userId?: string | null };
  }): Promise<unknown>;
};

const DEAD_ACTION_STATUSES = new Set(["expired", "cancelled"]);

/**
 * A high-risk tool action has one decision. The formal board approval that the
 * tool gateway creates for it is resolved by the same decision as the task card:
 * approving it in the Inbox approves and runs the action once, and rejecting it
 * declines the action. The tool gateway resolves both records in one review
 * transaction and wakes the agent after the outcome is recorded.
 */
export function toolActionApprovalDecisionHandler(
  db: Db,
  decisions: ToolActionDecisions,
): ApprovalDecisionHandler {
  return {
    handles(approval) {
      const payload = approval.payload as Record<string, unknown> | null;
      return approval.type === "request_board_approval" && payload?.source === "tool_gateway";
    },
    async decide({ approval, decision, decidedByUserId, decisionNote }) {
      const [request] = await db
        .select({ id: toolActionRequests.id, status: toolActionRequests.status })
        .from(toolActionRequests)
        .where(and(
          eq(toolActionRequests.companyId, approval.companyId),
          eq(toolActionRequests.approvalId, approval.id),
        ))
        .limit(1);
      if (!request) throw conflict("The tool action for this approval was not found");
      if (DEAD_ACTION_STATUSES.has(request.status)) {
        // Nothing can run any more. Close the approval so it leaves the Inbox.
        const cancelled = await approvalRecords(db).cancel(approval.id, `The tool action is ${request.status}; nothing ran.`);
        if (cancelled && cancelled.status === "cancelled" && approval.status !== "cancelled")
          await logActivity(db, {
            companyId: approval.companyId,
            actorType: "user",
            actorId: decidedByUserId,
            action: "approval.cancelled",
            entityType: "approval",
            entityId: approval.id,
            details: { type: approval.type, actionRequestId: request.id, actionStatus: request.status },
          });
        throw conflict(`This tool action is ${request.status}. Nothing ran, and the approval was closed.`);
      }
      const actor = { userId: decidedByUserId };
      if (decision === "approved") {
        await decisions.approveActionRequest({
          companyId: approval.companyId,
          actionRequestId: request.id,
          actor,
        });
        return;
      }
      await decisions.declineActionRequest({
        companyId: approval.companyId,
        actionRequestId: request.id,
        reason: decisionNote?.trim() || undefined,
        actor,
      });
    },
  };
}
