#!/usr/bin/env node
// Run a bash script from a package.json script on every platform.
//
// Usage: node scripts/run-bash.mjs <script.sh> [args...]
//
// On Linux and macOS this runs `bash <script.sh> [args...]`, which is what
// `./script.sh` does through its `#!/usr/bin/env bash` line. pnpm runs package
// scripts with cmd.exe on Windows, where `./script.sh` does not start and a
// plain `bash` can resolve to the WSL launcher in System32. On Windows this
// file finds Git Bash instead. Set PAPERCLIP_BASH to the full path of a bash
// executable to choose one yourself.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// Bash executables on PATH that are not Git Bash: the WSL launcher and its
// App Execution Alias.
function isWslLauncher(file) {
  const normalized = path.win32.normalize(file).toLowerCase();
  return normalized.includes("\\windows\\system32\\") || normalized.includes("\\microsoft\\windowsapps\\");
}

function gitInstallRoots({ env, gitExecPath }) {
  const roots = [];
  const execPath = gitExecPath();
  // `git --exec-path` is <root>/mingw64/libexec/git-core (or clangarm64, mingw32).
  if (execPath) roots.push(path.win32.resolve(execPath, "..", "..", ".."));
  const bases = [env.ProgramFiles, env.ProgramW6432, env["ProgramFiles(x86)"]];
  if (env.LOCALAPPDATA) bases.push(path.win32.join(env.LOCALAPPDATA, "Programs"));
  for (const base of bases) {
    if (base) roots.push(path.win32.join(base, "Git"));
  }
  return roots;
}

function defaultGitExecPath() {
  try {
    return execFileSync("git", ["--exec-path"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function findBash({
  platform = process.platform,
  env = process.env,
  gitExecPath = defaultGitExecPath,
  fileExists = isFile,
} = {}) {
  if (env.PAPERCLIP_BASH) return env.PAPERCLIP_BASH;
  if (platform !== "win32") return "bash";
  for (const root of gitInstallRoots({ env, gitExecPath })) {
    // bin/bash.exe sets up the Git Bash PATH before it starts usr/bin/bash.exe.
    for (const candidate of [path.win32.join(root, "bin", "bash.exe"), path.win32.join(root, "usr", "bin", "bash.exe")]) {
      if (fileExists(candidate)) return candidate;
    }
  }
  const pathValue = env.Path ?? env.PATH ?? "";
  for (const dir of pathValue.split(path.win32.delimiter)) {
    if (!dir) continue;
    const candidate = path.win32.join(dir, "bash.exe");
    if (!isWslLauncher(candidate) && fileExists(candidate)) return candidate;
  }
  return null;
}

export function main(argv = process.argv.slice(2), options = {}) {
  if (argv.length === 0) {
    console.error("run-bash: expected a script path");
    return 1;
  }
  const bash = findBash(options);
  if (!bash) {
    console.error("run-bash: no Git Bash found. Install Git for Windows or set PAPERCLIP_BASH to the full path of bash.exe.");
    return 1;
  }
  const result = spawnSync(bash, argv, { stdio: "inherit" });
  if (result.error) {
    console.error(`run-bash: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 1;
  }
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
