import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  acpxRegistryAcceptsArgv,
  resolveAgentRegistryOverride,
  resolveWindowsNodeLaunchCommand,
  splitAgentCommandToArgv,
} from "./agent-command-argv.js";

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

describe("resolveWindowsNodeLaunchCommand", () => {
  function withInstall(run: (bin: string, script: string) => Promise<void>) {
    const root = mkdtempSync(path.join(tmpdir(), "Paperclip Desktop "));
    const packageDir = path.join(root, "node_modules", "@agentclientprotocol", "claude-agent-acp");
    const bin = path.join(root, "node_modules", ".bin", "claude-agent-acp.cmd");
    const script = path.join(packageDir, "dist", "index.js");
    mkdirSync(path.dirname(script), { recursive: true });
    mkdirSync(path.dirname(bin), { recursive: true });
    writeFileSync(bin, "");
    writeFileSync(script, "");
    writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ bin: { "claude-agent-acp": "dist/index.js" } }));
    return run(bin, script).finally(() => rmSync(root, { recursive: true, force: true }));
  }

  // acpx 0.12 cannot launch a .cmd shim whose path has spaces, quoted or not.
  it("launches the package script with node so that spaces survive both acpx lines", () =>
    withInstall(async (bin, script) => {
      const node = "C:\\Program Files\\nodejs\\node.exe";
      const command = await resolveWindowsNodeLaunchCommand(bin, "claude-agent-acp", node);
      expect(command).toBe(`"C:/Program Files/nodejs/node.exe" "${script.replaceAll("\\", "/")}"`);
      expect(resolveAgentRegistryOverride(command, "win32", true)).toEqual([
        "C:/Program Files/nodejs/node.exe",
        script.replaceAll("\\", "/"),
      ]);
    }));

  it("returns null when the package script cannot be found", async () => {
    await expect(resolveWindowsNodeLaunchCommand("claude-agent-acp", "claude-agent-acp", "node.exe")).resolves.toBeNull();
  });
});

describe("resolveAgentRegistryOverride", () => {
  it("returns the raw string on non-Windows platforms", () => {
    expect(resolveAgentRegistryOverride("gemini --acp", "linux")).toBe("gemini --acp");
  });

  it("returns an argv array on Windows because acpx rejects raw command strings there", () => {
    expect(resolveAgentRegistryOverride("gemini --acp", "win32", true)).toEqual(["gemini", "--acp"]);
  });

  it("keeps an unquoted executable path with spaces as a single argv entry", () => {
    // The built-in agent bin resolves to a bare path, and the Windows installer
    // puts it under "...\\Paperclip Desktop\\...".
    const dir = mkdtempSync(path.join(tmpdir(), "paperclip argv "));
    try {
      const bin = path.join(dir, "claude-agent-acp.cmd");
      writeFileSync(bin, "");
      expect(resolveAgentRegistryOverride(bin, "win32", true)).toEqual([bin]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
