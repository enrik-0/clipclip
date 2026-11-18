import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { runSetupTokenLogin } from "@paperclipai/adapter-claude-local/server";
import { runDeviceLogin } from "@paperclipai/adapter-codex-local/server";
import { ensureCommandResolvable, resolveCommandForLogs } from "@paperclipai/adapter-utils/server-utils";
import { resolveCodexCommand, startAntigravityBrowserLogin } from "../vendor/paperclip-runner/index.js";

export type LocalBrowserLoginState = {
  authorizationUrl?: string;
  code?: string;
  outcome?: "success" | "failure";
  error?: string;
  submitCode?: (code: string) => void;
  abort: () => void;
};

// Node has no built-in PTY API. Python's standard-library pty module supplies
// the terminal required by both CLIs. The Docker image already includes
// python3. This bridge forwards only bytes; provider output is never logged.
const PYTHON_PTY_BRIDGE = String.raw`
import errno, os, pty, select, signal, sys
pid, master = pty.fork()
if pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
def stop(_signal, _frame):
    try: os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError: pass
    sys.exit(1)
signal.signal(signal.SIGTERM, stop)
while True:
    readable, _, _ = select.select([master, 0], [], [])
    if 0 in readable:
        data = os.read(0, 4096)
        if data: os.write(master, data)
        else: stop(None, None)
    if master in readable:
        try: data = os.read(master, 4096)
        except OSError as error:
            if error.errno == errno.EIO: break
            raise
        if not data: break
        os.write(1, data)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;

const WINDOWS_PTY_UNAVAILABLE = "Browser sign-in on Windows requires the optional ConPTY dependency (@lydell/node-pty). Reinstall Paperclip's dependencies, then start sign-in again.";
const WINDOWS_GOOGLE_UNSUPPORTED = "Google sign-in is not supported on Windows hosts. Run Paperclip on Linux, macOS or WSL, or use a sandbox environment.";
const CLAUDE_CODE_NOT_ACCEPTED = "Claude did not accept the code (it may be incomplete, expired or already used). Start sign-in again and paste the new code.";
const CLAUDE_TOKEN_NOT_READ = "Claude finished signing in, but Paperclip could not read the token from its screen. The installed Claude CLI may have changed its output; update Paperclip or report this, then start sign-in again.";
const NO_LINK_PRODUCED ="Sign-in ended before a link was produced. Make sure the provider CLI is installed and working on this host, then start sign-in again.";

// Minimal view of the pieces of the optional node-pty module that are used.
type WindowsPty = {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
  write(data: string): void;
  kill(): void;
};
type WindowsPtyModule = {
  spawn(file: string, args: string[] | string, options: {
    name: string; cols: number; rows: number; cwd: string; env: Record<string, string>;
  }): WindowsPty;
};

/** ConPTY via node-pty. Windows has no Python `pty` module, so the Python bridge cannot run there. */
async function loadWindowsPty(): Promise<WindowsPtyModule> {
  const loaded = await import("@lydell/node-pty") as unknown as WindowsPtyModule & { default?: WindowsPtyModule };
  return typeof loaded.spawn === "function" ? loaded : loaded.default!;
}

/** Run the same browser-code login used by sandbox connections on the local host. */
export function startLocalBrowserLogin(provider: "anthropic" | "openai" | "google", home: string): LocalBrowserLoginState {
  if (provider === "google") {
    // The native Antigravity runner relies on POSIX descriptors and file ownership checks.
    if (process.platform === "win32") return { outcome: "failure", error: WINDOWS_GOOGLE_UNSUPPORTED, abort: () => undefined };
    return startAntigravityBrowserLogin(home);
  }
  const controller = new AbortController();
  const state: LocalBrowserLoginState = { abort: () => controller.abort() };
  const args = provider === "anthropic" ? ["setup-token"] : ["login", "--device-auth"];
  let child: ChildProcessWithoutNullStreams | null = null;
  let windowsPty: WindowsPty | null = null;
  let windowsPtyExited = false;
  const driver = {
    async start(_command: string, onData: (chunk: string) => void): Promise<{ exitCode: number | null }> {
      const windows = process.platform === "win32";
      let executable = "claude";
      if (provider === "anthropic" && windows) {
        try {
          await ensureCommandResolvable("claude", home, process.env);
          executable = path.resolve(home, await resolveCommandForLogs("claude", home, process.env));
        } catch {
          state.error = "Claude browser sign-in requires the Claude Code CLI on this host. Install Claude Code and ensure claude is on Paperclip's PATH, then start sign-in again.";
          throw new Error("Browser login runtime unavailable");
        }
      }
      if (provider === "openai") {
        const legacyPlatform = !((process.platform === "linux" || process.platform === "darwin")
          && (process.arch === "x64" || process.arch === "arm64"));
        const codexOnPath = async () => {
          await ensureCommandResolvable("codex", home, process.env);
          return path.resolve(home, await resolveCommandForLogs("codex", home, process.env));
        };
        try {
          if (windows) {
            // Prefer the Codex that ships with Paperclip (@openai/codex); fall back to
            // one on PATH. Its launcher is a .js file, which is started through node.
            try {
              const shipped = resolveCodexCommand();
              if (typeof shipped !== "string" || !shipped) throw new Error("no shipped Codex");
              executable = shipped;
            } catch {
              executable = await codexOnPath();
            }
          } else if (legacyPlatform) {
            executable = await codexOnPath();
          } else {
            executable = resolveCodexCommand();
          }
        } catch {
          state.error = legacyPlatform
            ? "Codex browser sign-in requires the Codex CLI on this platform. Install Codex on this execution host and ensure codex is on Paperclip's PATH, then start sign-in again."
            : "Codex browser sign-in requires an installed Codex CLI. Install Codex on this execution host or restore Paperclip's runtime dependencies, then start sign-in again.";
          throw new Error("Browser login runtime unavailable");
        }
      }
      if (controller.signal.aborted) throw new Error("Local sign-in cancelled before launch");
      const env = { ...process.env,
        ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", CLAUDE_CODE_OAUTH_TOKEN: "",
        OPENAI_API_KEY: "", CODEX_API_KEY: "",
        CLAUDE_CONFIG_DIR: provider === "anthropic" ? home : process.env.CLAUDE_CONFIG_DIR,
        CODEX_HOME: provider === "openai" ? home : process.env.CODEX_HOME,
        BROWSER: "true",
      };
      if (windows) {
        let pty: WindowsPtyModule;
        try { pty = await loadWindowsPty(); } catch {
          state.error = WINDOWS_PTY_UNAVAILABLE;
          throw new Error("Browser login terminal unavailable");
        }
        const ptyEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(env)) if (typeof value === "string") ptyEnv[key] = value;
        // ConPTY cannot execute .cmd/.bat shims (npm installs) directly; run them through cmd.exe.
        const shim = /\.(cmd|bat)$/i.test(executable);
        // A JavaScript launcher (the shipped Codex) is not an executable either: run it with node.
        const script = /\.(c|m)?js$/i.test(executable);
        const file = shim ? (process.env.ComSpec ?? "cmd.exe") : script ? process.execPath : executable;
        const commandArgs: string[] | string = shim ? `/d /s /c ""${executable}" ${args.join(" ")}"` : script ? [executable, ...args] : args;
        return new Promise((resolve, reject) => {
          try {
            const terminal = pty.spawn(file, commandArgs, { name: "xterm-256color", cols: 200, rows: 50, cwd: process.cwd(), env: ptyEnv });
            windowsPty = terminal;
            // Provider output may contain secrets: forward it to the parser only, never log it.
            terminal.onData(onData);
            terminal.onExit(({ exitCode }) => { windowsPtyExited = true; resolve({ exitCode }); });
          } catch {
            state.error = WINDOWS_PTY_UNAVAILABLE;
            reject(new Error("Browser login terminal unavailable"));
          }
        });
      }
      return new Promise((resolve, reject) => {
        child = spawn("python3", ["-u", "-c", PYTHON_PTY_BRIDGE, executable, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
        child.stdout.on("data", (bytes: Buffer) => onData(bytes.toString("utf8")));
        // Provider output may contain secrets. Never log or retain stderr.
        child.stderr.resume();
        child.once("error", () => {
          state.error = "Browser sign-in requires Python 3 and a working local terminal. Install Python 3 on this execution host, then start sign-in again.";
          reject(new Error("Browser login terminal unavailable"));
        });
        child.once("close", (exitCode) => resolve({ exitCode }));
      });
    },
    write(input: string) { if (windowsPty) windowsPty.write(input); else child?.stdin.write(input); },
    stop() { try { if (!windowsPtyExited) windowsPty?.kill(); } catch { /* already exited */ } child?.kill("SIGTERM"); },
    async dispose() { try { if (!windowsPtyExited) windowsPty?.kill(); } catch { /* already exited */ } child?.kill("SIGTERM"); },
    async readFile(file: string) { const { readLocalAiCredentialFile } = await import("./local-ai-credential-file.js"); return Buffer.from(await readLocalAiCredentialFile(file)); },
  };
  if (provider === "anthropic") {
    let deliverCode: ((code: string) => void) | undefined;
    const codeReady = new Promise<string>((resolve) => { deliverCode = resolve; });
    state.submitCode = (code) => { deliverCode?.(code); deliverCode = undefined; };
    void runSetupTokenLogin(driver, {
      timeoutMs: 300_000, signal: controller.signal,
      // The runner logs only fixed, non-secret sentences. Turn the two that end a
      // sign-in after the link was shown into an actionable reason for the card.
      log: (line) => {
        if (!state.authorizationUrl) return;
        if (line.includes("ended with a non-zero exit code")) state.error ??= CLAUDE_CODE_NOT_ACCEPTED;
        else if (line.includes("the credential did not land")) state.error ??= CLAUDE_TOKEN_NOT_READ;
      },
      onPrompt: (prompt) => { state.authorizationUrl = prompt.url; },
      provideCode: (signal) => new Promise<string>((resolve, reject) => {
        const abort = () => reject(new Error("Local sign-in cancelled"));
        if (signal.aborted) { abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
        codeReady.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      }),
      onCredential: async (bytes) => {
        const file = await open(path.join(home, ".credentials.json"),
          // O_NOFOLLOW does not exist on Windows; an undefined flag must not poison the mask.
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
          await file.writeFile(JSON.stringify({ claudeAiOauth: { accessToken: bytes.toString("utf8") } }));
        } finally {
          await file.close();
        }
      },
    }).then((result) => {
      state.outcome = result.outcome === "success" ? "success" : "failure";
      if (state.outcome === "failure" && !state.authorizationUrl) state.error ??= NO_LINK_PRODUCED;
    }).catch(() => { state.outcome = "failure"; });
  } else {
    void runDeviceLogin(driver, {
      timeoutMs: 300_000, signal: controller.signal,
      onPrompt: (prompt) => { state.authorizationUrl = prompt.url; state.code = prompt.code; },
    }).then((result) => {
      state.outcome = result.outcome === "success" ? "success" : "failure";
      if (state.outcome === "failure" && !state.authorizationUrl) state.error ??= NO_LINK_PRODUCED;
    }).catch(() => { state.outcome = "failure"; });
  }
  return state;
}
