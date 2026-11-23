import { describe, expect, it } from "vitest";
import { acpxRegistryAcceptsArgv, resolveAgentRegistryOverride, splitAgentCommandToArgv } from "./agent-command-argv.js";

describe("splitAgentCommandToArgv", () => {
  it("splits plain whitespace-separated tokens", () => {
    expect(splitAgentCommandToArgv("gemini --acp")).toEqual(["gemini", "--acp"]);
    expect(splitAgentCommandToArgv("  kimi   acp ")).toEqual(["kimi", "acp"]);
  });

  it("keeps a quoted Windows path with spaces as one token and preserves backslashes", () => {
    expect(splitAgentCommandToArgv(`"C:\\Program Files\\nodejs\\node.exe" "C:/a b/acp.js"`)).toEqual([
      "C:\\Program Files\\nodejs\\node.exe",
      "C:/a b/acp.js",
    ]);
  });

  it("handles single quotes and an unquoted Windows path", () => {
    expect(splitAgentCommandToArgv(`'/opt/my agent/bin' --flag`)).toEqual(["/opt/my agent/bin", "--flag"]);
    expect(splitAgentCommandToArgv("C:\\repo\\node_modules\\.bin\\claude-agent-acp.cmd")).toEqual([
      "C:\\repo\\node_modules\\.bin\\claude-agent-acp.cmd",
    ]);
  });
});

describe("resolveAgentRegistryOverride", () => {
  it("returns the raw string on non-Windows platforms", () => {
    expect(resolveAgentRegistryOverride("gemini --acp", "linux")).toBe("gemini --acp");
  });

  it("returns an argv array on Windows because acpx rejects raw command strings there", () => {
    expect(resolveAgentRegistryOverride("gemini --acp", "win32", true)).toEqual(["gemini", "--acp"]);
  });

  it("keeps the raw string on Windows when the resolved acpx predates argv overrides", () => {
    expect(resolveAgentRegistryOverride("gemini --acp", "win32", false)).toBe("gemini --acp");
  });

  it("detects whether the installed acpx accepts argv", () => {
    expect(typeof acpxRegistryAcceptsArgv()).toBe("boolean");
  });

  it("returns undefined for empty commands", () => {
    expect(resolveAgentRegistryOverride(null, "win32", true)).toBeUndefined();
    expect(resolveAgentRegistryOverride("   ", "win32", true)).toBeUndefined();
  });
});
