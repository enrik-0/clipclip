import { describe, expect, it } from "vitest";
import { defaultGalleryConnectionName } from "./connection-default-name";

const obsidian = { slug: "obsidian", name: "Obsidian" };

describe("defaultGalleryConnectionName", () => {
  it("adds the vault folder to an Obsidian connection", () => {
    expect(defaultGalleryConnectionName(obsidian, { vaultPath: "C:\\Users\\me\\Documents\\Work notes\\" })).toBe("Obsidian (Work notes)");
    expect(defaultGalleryConnectionName(obsidian, { vaultPath: " /home/me/vaults/Procedures " })).toBe("Obsidian (Procedures)");
  });

  it("keeps the app name when there is no folder to show", () => {
    expect(defaultGalleryConnectionName(obsidian, {})).toBe("Obsidian");
    expect(defaultGalleryConnectionName(obsidian, { vaultPath: "C:\\" })).toBe("Obsidian");
    expect(defaultGalleryConnectionName({ slug: "notion", name: "Notion" }, { vaultPath: "C:\\notes" })).toBe("Notion");
  });

  it("stays inside the server's name limit", () => {
    const name = defaultGalleryConnectionName(obsidian, { vaultPath: `C:\\${"a".repeat(300)}` });
    expect(name.length).toBeLessThanOrEqual(160 - " for the organization".length);
  });
});
