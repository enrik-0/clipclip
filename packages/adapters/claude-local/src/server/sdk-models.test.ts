import { describe, expect, it } from "vitest";
import { mapSupportedModels } from "./sdk-models.js";

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
