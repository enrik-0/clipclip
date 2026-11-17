// Runs inside a plain Node process (not Electron) and owns the Paperclip
// server. The desktop shell talks to it over the child-process IPC channel:
//
//   host  -> shell   { type: "ready", listenPort, host, apiUrl }
//   host  -> shell   { type: "error", message }
//   shell -> host    { type: "shutdown" }
//
// Windows cannot deliver SIGTERM to a child, so an orderly stop has to be
// requested with a message. Losing the IPC channel (the shell died) also
// triggers an orderly stop, so the server never outlives the shell.
import { pathToFileURL } from "node:url";

const entry = process.env.PAPERCLIP_DESKTOP_SERVER_ENTRY;

function send(message) {
  if (process.connected) process.send(message);
}

let started = null;
let stopping = null;

function stop() {
  stopping ??= (async () => {
    try {
      if (started) await started.shutdown("SIGTERM");
      process.exit(0);
    } catch (error) {
      console.error("[desktop-host] orderly shutdown failed", error);
      process.exit(1);
    }
  })();
  return stopping;
}

process.on("message", (message) => {
  if (message?.type === "shutdown") void stop();
});
process.on("disconnect", () => void stop());

try {
  if (!entry) throw new Error("PAPERCLIP_DESKTOP_SERVER_ENTRY is not set");
  const serverModule = await import(pathToFileURL(entry).href);
  started = await serverModule.startServer();
  if (stopping) {
    // A stop request arrived while the server was still booting.
    await started.shutdown("SIGTERM");
    process.exit(0);
  }
  send({
    type: "ready",
    listenPort: started.listenPort,
    host: started.host,
    apiUrl: started.apiUrl,
  });
} catch (error) {
  console.error("[desktop-host] server failed to start", error);
  send({ type: "error", message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
