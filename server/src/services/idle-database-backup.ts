import { constants, createReadStream } from "node:fs";
import { lstat, mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

// The marker survives process replacement on persistent instance storage.
// It contains no credentials or tenant data, and never substitutes for a dump.
export const idleBackupWakeMarker = (directory: string) => path.join(directory, ".idle-backup-wake-required");

function linkRefusedError(file: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`Refusing to follow a link at ${file}`), { code: "ELOOP" });
}

// Open a file without following a final symbolic link. Windows has no
// O_NOFOLLOW (the constant is undefined there), so refuse links with lstat()
// and make sure the opened handle is the entry that lstat() sees.
async function openWithoutFollowingLinks(file: string, flags: number, mode?: number): Promise<FileHandle> {
  if (constants.O_NOFOLLOW !== undefined) return open(file, flags | constants.O_NOFOLLOW, mode);
  const before = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (before?.isSymbolicLink()) throw linkRefusedError(file);
  const handle = await open(file, flags, mode);
  try {
    const [opened, entry] = await Promise.all([handle.stat(), lstat(file)]);
    if (entry.isSymbolicLink() || opened.dev !== entry.dev || opened.ino !== entry.ino) throw linkRefusedError(file);
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

// Windows cannot flush a directory handle opened this way (EPERM), and NTFS
// journals directory entries itself. Like lib/durable-directory, sync
// directories only on POSIX systems.
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function markIdleBackupWakeRequired(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const marker = await openWithoutFollowingLinks(idleBackupWakeMarker(directory), constants.O_WRONLY | constants.O_CREAT, 0o600);
  try {
    await marker.writeFile("Take a fresh database backup after this process restarts.\n");
    await marker.sync();
  } finally { await marker.close(); }
  await syncDirectory(directory);
}

/** Read the entire archive to verify the gzip trailer, then persist its bytes
 * and directory entry before allowing compute to stop. The backup runner
 * retains its in-flight receipt until this function settles. */
export async function verifyIdleDatabaseBackup(backupFile: string): Promise<void> {
  // Windows flushes a file (FlushFileBuffers) only through a handle with write
  // access; a read-only handle makes sync() fail with EPERM.
  const accessMode = process.platform === "win32" ? constants.O_RDWR : constants.O_RDONLY;
  const handle = await openWithoutFollowingLinks(backupFile, accessMode);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0) throw new Error("Idle backup archive is empty or invalid");
    let bytes = 0;
    await pipeline(
      createReadStream(backupFile, { fd: handle.fd, autoClose: false }),
      createGunzip(),
      new Writable({ write(chunk, _encoding, done) { bytes += chunk.length; done(); } }),
    );
    if (bytes === 0) throw new Error("Idle backup archive contains no SQL");
    await handle.sync();
  } finally { await handle.close(); }
  await syncDirectory(path.dirname(backupFile));
}

export async function clearIdleBackupWakeRequired(directory: string): Promise<void> {
  await unlink(idleBackupWakeMarker(directory)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await syncDirectory(directory);
}
