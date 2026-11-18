# 0003: Destructive tool actions need two separate approvals; they should need one

- Status: open
- Area: server (`tool-gateway`, approvals), ui (task chat card, Inbox)
- Type: design
- Priority: high
- Found in: develop @ 73c57431e9

## Summary

When an agent calls a tool whose action is destructive (for example Obsidian
`delete_note`), a human has to decide **twice**: first a formal board approval
in the Inbox, then "Approve & run" on the card in the task chat. Approving only
the first one does nothing, and nothing on screen says the second is needed.
Product requirement from the owner: **one request, one decision**.

## Observed

**Confirmed**, with two different agents (OpenCode 2.3.0 and Claude Haiku):

1. The agent calls `delete_note`. The gateway answers `409 approval_required`.
   The task goes to `in_review` and shows a card "delete_note … Approve & run /
   Decline". An Inbox item "Board Approval: Approve high-risk tool action: …
   delete-note" (Approve / Reject) appears too.
2. Pressing **Approve & run** on the card first fails with "Tool action request
   requires formal board approval before execution. Try again."
3. Pressing **Approve** in the Inbox shows "Approval confirmed. Requesting
   agent was notified…" and wakes the agent. The note is **not** deleted. The
   action request stays `pending` with no `decidedAt`. The woken agent has
   nothing to do and spends a run (one OpenCode run ended `timed_out` exploring
   the API).
4. Pressing **Approve & run** on the card **after** the Inbox approval runs the
   action: the card shows "Succeeded" and the note is in `.trash/`.

Lower-risk actions (`write` level: `move_note`, `move_file`) have no formal
approval (`approvalId` is null) and need only the card: one step. So the two
step flow exists only for the high-risk tier.

## Reproduce

1. Connect an Obsidian vault (not read only) and set `delete_note` to "Ask first".
2. Give an agent a task such as "that note is obsolete, remove it".
3. Follow the four steps above.

## Where to look

- `server/src/services/tool-gateway.ts` around lines 10416-10435 and
  11080-11110: both check the formal approval (`approvals.status`) and throw
  `formal_approval_required`; execution runs only when the action request itself
  is `approved`.
- `POST /approvals/:id/approve` (board approval) updates `approvals` but does not
  decide or run the linked `tool_action_requests` row.
- Observed: pressing "Approve & run" on the card is what approves the action
  request and runs it. Find the endpoint behind that button; it was not read.

## Expected

Deciding once is enough. Either:

- approving the formal board approval also approves and runs the linked action
  request, then wakes the agent with the **result**, or
- the card's "Approve & run" creates and resolves the formal approval in the same
  call when the user is a board member who may approve.

Pick one and make the Inbox, the card and the agent wake consistent. The agent
must never be woken for an approval whose action has not run yet.

## Acceptance criteria

- A server test: approving the formal approval executes the action once and
  records its outcome on the request.
- A server test: the agent wake after approval carries the result of the action.
- A UI test: after one decision the card shows the outcome (Succeeded / Failed).
- A test for Decline / Reject: the action is never executed and the agent is told.
- The "approval confirmed" wording in the Inbox is accurate for the new flow.
- Document the final flow in the relevant `doc/` page.

## Out of scope

Changing which tools are classified as high risk (see 0005).
