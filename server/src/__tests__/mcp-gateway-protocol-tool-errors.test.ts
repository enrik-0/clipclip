import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { mcpGatewayProtocolRoutes } from "../routes/tool-gateway.js";
import { ToolGatewayHttpError, type ToolGatewayService } from "../services/tool-gateway.js";

function appWithGatewayError(error: ToolGatewayHttpError) {
  const gateway = { executeTool: vi.fn(async () => { throw error; }) } as unknown as ToolGatewayService;
  const app = express();
  app.use(express.json());
  app.use(mcpGatewayProtocolRoutes(gateway));
  return app;
}

describe("MCP gateway tools/call errors", () => {
  it("returns arguments that do not match the tool schema as a tool result the agent can fix (#10)", async () => {
    const message = "The arguments for move_file do not match its input schema. Expected properties: oldPath (required).";
    const response = await request(appWithGatewayError(
      new ToolGatewayHttpError(422, message, "invalid_tool_arguments", { tool: "move_file" }),
    ))
      .post("/mcp/gateways/gw_test")
      .set("authorization", "Bearer token")
      .send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "move_file", arguments: { from: "a" } } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { content: [{ type: "text", text: message }], isError: true },
    });
  });

  it("keeps an approval request as a protocol error", async () => {
    const response = await request(appWithGatewayError(
      new ToolGatewayHttpError(409, "Tool action requires approval", "approval_required"),
    ))
      .post("/mcp/gateways/gw_test")
      .set("authorization", "Bearer token")
      .send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "move_file", arguments: {} } });

    expect(response.status).toBe(409);
    expect(response.body.error.data.reasonCode).toBe("approval_required");
  });
});
