# 0008: Desktop: the server-stopped page prints raw ANSI colour codes

- Status: open
- Area: desktop (`main.mjs`, `status-page.mjs`)
- Type: bug
- Priority: low
- Found in: develop @ 73c57431e9

## Summary

When the embedded server exits unexpectedly, the app shows the tail of the server
log. The log contains terminal colour sequences, which the HTML page prints as
text, so the log looks like `�[32mINFO�[39m: …`.

## Observed

**Confirmed** (screenshot of the window after killing the server): the title
"El servidor de Paperclip se ha detenido", the exit line (code 4294967295, which
is `-1` read as unsigned), and a log box full of `�[36m`, `�[39m` and `�[90m`.

## Where to look

- `desktop/src/main.mjs`: `logTail` is passed as `log` to `showStatus`.
- `desktop/src/status-page.mjs`: `statusPageUrl({ title, detail, log, busy })`
  escapes HTML but does not strip control sequences.

## Expected

The log box is readable text. Strip ANSI escape sequences before display (keep
the full raw log in `server.log`). Consider showing the exit code as a signed
value or "unknown".

## Acceptance criteria

- A unit test for the stripping function (SGR sequences and the `ESC[`
  prefix), and for `statusPageUrl` output with coloured input.
- The raw log file is unchanged.

## Out of scope

Colourless logging in the server.
