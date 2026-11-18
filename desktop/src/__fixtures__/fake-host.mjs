// Stand-in for server-host.mjs that speaks the same IPC protocol.
import http from "node:http";

const mode = process.env.FAKE_HOST_MODE ?? "ready";

if (mode === "error") {
  process.send({ type: "error", message: "boom" });
  process.exit(1);
} else if (mode === "crash") {
  process.exit(7);
} else {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    // "api-only" mimics a server with no built UI and no Vite middleware.
    if (req.url === "/" && mode !== "api-only") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>Paperclip</title>");
      return;
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end("<pre>Cannot GET /</pre>");
  });
  server.listen(0, "127.0.0.1", () => {
    process.send({ type: "ready", host: "127.0.0.1", listenPort: server.address().port, apiUrl: "ignored" });
  });
  process.on("message", (message) => {
    if (message?.type !== "shutdown") return;
    if (mode === "ignore-shutdown" || mode === "crash-after-ready") return;
    server.close(() => process.exit(0));
  });
  if (mode === "crash-after-ready") setTimeout(() => process.exit(3), 200);
}
