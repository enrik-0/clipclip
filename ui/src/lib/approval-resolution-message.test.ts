import { describe, expect, it } from "vitest";
import { approvalConfirmedDetail } from "./approval-resolution-message";

describe("approvalConfirmedDetail (#9)", () => {
  it("says a tool action approval runs the action and wakes the agent with the result", () => {
    const text = approvalConfirmedDetail({ type: "request_board_approval", payload: { source: "tool_gateway" } });
    expect(text).toContain("runs once");
    expect(text).toContain("woken with the result");
    expect(text).not.toContain("notified to review");
  });

  it("keeps the general text for other approvals", () => {
    expect(approvalConfirmedDetail({ type: "hire_agent", payload: {} }))
      .toBe("Requesting agent was notified to review this approval and linked tasks.");
    expect(approvalConfirmedDetail({ type: "request_board_approval", payload: null }))
      .toBe("Requesting agent was notified to review this approval and linked tasks.");
  });
});
