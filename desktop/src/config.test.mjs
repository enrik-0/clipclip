import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readEnvFile, resolveDesktopConfig } from "./config.mjs";

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-desktop-"));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

const SOURCE_SERVER = {
  "server/src/index.ts": "",
  "server/node_modules/tsx/dist/loader.mjs": "",
};

test("readEnvFile parses assignments, quotes and export prefixes", () => {
  const root = makeRepo({
    ".env": [
      "# comment",
      "PORT=3200",
      'export NAME="quoted value"',
      "EMPTY=",
      "bad line",
      "URL=postgres://u:p@h/db?x=1",
    ].join("\r\n"),
  });
  assert.deepEqual(readEnvFile(path.join(root, ".env")), {
    PORT: "3200",
    NAME: "quoted value",
    EMPTY: "",
    URL: "postgres://u:p@h/db?x=1",
  });
  assert.deepEqual(readEnvFile(path.join(root, "missing.env")), {});
});

test("defaults to the repository that contains the desktop package", () => {
  const root = makeRepo(SOURCE_SERVER);
  const config = resolveDesktopConfig({ env: {}, desktopDir: path.join(root, "desktop") });
  assert.equal(config.repoRoot, root);
  assert.equal(config.serverMode, "source");
  assert.equal(config.serverEntry, path.join(root, "server", "src", "index.ts"));
  assert.equal(config.tsxLoader, path.join(root, "server", "node_modules", "tsx", "dist", "loader.mjs"));
  assert.equal(config.expectedUrl, "http://127.0.0.1:3100");
  assert.equal(config.nodePath, "node");
});

test("reads the port from the env file and lets the process env win", () => {
  const root = makeRepo({ ...SOURCE_SERVER, ".paperclip/.env": "PORT=3200\nDATABASE_URL=from-file\n" });
  const desktopDir = path.join(root, "desktop");
  const fromFile = resolveDesktopConfig({ env: {}, desktopDir });
  assert.equal(fromFile.expectedUrl, "http://127.0.0.1:3200");
  assert.equal(fromFile.serverEnv.DATABASE_URL, "from-file");

  const overridden = resolveDesktopConfig({ env: { PORT: "3300", DATABASE_URL: "from-env" }, desktopDir });
  assert.equal(overridden.expectedUrl, "http://127.0.0.1:3300");
  assert.equal(overridden.serverEnv.DATABASE_URL, "from-env");
});

test("turns on the Vite middleware only when no built UI exists", () => {
  const withoutUi = makeRepo(SOURCE_SERVER);
  const desktopDir = path.join(withoutUi, "desktop");
  assert.equal(resolveDesktopConfig({ env: {}, desktopDir }).serverEnv.PAPERCLIP_UI_DEV_MIDDLEWARE, "true");
  assert.equal(
    resolveDesktopConfig({ env: { PAPERCLIP_UI_DEV_MIDDLEWARE: "false" }, desktopDir }).serverEnv
      .PAPERCLIP_UI_DEV_MIDDLEWARE,
    "false",
  );

  const withUi = makeRepo({ ...SOURCE_SERVER, "ui/dist/index.html": "" });
  assert.equal(
    resolveDesktopConfig({ env: {}, desktopDir: path.join(withUi, "desktop") }).serverEnv.PAPERCLIP_UI_DEV_MIDDLEWARE,
    undefined,
  );
});

test("falls back to the built server, and reports when none is installed", () => {
  const built = makeRepo({ "server/dist/index.js": "" });
  const builtConfig = resolveDesktopConfig({ env: {}, desktopDir: path.join(built, "desktop") });
  assert.equal(builtConfig.serverMode, "dist");
  assert.equal(builtConfig.serverEntry, path.join(built, "server", "dist", "index.js"));
  assert.equal(builtConfig.tsxLoader, null);

  const empty = makeRepo({ "README.md": "" });
  assert.equal(resolveDesktopConfig({ env: {}, desktopDir: path.join(empty, "desktop") }).serverMode, null);
});

test("honours the repository, env file, URL and Node overrides", () => {
  const other = makeRepo({ ...SOURCE_SERVER, "custom.env": "PORT=3400\n" });
  const config = resolveDesktopConfig({
    env: {
      PAPERCLIP_DESKTOP_REPO_ROOT: other,
      PAPERCLIP_DESKTOP_ENV_FILE: path.join(other, "custom.env"),
      PAPERCLIP_DESKTOP_URL: "http://127.0.0.1:9999/",
      PAPERCLIP_DESKTOP_NODE: "C:/node/node.exe",
    },
    desktopDir: path.join(os.tmpdir(), "elsewhere", "desktop"),
  });
  assert.equal(config.repoRoot, other);
  assert.equal(config.serverEnv.PORT, "3400");
  assert.equal(config.expectedUrl, "http://127.0.0.1:9999");
  assert.equal(config.nodePath, "C:/node/node.exe");
});

test("a packaged build runs its bundled server with Electron as Node and keeps its env file in the user data dir", () => {
  const runtime = makeRepo({ "server/dist/index.js": "", "server/ui-dist/index.html": "" });
  const userData = makeRepo({ ".env": "PORT=3777\n" });
  const execPath = path.join(runtime, "Paperclip Desktop.exe");
  const packaged = { runtimeDir: runtime, userDataDir: userData, execPath };
  const config = resolveDesktopConfig({ env: {}, desktopDir: path.join(runtime, "app.asar"), packaged });
  assert.equal(config.repoRoot, runtime);
  assert.equal(config.serverMode, "dist");
  assert.equal(config.nodePath, execPath);
  assert.equal(config.serverEnv.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(config.envFile, path.join(userData, ".env"));
  assert.equal(config.expectedUrl, "http://127.0.0.1:3777");
  assert.equal(config.serverEnv.PAPERCLIP_UI_DEV_MIDDLEWARE, undefined);

  const custom = resolveDesktopConfig({
    env: { PAPERCLIP_DESKTOP_NODE: "node" },
    desktopDir: path.join(runtime, "app.asar"),
    packaged,
  });
  assert.equal(custom.nodePath, "node");
  assert.equal(custom.serverEnv.ELECTRON_RUN_AS_NODE, undefined);
});
