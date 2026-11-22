function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// CSI (`ESC[` ... final byte, which covers SGR colours), OSC (`ESC]` ... BEL
// or ESC\), and the remaining two-character escapes.
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Removes terminal escape sequences, so a server log reads as plain text. */
export function stripAnsi(text) {
  return String(text).replace(ANSI_PATTERN, "");
}

/**
 * Exit code for display. Windows reports some codes as unsigned 32-bit values
 * (4294967295 is -1), so they are shown signed. No code is "desconocido".
 */
export function formatExitCode(code) {
  if (typeof code !== "number" || !Number.isFinite(code)) return "desconocido";
  return String(code > 0x7fffffff && code <= 0xffffffff ? code - 0x1_0000_0000 : code);
}

/**
 * Builds the local page shown while the server is starting, stopping, or has
 * failed. It is loaded as a data URL, so it needs no file access and runs no
 * script. Escape sequences in `log` are removed for display only.
 */
export function statusPageUrl({ title, detail = "", log = "", busy = false }) {
  log = stripAnsi(log);
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Paperclip</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: Canvas; color: CanvasText; font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
  main { width: min(760px, calc(100vw - 48px)); }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: GrayText; }
  pre { margin: 0; padding: 12px; max-height: 50vh; overflow: auto; border: 1px solid GrayText; border-radius: 6px;
        font: 12px/1.45 Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  .bar { height: 3px; margin-bottom: 20px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, CanvasText 15%, Canvas); }
  .bar::after { content: ""; display: block; width: 35%; height: 100%; background: Highlight; animation: slide 1.4s ease-in-out infinite; }
  @keyframes slide { from { margin-left: -35%; } to { margin-left: 100%; } }
  @media (prefers-reduced-motion: reduce) { .bar::after { animation: none; width: 100%; } }
</style>
</head>
<body>
<main>
  ${busy ? '<div class="bar"></div>' : ""}
  <h1>${escapeHtml(title)}</h1>
  ${detail ? `<p>${escapeHtml(detail)}</p>` : ""}
  ${log ? `<pre>${escapeHtml(log)}</pre>` : ""}
</main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
