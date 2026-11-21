/**
 * Exit code of a `--quit` process that found no running instance to stop. It
 * differs from 0 so that scripts can tell "stopped the app" from "nothing was
 * running".
 */
export const EXIT_NO_RUNNING_INSTANCE = 2;

/** What the instance that holds the lock does when the app is launched again. */
export function secondInstanceAction(argv) {
  return argv.includes("--quit") ? "quit" : "show";
}

/**
 * Decides what a newly launched process does, and does it through the given
 * callbacks.
 *
 * - Without the single-instance lock, the running instance gets this argv
 *   (through `second-instance`) and this process quits.
 * - With the lock and `--quit`, no instance was running (or it shut down
 *   before this process asked). A `--quit` process never starts the app, so it
 *   exits at once with `EXIT_NO_RUNNING_INSTANCE`.
 * - Otherwise this process starts the app.
 *
 * Returns the action taken: "defer", "exit" or "start".
 */
export function handleLaunch({ argv, requestLock, quit, exit, start, log = () => {} }) {
  if (!requestLock()) {
    quit();
    return "defer";
  }
  if (argv.includes("--quit")) {
    log("[desktop] --quit: no running Paperclip Desktop instance to stop\n");
    exit(EXIT_NO_RUNNING_INSTANCE);
    return "exit";
  }
  start({ hidden: argv.includes("--hidden") });
  return "start";
}
