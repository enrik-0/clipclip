/**
 * acpx refuses raw agent command strings on Windows ("Raw agent command strings
 * are not supported on Windows") and requires an argv array instead. The ACPX
 * engine builds agent commands as strings (shared with POSIX shell launches), so
 * Windows runs convert them to argv at the registry boundary.
 */
import { createRequire } from "node:module";

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
  const argv = splitAgentCommandToArgv(trimmed);
  return argv.length > 0 ? argv : undefined;
}
