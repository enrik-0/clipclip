import { access } from "node:fs/promises";
import path from "node:path";
import { resolveCommandForLogs } from "@paperclipai/adapter-utils/server-utils";

const VENDORED_BIN_RE = /[\\/]node_modules[\\/]\.bin[\\/]?$/;

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/**
 * Locate the operator's installed Claude Code, so that the model picker and ACP runs use the
 * same executable. Returns null when there is none the Claude Agent SDK can start; both then
 * use the SDK built-in executable.
 */
export async function resolveInstalledClaude(
  input: { command?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<string | null> {
  const env = input.env ?? process.env;
  const explicit = env.CLAUDE_CODE_EXECUTABLE?.trim();
  if (explicit) return explicit;

  // A `claude` that some dependency vendors into node_modules/.bin is not the operator's install.
  const searchPath = (env.PATH ?? env.Path ?? "")
    .split(path.delimiter)
    .filter((dir) => dir && !VENDORED_BIN_RE.test(dir))
    .join(path.delimiter);
  const resolved = await resolveCommandForLogs(
    input.command?.trim() || "claude",
    input.cwd ?? process.cwd(),
    { ...env, PATH: searchPath },
  );
  if (!path.isAbsolute(resolved) || !(await exists(resolved))) return null;
  if (process.platform !== "win32") return resolved;
  if (/\.(exe|js)$/i.test(resolved)) return resolved;
  // The SDK cannot start a .cmd shim; an npm install keeps the native executable next to it.
  const native = path.join(path.dirname(resolved), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  return (await exists(native)) ? native : null;
}
