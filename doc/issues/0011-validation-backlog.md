# 0011: Validation backlog: what was not verified

- Status: open
- Area: all
- Type: test
- Priority: medium
- Found in: develop @ 73c57431e9

## Summary

The 2026-11-18 end-to-end validation covered the main paths of each pull request
(Claude 5-hour limit wait, activity hours, the Obsidian connector with approvals,
OpenCode run MCP servers, the Windows desktop shell). These items were **not**
verified. Each is a small task: do it, record the result here, and open a
separate issue for any bug.

## Desktop (`desktop/`)

- [ ] Tray icon and its menu: "Abrir Paperclip", "Abrir en el navegador",
      "Reiniciar servidor", "Salir".
- [ ] "Reiniciar servidor" from the tray, including after a crash.
- [ ] "Iniciar con Windows" (`--hidden` start). It changes the Windows login
      items; test on a machine where that is acceptable and undo it.
- [ ] External links open in the system browser, not in the app window.
- [ ] The tray balloon on first close, and closing the window with the tray icon
      visible.
- [ ] The intermittent orphan `postgres.exe` the README mentions: repeat start and
      quit cycles on an instance where nothing else uses the same data directory.
      An earlier attempt was invalid because another server shared the database.
- [ ] A window started by a background process opens minimized; check whether the
      app should force it to the front.

## Activity hours

- [ ] Saving the schedule from **Company settings** in the browser (two attempts
      sent no request; unknown whether it was the test tooling or the form).
- [ ] A periodic timer check outside the window is skipped, with no retry.
- [ ] A wake caused by a board comment, in both modes.
- [ ] A window that crosses midnight and a daylight-saving change.
- [ ] Assignment made by an agent in `defer_automatic` (see 0009).
- [ ] The retry badge and monitor banner use "Pool exhausted" wording for this
      wait (known limit in `doc/ACTIVITY-HOURS.md`).

## Claude 5-hour limit

- [ ] A real subscription limit (only the message was simulated).
- [ ] The ACP engine path (`acp.quota`), which this change did not touch.
- [ ] The "AI provider quota" monitor on the task.

## Obsidian connector

- [ ] "Always allow" in the approve menu, and its effect on later calls.
- [ ] A read-only connection when an agent asks to write.
- [ ] `wiki_link` and `manage_tags`, `update_frontmatter` through an agent.
- [ ] Which process creates `.obsidian/` (`app.json`, `appearance.json`, …) inside
      a vault that had none.
- [ ] Links left dangling after a note is deleted or moved (no tool updates them).

## OpenCode

- [ ] Finish the delete flow with OpenCode: the agent closes the task and fixes
      links after the approval runs (the free model ran out before it could).
- [ ] `move_note` / `move_file` with OpenCode; only Claude was used.
- [ ] OpenCode 1.x against the same flows (1.18.32 was only used for the first
      lookup tests).
- [ ] Remote and sandbox targets.

## Repository

- [ ] Run `pnpm verify` and the typecheck on `develop` after the six merges; it was
      not run.
- [ ] The fork CI workflow (`.github/workflows/fork-ci.yml`) was merged to `master`
      only and never ran.

## Acceptance criteria

Every box is either checked with a note on how, or has an issue linked.
