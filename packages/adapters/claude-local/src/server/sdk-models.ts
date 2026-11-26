import os from "node:os";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import { resolveInstalledClaude } from "./claude-executable.js";

const SDK_MODELS_TIMEOUT_MS = 20_000;
const DATED_SNAPSHOT_RE = /-\d{8}$/;

/**
 * Turn the SDK's `supportedModels()` rows into picker entries. Rows are either aliases
 * (`opus`, `sonnet`, `haiku`, `default`) or full ids. The versioned id is `resolvedModel`;
 * dated snapshots are folded into the bare alias id, as the static list does, and the
 * `default` row is dropped because it only repeats another row.
 */
export function mapSupportedModels(rows: unknown): AdapterModel[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const models: AdapterModel[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const { value, resolvedModel, displayName } = row as {
      value?: unknown;
      resolvedModel?: unknown;
      displayName?: unknown;
    };
    if (typeof value !== "string" || value === "default") continue;
    const raw = typeof resolvedModel === "string" && resolvedModel.trim() ? resolvedModel.trim() : "";
    if (!raw.startsWith("claude-")) continue;
    const id = raw.replace(DATED_SNAPSHOT_RE, "");
    if (seen.has(id)) continue;
    seen.add(id);
    const name = typeof displayName === "string" ? displayName.trim() : "";
    const label = !name ? id : /^claude\b/i.test(name) ? name : `Claude ${name}`;
    models.push({ id, label });
  }
  return models;
}

/**
 * Ask Claude Code which models it supports. Works with a subscription login:
 * no API key and no prompt is sent, so it costs no tokens. Returns [] on any failure so the
 * caller can fall back to another source.
 */
export async function fetchClaudeCodeModels(): Promise<AdapterModel[]> {
  let release: (() => void) | undefined;
  let query: { supportedModels(): Promise<unknown>; close(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { query: sdkQuery } = await import("@anthropic-ai/claude-agent-sdk");
    const idle = new Promise<void>((resolve) => {
      release = resolve;
    });
    // An idle prompt stream keeps the session open without ever sending a message.
    async function* prompt(): AsyncGenerator<never> {
      await idle;
    }
    const executable = await resolveInstalledClaude();
    query = sdkQuery({
      prompt: prompt(),
      options: {
        cwd: os.tmpdir(),
        // Listing models must not run the user's hooks, plugins or MCP servers.
        settingSources: [],
        strictMcpConfig: true,
        persistSession: false,
        // The same executable ACP runs use; undefined means the SDK built-in one.
        pathToClaudeCodeExecutable: executable ?? undefined,
      },
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), SDK_MODELS_TIMEOUT_MS);
    });
    return mapSupportedModels(await Promise.race([query.supportedModels(), timeout]));
  } catch (error) {
    console.warn("[paperclip] Claude Code model discovery failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  } finally {
    if (timer) clearTimeout(timer);
    release?.();
    try {
      query?.close();
    } catch {
      // The process is already gone.
    }
  }
}
