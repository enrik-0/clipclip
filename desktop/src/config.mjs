import fs from "node:fs";
import path from "node:path";

const DEFAULT_PORT = 3100;

/**
 * Parses a dotenv-style file into a plain object. Only `KEY=value` lines are
 * read; quotes around the value are removed. Returns an empty object when the
 * file does not exist.
 */
export function readEnvFile(filePath, fsImpl = fs) {
  let raw;
  try {
    raw = fsImpl.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function firstExisting(candidates, fsImpl) {
  return candidates.find((candidate) => fsImpl.existsSync(candidate)) ?? null;
}

/**
 * Resolves everything the shell needs to start, or attach to, a Paperclip
 * server. Values already present in `env` win over the env file, matching how
 * the server itself loads its env file.
 */
export function resolveDesktopConfig({ env, desktopDir, fsImpl = fs, packaged = null }) {
  // An installed build carries the compiled server in `packaged.runtimeDir`
  // (resources/runtime) and keeps its env file in the per-user data directory
  // instead of a repository checkout. It runs the server with the Electron
  // executable acting as Node, so the machine does not need Node installed.
  const repoRoot = path.resolve(
    env.PAPERCLIP_DESKTOP_REPO_ROOT || packaged?.runtimeDir || path.join(desktopDir, ".."),
  );
  const defaultEnvFile = packaged
    ? path.join(packaged.userDataDir, ".env")
    : path.join(repoRoot, ".paperclip", ".env");
  const envFile = path.resolve(env.PAPERCLIP_DESKTOP_ENV_FILE || defaultEnvFile);
  const serverEnv = { ...readEnvFile(envFile, fsImpl), ...env };
  if (packaged && !env.PAPERCLIP_DESKTOP_NODE) serverEnv.ELECTRON_RUN_AS_NODE = "1";

  const sourceEntry = path.join(repoRoot, "server", "src", "index.ts");
  const distEntry = path.join(repoRoot, "server", "dist", "index.js");
  const tsxLoader = path.join(repoRoot, "server", "node_modules", "tsx", "dist", "loader.mjs");
  const requestedMode = env.PAPERCLIP_DESKTOP_SERVER_MODE;
  const sourceAvailable = fsImpl.existsSync(sourceEntry) && fsImpl.existsSync(tsxLoader);
  const distAvailable = fsImpl.existsSync(distEntry);
  let serverMode = null;
  if (requestedMode === "source" || requestedMode === "dist") serverMode = requestedMode;
  else if (sourceAvailable) serverMode = "source";
  else if (distAvailable) serverMode = "dist";

  const builtUi = firstExisting(
    [path.join(repoRoot, "server", "ui-dist", "index.html"), path.join(repoRoot, "ui", "dist", "index.html")],
    fsImpl,
  );
  if (!builtUi && serverEnv.PAPERCLIP_UI_DEV_MIDDLEWARE === undefined) {
    // Without a built UI the server would answer API requests only. The Vite
    // middleware serves the UI from source on the same port instead.
    serverEnv.PAPERCLIP_UI_DEV_MIDDLEWARE = "true";
  }

  const port = Number(serverEnv.PORT) || DEFAULT_PORT;
  const expectedUrl = (env.PAPERCLIP_DESKTOP_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");

  return {
    repoRoot,
    envFile,
    serverEnv,
    serverMode,
    serverEntry: serverMode === "dist" ? distEntry : sourceEntry,
    tsxLoader: serverMode === "source" ? tsxLoader : null,
    nodePath: env.PAPERCLIP_DESKTOP_NODE || (packaged ? packaged.execPath : "node"),
    expectedUrl,
    iconPath: firstExisting(
      [
        path.join(desktopDir, "build", "icon.png"),
        path.join(repoRoot, "ui", "public", "android-chrome-192x192.png"),
        path.join(repoRoot, "ui", "public", "favicon-32x32.png"),
      ],
      fsImpl,
    ),
  };
}
