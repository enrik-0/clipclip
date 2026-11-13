/**
 * Flags that keep a run from loading the operator's personal Claude setup.
 *
 * `claude` reads user-level settings from the shared config directory: enabled
 * plugins, personal skills, hooks and MCP servers (browser control, mail, ...).
 * Without isolation an agent inherits all of them. Credentials are not part of
 * the settings sources, so authentication keeps working.
 */
export function buildPersonalConfigIsolationArgs(input: {
  enabled: boolean;
  /** Paperclip already passes its own `--mcp-config ... --strict-mcp-config`. */
  hasRuntimeMcpServers: boolean;
}): string[] {
  if (!input.enabled) return [];
  const args = ["--setting-sources", "project,local"];
  if (!input.hasRuntimeMcpServers) {
    args.push("--mcp-config", '{"mcpServers":{}}', "--strict-mcp-config");
  }
  return args;
}
