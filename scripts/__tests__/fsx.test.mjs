import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FsxError, run } from "../fsx.mjs";

const fsxPath = fileURLToPath(new URL("../fsx.mjs", import.meta.url));

function scratch(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "fsx-"));
  t.after(() => {
    // Read-only files from the -f tests must be writable again before removal.
    for (const file of walk(root)) {
      try {
        chmodSync(file, 0o644);
      } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function write(file, content = "x") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function tree(dir) {
  return walk(dir)
    .map((file) => path.relative(dir, file).split(path.sep).join("/"))
    .sort();
}

test("rm removes files and directories recursively and ignores missing paths", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "dist/a/b.js"));
  write(path.join(cwd, "tsconfig.tsbuildinfo"));
  run(["rm", "dist", "tsconfig.tsbuildinfo", "does-not-exist"], { cwd });
  assert.deepEqual(readdirSync(cwd), []);
});

test("rm and mkdir need at least one path", () => {
  assert.throws(() => run(["rm"]), FsxError);
  assert.throws(() => run(["mkdir"]), FsxError);
});

test("mkdir creates parents and accepts existing directories", (t) => {
  const cwd = scratch(t);
  mkdirSync(path.join(cwd, "dist"));
  run(["mkdir", "dist/migrations/meta", "dist/cliplab", "dist"], { cwd });
  assert.ok(statSync(path.join(cwd, "dist/migrations/meta")).isDirectory());
  assert.ok(statSync(path.join(cwd, "dist/cliplab")).isDirectory());
});

test("cp copies several files into an existing directory", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "src/LICENSE"), "license");
  write(path.join(cwd, "src/PROVENANCE.md"), "provenance");
  mkdirSync(path.join(cwd, "dist"));
  run(["cp", "src/LICENSE", "src/PROVENANCE.md", "dist/"], { cwd });
  assert.equal(readFileSync(path.join(cwd, "dist/LICENSE"), "utf8"), "license");
  assert.equal(readFileSync(path.join(cwd, "dist/PROVENANCE.md"), "utf8"), "provenance");
});

test("cp copies one file to a new file name", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "package.json"), "{}");
  run(["cp", "package.json", "package.dev.json"], { cwd });
  assert.equal(readFileSync(path.join(cwd, "package.dev.json"), "utf8"), "{}");
});

test("cp expands a glob and skips dot files like a shell", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "src/migrations/0001_a.sql"), "a");
  write(path.join(cwd, "src/migrations/0002_b.sql"), "b");
  write(path.join(cwd, "src/migrations/.hidden.sql"), "hidden");
  write(path.join(cwd, "src/migrations/meta/_journal.json"), "{}");
  mkdirSync(path.join(cwd, "dist/migrations"), { recursive: true });
  run(["cp", "src/migrations/*.sql", "dist/migrations/"], { cwd });
  assert.deepEqual(tree(path.join(cwd, "dist")), ["migrations/0001_a.sql", "migrations/0002_b.sql"]);
});

test("cp fails when a glob matches nothing", (t) => {
  const cwd = scratch(t);
  mkdirSync(path.join(cwd, "dist"));
  assert.throws(() => run(["cp", "src/*.sql", "dist/"], { cwd }), /no match/);
});

test("cp fails for a missing source", (t) => {
  const cwd = scratch(t);
  mkdirSync(path.join(cwd, "dist"));
  assert.throws(() => run(["cp", "missing.txt", "dist/"], { cwd }), /No such file/);
});

test("cp needs a directory destination for several sources", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "a"));
  write(path.join(cwd, "b"));
  assert.throws(() => run(["cp", "a", "b", "dest"], { cwd }), /not a directory/);
  assert.throws(() => run(["cp", "a", "dest/"], { cwd }), /not a directory/);
});

test("cp without -R refuses a directory", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "src/file"));
  mkdirSync(path.join(cwd, "dist"));
  assert.throws(() => run(["cp", "src", "dist/"], { cwd }), /-R not specified/);
});

test("cp -R dir/. merges the contents of dir into an existing directory", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "src/assets/one.txt"), "one");
  write(path.join(cwd, "src/assets/nested/two.txt"), "two");
  write(path.join(cwd, "src/assets/.keep"), "");
  write(path.join(cwd, "dist/assets/existing.txt"), "kept");
  write(path.join(cwd, "dist/assets/one.txt"), "old");
  run(["cp", "-R", "src/assets/.", "dist/assets/"], { cwd });
  assert.deepEqual(tree(path.join(cwd, "dist/assets")), [".keep", "existing.txt", "nested/two.txt", "one.txt"]);
  assert.equal(readFileSync(path.join(cwd, "dist/assets/one.txt"), "utf8"), "one");
});

test("cp -R copies a directory into a directory under its own name", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "src/assets/one.txt"), "one");
  mkdirSync(path.join(cwd, "dist"));
  run(["cp", "-R", "src/assets", "dist/"], { cwd });
  assert.deepEqual(tree(path.join(cwd, "dist")), ["assets/one.txt"]);
});

test("cp -R creates a missing destination directory as a copy of the source", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "src/assets/one.txt"), "one");
  run(["cp", "-R", "src/assets", "copy"], { cwd });
  assert.deepEqual(tree(path.join(cwd, "copy")), ["one.txt"]);
});

test("cp -Rf replaces a read-only destination file", (t) => {
  const cwd = scratch(t);
  const relative = "remote-provider-packs/linux-x64/provider-pack.json";
  write(path.join(cwd, "runner/dist", relative), "new");
  write(path.join(cwd, "server/dist/vendor", relative), "old");
  chmodSync(path.join(cwd, "server/dist/vendor", relative), 0o444);
  run(["cp", "-Rf", "runner/dist/.", "server/dist/vendor/"], { cwd });
  assert.equal(readFileSync(path.join(cwd, "server/dist/vendor", relative), "utf8"), "new");
});

test("mv renames a file and replaces the destination", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "package.dev.json"), "dev");
  write(path.join(cwd, "package.json"), "generated");
  run(["mv", "package.dev.json", "package.json"], { cwd });
  assert.equal(readFileSync(path.join(cwd, "package.json"), "utf8"), "dev");
  assert.equal(existsSync(path.join(cwd, "package.dev.json")), false);
});

test("mv --if-exists does nothing for a missing source; plain mv fails", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "package.json"), "kept");
  run(["mv", "--if-exists", "package.dev.json", "package.json"], { cwd });
  assert.equal(readFileSync(path.join(cwd, "package.json"), "utf8"), "kept");
  assert.throws(() => run(["mv", "package.dev.json", "package.json"], { cwd }), /No such file/);
});

test("chmod +x adds execute bits on POSIX and only checks the file on Windows", (t) => {
  const cwd = scratch(t);
  const file = path.join(cwd, "dist/index.js");
  write(file);
  if (process.platform !== "win32") chmodSync(file, 0o644);
  run(["chmod", "+x", "dist/index.js"], { cwd });
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o755);
  assert.throws(() => run(["chmod", "+x", "dist/missing.js"], { cwd }), /ENOENT/);
  assert.throws(() => run(["chmod", "u+w", "dist/index.js"], { cwd }), /unsupported mode/);
});

test("chmod with an octal mode sets that mode on POSIX", { skip: process.platform === "win32" }, (t) => {
  const cwd = scratch(t);
  const file = path.join(cwd, "tool");
  write(file);
  run(["chmod", "700", "tool"], { cwd });
  assert.equal(lstatSync(file).mode & 0o777, 0o700);
});

test("prune keeps the newest n matches by name and removes the rest", (t) => {
  const cwd = scratch(t);
  const meta = path.join(cwd, "src/migrations/meta");
  for (const id of ["0331", "0332", "0333", "0334", "0335", "0336", "0337", "0338"]) {
    write(path.join(meta, `${id}_snapshot.json`), "{}");
  }
  write(path.join(meta, "_journal.json"), "{}");
  run(["prune", "src/migrations/meta/*_snapshot.json", "--keep", "5"], { cwd });
  assert.deepEqual(readdirSync(meta).sort(), [
    "0334_snapshot.json",
    "0335_snapshot.json",
    "0336_snapshot.json",
    "0337_snapshot.json",
    "0338_snapshot.json",
    "_journal.json",
  ]);
});

test("prune keeps everything when there are fewer matches than n, or none", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "meta/0001_snapshot.json"));
  run(["prune", "meta/*_snapshot.json", "--keep", "5"], { cwd });
  run(["prune", "other/*_snapshot.json", "--keep", "5"], { cwd });
  assert.deepEqual(readdirSync(path.join(cwd, "meta")), ["0001_snapshot.json"]);
  assert.throws(() => run(["prune", "meta/*.json"], { cwd }), /--keep/);
});

test("an unknown command fails", () => {
  assert.throws(() => run(["copy", "a", "b"]), /unknown command/);
});

test("the command line reports errors with a non-zero exit code", (t) => {
  const cwd = scratch(t);
  write(path.join(cwd, "src/LICENSE"), "license");
  const ok = spawnSync(process.execPath, [fsxPath, "cp", "src/LICENSE", "LICENSE"], { cwd, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(readFileSync(path.join(cwd, "LICENSE"), "utf8"), "license");
  const failed = spawnSync(process.execPath, [fsxPath, "cp", "src/*.sql", "dist/"], { cwd, encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /cp: no match for 'src\/\*\.sql'/);
});
