# 0007: Desktop: attaching to a server that serves no UI shows "Cannot GET /"

- Status: open
- Area: desktop (`server-supervisor.mjs`, `status-page.mjs`)
- Type: bug
- Priority: low
- Found in: develop @ 73c57431e9

## Summary

If a Paperclip server is already running on the expected URL, the desktop app
attaches to it. If that server runs in API-only mode (no built UI and the Vite
middleware off, as `pnpm dev:server` does), the window loads the server's root
and shows the Express error page "Cannot GET /" (window title "Error"). The app
reports no problem.

## Observed

**Confirmed.** A server started with `pnpm dev:server` and no
`PAPERCLIP_UI_DEV_MIDDLEWARE` (the same start prints `UI dist not found; running
in API-only mode`) answered 404 on `/`. The app logged `attached to server at http://127.0.0.1:3210` and the
window title became "Error". The same app, when it starts its own server, enables
the Vite middleware and shows the UI.

## Where to look

- `desktop/src/server-supervisor.mjs`: the probe accepts any answer that is a
  Paperclip health payload (`probeServer`).
- `desktop/src/status-page.mjs`: existing loading and error pages.
- The health payload may or may not say whether a UI is served; check before
  adding a field (`AGENTS.md` section 5 asks for synced contracts).

## Expected

When attaching, the app checks that `GET /` returns the UI (HTML that is not an
error page) before loading it. If not, it shows its status page explaining that
the server it found serves no UI, with the options available (restart without
attaching, or open the API URL).

## Acceptance criteria

- A test in `desktop/src/` (`node --test`): the probe or the attach step reports
  "no UI" for a server whose `/` is 404.
- The status page text is clear in Spanish, like the others.
- Attaching to a server that serves the UI is unchanged.

## Out of scope

Starting the Vite middleware on a server the app does not own.
