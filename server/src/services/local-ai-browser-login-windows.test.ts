import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Windows has no Python `pty` module, so subscription sign-in must run through
// ConPTY (node-pty). These tests simulate a Windows host on any platform.

const ptyMock = vi.hoisted(() => ({ spawn: vi.fn() }));
const childProcessMock = vi.hoisted(() => ({ spawn: vi.fn() }));
const resolverMock = vi.hoisted(() => ({
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async (command: string) => `C:\\tools\\${command}.exe`),
}));
const runnerMock = vi.hoisted(() => ({ resolveCodexCommand: vi.fn(), startAntigravityBrowserLogin: vi.fn() }));

vi.mock("@lydell/node-pty", () => ({ spawn: ptyMock.spawn }));
vi.mock("node:child_process", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:child_process")>()), spawn: childProcessMock.spawn }));
vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => ({ ...(await importOriginal<object>()), ...resolverMock }));
vi.mock("../vendor/paperclip-runner/index.js", () => runnerMock);

import { startLocalBrowserLogin } from "./local-ai-browser-login.js";

const initialPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const CLAUDE_URL = "https://claude.com/cai/oauth/authorize?client_id=cid&code=abcdefgh&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&response_type=code&scope=user&state=0123456789abcdef";

let home: string;
beforeEach(async () => {
  Object.defineProperty(process, "platform", { ...initialPlatform, value: "win32" });
  home = await mkdtemp(path.join(os.tmpdir(), "paperclip-win-login-"));
});
afterEach(async () => {
  Object.defineProperty(process, "platform", initialPlatform);
  vi.clearAllMocks();
  resolverMock.resolveCommandForLogs.mockImplementation(async (command: string) => `C:\\tools\\${command}.exe`);
  await rm(home, { recursive: true, force: true });
});

/** A scripted terminal: emits `lines` once the listener is attached, then reacts to input. */
function fakeTerminal(script: { lines: string[]; onWrite?: (input: string, emit: (data: string) => void, exit: (code: number) => void) => void; exitAfterLines?: number }) {
  let dataListener: (data: string) => void = () => undefined;
  let exitListener: (event: { exitCode: number }) => void = () => undefined;
  const exit = (code: number) => exitListener({ exitCode: code });
  const terminal = {
    onData: (listener: (data: string) => void) => { dataListener = listener; },
    onExit: (listener: (event: { exitCode: number }) => void) => { exitListener = listener; },
    write: vi.fn((data: string) => script.onWrite?.(data, dataListener, exit)),
    kill: vi.fn(() => exit(1)),
  };
  queueMicrotask(() => setTimeout(() => {
    for (const line of script.lines) dataListener(line);
    if (script.exitAfterLines !== undefined) exit(script.exitAfterLines);
  }, 5));
  return terminal;
}

describe("local browser subscription login on Windows", () => {
  it("surfaces the Claude authorization link through ConPTY instead of Python", async () => {
    ptyMock.spawn.mockImplementation(() => fakeTerminal({
      lines: [
        "Welcome to Claude Code\r\nOpening browser to sign in…\r\nBrowser didn't open? Use the url below to sign in (c to copy)\r\n",
        `${CLAUDE_URL}\r\n`,
        "Paste code here if prompted >\r\n",
      ],
      onWrite: (input, emit, exit) => {
        if (input !== "\r") return; // the runner writes the code first, then a separate Return
        emit("✓ Long-lived authentication token created successfully!\r\n\r\nYour OAuth token (valid for 1 year):\r\n\r\nsk-ant-oat01-AAAABBBBCCCCDDDDEEEE11112222FFFFGGGG_HHHH-IIII\r\n\r\nStore this token securely. You won't be able to see it again.\r\n");
        exit(0);
      },
    }));
    const login = startLocalBrowserLogin("anthropic", home);
    await vi.waitFor(() => expect(login.authorizationUrl).toBe(CLAUDE_URL), { timeout: 5000 });
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
    const [file, args, options] = ptyMock.spawn.mock.calls[0]!;
    expect(file).toBe("C:\\tools\\claude.exe");
    expect(args).toEqual(["setup-token"]);
    expect(options.cwd).toBe(home);
    expect(options.env.CLAUDE_CONFIG_DIR).toBe(home);
    expect(options.env.ANTHROPIC_API_KEY).toBe("");
    login.submitCode?.("fixture-code");
    await vi.waitFor(() => expect(login.outcome).toBe("success"), { timeout: 5000 });
    const credential = JSON.parse(await readFile(path.join(home, ".credentials.json"), "utf8"));
    expect(credential.claudeAiOauth.accessToken).toMatch(/^sk-ant-oat01-/);
  });

  it("surfaces the Codex device link and code through ConPTY", async () => {
    ptyMock.spawn.mockImplementation(() => fakeTerminal({
      lines: [
        "1. Open this link in your browser and sign in to your account\r\nhttps://auth.openai.com/codex/device\r\n2. Enter this one-time code (expires in 15 minutes)\r\nABCD-EFGHJ\r\n",
      ],
      exitAfterLines: 0,
    }));
    const login = startLocalBrowserLogin("openai", home);
    await vi.waitFor(() => expect(login.outcome).toBe("success"), { timeout: 5000 });
    expect(login.authorizationUrl).toBe("https://auth.openai.com/codex/device");
    expect(login.code).toBe("ABCD-EFGHJ");
    expect(ptyMock.spawn.mock.calls[0]![1]).toEqual(["login", "--device-auth"]);
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  it("runs npm .cmd shims through cmd.exe because ConPTY cannot execute them directly", async () => {
    resolverMock.resolveCommandForLogs.mockResolvedValue("C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd");
    ptyMock.spawn.mockImplementation(() => fakeTerminal({ lines: [], exitAfterLines: 1 }));
    const login = startLocalBrowserLogin("anthropic", home);
    await vi.waitFor(() => expect(login.outcome).toBe("failure"), { timeout: 5000 });
    const [file, args] = ptyMock.spawn.mock.calls[0]!;
    expect(String(file).toLowerCase()).toMatch(/cmd(\.exe)?$/);
    expect(args).toContain("claude.cmd");
    expect(String(args)).toMatch(/\/c/);
  });

  it("explains a missing Claude CLI without leaking the host PATH", async () => {
    resolverMock.ensureCommandResolvable.mockRejectedValueOnce(new Error("Command not found in PATH: claude (C:\\secret\\bin)"));
    const login = startLocalBrowserLogin("anthropic", home);
    await vi.waitFor(() => expect(login.outcome).toBe("failure"), { timeout: 5000 });
    expect(login.error).toMatch(/requires the Claude Code CLI.*Install Claude Code/);
    expect(JSON.stringify(login)).not.toContain("secret");
    expect(ptyMock.spawn).not.toHaveBeenCalled();
  });

  it("explains a failing terminal instead of staying silent", async () => {
    ptyMock.spawn.mockImplementation(() => { throw new Error("ConPTY unavailable on C:\\private"); });
    const login = startLocalBrowserLogin("openai", home);
    await vi.waitFor(() => expect(login.outcome).toBe("failure"), { timeout: 5000 });
    expect(login.error).toMatch(/ConPTY/);
    expect(JSON.stringify(login)).not.toContain("private");
  });

  it("reports a clear error when the CLI exits without producing a link", async () => {
    ptyMock.spawn.mockImplementation(() => fakeTerminal({ lines: ["private-provider-output\r\n"], exitAfterLines: 1 }));
    const login = startLocalBrowserLogin("anthropic", home);
    await vi.waitFor(() => expect(login.outcome).toBe("failure"), { timeout: 5000 });
    expect(login.error).toMatch(/ended before a link was produced/);
    expect(JSON.stringify(login)).not.toContain("private-provider-output");
  });

  it("kills the terminal when sign-in is cancelled", async () => {
    let terminal: ReturnType<typeof fakeTerminal> | undefined;
    ptyMock.spawn.mockImplementation(() => (terminal = fakeTerminal({ lines: [] })));
    const login = startLocalBrowserLogin("openai", home);
    await vi.waitFor(() => expect(terminal).toBeDefined(), { timeout: 5000 });
    login.abort();
    await vi.waitFor(() => expect(login.outcome).toBe("failure"), { timeout: 5000 });
    expect(terminal!.kill).toHaveBeenCalled();
  });

  it("states that Google sign-in is unsupported on Windows instead of failing generically", async () => {
    const login = startLocalBrowserLogin("google", home);
    expect(login.outcome).toBe("failure");
    expect(login.error).toMatch(/not supported on Windows.*Linux, macOS or WSL/);
    expect(runnerMock.startAntigravityBrowserLogin).not.toHaveBeenCalled();
    expect(ptyMock.spawn).not.toHaveBeenCalled();
  });
});
