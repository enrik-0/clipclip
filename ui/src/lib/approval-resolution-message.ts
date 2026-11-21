/**
 * The text shown after a board user approves an approval. A tool action
 * approval runs the action once and wakes the agent only after it ran, so the
 * generic "agent was notified" text would be wrong for it.
 */
export function approvalConfirmedDetail(approval: { type: string; payload: unknown }): string {
  const payload = approval.payload && typeof approval.payload === "object"
    ? approval.payload as Record<string, unknown>
    : null;
  if (approval.type === "request_board_approval" && payload?.source === "tool_gateway") {
    return "The tool action runs once with the reviewed arguments. The linked task shows the outcome, and the requesting agent is woken with the result.";
  }
  return "Requesting agent was notified to review this approval and linked tasks.";
}
