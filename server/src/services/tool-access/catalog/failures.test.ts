import { describe, expect, it } from "vitest";
import { badRequest, HttpError, unprocessable } from "../../../errors.js";
import { healthFailureHttpStatus, sanitizeHttpFailure } from "./failures.js";

const statusFor = (error: unknown) => healthFailureHttpStatus(sanitizeHttpFailure(error));

describe("connection setup failures", () => {
  it("keeps the message and code of a setup input error and answers 422", () => {
    const error = badRequest("The vault cannot be a drive or share root. Choose the vault's own folder.", {
      code: "obsidian_vault_path_root",
    });
    expect(sanitizeHttpFailure(error)).toMatchObject({
      status: "error",
      message: "The vault cannot be a drive or share root. Choose the vault's own folder.",
      code: "obsidian_vault_path_root",
    });
    expect(statusFor(error)).toBe(422);
  });

  it("answers 422 for a connector's own 422 input error and for a 400 without a code", () => {
    const connectorError = new HttpError(422, "Configure the Vercel team ID for this connection.", { code: "vercel_team_required" });
    expect(sanitizeHttpFailure(connectorError).code).toBe("vercel_team_required");
    expect(statusFor(connectorError)).toBe(422);

    const uncoded = badRequest("Copy the tenant API Base URL from Cognee's API Keys page.");
    expect(sanitizeHttpFailure(uncoded)).toMatchObject({
      message: "Copy the tenant API Base URL from Cognee's API Keys page.",
      code: "connection_setup_invalid",
    });
    expect(statusFor(uncoded)).toBe(422);
    expect(statusFor(unprocessable("Reconnect AgentMail to restore its API key", { code: "missing_secret" }))).toBe(422);
  });

  it("keeps 502 for a genuine upstream or network failure", () => {
    // The egress guard reports network failures as 400s; they are still outages.
    expect(statusFor(badRequest("Remote MCP connection hostname did not resolve", { code: "remote_http_dns_failed" }))).toBe(502);
    expect(statusFor(badRequest("Could not connect", { code: "remote_http_connect_failed" }))).toBe(502);
    expect(statusFor(new HttpError(502, "Remote MCP server returned HTTP 503", { status: 503 }))).toBe(502);
    expect(sanitizeHttpFailure(new HttpError(502, "Remote MCP server returned HTTP 503")).code).toBe("paperclip_error");
    expect(statusFor(new HttpError(504, "The Vercel request timed out.", { code: "vercel_deadline_exceeded" }))).toBe(502);
    expect(statusFor(new Error("socket hang up"))).toBe(502);
  });
});
