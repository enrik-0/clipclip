import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { binaryFileName, commandInvocation, PLUGIN_SDK_BUILD_MARKERS, pluginSdkBuildStep } from "../agent-preflight.mjs";

// A worktree with the real ensure-plugin-build-deps script and a stand-in
// compiler that emits dist/index.js next to the tsconfig it is given.
function worktree(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "agent-preflight-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "scripts"));
  copyFileSync(new URL("../ensure-plugin-build-deps.mjs", import.meta.url), path.join(root, "scripts/ensure-plugin-build-deps.mjs"));
  const compiler = path.join(root, "node_modules/typescript/bin/tsc");
  mkdirSync(path.dirname(compiler), { recursive: true });
  writeFileSync(compiler, `
const fs = require("node:fs");
const path = require("node:path");
const target = path.dirname(process.argv[3]);
if (fs.existsSync("fail")) process.exit(2);
fs.appendFileSync("builds", path.relative(process.cwd(), target).split(path.sep).join("/") + "\\n");
fs.mkdirSync(path.join(target, "dist"), { recursive: true });
fs.writeFileSync(path.join(target, "dist/index.js"), "export {};\\n");
`);
  for (const target of ["packages/shared", "packages/plugins/sdk"]) {
    mkdirSync(path.join(root, target, "src"), { recursive: true });
    writeFileSync(path.join(root, target, "src/index.ts"), "export {};\n");
    writeFileSync(path.join(root, target, "tsconfig.json"), "{}");
  }
  const builds = () => existsSync(path.join(root, "builds"))
    ? readFileSync(path.join(root, "builds"), "utf8").trim().split("\n") : [];
  return { root, builds };
}

test("a fresh worktree gets the plugin SDK and its shared dependency built", t => {
  const { root, builds } = worktree(t);
  const result = pluginSdkBuildStep(root);
  assert.equal(result.step, "plugin-sdk");
  assert.equal(result.action, "built");
  assert.deepEqual(builds(), ["packages/shared", "packages/plugins/sdk"]);
  for (const marker of PLUGIN_SDK_BUILD_MARKERS) assert.ok(existsSync(path.join(root, marker)), marker);
  assert.ok(existsSync(path.join(root, "packages/plugins/sdk/dist/index.js")));
});

test("unchanged sources skip the build and a source change rebuilds", t => {
  const { root, builds } = worktree(t);
  pluginSdkBuildStep(root);
  assert.equal(pluginSdkBuildStep(root).action, "skipped");
  assert.equal(builds().length, 2);

  writeFileSync(path.join(root, "packages/plugins/sdk/src/index.ts"), "export const changed = true;\n");
  assert.equal(pluginSdkBuildStep(root).action, "built");
  assert.deepEqual(builds().slice(2), ["packages/plugins/sdk"]);
});

test("a missing SDK dist is rebuilt even when the shared build is current", t => {
  const { root, builds } = worktree(t);
  pluginSdkBuildStep(root);
  rmSync(path.join(root, "packages/plugins/sdk/dist"), { recursive: true, force: true });
  assert.equal(pluginSdkBuildStep(root).action, "built");
  assert.deepEqual(builds().slice(2), ["packages/plugins/sdk"]);
});

test("a failed build fails the preflight", t => {
  const { root } = worktree(t);
  writeFileSync(path.join(root, "fail"), "");
  assert.throws(() => pluginSdkBuildStep(root), /ensure-plugin-build-deps\.mjs failed/);
});

test("a build that reports success without its outputs fails the preflight", t => {
  const { root } = worktree(t);
  assert.throws(() => pluginSdkBuildStep(root, () => 0), /no completion marker/);
});

test("on Windows, pnpm runs through the shell because it is a .cmd shim (#19)", () => {
  assert.deepEqual(commandInvocation("pnpm", ["install", "--frozen-lockfile"], "win32"),
    { command: "pnpm", args: ["install", "--frozen-lockfile"], shell: true });
  assert.deepEqual(commandInvocation("pnpm", ["--filter", "a b", 'say "hi"'], "win32").args,
    ["--filter", '"a b"', '"say ""hi"""']);
});

test("other commands and other platforms spawn directly", () => {
  assert.deepEqual(commandInvocation("cargo", ["build"], "win32"), { command: "cargo", args: ["build"], shell: false });
  assert.deepEqual(commandInvocation("pnpm", ["install"], "linux"), { command: "pnpm", args: ["install"], shell: false });
  assert.equal(commandInvocation(process.execPath, ["x.mjs"], "win32").shell, false);
});

test("debug binaries carry the .exe suffix only on Windows", () => {
  assert.equal(binaryFileName("paperclip-runnerd", "win32"), "paperclip-runnerd.exe");
  assert.equal(binaryFileName("paperclip-runnerd", "linux"), "paperclip-runnerd");
  assert.equal(binaryFileName("paperclip-runnerd", "darwin"), "paperclip-runnerd");
});

test("pnpm can be started on this platform", () => {
  const { command, args, shell } = commandInvocation("pnpm", ["--version"]);
  const result = spawnSync(command, args, { encoding: "utf8", shell });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});
