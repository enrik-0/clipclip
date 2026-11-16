import { fork, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "::", "[::]", "localhost"]);

/** URL the shell window should load for a server listening on host:port. */
export function localUrlFor(host, listenPort) {
  const target = WILDCARD_HOSTS.has(host ?? "") ? "127.0.0.1" : host;
  return `http://${target.includes(":") && !target.startsWith("[") ? `[${target}]` : target}:${listenPort}`;
}

/** True when a Paperclip server answers its health route at `baseUrl`. */
export async function probeServer(baseUrl, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  try {
    const response = await fetchImpl(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = await response.json();
    return typeof body === "object" && body !== null && "status" in body;
  } catch {
    return false;
  }
}

function killProcessTree(child) {
  if (process.platform === "win32" && child.pid) {
    // The server owns grandchildren (embedded PostgreSQL, agent CLIs) that a
    // plain kill would leave running on Windows.
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  child.kill("SIGKILL");
}

/**
 * Starts the Paperclip server in a child Node process, or attaches to one that
 * is already running at the expected URL. Only a server this supervisor
 * started is stopped by `stop()`.
 */
export function createServerSupervisor({
  config,
  hostScript,
  onLog = () => {},
  onUnexpectedExit = () => {},
  forkImpl = fork,
  fetchImpl = fetch,
  killTree = killProcessTree,
  startTimeoutMs = 300_000,
  stopTimeoutMs = 90_000,
}) {
  let child = null;
  let exited = null;
  let stopRequested = false;

  async function start() {
    if (await probeServer(config.expectedUrl, { fetchImpl })) {
      return { url: config.expectedUrl, owned: false };
    }
    if (!config.serverMode) {
      throw new Error(
        `No Paperclip server found under ${config.repoRoot}. Install dependencies there or set PAPERCLIP_DESKTOP_REPO_ROOT.`,
      );
    }

    child = forkImpl(hostScript, [], {
      execPath: config.nodePath,
      execArgv: config.tsxLoader ? ["--import", pathToFileURL(config.tsxLoader).href] : [],
      // Same working directory as `pnpm dev:server`, so config discovery
      // behaves the same way under the shell.
      cwd: path.join(config.repoRoot, "server"),
      env: { ...config.serverEnv, PAPERCLIP_DESKTOP_SERVER_ENTRY: config.serverEntry },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });
    child.stdout?.on("data", (chunk) => onLog(chunk.toString()));
    child.stderr?.on("data", (chunk) => onLog(chunk.toString()));
    exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`The server did not become ready within ${Math.round(startTimeoutMs / 1000)}s.`)),
        startTimeoutMs,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Could not launch Node (${config.nodePath}): ${error.message}`));
      });
      child.on("message", (message) => {
        if (message?.type === "ready") {
          clearTimeout(timer);
          resolve({ url: localUrlFor(message.host, message.listenPort), owned: true });
        } else if (message?.type === "error") {
          clearTimeout(timer);
          reject(new Error(message.message));
        }
      });
      void exited.then(({ code, signal }) => {
        clearTimeout(timer);
        reject(new Error(`The server process exited during startup (code ${code ?? "none"}, signal ${signal ?? "none"}).`));
      });
    });

    try {
      const result = await ready;
      void exited.then((status) => {
        if (!stopRequested) onUnexpectedExit(status);
      });
      return result;
    } catch (error) {
      await stop();
      throw error;
    }
  }

  async function stop() {
    if (!child || !exited) return;
    stopRequested = true;
    const running = child;
    if (running.exitCode === null && running.signalCode === null) {
      if (running.connected) running.send({ type: "shutdown" });
      else killTree(running);
      let timer;
      const timedOut = new Promise((resolve) => {
        timer = setTimeout(() => resolve(true), stopTimeoutMs);
      });
      if (await Promise.race([exited.then(() => false), timedOut])) {
        killTree(running);
        await exited;
      }
      clearTimeout(timer);
    }
    child = null;
  }

  return { start, stop, isOwned: () => child !== null };
}
