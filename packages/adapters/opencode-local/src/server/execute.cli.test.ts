import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@paperclipai/adapter-utils/execution-target", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});
vi.mock("./cli-version.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, detectOpenCodeCliVersion: vi.fn() };
});
vi.mock("./models.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, ensureOpenCodeModelConfiguredAndAvailable: vi.fn(async () => []) };
});

import { execute } from "./execute.js";
import { detectOpenCodeCliVersion, parseOpenCodeCliVersion } from "./cli-version.js";
import { ensureOpenCodeModelConfiguredAndAvailable } from "./models.js";
import { runAdapterExecutionTargetProcess } from "@paperclipai/adapter-utils/execution-target";

const runProcessMock = vi.mocked(runAdapterExecutionTargetProcess);
const detectVersionMock = vi.mocked(detectOpenCodeCliVersion);
const ensureModelMock = vi.mocked(ensureOpenCodeModelConfiguredAndAvailable);
const token = "run-scoped-secret-token";

describe("OpenCode CLI arguments and run MCP servers", () => {
  let root: string;
  let commandPath: string;
  let captured: { args: string[]; env: Record<string, string>; config: Record<string, any> } | null;
  let meta: Record<string, unknown> | null;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-cli-"));
    await fs.mkdir(path.join(root, "config"), { recursive: true });
    vi.stubEnv("XDG_CONFIG_HOME", path.join(root, "config"));
    commandPath = path.join(root, "opencode");
    await fs.writeFile(commandPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    captured = null;
    meta = null;
    runProcessMock.mockReset();
    runProcessMock.mockImplementation(async (_runId, _target, _command, args, options) => {
      const env = options.env as Record<string, string>;
      const config = JSON.parse(
        await fs.readFile(path.join(env.XDG_CONFIG_HOME!, "opencode", "opencode.json"), "utf8"),
      );
      captured = { args, env, config };
      return {
        exitCode: 0, signal: null, timedOut: false, stderr: "", pid: 1, startedAt: new Date().toISOString(),
        stdout: JSON.stringify({ type: "text", sessionID: "session-1", part: { text: "done" } }),
      } as never;
    });
    ensureModelMock.mockClear();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function run() {
    return execute({
      runId: "run-cli",
      agent: { id: "agent-1", companyId: "company-1", name: "OpenCode", adapterType: "opencode_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: commandPath, cwd: root, model: "openai/gpt-5", variant: "high" },
      context: {},
      runtimeMcp: {
        getServers: () => [
          { name: "Paperclip projects", url: "http://127.0.0.1:3100/api/mcp/project-tools", token, connectionId: "paperclip-project-tools" },
        ],
      },
      onLog: async () => {},
      onMeta: async (value) => { meta = value as unknown as Record<string, unknown>; },
    });
  }

  it("keeps the 1.x arguments and hands run MCP servers to OpenCode without leaking the token", async () => {
    detectVersionMock.mockResolvedValue(parseOpenCodeCliVersion("1.17.11"));
    const result = await run();
    expect(result.exitCode).toBe(0);
    expect(captured!.args.slice(0, 3)).toEqual(["run", "--format", "json"]);
    expect(captured!.args).not.toContain("--standalone");
    expect(captured!.args).toEqual(expect.arrayContaining(["--model", "openai/gpt-5", "--variant", "high", "--dir", root]));
    expect(captured!.config.mcp).toEqual({
      paperclip_projects: {
        type: "remote",
        url: "http://127.0.0.1:3100/api/mcp/project-tools",
        headers: { Authorization: `Bearer ${token}` },
        oauth: false,
      },
    });
    expect(JSON.stringify(meta)).not.toContain(token);
    expect(ensureModelMock).toHaveBeenCalledWith(expect.objectContaining({ standalone: false }));
  });

  it("uses a private server, model#variant and the working directory with the 2.x CLI", async () => {
    detectVersionMock.mockResolvedValue(parseOpenCodeCliVersion("opencode v2.3.0"));
    const result = await run();
    expect(result.exitCode).toBe(0);
    expect(captured!.args.slice(0, 4)).toEqual(["run", "--standalone", "--format", "json"]);
    expect(captured!.args).toEqual(expect.arrayContaining(["--model", "openai/gpt-5#high"]));
    expect(captured!.args).not.toContain("--variant");
    expect(captured!.args).not.toContain("--dir");
    expect(captured!.env.PWD).toBe(root);
    expect(captured!.config.mcp.paperclip_projects.url).toBe("http://127.0.0.1:3100/api/mcp/project-tools");
    expect(ensureModelMock).toHaveBeenCalledWith(expect.objectContaining({ standalone: true }));
    expect(String((meta as { commandNotes?: string[] } | null)?.commandNotes?.join("\n"))).toContain("OpenCode CLI 2.3.0");
  });
});

describe("parseOpenCodeCliVersion", () => {
  it.each([
    ["1.17.11", 1],
    ["opencode v2.3.0", 2],
    ["opencode 2.10.4\n", 2],
  ])("reads %s", (output, major) => {
    expect(parseOpenCodeCliVersion(output)?.major).toBe(major);
  });

  it("returns null for unrecognized output", () => {
    expect(parseOpenCodeCliVersion("")).toBeNull();
    expect(parseOpenCodeCliVersion("unknown")).toBeNull();
  });
});
