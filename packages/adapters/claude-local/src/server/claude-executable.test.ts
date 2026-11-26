import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ configs: [] as Record<string, unknown>[] }));
vi.mock("@paperclipai/adapter-utils/acpx-engine/execute", () => ({
  createAcpxEngineExecutor: () => async (ctx: { config: Record<string, unknown> }) => {
    engine.configs.push(ctx.config);
    return { exitCode: 0, signal: null, timedOut: false };
  },
}));

import { createClaudeAcpExecutor } from "./acp.js";
import { resolveInstalledClaude } from "./claude-executable.js";

const isWindows = process.platform === "win32";
const binaryName = isWindows ? "claude.exe" : "claude";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "paperclip-claude-exe-"));
  engine.configs.length = 0;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function executable(...segments: string[]) {
  const file = path.join(root, ...segments);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "");
  await chmod(file, 0o755);
  return file;
}

const pathEnv = (...dirs: string[]) => ({ PATH: dirs.join(path.delimiter), PATHEXT: ".EXE;.CMD" });
const samePath = (actual: unknown, expected: string) =>
  expect(String(actual).toLowerCase()).toBe(expected.toLowerCase());

describe("resolveInstalledClaude", () => {
  it("finds the installed claude on PATH", async () => {
    const file = await executable("bin", binaryName);
    samePath(await resolveInstalledClaude({ env: pathEnv(path.dirname(file)) }), file);
  });

  it("returns null when claude is not installed", async () => {
    expect(await resolveInstalledClaude({ env: pathEnv(root) })).toBeNull();
    expect(await resolveInstalledClaude({ command: path.join(root, binaryName), env: pathEnv(root) })).toBeNull();
  });

  it("ignores a claude vendored in node_modules/.bin", async () => {
    const vendored = await executable("node_modules", ".bin", binaryName);
    const installed = await executable("bin", binaryName);
    samePath(
      await resolveInstalledClaude({ env: pathEnv(path.dirname(vendored), path.dirname(installed)) }),
      installed,
    );
  });

  it("honours CLAUDE_CODE_EXECUTABLE and a configured command", async () => {
    const custom = await executable("custom", binaryName);
    expect(await resolveInstalledClaude({ env: { CLAUDE_CODE_EXECUTABLE: "/opt/claude" } })).toBe("/opt/claude");
    samePath(await resolveInstalledClaude({ command: custom, env: pathEnv(root) }), custom);
  });

  it.runIf(isWindows)("follows an npm claude.cmd shim to its native executable, else gives up", async () => {
    const shim = await executable("npm", "claude.cmd");
    expect(await resolveInstalledClaude({ env: pathEnv(path.dirname(shim)) })).toBeNull();
    const native = await executable("npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    samePath(await resolveInstalledClaude({ env: pathEnv(path.dirname(shim)) }), native);
  });
});

describe("ACP runs use the installed claude", () => {
  async function run(config: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const resolve = vi.fn(async () => "/installed/claude");
    const execute = createClaudeAcpExecutor({ resolveClaudeExecutable: resolve });
    await execute({ config, ...extra } as never);
    return { env: (engine.configs.at(-1)!.env ?? {}) as Record<string, unknown>, resolve };
  }

  it("passes it to a local run, keeping the agent's env", async () => {
    const { env } = await run({ env: { FOO: "bar" }, model: "claude-opus-5-5" });
    expect(env).toMatchObject({ FOO: "bar", CLAUDE_CODE_EXECUTABLE: "/installed/claude" });
  });

  it("resolves the configured command", async () => {
    const { resolve } = await run({ command: "/custom/claude" });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ command: "/custom/claude" }));
  });

  it("keeps the agent's own CLAUDE_CODE_EXECUTABLE", async () => {
    const { env } = await run({ env: { CLAUDE_CODE_EXECUTABLE: "/mine/claude" } });
    expect(env.CLAUDE_CODE_EXECUTABLE).toBe("/mine/claude");
  });

  it("leaves a custom ACP server command alone", async () => {
    const { env } = await run({ agentCommand: "my-acp-server" });
    expect(env.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
  });

  it("does not send a host path to a remote run", async () => {
    const { env, resolve } = await run(
      {},
      { executionTarget: { kind: "remote", transport: "sandbox", providerKey: "test", remoteCwd: "/workspace" } },
    );
    expect(env.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("sets no executable when claude is not installed", async () => {
    const execute = createClaudeAcpExecutor({ resolveClaudeExecutable: async () => null });
    await execute({ config: {} } as never);
    expect((engine.configs.at(-1)!.env as Record<string, unknown> | undefined)?.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
  });
});
