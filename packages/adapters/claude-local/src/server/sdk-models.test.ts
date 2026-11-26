import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => sdk);

import { fetchClaudeCodeModels, mapSupportedModels } from "./sdk-models.js";

describe("fetchClaudeCodeModels", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    sdk.query.mockReset();
  });

  function stubQuery() {
    const close = vi.fn();
    sdk.query.mockReturnValue({
      supportedModels: async () => [{ value: "opus", resolvedModel: "claude-opus-9", displayName: "Opus 9" }],
      close,
    });
    return close;
  }

  it("runs isolated from user settings, hooks and MCP servers, and closes the process", async () => {
    const close = stubQuery();
    expect(await fetchClaudeCodeModels()).toEqual([{ id: "claude-opus-9", label: "Claude Opus 9" }]);
    expect(sdk.query.mock.calls[0]![0].options).toMatchObject({
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("asks the same executable ACP runs use: CLAUDE_CODE_EXECUTABLE, else the SDK built-in", async () => {
    stubQuery();
    vi.stubEnv("CLAUDE_CODE_EXECUTABLE", "");
    await fetchClaudeCodeModels();
    expect(sdk.query.mock.calls[0]![0].options.pathToClaudeCodeExecutable).toBeUndefined();
    vi.stubEnv("CLAUDE_CODE_EXECUTABLE", "/opt/claude/claude");
    await fetchClaudeCodeModels();
    expect(sdk.query.mock.calls[1]![0].options.pathToClaudeCodeExecutable).toBe("/opt/claude/claude");
  });
});

describe("mapSupportedModels", () => {
  it("uses versioned ids, drops the default row and dated snapshots, and dedupes", () => {
    const result = mapSupportedModels([
      { value: "default", resolvedModel: "claude-sonnet-5-5", displayName: "Default (recommended)" },
      { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5" },
      { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet 5.5" },
      { value: "claude-fable-5-1", resolvedModel: "claude-fable-5-1", displayName: "Fable 5.1" },
      { value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" },
      { value: "claude-opus-5-5", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5" },
      { value: "mystery", displayName: "No resolved model" },
    ]);
    expect(result).toEqual([
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ]);
  });

  it("ignores malformed input", () => {
    expect(mapSupportedModels(null)).toEqual([]);
    expect(mapSupportedModels([null, 3, {}, { value: 1 }])).toEqual([]);
  });
});
