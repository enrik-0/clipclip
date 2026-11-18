import { describe, expect, it } from "vitest";
import { checkToolArgumentsAgainstSchema } from "./tool-argument-schema.js";

// The Obsidian vault move_file schema, as listed by the vault MCP server.
const moveFileSchema = {
  type: "object",
  properties: {
    oldPath: { type: "string" },
    newPath: { type: "string" },
    confirmOldPath: { type: "string" },
    confirmNewPath: { type: "string" },
    overwrite: { type: "boolean", default: false },
  },
  required: ["oldPath", "newPath", "confirmOldPath", "confirmNewPath"],
};

describe("checkToolArgumentsAgainstSchema", () => {
  it("names missing and unknown properties and lists the expected names", () => {
    const result = checkToolArgumentsAgainstSchema("move_file", moveFileSchema, {
      from: "esquema-backup.png",
      to: "Procedimientos/esquema-backup.png",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingProperties).toEqual(["oldPath", "newPath", "confirmOldPath", "confirmNewPath"]);
    expect(result.unknownProperties).toEqual(["from", "to"]);
    expect(result.expectedProperties).toEqual(["oldPath", "newPath", "confirmOldPath", "confirmNewPath", "overwrite"]);
    expect(result.message).toContain("Missing required properties: oldPath, newPath, confirmOldPath, confirmNewPath");
    expect(result.message).toContain("Unknown properties: from, to");
    expect(result.message).toContain(
      "Expected properties: oldPath (required), newPath (required), confirmOldPath (required), confirmNewPath (required), overwrite",
    );
    expect(result.message).toContain("No approval was requested");
  });

  it("accepts arguments that match the schema and does not change them", () => {
    const args = { oldPath: "a.png", newPath: "b/a.png", confirmOldPath: "a.png", confirmNewPath: "b/a.png" };
    const before = JSON.stringify(args);
    expect(checkToolArgumentsAgainstSchema("move_file", moveFileSchema, args)).toEqual({ ok: true });
    expect(JSON.stringify(args)).toBe(before);
  });

  it("rejects an unknown property even when all required properties are present", () => {
    const result = checkToolArgumentsAgainstSchema("move_file", moveFileSchema, {
      oldPath: "a", newPath: "b", confirmOldPath: "a", confirmNewPath: "b", force: true,
    });
    expect(result).toMatchObject({ ok: false, missingProperties: [], unknownProperties: ["force"] });
  });

  it("reports a type mismatch without coercing the value", () => {
    const result = checkToolArgumentsAgainstSchema("move_file", moveFileSchema, {
      oldPath: "a", newPath: "b", confirmOldPath: "a", confirmNewPath: "b", overwrite: "true",
    });
    expect(result).toMatchObject({ ok: false, invalidValues: ["overwrite must be boolean"] });
  });

  it("rejects arguments that are not an object when the schema expects one", () => {
    expect(checkToolArgumentsAgainstSchema("move_file", moveFileSchema, ["a", "b"])).toMatchObject({ ok: false });
  });

  it.each([
    ["no schema", undefined],
    ["an empty schema", {}],
    ["an object schema without properties", { type: "object" }],
    ["a schema that cannot be compiled", { type: "object", properties: { a: { $ref: "#/missing" } }, required: ["a"] }],
  ])("passes arguments through for %s", (_label, schema) => {
    expect(checkToolArgumentsAgainstSchema("tool", schema, { anything: 1 })).toEqual({ ok: true });
  });

  it("allows undeclared properties when the schema allows them", () => {
    expect(checkToolArgumentsAgainstSchema("tool", {
      type: "object", properties: { a: { type: "string" } }, additionalProperties: true,
    }, { a: "x", b: 1 })).toEqual({ ok: true });
    expect(checkToolArgumentsAgainstSchema("tool", {
      type: "object", properties: { a: { type: "string" } }, patternProperties: { "^x-": {} },
    }, { a: "x", "x-extra": 1 })).toEqual({ ok: true });
  });

  it("accepts a draft 2020-12 schema", () => {
    expect(checkToolArgumentsAgainstSchema("tool", {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object", properties: { a: { type: "string" } }, required: ["a"],
    }, {})).toMatchObject({ ok: false, missingProperties: ["a"] });
  });
});
