#!/usr/bin/env node
// Cross-platform file commands for package.json scripts.
//
// pnpm runs package scripts with cmd.exe on Windows, where `rm -rf`, `mkdir -p`,
// `cp`, `mv`, `chmod`, `[ -f ]` and unquoted globs do not exist or do not
// expand. Scripts call this file instead, so they give the same result under
// cmd.exe and under a POSIX shell.
//
// Usage: node scripts/fsx.mjs <command> [args...]
//
//   rm <paths...>                    Remove each path recursively. A missing path
//                                    is not an error (`rm -rf`).
//   mkdir <dirs...>                  Create each directory and its parents
//                                    (`mkdir -p`).
//   cp [-R] [-f] <sources...> <dest> Copy like POSIX `cp`. A source that contains
//                                    `*`, `?` or `[` is a glob; it must match at
//                                    least one path. With more than one source,
//                                    <dest> must be an existing directory. -R
//                                    copies directories; `dir/.` copies the
//                                    contents of `dir`. -f replaces a destination
//                                    file that cannot be opened for writing.
//   mv [--if-exists] <src> <dest>    Move or rename. With --if-exists, a missing
//                                    <src> is not an error
//                                    (`if [ -f src ]; then mv src dest; fi`).
//   chmod <mode> <files...>          Set a mode: octal (`755`) or `+x`. Windows
//                                    has no POSIX mode bits, so there it only
//                                    checks that the files exist.
//   prune <glob> --keep <n>          Sort the matches of <glob> by name, newest
//                                    (highest) first, keep the first <n> and
//                                    remove the rest
//                                    (`ls glob | sort -r | tail -n +<n+1> | xargs rm -f`).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class FsxError extends Error {}

const GLOB_CHARS = /[*?[]/;

function isGlob(pattern) {
  return GLOB_CHARS.test(pattern);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

// Expand a glob relative to cwd. Like a POSIX shell, `*` does not match a name
// that starts with a dot unless the pattern itself names a dot file.
export function expandGlob(pattern, cwd = process.cwd()) {
  const allowDot = path.posix.basename(pattern).startsWith(".");
  return fs
    .globSync(pattern, { cwd })
    .map(toPosix)
    .filter((match) => allowDot || !path.posix.basename(match).startsWith("."))
    .sort();
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function statOrNull(target) {
  try {
    return fs.statSync(target);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

function resolveIn(cwd, target) {
  return path.resolve(cwd, target);
}

export function rm(paths, { cwd = process.cwd() } = {}) {
  for (const target of paths) {
    fs.rmSync(resolveIn(cwd, target), { recursive: true, force: true, maxRetries: 3 });
  }
}

export function mkdir(dirs, { cwd = process.cwd() } = {}) {
  for (const dir of dirs) {
    fs.mkdirSync(resolveIn(cwd, dir), { recursive: true });
  }
}

function copyFile(source, destination, force) {
  try {
    fs.copyFileSync(source, destination);
  } catch (error) {
    if (!force || (error.code !== "EPERM" && error.code !== "EACCES")) throw error;
    // `cp -f`: remove a destination that cannot be opened, then try again.
    fs.rmSync(destination, { force: true });
    fs.copyFileSync(source, destination);
  }
}

function copyEntry(source, destination, { recursive, force, label }) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    // `cp -R` copies a symbolic link as a link. A plain `cp` follows it.
    if (recursive) {
      fs.rmSync(destination, { force: true });
      fs.symlinkSync(fs.readlinkSync(source), destination);
      return;
    }
    copyEntry(fs.realpathSync(source), destination, { recursive, force, label });
    return;
  }
  if (stat.isDirectory()) {
    if (!recursive) throw new FsxError(`cp: -R not specified; omitting directory '${label}'`);
    const existing = statOrNull(destination);
    if (existing && !existing.isDirectory()) {
      throw new FsxError(`cp: cannot overwrite non-directory '${destination}' with directory '${label}'`);
    }
    if (!existing) fs.mkdirSync(destination);
    for (const name of fs.readdirSync(source)) {
      copyEntry(path.join(source, name), path.join(destination, name), {
        recursive,
        force,
        label: path.posix.join(label, name),
      });
    }
    return;
  }
  copyFile(source, destination, force);
}

export function cp(args, { cwd = process.cwd() } = {}) {
  let recursive = false;
  let force = false;
  const operands = [];
  for (const arg of args) {
    if (/^-[Rrf]+$/.test(arg) && operands.length === 0) {
      if (/[Rr]/.test(arg)) recursive = true;
      if (arg.includes("f")) force = true;
    } else {
      operands.push(arg);
    }
  }
  if (operands.length < 2) throw new FsxError("cp: expected at least one source and a destination");
  const destinationArg = operands.pop();
  const sources = [];
  for (const operand of operands) {
    if (!isGlob(operand)) {
      sources.push(operand);
      continue;
    }
    const matches = expandGlob(operand, cwd);
    if (matches.length === 0) throw new FsxError(`cp: no match for '${operand}'`);
    sources.push(...matches);
  }

  const destination = resolveIn(cwd, destinationArg);
  const destinationStat = statOrNull(destination);
  const destinationIsDir = destinationStat?.isDirectory() ?? false;
  if (sources.length > 1 && !destinationIsDir) {
    throw new FsxError(`cp: target '${destinationArg}' is not a directory`);
  }
  if (!destinationIsDir && /[\\/]$/.test(destinationArg)) {
    throw new FsxError(`cp: target '${destinationArg}' is not a directory`);
  }

  for (const source of sources) {
    const sourcePath = resolveIn(cwd, source);
    if (!lstatOrNull(sourcePath)) throw new FsxError(`cp: cannot stat '${source}': No such file or directory`);
    // `dir/.` has the base name `.`, so `cp -R dir/. dest/` merges into dest.
    const target = destinationIsDir ? path.join(destination, path.basename(source)) : destination;
    copyEntry(sourcePath, target, { recursive, force, label: source });
  }
}

export function mv(args, { cwd = process.cwd() } = {}) {
  let ifExists = false;
  const operands = [];
  for (const arg of args) {
    if (arg === "--if-exists") ifExists = true;
    else operands.push(arg);
  }
  if (operands.length !== 2) throw new FsxError("mv: expected a source and a destination");
  const [sourceArg, destinationArg] = operands;
  const source = resolveIn(cwd, sourceArg);
  if (!lstatOrNull(source)) {
    if (ifExists) return;
    throw new FsxError(`mv: cannot stat '${sourceArg}': No such file or directory`);
  }
  let destination = resolveIn(cwd, destinationArg);
  if (statOrNull(destination)?.isDirectory()) destination = path.join(destination, path.basename(source));
  fs.renameSync(source, destination);
}

export function chmod(args, { cwd = process.cwd(), platform = process.platform } = {}) {
  const [mode, ...files] = args;
  if (!mode || files.length === 0) throw new FsxError("chmod: expected a mode and at least one file");
  if (mode !== "+x" && !/^[0-7]{3,4}$/.test(mode)) {
    throw new FsxError(`chmod: unsupported mode '${mode}' (use +x or an octal mode)`);
  }
  for (const file of files) {
    const target = resolveIn(cwd, file);
    const stat = fs.statSync(target);
    if (platform === "win32") continue;
    const next = mode === "+x" ? stat.mode | 0o111 : Number.parseInt(mode, 8);
    fs.chmodSync(target, next & 0o7777);
  }
}

export function prune(args, { cwd = process.cwd() } = {}) {
  const keepIndex = args.indexOf("--keep");
  const keepValue = keepIndex === -1 ? undefined : args[keepIndex + 1];
  const patterns = args.filter((_, index) => index !== keepIndex && index !== keepIndex + 1);
  if (patterns.length !== 1 || keepValue === undefined || !/^\d+$/.test(keepValue)) {
    throw new FsxError("prune: expected <glob> --keep <n>");
  }
  const keep = Number(keepValue);
  const matches = expandGlob(patterns[0], cwd).reverse();
  const removed = matches.slice(keep);
  for (const match of removed) fs.rmSync(resolveIn(cwd, match), { force: true });
  return removed;
}

const COMMANDS = { rm, mkdir, cp, mv, chmod, prune };

export function run(argv, options = {}) {
  const [command, ...args] = argv;
  const handler = COMMANDS[command];
  if (!handler) {
    throw new FsxError(`fsx: unknown command '${command ?? ""}' (expected one of: ${Object.keys(COMMANDS).join(", ")})`);
  }
  if ((command === "rm" || command === "mkdir") && args.length === 0) {
    throw new FsxError(`${command}: expected at least one path`);
  }
  handler(args, options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof FsxError ? error.message : `fsx: ${error.message}`);
    process.exitCode = 1;
  }
}
