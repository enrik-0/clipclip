import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createUpdater } from "./updater.mjs";

/** Stand-in for electron-updater's `autoUpdater`. */
function fakeAutoUpdater({ checkResult = () => Promise.resolve(null) } = {}) {
  const emitter = new EventEmitter();
  emitter.calls = { check: 0, install: [], feed: [] };
  emitter.checkForUpdates = () => {
    emitter.calls.check += 1;
    return checkResult();
  };
  emitter.setFeedURL = (options) => emitter.calls.feed.push(options);
  emitter.quitAndInstall = (...args) => emitter.calls.install.push(args);
  return emitter;
}

/** Timer stand-ins that never fire on their own, so a test decides when. */
function fakeTimers() {
  const timers = { timeouts: [], intervals: [], cleared: [] };
  return {
    timers,
    setTimeoutImpl: (fn, ms) => (timers.timeouts.push({ fn, ms }), timers.timeouts.length),
    setIntervalImpl: (fn, ms) => (timers.intervals.push({ fn, ms }), timers.intervals.length),
    clearTimeoutImpl: (id) => timers.cleared.push(["timeout", id]),
    clearIntervalImpl: (id) => timers.cleared.push(["interval", id]),
  };
}

function make(overrides = {}) {
  const autoUpdater = overrides.autoUpdater ?? fakeAutoUpdater();
  const clock = fakeTimers();
  const changes = [];
  const updater = createUpdater({
    autoUpdater,
    enabled: true,
    onChange: (state) => changes.push(state.status),
    ...clock,
    ...overrides,
  });
  return { updater, autoUpdater, clock, changes };
}

test("a disabled updater touches nothing and offers no menu item", async () => {
  const { updater, autoUpdater, clock } = make({ enabled: false });
  updater.start();
  assert.equal(updater.getState().status, "disabled");
  assert.equal(clock.timers.timeouts.length, 0);
  assert.equal(await updater.checkNow(), false);
  assert.equal(autoUpdater.calls.check, 0);
  assert.equal(updater.trayItem(), null);
});

test("start configures the updater and schedules the first check, then a repeating one", async () => {
  const { updater, autoUpdater, clock } = make({ initialDelayMs: 1000, checkIntervalMs: 5000 });
  updater.start();
  assert.equal(autoUpdater.autoDownload, true);
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
  assert.equal(autoUpdater.allowPrerelease, false);
  assert.equal(autoUpdater.allowDowngrade, false);
  assert.deepEqual(autoUpdater.calls.feed, [], "the feed baked into the app is used by default");
  assert.equal(clock.timers.timeouts[0].ms, 1000);
  assert.equal(clock.timers.intervals[0].ms, 5000);

  await clock.timers.timeouts[0].fn();
  assert.equal(autoUpdater.calls.check, 1);
  await clock.timers.intervals[0].fn();
  assert.equal(autoUpdater.calls.check, 2);
});

test("a feed URL overrides the feed baked into the app", () => {
  const { updater, autoUpdater } = make({ feedUrl: "http://127.0.0.1:8766" });
  updater.start();
  assert.deepEqual(autoUpdater.calls.feed, [{ provider: "generic", url: "http://127.0.0.1:8766" }]);
});

test("updater events move the state and report each change", () => {
  const { updater, autoUpdater, changes } = make();
  updater.start();

  autoUpdater.emit("checking-for-update");
  assert.equal(updater.getState().status, "checking");

  autoUpdater.emit("update-available", { version: "1.2.3" });
  assert.deepEqual(
    [updater.getState().status, updater.getState().version],
    ["available", "1.2.3"],
  );

  autoUpdater.emit("download-progress", { percent: 41.6 });
  assert.deepEqual(
    [updater.getState().status, updater.getState().percent],
    ["downloading", 42],
  );

  autoUpdater.emit("update-downloaded", { version: "1.2.3" });
  assert.equal(updater.getState().status, "downloaded");

  autoUpdater.emit("update-not-available", { version: "1.0.0" });
  assert.equal(updater.getState().status, "downloaded", "a finished download is not forgotten");

  assert.deepEqual(changes, ["checking", "available", "downloading", "downloaded"]);
});

test("no update leaves the state idle, and an error is kept with its message", () => {
  const { updater, autoUpdater } = make();
  updater.start();
  autoUpdater.emit("update-not-available", { version: "1.0.0" });
  assert.equal(updater.getState().status, "idle");

  autoUpdater.emit("error", new Error("feed unreachable"));
  assert.equal(updater.getState().status, "error");
  assert.equal(updater.getState().error, "feed unreachable");
});

test("checkNow does not check while an update is downloading or ready", async () => {
  const { updater, autoUpdater } = make();
  updater.start();
  autoUpdater.emit("download-progress", { percent: 10 });
  assert.equal(await updater.checkNow(), false);
  autoUpdater.emit("update-downloaded", { version: "2.0.0" });
  assert.equal(await updater.checkNow(), false);
  assert.equal(autoUpdater.calls.check, 0);
});

test("a failing check becomes an error state instead of throwing", async () => {
  const autoUpdater = fakeAutoUpdater({ checkResult: () => Promise.reject(new Error("HTTP 404")) });
  const { updater } = make({ autoUpdater });
  updater.start();
  assert.equal(await updater.checkNow(), true);
  assert.equal(updater.getState().status, "error");
  assert.equal(updater.getState().error, "HTTP 404");
});

test("installNow stops the server first, then restarts into the new version", async () => {
  const order = [];
  const autoUpdater = fakeAutoUpdater();
  autoUpdater.quitAndInstall = (...args) => order.push(["quitAndInstall", ...args]);
  const { updater } = make({ autoUpdater, prepareToInstall: async () => order.push("prepare") });
  updater.start();

  assert.equal(await updater.installNow(), false, "nothing is installed before a download finishes");
  assert.deepEqual(order, []);

  autoUpdater.emit("update-downloaded", { version: "2.0.0" });
  assert.equal(await updater.installNow(), true);
  assert.deepEqual(order, ["prepare", ["quitAndInstall", true, true]]);
});

test("installNow does not restart when the shutdown step fails", async () => {
  const autoUpdater = fakeAutoUpdater();
  const { updater } = make({ autoUpdater, prepareToInstall: async () => { throw new Error("server busy"); } });
  updater.start();
  autoUpdater.emit("update-downloaded", { version: "2.0.0" });
  assert.equal(await updater.installNow(), false);
  assert.equal(autoUpdater.calls.install.length, 0);
  assert.equal(updater.getState().status, "error");
  assert.match(updater.getState().error, /server busy/);
});

test("the tray item follows the state", () => {
  const { updater, autoUpdater } = make();
  updater.start();
  assert.deepEqual(updater.trayItem(), { label: "Buscar actualizaciones", enabled: true, action: "check" });

  autoUpdater.emit("checking-for-update");
  assert.deepEqual(updater.trayItem(), { label: "Buscando actualizaciones…", enabled: false, action: null });

  autoUpdater.emit("download-progress", { percent: 42.2 });
  assert.deepEqual(updater.trayItem(), { label: "Descargando actualización (42 %)", enabled: false, action: null });

  autoUpdater.emit("update-downloaded", { version: "2.0.0" });
  assert.deepEqual(updater.trayItem(), { label: "Reiniciar para actualizar a 2.0.0", enabled: true, action: "install" });

  const failed = make();
  failed.updater.start();
  failed.autoUpdater.emit("error", new Error("x"));
  assert.deepEqual(failed.updater.trayItem(), {
    label: "No se pudo buscar actualizaciones. Reintentar",
    enabled: true,
    action: "check",
  });
});

test("stop cancels the timers and detaches from the updater", () => {
  const { updater, autoUpdater, clock } = make();
  updater.start();
  updater.stop();
  assert.equal(clock.timers.cleared.length, 2);
  autoUpdater.emit("update-available", { version: "9.9.9" });
  assert.notEqual(updater.getState().status, "available");
});
