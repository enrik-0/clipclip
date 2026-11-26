import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { models as DIRECT_MODELS } from "../index.js";

const sdkModels = vi.hoisted(() => ({ fetchClaudeCodeModels: vi.fn() }));
vi.mock("./sdk-models.js", () => sdkModels);

import { listClaudeModels, refreshClaudeModels, resetClaudeModelsCacheForTests } from "./models.js";

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "PAPERCLIP_CLAUDE_MODELS_CATALOG_URL",
] as const;

const ids = (models: { id: string }[]) => models.map((model) => model.id);

const catalog = {
  anthropic: {
    models: {
      "claude-opus-9": { id: "claude-opus-9", name: "Claude Opus 9" },
      "claude-opus-9-20270101": { id: "claude-opus-9-20270101", name: "Claude Opus 9 (snapshot)" },
      "claude-sonnet-5-5": { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      "not-claude": { id: "gpt-x", name: "GPT X" },
    },
  },
  "amazon-bedrock": {
    models: { "us.anthropic.claude-opus-10": { id: "us.anthropic.claude-opus-10", name: "Bedrock" } },
  },
};

function mockCatalog(payload: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("listClaudeModels without ANTHROPIC_API_KEY", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    resetClaudeModelsCacheForTests();
    sdkModels.fetchClaudeCodeModels.mockReset();
    sdkModels.fetchClaudeCodeModels.mockResolvedValue([]);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });

  it("adds new claude-* models from the public catalog, merged and ordered", async () => {
    mockCatalog(catalog);
    const result = await listClaudeModels();
    const resultIds = ids(result);

    expect(resultIds).toContain("claude-fable-5-1");
    // Newest opus goes ahead of the older static opus entries.
    expect(resultIds.indexOf("claude-opus-9")).toBeGreaterThanOrEqual(0);
    expect(resultIds.indexOf("claude-opus-9")).toBeLessThan(resultIds.indexOf("claude-opus-5-5"));
    // Static entries keep their curated label; no duplicates.
    expect(result.find((m) => m.id === "claude-sonnet-5-5")?.label).toBe("Claude Sonnet 5.5");
    expect(new Set(resultIds).size).toBe(resultIds.length);
    // Ignores dated snapshots, other vendors and other providers' ids.
    expect(resultIds).not.toContain("claude-opus-9-20270101");
    expect(resultIds).not.toContain("gpt-x");
    expect(resultIds).not.toContain("us.anthropic.claude-opus-10");
  });

  it("falls back to the static list when the catalog request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(ids(await listClaudeModels())).toEqual(ids(DIRECT_MODELS));
  });

  it("falls back to the static list on a non-OK or malformed response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(ids(await listClaudeModels())).toEqual(ids(DIRECT_MODELS));
    resetClaudeModelsCacheForTests();
    mockCatalog({ unexpected: true });
    expect(ids(await listClaudeModels())).toEqual(ids(DIRECT_MODELS));
  });

  it("caches the catalog and refresh bypasses the cache", async () => {
    const fetchMock = mockCatalog(catalog);
    await listClaudeModels();
    await listClaudeModels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await refreshClaudeModels();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefers the models Claude Code reports and does not call the public catalog", async () => {
    sdkModels.fetchClaudeCodeModels.mockResolvedValue([{ id: "claude-opus-9", label: "Claude Opus 9" }]);
    const fetchMock = mockCatalog(catalog);
    const resultIds = ids(await listClaudeModels());
    expect(resultIds).toContain("claude-opus-9");
    expect(resultIds).toContain("claude-fable-5-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the public catalog when Claude Code reports nothing", async () => {
    const fetchMock = mockCatalog(catalog);
    expect(ids(await listClaudeModels())).toContain("claude-opus-9");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches the Claude Code result for a day and refresh bypasses the cache", async () => {
    vi.useFakeTimers();
    try {
      sdkModels.fetchClaudeCodeModels.mockResolvedValue([{ id: "claude-opus-9", label: "Claude Opus 9" }]);
      await listClaudeModels();
      vi.advanceTimersByTime(23 * 60 * 60 * 1000);
      await listClaudeModels();
      expect(sdkModels.fetchClaudeCodeModels).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await listClaudeModels();
      expect(sdkModels.fetchClaudeCodeModels).toHaveBeenCalledTimes(2);
      await refreshClaudeModels();
      expect(sdkModels.fetchClaudeCodeModels).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries after a few minutes, not on every request, when both sources fail", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
      await listClaudeModels();
      await listClaudeModels();
      expect(sdkModels.fetchClaudeCodeModels).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(6 * 60 * 1000);
      await listClaudeModels();
      expect(sdkModels.fetchClaudeCodeModels).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not keep a public catalog fallback for a whole day", async () => {
    vi.useFakeTimers();
    try {
      mockCatalog(catalog);
      await listClaudeModels();
      vi.advanceTimersByTime(6 * 60 * 1000);
      sdkModels.fetchClaudeCodeModels.mockResolvedValue([{ id: "claude-opus-11", label: "Claude Opus 11" }]);
      expect(ids(await listClaudeModels())).toContain("claude-opus-11");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the Claude Code list instead of the public catalog if a refresh cannot reach it", async () => {
    sdkModels.fetchClaudeCodeModels.mockResolvedValue([{ id: "claude-opus-11", label: "Claude Opus 11" }]);
    await listClaudeModels();
    sdkModels.fetchClaudeCodeModels.mockResolvedValue([]);
    const fetchMock = mockCatalog(catalog);
    const resultIds = ids(await refreshClaudeModels());
    expect(resultIds).toContain("claude-opus-11");
    expect(resultIds).not.toContain("claude-opus-9");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps serving the last good catalog if a later refresh fails", async () => {
    mockCatalog(catalog);
    await listClaudeModels();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(ids(await refreshClaudeModels())).toContain("claude-opus-9");
  });
});
