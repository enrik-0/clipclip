import { describe, expect, it } from "vitest";
import { buildPersonalConfigIsolationArgs } from "./personal-config-isolation.js";

describe("buildPersonalConfigIsolationArgs", () => {
  it("adds nothing when isolation is off", () => {
    expect(buildPersonalConfigIsolationArgs({ enabled: false, hasRuntimeMcpServers: false })).toEqual([]);
  });

  it("skips user-level settings (plugins, skills, hooks) and user MCP servers", () => {
    expect(buildPersonalConfigIsolationArgs({ enabled: true, hasRuntimeMcpServers: false })).toEqual([
      "--setting-sources",
      "project,local",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--strict-mcp-config",
    ]);
  });

  it("does not duplicate MCP flags when Paperclip already supplies a strict MCP config", () => {
    expect(buildPersonalConfigIsolationArgs({ enabled: true, hasRuntimeMcpServers: true })).toEqual([
      "--setting-sources",
      "project,local",
    ]);
  });
});
