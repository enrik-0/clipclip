/**
 * GNU tar reads `C:\dir\file.tar` as `host:path` and tries to open a remote
 * connection. Windows hosts that put Git's GNU tar ahead of the system bsdtar
 * (common with Git for Windows) hit "Cannot connect to C: resolve failed".
 * `--force-local` fixes GNU tar; bsdtar rejects the flag, so only add it when the
 * installed tar is GNU.
 */
export function tarForceLocalArgs(versionOutput: string | null, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [];
  return versionOutput !== null && /GNU tar/i.test(versionOutput) ? ["--force-local"] : [];
}
