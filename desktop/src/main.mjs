import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from "electron";
import { resolveDesktopConfig } from "./config.mjs";
import { handleLaunch, secondInstanceAction } from "./launch.mjs";
import { createServerSupervisor } from "./server-supervisor.mjs";
import { statusPageUrl } from "./status-page.mjs";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(srcDir, "..");
const LOG_TAIL_CHARS = 6000;
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

app.setName("Paperclip Desktop");
if (process.platform === "win32") app.setAppUserModelId("ai.paperclip.desktop");

const config = resolveDesktopConfig({ env: process.env, desktopDir });

let mainWindow = null;
let tray = null;
let supervisor = null;
let serverUrl = null;
let serverOwned = false;
let logStream = null;
let logTail = "";
let quitting = false;
let trayHintShown = false;

function appendLog(text) {
  logTail = (logTail + text).slice(-LOG_TAIL_CHARS);
  logStream?.write(text);
}

function openLogStream() {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "server.log");
  try {
    if (fs.statSync(logFile).size > LOG_ROTATE_BYTES) fs.renameSync(logFile, `${logFile}.1`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  logStream = fs.createWriteStream(logFile, { flags: "a" });
  return logFile;
}

function loginItemOptions() {
  // Unpackaged, the executable is Electron itself and needs the app path.
  return app.isPackaged
    ? { args: ["--hidden"] }
    : { path: process.execPath, args: [app.getAppPath(), "--hidden"] };
}

function isSameOrigin(url) {
  try {
    return serverUrl !== null && new URL(url).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

function openExternally(url) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function showStatus(page) {
  if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(statusPageUrl(page));
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "Paperclip",
    icon: config.iconPath ?? undefined,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url)) return { action: "allow" };
    openExternally(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isSameOrigin(url) || url.startsWith("data:")) return;
    event.preventDefault();
    openExternally(url);
  });

  // Closing the window keeps the server (and the agents it runs) alive in the
  // tray. Only "Salir" stops it.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!trayHintShown && tray && process.platform === "win32") {
      trayHintShown = true;
      tray.displayBalloon({
        title: "Paperclip sigue en marcha",
        content: "Los agentes continúan trabajando. Usa el icono de la bandeja para abrir o salir.",
      });
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (serverUrl) void mainWindow.loadURL(serverUrl);
}

function buildTrayMenu() {
  const loginItem = app.getLoginItemSettings(loginItemOptions());
  return Menu.buildFromTemplate([
    { label: "Abrir Paperclip", click: showWindow },
    {
      label: "Abrir en el navegador",
      enabled: serverUrl !== null,
      click: () => serverUrl && openExternally(serverUrl),
    },
    { type: "separator" },
    {
      label: "Reiniciar servidor",
      enabled: serverOwned || serverUrl === null,
      click: () => void restartServer(),
    },
    {
      label: "Iniciar con Windows",
      type: "checkbox",
      checked: loginItem.openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked });
        refreshTray();
      },
    },
    { type: "separator" },
    { label: "Salir", click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
  tray.setToolTip(
    serverUrl ? `Paperclip — ${serverUrl}${serverOwned ? "" : " (servidor externo)"}` : "Paperclip — sin servidor",
  );
}

function createTray() {
  const image = config.iconPath
    ? nativeImage.createFromPath(config.iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
  tray = new Tray(image);
  tray.on("click", showWindow);
  refreshTray();
}

async function startServer() {
  serverUrl = null;
  serverOwned = false;
  refreshTray();
  showStatus({
    title: "Iniciando Paperclip…",
    detail: "Arrancando el servidor local. La primera vez puede tardar un par de minutos.",
    busy: true,
  });

  supervisor = createServerSupervisor({
    config,
    hostScript: path.join(srcDir, "server-host.mjs"),
    onLog: appendLog,
    onUnexpectedExit: ({ code, signal }) => {
      serverUrl = null;
      serverOwned = false;
      refreshTray();
      showStatus({
        title: "El servidor de Paperclip se ha detenido",
        detail: `Salió de forma inesperada (código ${code ?? "ninguno"}, señal ${signal ?? "ninguna"}). Usa "Reiniciar servidor" en el icono de la bandeja.`,
        log: logTail,
      });
      showWindow();
    },
  });

  try {
    const result = await supervisor.start();
    serverUrl = result.url;
    serverOwned = result.owned;
    appendLog(`[desktop] ${result.owned ? "started" : "attached to"} server at ${result.url}\n`);
    refreshTray();
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(serverUrl);
  } catch (error) {
    appendLog(`[desktop] server start failed: ${error?.message ?? error}\n`);
    refreshTray();
    showStatus({
      title: "No se pudo iniciar Paperclip",
      detail: error?.message ?? String(error),
      log: logTail,
    });
    showWindow();
  }
}

async function restartServer() {
  showStatus({ title: "Reiniciando el servidor…", busy: true });
  await supervisor?.stop();
  await startServer();
}

function startApp({ hidden }) {
  // Launching the app again focuses the running one; `--quit` asks it to shut
  // down instead, which gives scripts a way to stop the server cleanly.
  app.on("second-instance", (_event, argv) => {
    if (secondInstanceAction(argv) === "quit") app.quit();
    else showWindow();
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    if (!supervisor?.isOwned()) return;
    // Hold the quit until the server has finished its orderly shutdown, so
    // running agents and the embedded database are closed cleanly.
    event.preventDefault();
    showStatus({
      title: "Cerrando Paperclip…",
      detail: "Deteniendo el servidor de forma ordenada.",
      busy: true,
    });
    void supervisor.stop().finally(() => {
      logStream?.end();
      app.exit(0);
    });
  });

  // The window being hidden to the tray must not end the app.
  app.on("window-all-closed", () => {});

  // Not a top-level await: Electron holds back `ready` until this module has
  // finished loading, so awaiting it here would never resolve.
  void app.whenReady().then(async () => {
    const logFile = openLogStream();
    appendLog(`[desktop] repo ${config.repoRoot}, mode ${config.serverMode ?? "none"}, log ${logFile}
`);
    createTray();
    createWindow();
    if (!hidden) showWindow();
    await startServer();
  });
}

handleLaunch({
  argv: process.argv,
  requestLock: () => app.requestSingleInstanceLock(),
  quit: () => app.quit(),
  exit: (code) => app.exit(code),
  start: startApp,
  log: (text) => process.stderr.write(text),
});
