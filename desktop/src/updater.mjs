// Keeps an installed build up to date. It wraps electron-updater's
// `autoUpdater` (passed in, so tests can use a fake) and exposes a small state
// machine for the tray menu.
//
// Flow: a first check shortly after start and then a periodic one. A newer
// version downloads in the background. It installs when the person picks
// "Reiniciar para actualizar", or silently when the app is quit
// (`autoInstallOnAppQuit`).

export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_INITIAL_DELAY_MS = 30 * 1000;

/**
 * @param {object} options
 * @param {import("node:events").EventEmitter & Record<string, any>} options.autoUpdater
 * @param {boolean} options.enabled
 * @param {string | null} [options.feedUrl] Generic feed that replaces the feed baked into the app.
 * @param {() => Promise<void>} [options.prepareToInstall] Runs before the app restarts into the new version.
 * @param {(state: object) => void} [options.onChange]
 * @param {(line: string) => void} [options.log]
 */
export function createUpdater({
  autoUpdater,
  enabled,
  feedUrl = null,
  prepareToInstall = async () => {},
  onChange = () => {},
  log = () => {},
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) {
  let state = { status: enabled ? "idle" : "disabled", version: null, percent: null, error: null };
  let firstCheck = null;
  let periodicCheck = null;
  let attached = false;

  function setState(patch) {
    state = { ...state, ...patch };
    onChange({ ...state });
  }

  const handlers = {
    "checking-for-update": () => setState({ status: "checking", error: null }),
    "update-available": (info) => setState({ status: "available", version: info?.version ?? null, percent: null }),
    "download-progress": (progress) =>
      setState({ status: "downloading", percent: Math.round(progress?.percent ?? 0) }),
    "update-downloaded": (info) => setState({ status: "downloaded", version: info?.version ?? state.version, percent: 100 }),
    "update-not-available": () => {
      // A finished download stays ready to install even if a later check finds nothing newer.
      if (state.status !== "downloaded") setState({ status: "idle", percent: null });
    },
    error: (error) => {
      log(`[updater] error: ${error?.message ?? error}`);
      setState({ status: "error", error: error?.message ?? String(error) });
    },
  };

  function attach() {
    if (attached) return;
    attached = true;
    for (const [event, handler] of Object.entries(handlers)) autoUpdater.on(event, handler);
  }

  function detach() {
    if (!attached) return;
    attached = false;
    for (const [event, handler] of Object.entries(handlers)) autoUpdater.removeListener(event, handler);
  }

  async function checkNow() {
    if (!enabled) return false;
    if (state.status === "downloading" || state.status === "downloaded") return false;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      // electron-updater also emits "error"; this covers a rejection without an event.
      handlers.error(error);
    }
    return true;
  }

  async function installNow() {
    if (!enabled || state.status !== "downloaded") return false;
    try {
      await prepareToInstall();
    } catch (error) {
      handlers.error(new Error(`Could not stop the server before updating: ${error?.message ?? error}`));
      return false;
    }
    log(`[updater] restarting to install ${state.version}`);
    // Silent install, then start the new version.
    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  function start() {
    if (!enabled) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = {
      info: (message) => log(`[updater] ${message}`),
      warn: (message) => log(`[updater] ${message}`),
      error: (message) => log(`[updater] ${message}`),
      debug: () => {},
    };
    if (feedUrl) autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
    attach();
    firstCheck = setTimeoutImpl(() => void checkNow(), initialDelayMs);
    periodicCheck = setIntervalImpl(() => void checkNow(), checkIntervalMs);
  }

  function stop() {
    if (firstCheck !== null) clearTimeoutImpl(firstCheck);
    if (periodicCheck !== null) clearIntervalImpl(periodicCheck);
    firstCheck = null;
    periodicCheck = null;
    detach();
  }

  /** The tray menu entry for the current state, or null when updates are off. */
  function trayItem() {
    switch (state.status) {
      case "disabled":
        return null;
      case "checking":
        return { label: "Buscando actualizaciones…", enabled: false, action: null };
      case "available":
        return { label: `Descargando actualización ${state.version ?? ""}`.trim(), enabled: false, action: null };
      case "downloading":
        return { label: `Descargando actualización (${state.percent ?? 0} %)`, enabled: false, action: null };
      case "downloaded":
        return { label: `Reiniciar para actualizar a ${state.version}`, enabled: true, action: "install" };
      case "error":
        return { label: "No se pudo buscar actualizaciones. Reintentar", enabled: true, action: "check" };
      default:
        return { label: "Buscar actualizaciones", enabled: true, action: "check" };
    }
  }

  return { start, stop, checkNow, installNow, trayItem, getState: () => ({ ...state }) };
}
