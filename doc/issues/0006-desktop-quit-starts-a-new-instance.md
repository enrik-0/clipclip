# 0006: Desktop: `--quit` can start a full new app instead of quitting

- Status: open
- Area: desktop (`desktop/src/main.mjs`)
- Type: bug
- Priority: medium
- Found in: develop @ 73c57431e9

## Summary

`electron . --quit` is documented as the way to stop the app and its server in
order. It works when the server is healthy. After the embedded server has died,
the `--quit` command twice ended up as a **new full app**: its own server child
process, port 3210 listening, and a visible window. The user asked to quit and
the app is running again.

## Observed

**Confirmed, reproduced twice** on Windows 11, Electron 45.3.3, isolated
instance:

1. Start the app (it starts its own server).
2. Kill the server's `node` child process (simulates a crash). The window shows
   "El servidor de Paperclip se ha detenido".
3. Run `electron . --quit`.
4. First run: the command did not return within 120 s (`timeout` killed it).
   Second run: the main process exited after 1 s, but a process named
   `electron.exe . --quit` stayed alive with GPU/renderer children, a new `node`
   server child, port 3210 listening and a visible window. The log showed a
   second `[desktop] repo …` start line.

With a healthy server the same command exits with code 0 in about 400-700 ms and
leaves no process behind (also confirmed, several times).

## Where to look

- `desktop/src/main.mjs:221-229`: `--quit` is handled only inside the
  `second-instance` event of the instance that already holds the lock:

  ```js
  if (!app.requestSingleInstanceLock()) { app.quit(); } else {
    app.on("second-instance", (_event, argv) => {
      if (argv.includes("--quit")) app.quit();
      else showWindow();
    });
  ```

  A `--quit` process that obtains the lock goes down the normal startup path and
  never looks at its own argv.
- **Hypothesis (not verified):** with no server to stop, the running instance
  quits within milliseconds, and the launching process obtains the lock before it
  gives up. That would make it a race that only shows when shutdown is fast.

## Expected

`--quit` never starts the application. If the process that gets the lock was
started with `--quit`, it exits immediately (and, if it cannot reach a running
instance, it exits with a distinct code).

## Acceptance criteria

- A test (extract the decision into a small module if `main.mjs` cannot be
  unit tested): a process started with `--quit` that holds the lock does not
  create a window or start the server.
- Manual check, recorded in the PR: crash the server, run `--quit`, confirm no
  Electron process, no `node` child and no listener remain.
- The healthy-server case still stops the server in order (ordered shutdown log
  lines, no `postgres.exe` left).

## Out of scope

Restarting the server from the tray.
