# Known issues

One file per issue, written so that an agent (or a person) can pick it up cold.
They come from an end-to-end validation of `develop` at `73c57431e9` on
2026-11-18. Each file says what was observed, how to reproduce it, what the
code shows, and what "done" means.

GitHub Issues is turned off on this fork, which is why they live here.

## How to work an issue

1. Read the issue file and the docs `AGENTS.md` section 2 points to for the area.
2. Fix the root cause. If an invariant or a rule in `AGENTS.md` seems wrong,
   say so and propose the change; do not work around it.
3. For a bug, follow `AGENTS.md` section 10: a test that fails because of the
   bug, then the fix, then the same test passing.
4. Keep contracts synchronized across `packages/db`, `packages/shared`,
   `server` and `ui` when the change touches them (`AGENTS.md` section 5).
5. Verify with `pnpm verify` (section 7). Report anything you could not run.
6. Open one pull request per issue, filling every section of
   `.github/PULL_REQUEST_TEMPLATE.md`.
7. When it is merged, set `Status: done` in the issue file and add the PR number.

Statements marked **Confirmed** were observed and, where a code location is
given, read in the code. Statements marked **Hypothesis** were not verified:
check them before building on them.

## Index

| # | Title | Area | Type | Priority |
| --- | --- | --- | --- | --- |
| [0001](0001-catalog-validation-errors-shown-as-unavailable.md) | Setup validation errors are shown as "Paperclip is temporarily unavailable" | server + ui | bug | high |
| [0002](0002-obsidian-connect-ui-papercuts.md) | Obsidian connect screen: wrong name on completion, Read only hard to find | ui | bug | low |
| [0003](0003-single-step-approval-for-destructive-tool-actions.md) | Destructive tool actions need two separate approvals; they should need one | server + ui | design | high |
| [0004](0004-validate-tool-arguments-before-requesting-approval.md) | An approval card is created for a call whose arguments do not match the tool schema | server | bug | high |
| [0005](0005-patch-note-removes-content-without-approval.md) | `patch_note` can remove content without asking | server | decision | medium |
| [0006](0006-desktop-quit-starts-a-new-instance.md) | Desktop: `--quit` can start a full new app instead of quitting | desktop | bug | medium |
| [0007](0007-desktop-attach-to-server-without-ui.md) | Desktop: attaching to a server that serves no UI shows "Cannot GET /" | desktop | bug | low |
| [0008](0008-desktop-error-page-shows-raw-ansi-codes.md) | Desktop: the server-stopped page prints raw ANSI colour codes | desktop | bug | low |
| [0009](0009-activity-hours-doc-assignments.md) | Activity hours doc says assignments wait; user assignments run | docs | docs | low |
| [0010](0010-agents-run-without-api-credential-in-local-dev.md) | Agents run without `PAPERCLIP_API_KEY` in a local dev start | server | triage | medium |
| [0011](0011-validation-backlog.md) | Validation backlog: what was not verified | all | test | medium |

## Template

```markdown
# NNNN: Title

- Status: open
- Area: ...
- Type: bug | design | decision | docs | triage | test
- Priority: high | medium | low
- Found in: develop @ 73c57431e9

## Summary
## Observed (Confirmed / Hypothesis)
## Reproduce
## Where to look
## Expected
## Acceptance criteria
## Out of scope
```
