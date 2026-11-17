import { runChildProcess } from "@paperclipai/adapter-utils/server-utils";

export type OpenCodeCliVersion = {
  version: string;
  major: number;
  minor: number;
  patch: number;
};

const VERSION_CACHE_TTL_MS = 5 * 60_000;
const VERSION_PROBE_TIMEOUT_SEC = 20;
const versionCache = new Map<string, { expiresAt: number; version: OpenCodeCliVersion | null }>();

export function parseOpenCodeCliVersion(output: string): OpenCodeCliVersion | null {
  const match = /(?:^|[\sv])(\d+)\.(\d+)\.(\d+)\b/.exec(output.trim());
  if (!match) return null;
  const [major, minor, patch] = [match[1], match[2], match[3]].map(Number) as [number, number, number];
  return { version: `${major}.${minor}.${patch}`, major, minor, patch };
}

/**
 * OpenCode 2.x routes CLI commands through a shared background service unless
 * `--standalone` is given, so the run's private config (XDG_CONFIG_HOME) would be
 * ignored. It also removed `run --dir` and `run --variant` (use `model#variant`).
 */
export function openCodeCliUsesBackgroundService(version: OpenCodeCliVersion | null): boolean {
  return (version?.major ?? 0) >= 2;
}

/** Reads `opencode --version` for a local command. Unknown output resolves to null (1.x arguments). */
export async function detectOpenCodeCliVersion(input: {
  command: string;
  cwd: string;
  env: Record<string, string>;
}): Promise<OpenCodeCliVersion | null> {
  const key = `${input.command}\u0000${input.env.PATH ?? ""}`;
  const now = Date.now();
  const cached = versionCache.get(key);
  if (cached && cached.expiresAt > now) return cached.version;
  let version: OpenCodeCliVersion | null = null;
  try {
    const result = await runChildProcess(
      `opencode-version-${now}-${Math.random().toString(16).slice(2)}`,
      input.command,
      ["--version"],
      { cwd: input.cwd, env: input.env, timeoutSec: VERSION_PROBE_TIMEOUT_SEC, graceSec: 2, onLog: async () => {} },
    );
    // Some 2.x builds print the version but exit non-zero, so trust the output, not the code.
    if (!result.timedOut) version = parseOpenCodeCliVersion(`${result.stdout}\n${result.stderr}`);
  } catch {
    version = null;
  }
  versionCache.set(key, { expiresAt: now + VERSION_CACHE_TTL_MS, version });
  return version;
}

export function resetOpenCodeCliVersionCacheForTests(): void {
  versionCache.clear();
}
