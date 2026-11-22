import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServerSupervisor, localUrlFor, probeServer, probeUi } from "./server-supervisor.mjs";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const fakeHost = path.join(srcDir, "__fixtures__", "fake-host.mjs");
// The supervisor runs the host from `<repoRoot>/server`, which exists here.
const repoRoot = path.join(srcDir, "..", "..");

function configFor(mode, overrides = {}) {
  return {
    repoRoot,
    serverMode: "dist",
    serverEntry: "unused",
    tsxLoader: null,
    nodePath: process.execPath,
    // Port 9 (discard) is never a Paperclip server, so the probe fails fast.
    expectedUrl: "http://127.0.0.1:9",
    serverEnv: { ...process.env, FAKE_HOST_MODE: mode },
    ...overrides,
  };
}

test("localUrlFor maps wildcard hosts to loopback", () => {
  assert.equal(localUrlFor("0.0.0.0", 3100), "http://127.0.0.1:3100");
  assert.equal(localUrlFor("localhost", 3100), "http://127.0.0.1:3100");
  assert.equal(localUrlFor("192.168.1.5", 3200), "http://192.168.1.5:3200");
  assert.equal(localUrlFor("::1", 3100), "http://[::1]:3100");
});

test("probeServer rejects answers that are not a Paperclip health payload", async () => {
  const notJson = async () => ({
    ok: true,
    json: async () => {
      throw new Error("not json");
    },
  });
  const failing = async () => ({ ok: false, json: async () => ({ status: "ok" }) });
  const healthy = async () => ({ ok: true, json: async () => ({ status: "ok" }) });
  assert.equal(await probeServer("http://x", { fetchImpl: notJson }), false);
  assert.equal(await probeServer("http://x", { fetchImpl: failing }), false);
  assert.equal(await probeServer("http://x", { fetchImpl: healthy }), true);
});

test("starts an owned server, reports its URL, and stops it on request", async () => {
  const supervisor = createServerSupervisor({ config: configFor("ready"), hostScript: fakeHost });
  const result = await supervisor.start();
  assert.equal(result.owned, true);
  assert.match(result.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(await probeServer(result.url), true);
  assert.equal(supervisor.isOwned(), true);

  await supervisor.stop();
  assert.equal(supervisor.isOwned(), false);
  assert.equal(await probeServer(result.url), false);
});

test("attaches to a server that is already running and never stops it", async () => {
  const owner = createServerSupervisor({ config: configFor("ready"), hostScript: fakeHost });
  const running = await owner.start();
  try {
    const visitor = createServerSupervisor({
      config: configFor("ready", { expectedUrl: running.url }),
      hostScript: fakeHost,
    });
    const attached = await visitor.start();
    assert.deepEqual(attached, { url: running.url, owned: false, ui: true });
    assert.equal(visitor.isOwned(), false);
    await visitor.stop();
    assert.equal(await probeServer(running.url), true);
  } finally {
    await owner.stop();
  }
});

test("probeUi accepts only an HTML page that is not an error", async () => {
  const page = (status, contentType) => async (url) => {
    assert.equal(url, "http://x/");
    return { ok: status < 400, status, headers: new Headers({ "content-type": contentType }) };
  };
  assert.equal(await probeUi("http://x", { fetchImpl: page(200, "text/html; charset=utf-8") }), true);
  assert.equal(await probeUi("http://x", { fetchImpl: page(404, "text/html; charset=utf-8") }), false);
  assert.equal(await probeUi("http://x", { fetchImpl: page(200, "application/json") }), false);
  const unreachable = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.equal(await probeUi("http://x", { fetchImpl: unreachable }), false);
});

test("reports no UI when it attaches to a server whose root is 404", async () => {
  const owner = createServerSupervisor({ config: configFor("api-only"), hostScript: fakeHost });
  const running = await owner.start();
  try {
    const visitor = createServerSupervisor({
      config: configFor("ready", { expectedUrl: running.url }),
      hostScript: fakeHost,
      forkImpl: () => assert.fail("must not spawn"),
    });
    const attached = await visitor.start();
    assert.deepEqual(attached, { url: running.url, owned: false, ui: false });
    assert.equal(visitor.isOwned(), false);
  } finally {
    await owner.stop();
  }
});

test("surfaces the startup error reported by the host", async () => {
  const supervisor = createServerSupervisor({ config: configFor("error"), hostScript: fakeHost });
  await assert.rejects(supervisor.start(), /boom/);
  assert.equal(supervisor.isOwned(), false);
});

test("fails when the host exits before it is ready", async () => {
  const supervisor = createServerSupervisor({ config: configFor("crash"), hostScript: fakeHost });
  await assert.rejects(supervisor.start(), /exited during startup \(code 7/);
});

test("fails without spawning when no server is installed", async () => {
  const supervisor = createServerSupervisor({
    config: configFor("ready", { serverMode: null }),
    hostScript: fakeHost,
    forkImpl: () => assert.fail("must not spawn"),
  });
  await assert.rejects(supervisor.start(), /No Paperclip server found/);
});

test("kills a host that ignores the shutdown request", async () => {
  const supervisor = createServerSupervisor({
    config: configFor("ignore-shutdown"),
    hostScript: fakeHost,
    stopTimeoutMs: 300,
  });
  const result = await supervisor.start();
  await supervisor.stop();
  assert.equal(await probeServer(result.url), false);
});

test("reports an exit that happens after startup, but not a requested stop", async () => {
  const exits = [];
  const crashing = createServerSupervisor({
    config: configFor("crash-after-ready"),
    hostScript: fakeHost,
    onUnexpectedExit: (status) => exits.push(status),
  });
  await crashing.start();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.deepEqual(exits, [{ code: 3, signal: null }]);

  const stopped = createServerSupervisor({
    config: configFor("ready"),
    hostScript: fakeHost,
    onUnexpectedExit: (status) => exits.push(status),
  });
  await stopped.start();
  await stopped.stop();
  assert.equal(exits.length, 1);
});
