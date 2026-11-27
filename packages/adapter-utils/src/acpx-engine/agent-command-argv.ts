/**
 * acpx refuses raw agent command strings on Windows ("Raw agent command strings
 * are not supported on Windows") and requires an argv array instead. The ACPX
 * engine builds agent commands as strings (shared with POSIX shell launches), so
 * Windows runs convert them to argv at the registry boundary.
 */
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

function isExistingFile(candidate: string): boolean {
  if (!path.isAbsolute(candidate)) return false;
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Split a command line into argv. Honors single and double quotes. Backslashes
 * are NOT escapes, so Windows paths such as `C:\Program Files\node.exe` survive.
 */
export function splitAgentCommandToArgv(command: string): string[] {
  const argv: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let inToken = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
    } else if (/\s/u.test(char)) {
      if (inToken) {
        argv.push(current);
        current = "";
        inToken = false;
      }
    } else {
      current += char;
      inToken = true;
    }
  }
  if (inToken) argv.push(current);
  return argv;
}

/**
 * Windows launch command for a built-in agent package: node plus the package's
 * own script, instead of the `node_modules/.bin/*.cmd` shim. acpx runs a `.cmd`
 * through `cmd.exe` and 0.12 does not quote its path, so an install folder with
 * spaces ("Paperclip Desktop") fails to start. Returns null when the script is
 * not next to the shim, so the caller keeps its previous command.
 */
export async function resolveWindowsNodeLaunchCommand(
  binPath: string,
  binName: string,
  nodePath: string = process.execPath,
): Promise<string | null> {
  if (!path.isAbsolute(binPath)) return null;
  const packageDir = path.join(path.dirname(path.dirname(binPath)), "@agentclientprotocol", binName);
  try {
    const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const relative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
    if (!relative) return null;
    const script = path.join(packageDir, relative);
    if (!isExistingFile(script)) return null;
    // Forward slashes and double quotes parse the same in acpx 0.12 and in
    // splitAgentCommandToArgv.
    return [nodePath, script].map((part) => JSON.stringify(part.replaceAll("\\", "/"))).join(" ");
  } catch {
    return null;
  }
}

/**
 * acpx >= 0.13 accepts argv arrays as registry overrides (and demands them on
 * Windows). 0.12 only understands strings and would mangle an array. This
 * package declares 0.12 while the server ships 0.13, so detect what resolves.
 * Unknown versions are assumed to be the newer line.
 */
export function acpxRegistryAcceptsArgv(): boolean {
  try {
    const { version } = createRequire(import.meta.url)("acpx/package.json") as { version?: string };
    const [major = 0, minor = 0] = (version ?? "").split(".").map((part) => Number.parseInt(part, 10));
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return true;
    return major > 0 || minor >= 13;
  } catch {
    return true;
  }
}

/** Value for acpx `createAgentRegistry({ overrides })`: argv on Windows, string elsewhere. */
export function resolveAgentRegistryOverride(
  command: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
  acceptsArgv: boolean = acpxRegistryAcceptsArgv(),
): string | string[] | undefined {
  const trimmed = command?.trim();
  if (!trimmed) return undefined;
  if (platform !== "win32" || !acceptsArgv) return trimmed;
  // The built-in agent bin arrives unquoted and its install folder can contain
  // spaces ("Paperclip Desktop"). Never split a path that names a real file.
  if (isExistingFile(trimmed)) return [trimmed];
  const argv = splitAgentCommandToArgv(trimmed);
  return argv.length > 0 ? argv : undefined;
}
