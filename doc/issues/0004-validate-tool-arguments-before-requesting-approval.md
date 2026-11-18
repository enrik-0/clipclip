# 0004: An approval card is created for a call whose arguments do not match the tool schema

- Status: open
- Area: server (`tool-gateway`)
- Type: bug
- Priority: high
- Found in: develop @ 73c57431e9

## Summary

An agent called Obsidian `move_file` with `{"from": …, "to": …}`. The tool's
schema is `oldPath`, `newPath`, `confirmOldPath`, `confirmNewPath`. The gateway
accepted the call, created an approval card, and a human approved it. On
execution the MCP server received no paths and failed. The human spent an
approval on an action that could never succeed.

## Observed

**Confirmed.** Gateway log for the same task, two attempts:

```
move-file {"from":"esquema-backup.png","to":"Procedimientos/Operaciones/esquema-backup.png"}
move-file {"oldPath":"esquema-backup.png","newPath":"Procedimientos/Operaciones/esquema-backup.png","confirmOldPath":"esquema-backup.png","confirmNewPath":"Procedimientos/Operaciones/esquema-backup.png"}
```

- The first call created an action request; its stored arguments were
  `{"from": …, "to": …}`. After "Approve & run" the card showed:
  `Execution failed: { "success": false, "oldPath": "", "newPath": "", "message": "Source path is a directory: . move_file currently supports files only." }`.
- The agent noticed ("the tool received empty paths because of my parameter
  error"), called again with the right names, and a second card was needed.
- The tool schema is in `server/src/services/obsidian-vault-tools.generated.ts`
  (`move_file`).
- The model that made the mistake was Claude Haiku. A direct call to the MCP
  server with the right arguments works (the note moved to its trash).

## Reproduce

Call the gateway `tools/call` for `…:move-file` with arguments that do not match
the input schema, on a connection where `move_file` is "Ask first".

## Where to look

- `server/src/services/tool-gateway.ts`, the path that creates the action
  request and throws `approval_required` (around lines 2525-2600), and where the
  arguments are hashed and stored.
- The tool's `inputSchema` is available from the catalog entry.

## Expected

Before creating an action request (and before asking a human), validate the
arguments against the tool's `inputSchema`. If they do not match, return a tool
error to the agent that names the missing or unknown properties. No card, no
approval.

## Acceptance criteria

- A server test: a call with unknown or missing required properties returns an
  error to the agent and creates no action request.
- A server test: a valid call still creates the request and the card.
- Decide and document what happens for tools whose catalog has no input schema.
- The validation error text lists the expected property names.

## Out of scope

Argument coercion. Validate; do not guess.
