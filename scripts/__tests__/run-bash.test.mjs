import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findBash } from "../run-bash.mjs";

const runBashPath = fileURLToPath(new URL("../run-bash.mjs", import.meta.url));

function existing(...files) {
  const set = new Set(files.map((file) => file.toLowerCase()));
  return (file) => set.has(file.toLowerCase());
}

test("findBash uses bash from PATH on Linux and macOS", () => {
  assert.equal(findBash({ platform: "linux", env: {}, gitExecPath: () => "", fileExists: () => false }), "bash");
  assert.equal(findBash({ platform: "darwin", env: {}, gitExecPath: () => "", fileExists: () => false }), "bash");
});

test("findBash prefers PAPERCLIP_BASH on every platform", () => {
  for (const platform of ["linux", "win32"]) {
    assert.equal(
      findBash({ platform, env: { PAPERCLIP_BASH: "D:\\tools\\bash.exe" }, gitExecPath: () => "", fileExists: () => false }),
      "D:\\tools\\bash.exe",
    );
  }
});

test("findBash finds Git Bash from git --exec-path on Windows", () => {
  const bash = findBash({
    platform: "win32",
    env: {},
    gitExecPath: () => "D:/Apps/Git/mingw64/libexec/git-core",
    fileExists: existing("D:\\Apps\\Git\\bin\\bash.exe"),
  });
  assert.equal(bash, "D:\\Apps\\Git\\bin\\bash.exe");
});

test("findBash falls back to the default Git for Windows install folder", () => {
  const bash = findBash({
    platform: "win32",
    env: { ProgramFiles: "C:\\Program Files" },
    gitExecPath: () => "",
    fileExists: existing("C:\\Program Files\\Git\\usr\\bin\\bash.exe"),
  });
  assert.equal(bash, "C:\\Program Files\\Git\\usr\\bin\\bash.exe");
});

test("findBash skips the WSL launchers on PATH", () => {
  const options = {
    platform: "win32",
    gitExecPath: () => "",
    fileExists: existing(
      "C:\\Windows\\System32\\bash.exe",
      "C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe",
      "D:\\msys64\\usr\\bin\\bash.exe",
    ),
  };
  assert.equal(
    findBash({ ...options, env: { Path: "C:\\Windows\\System32;C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps;D:\\msys64\\usr\\bin" } }),
    "D:\\msys64\\usr\\bin\\bash.exe",
  );
  assert.equal(
    findBash({ ...options, env: { Path: "C:\\Windows\\System32;C:\\Users\\dev\\AppData\\Local\\Microsoft\\WindowsApps" } }),
    null,
  );
});

test("run-bash runs a script with its arguments and returns its exit code", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "run-bash-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "echo.sh"), 'printf "%s|" "$@"\nexit 3\n');
  const result = spawnSync(process.execPath, [runBashPath, "echo.sh", "one", "two words"], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stdout, "one|two words|");
});

test("run-bash needs a script path", () => {
  const result = spawnSync(process.execPath, [runBashPath], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected a script path/);
});
