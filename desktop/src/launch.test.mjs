import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT_NO_RUNNING_INSTANCE, handleLaunch, secondInstanceAction } from "./launch.mjs";

function recorder({ hasLock }) {
  const calls = [];
  return {
    calls,
    deps: {
      requestLock: () => {
        calls.push("lock");
        return hasLock;
      },
      quit: () => calls.push("quit"),
      exit: (code) => calls.push(`exit:${code}`),
      start: (options) => calls.push(`start:${JSON.stringify(options)}`),
      log: () => {},
    },
  };
}

test("a --quit process that gets the lock exits without starting the app", () => {
  const { calls, deps } = recorder({ hasLock: true });
  const action = handleLaunch({ argv: ["electron", ".", "--quit"], ...deps });
  assert.equal(action, "exit");
  assert.deepEqual(calls, ["lock", `exit:${EXIT_NO_RUNNING_INSTANCE}`]);
  assert.notEqual(EXIT_NO_RUNNING_INSTANCE, 0);
});

test("a --quit process without the lock hands over to the running instance", () => {
  const { calls, deps } = recorder({ hasLock: false });
  const action = handleLaunch({ argv: ["electron", ".", "--quit"], ...deps });
  assert.equal(action, "defer");
  assert.deepEqual(calls, ["lock", "quit"]);
});

test("a normal launch without the lock defers to the running instance", () => {
  const { calls, deps } = recorder({ hasLock: false });
  assert.equal(handleLaunch({ argv: ["electron", "."], ...deps }), "defer");
  assert.deepEqual(calls, ["lock", "quit"]);
});

test("a normal launch with the lock starts the app", () => {
  const { calls, deps } = recorder({ hasLock: true });
  assert.equal(handleLaunch({ argv: ["electron", "."], ...deps }), "start");
  assert.deepEqual(calls, ["lock", 'start:{"hidden":false}']);
});

test("a --hidden launch with the lock starts the app hidden", () => {
  const { calls, deps } = recorder({ hasLock: true });
  assert.equal(handleLaunch({ argv: ["electron", ".", "--hidden"], ...deps }), "start");
  assert.deepEqual(calls, ["lock", 'start:{"hidden":true}']);
});

test("the running instance quits for a --quit launch and shows itself otherwise", () => {
  assert.equal(secondInstanceAction(["electron", ".", "--quit"]), "quit");
  assert.equal(secondInstanceAction(["electron", "."]), "show");
  assert.equal(secondInstanceAction(["electron", ".", "--hidden"]), "show");
});

// A packaged executable that gets a script lost `ELECTRON_RUN_AS_NODE` on the
// way. Starting the app instead would open it on the user's default profile.
test("a packaged launch with a script argument exits without starting the app", () => {
  const exe = "C:\\Programs\\Paperclip Desktop\\Paperclip Desktop.exe";
  for (const script of ["C:\\runtime\\node_modules\\agent\\dist\\index.js", "/opt/runtime/probe.mjs", "tool.cjs"]) {
    const { calls, deps } = recorder({ hasLock: true });
    assert.equal(handleLaunch({ argv: [exe, script, "--flag"], packaged: true, ...deps }), "refuse");
    assert.deepEqual(calls, ["exit:1"]);
  }
});

test("a packaged launch with only switches starts the app", () => {
  const { calls, deps } = recorder({ hasLock: true });
  const argv = ["Paperclip Desktop.exe", "--hidden", "--user-data-dir=C:\\data\\profile.js"];
  assert.equal(handleLaunch({ argv, packaged: true, ...deps }), "start");
  assert.deepEqual(calls, ["lock", 'start:{"hidden":true}']);
});

test("an unpackaged launch may name its entry script", () => {
  const { calls, deps } = recorder({ hasLock: true });
  assert.equal(handleLaunch({ argv: ["electron", "src/main.mjs"], packaged: false, ...deps }), "start");
  assert.deepEqual(calls, ["lock", 'start:{"hidden":false}']);
});
