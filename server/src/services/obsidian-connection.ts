import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OBSIDIAN_VAULT_TOOLS } from "./obsidian-vault-tools.generated.js";

/**
 * Obsidian has no hosted API: a vault is a folder of Markdown files on the
 * runtime host. Paperclip reaches it through the pinned `@bitbonsai/mcpvault`
 * stdio server, which reads the folder directly. Each connection names its own
 * vault, so one company can connect several.
 */
export const OBSIDIAN_VAULT_TEMPLATE_ID = "paperclip.obsidian-vault";
export const OBSIDIAN_VAULT_APP_SLUG = "obsidian";
const MCP_PACKAGE = "@bitbonsai/mcpvault";

export const OBSIDIAN_STDIO_TEMPLATE = {
  name: "Obsidian vault",
  // The command and its arguments depend on the connection's vault; see obsidianVaultCommand.
  command: null,
  args: [] as string[],
  envKeys: [] as string[],
  tools: OBSIDIAN_VAULT_TOOLS,
};

export class ObsidianVaultConfigError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ObsidianVaultConfigError";
  }
}

export interface ObsidianVaultSettings {
  vaultPath: string;
  readOnly: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Reads and checks the vault a connection points at. */
export function readObsidianVaultSettings(connectionConfig: unknown): ObsidianVaultSettings {
  const methodConfig = record(record(connectionConfig).methodConfig);
  const raw = typeof methodConfig.vaultPath === "string" ? methodConfig.vaultPath.trim() : "";
  if (!raw) throw new ObsidianVaultConfigError("Enter the folder of the Obsidian vault.", "obsidian_vault_path_missing");
  if (!path.isAbsolute(raw)) {
    throw new ObsidianVaultConfigError("The vault folder must be an absolute path.", "obsidian_vault_path_relative");
  }
  const vaultPath = path.resolve(raw);
  // A drive or share root exposes far more than notes, and the MCP server mishandles it.
  if (path.parse(vaultPath).root === vaultPath) {
    throw new ObsidianVaultConfigError("The vault cannot be a drive or share root. Choose the vault's own folder.", "obsidian_vault_path_root");
  }
  let isDirectory = false;
  try { isDirectory = existsSync(vaultPath) && statSync(vaultPath).isDirectory(); } catch { isDirectory = false; }
  if (!isDirectory) {
    throw new ObsidianVaultConfigError(
      "Paperclip cannot find that folder on the computer that runs it. Check the path of the vault.", "obsidian_vault_path_not_found");
  }
  return { vaultPath, readOnly: methodConfig.readOnly === true || methodConfig.readOnly === "true" };
}

let cachedEntry: string | null = null;

/** The stdio entry file of the bundled MCP server. */
function mcpServerEntry(): string {
  if (cachedEntry) return cachedEntry;
  // The package's `exports` hide its manifest from module resolution, so find
  // the installed folder the way Node does: nearest node_modules first.
  let manifestPath: string | null = null;
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", ...MCP_PACKAGE.split("/"), "package.json");
    if (existsSync(candidate)) { manifestPath = candidate; break; }
    if (path.dirname(dir) === dir) break;
  }
  if (!manifestPath) {
    throw new ObsidianVaultConfigError("The Obsidian MCP server is not installed with Paperclip.", "obsidian_mcp_server_missing");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: string | Record<string, string>; main?: string };
  const bin = typeof manifest.bin === "string" ? manifest.bin : Object.values(manifest.bin ?? {})[0];
  const entry = bin ?? manifest.main;
  if (!entry) throw new ObsidianVaultConfigError("The Obsidian MCP server has no entry file.", "obsidian_mcp_server_missing");
  cachedEntry = path.join(path.dirname(manifestPath), entry);
  return cachedEntry;
}

/**
 * The process that serves one connection's vault. It runs the Node binary
 * directly: the gateway starts commands without a shell.
 */
export function obsidianVaultCommand(connectionConfig: unknown): { command: string; args: string[] } {
  const settings = readObsidianVaultSettings(connectionConfig);
  return {
    command: process.execPath,
    args: [mcpServerEntry(), settings.vaultPath, ...(settings.readOnly ? ["--read-only"] : [])],
  };
}

const READ_ONLY_TOOL_NAMES = new Set(
  OBSIDIAN_VAULT_TOOLS.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name),
);

/** A read-only connection offers only the tools that read. */
export function obsidianToolAvailable(connectionConfig: unknown, toolName: string): boolean {
  const methodConfig = record(record(connectionConfig).methodConfig);
  const readOnly = methodConfig.readOnly === true || methodConfig.readOnly === "true";
  return !readOnly || READ_ONLY_TOOL_NAMES.has(toolName);
}
