import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { openRunnerApiWorkspaceFile } from "./native-runtime/runner-api-files.js";

const MAX_CREDENTIAL_BYTES = 64 * 1024;

async function readBounded(file: FileHandle): Promise<string> {
  const bytes = Buffer.alloc(MAX_CREDENTIAL_BYTES + 1);
  let size = 0;
  while (size < bytes.length) {
    const read = await file.read(bytes, size, bytes.length - size, size);
    if (!read.bytesRead) break;
    size += read.bytesRead;
  }
  if (size > MAX_CREDENTIAL_BYTES) throw new Error("Invalid credential file");
  return bytes.subarray(0, size).toString("utf8");
}

/**
 * Windows has no POSIX owner/mode and no /proc descriptor links, so the confined
 * open below cannot run there. The sign-in attempt directory is a private
 * directory under the user's profile (protected by its ACL). Reject symlinks,
 * non-regular and oversized files, and require that the opened descriptor is the
 * file that was checked, so a path swapped between the check and the open fails.
 */
async function readWindowsCredentialFile(filename: string): Promise<string> {
  const [parent, before] = await Promise.all([lstat(dirname(filename)), lstat(filename)]);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("Invalid credential file");
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_CREDENTIAL_BYTES) {
    throw new Error("Invalid credential file");
  }
  const file = await open(filename, constants.O_RDONLY);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_CREDENTIAL_BYTES || stat.ino !== before.ino || stat.dev !== before.dev) {
      throw new Error("Invalid credential file");
    }
    return await readBounded(file);
  } finally {
    await file.close();
  }
}

/** Bounded descriptor read; never follows symlinks or reopens a checked path. */
export async function readLocalAiCredentialFile(filename: string): Promise<string> {
  if (process.platform === "win32") return readWindowsCredentialFile(filename);
  const file = await openRunnerApiWorkspaceFile(filename);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.size > MAX_CREDENTIAL_BYTES) {
      throw new Error("Invalid credential file");
    }
    return await readBounded(file);
  } finally {
    await file.close();
  }
}
