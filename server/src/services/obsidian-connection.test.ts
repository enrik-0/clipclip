import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  OBSIDIAN_STDIO_TEMPLATE,
  ObsidianVaultConfigError,
  obsidianToolAvailable,
  obsidianVaultCommand,
  readObsidianVaultSettings,
} from "./obsidian-connection.js";
import { classifyRisk } from "./tool-access/catalog/descriptors.js";

const vault = mkdtempSync(path.join(tmpdir(), "paperclip obsidian vault-"));
afterAll(() => rmSync(vault, { recursive: true, force: true }));

const config = (methodConfig: Record<string, unknown>) => ({ templateId: "paperclip.obsidian-vault", methodConfig });
const codeOf = (run: () => unknown) => {
  try { run(); } catch (error) { return error instanceof ObsidianVaultConfigError ? error.code : String(error); }
  return null;
};

describe("readObsidianVaultSettings", () => {
  it("reads the vault folder and the read-only choice of a connection", () => {
    expect(readObsidianVaultSettings(config({ vaultPath: ` ${vault} ` }))).toEqual({ vaultPath: vault, readOnly: false });
    expect(readObsidianVaultSettings(config({ vaultPath: vault, readOnly: true })).readOnly).toBe(true);
    expect(readObsidianVaultSettings(config({ vaultPath: vault, readOnly: "true" })).readOnly).toBe(true);
  });

  it("names the setup mistake", () => {
    expect(codeOf(() => readObsidianVaultSettings(config({})))).toBe("obsidian_vault_path_missing");
    expect(codeOf(() => readObsidianVaultSettings(config({ vaultPath: "notes" })))).toBe("obsidian_vault_path_relative");
    expect(codeOf(() => readObsidianVaultSettings(config({ vaultPath: path.parse(vault).root }))))
      .toBe("obsidian_vault_path_root");
    expect(codeOf(() => readObsidianVaultSettings(config({ vaultPath: path.join(vault, "missing") }))))
      .toBe("obsidian_vault_path_not_found");
  });
});

describe("obsidianVaultCommand", () => {
  it("runs the bundled MCP server on the connection's own vault without a shell", () => {
    const { command, args } = obsidianVaultCommand(config({ vaultPath: vault }));
    expect(command).toBe(process.execPath);
    expect(existsSync(args[0]!)).toBe(true);
    expect(args.slice(1)).toEqual([vault]);
    expect(obsidianVaultCommand(config({ vaultPath: vault, readOnly: true })).args.slice(1)).toEqual([vault, "--read-only"]);
  });
});

describe("Obsidian tools", () => {
  it("states a permission tier for every tool, so no writing tool is offered as a read", () => {
    const tiers = Object.fromEntries(OBSIDIAN_STDIO_TEMPLATE.tools.map((tool) => [tool.name, classifyRisk(tool)]));
    expect(tiers).toMatchObject({
      read_note: "read", search_notes: "read", get_frontmatter: "read",
      write_note: "write", patch_note: "write", move_note: "write", move_file: "write",
      update_frontmatter: "write", manage_tags: "write",
      delete_note: "destructive",
    });
    expect(Object.values(tiers).filter((tier) => tier === "read")).toHaveLength(11);
    expect(OBSIDIAN_STDIO_TEMPLATE.tools).toHaveLength(18);
  });

  it("offers only the reading tools on a read-only connection", () => {
    const readOnly = config({ vaultPath: vault, readOnly: true });
    expect(obsidianToolAvailable(readOnly, "read_note")).toBe(true);
    expect(obsidianToolAvailable(readOnly, "write_note")).toBe(false);
    expect(obsidianToolAvailable(readOnly, "delete_note")).toBe(false);
    expect(obsidianToolAvailable(config({ vaultPath: vault }), "write_note")).toBe(true);
  });
});
