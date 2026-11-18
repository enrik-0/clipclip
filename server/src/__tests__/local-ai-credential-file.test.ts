import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLocalAiCredentialFile } from "../services/local-ai-credential-file.js";
let home: string;
beforeEach(async () => { home = await realpath(await mkdtemp(path.join(os.tmpdir(), "ai-auth-read-"))); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });
const initialPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => { Object.defineProperty(process, "platform", initialPlatform); });

// Windows has no POSIX owner/mode and no /proc: the sign-in attempt directory is a
// private directory under the user's profile, so the read checks the file is a
// regular, bounded, non-symlink file and that it is the one that was opened.
describe("credential file on Windows hosts", () => {
  const asWindows = () => Object.defineProperty(process, "platform", { ...initialPlatform, value: "win32" });

  it("reads a regular file without POSIX owner or mode checks", async () => {
    asWindows();
    const filename = path.join(home, ".credentials.json");
    await writeFile(filename, "fixture", { mode: 0o644 });
    await expect(readLocalAiCredentialFile(filename)).resolves.toBe("fixture");
  });

  it("still rejects directories, oversized files and missing files", async () => {
    asWindows();
    const filename = path.join(home, ".credentials.json");
    await writeFile(filename, Buffer.alloc(64 * 1024 + 1));
    await expect(readLocalAiCredentialFile(filename)).rejects.toThrow();
    await expect(readLocalAiCredentialFile(home)).rejects.toThrow();
    await expect(readLocalAiCredentialFile(path.join(home, "missing.json"))).rejects.toThrow();
  });

  it("rejects a symlinked file when the host allows creating one", async () => {
    asWindows();
    const filename = path.join(home, ".credentials.json");
    await writeFile(filename, "fixture");
    const link = path.join(home, "linked.json");
    try { await symlink(filename, link); } catch { return; } // creating symlinks may need privileges
    await expect(readLocalAiCredentialFile(link)).rejects.toThrow();
  });
});

describe.skipIf(process.platform === "win32")("isolated credential file safety", () => {
  it("reads only bounded private regular files", async () => {
    const filename = path.join(home, "credentials.json");
    await writeFile(filename, "fixture", { mode: 0o600 });
    await expect(readLocalAiCredentialFile(filename)).resolves.toBe("fixture");
    await chmod(filename, 0o644);
    await expect(readLocalAiCredentialFile(filename)).rejects.toThrow();
    await chmod(filename, 0o600);
    await writeFile(filename, Buffer.alloc(64 * 1024 + 1));
    await expect(readLocalAiCredentialFile(filename)).rejects.toThrow();
    await expect(readLocalAiCredentialFile(home)).rejects.toThrow();
  });
  it("rejects file and ancestor symlinks", async () => {
    const filename = path.join(home, "credentials.json");
    await writeFile(filename, "fixture", { mode: 0o600 });
    await symlink(filename, path.join(home, "linked.json"));
    await expect(readLocalAiCredentialFile(path.join(home, "linked.json"))).rejects.toThrow();
    await symlink(home, path.join(home, "linked-home"));
    await expect(readLocalAiCredentialFile(path.join(home, "linked-home", "credentials.json"))).rejects.toThrow();
  });
});
