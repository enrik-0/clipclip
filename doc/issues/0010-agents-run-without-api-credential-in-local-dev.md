# 0010: Agents run without `PAPERCLIP_API_KEY` in a local dev start

- Status: open
- Area: server (agent credentials), docs
- Type: triage
- Priority: medium
- Found in: develop @ 73c57431e9

## Summary

In a local trusted dev start, agent runs reached the API without a bearer token.
Their requests were authenticated as the board user, so a comment posted by an
agent was recorded as written by the user, and an agent that sent
`authorType: "agent"` was rejected. It is **not known** whether this is a bug or
a configuration mistake in how the server was started. This issue is to find out.

## Observed

**Confirmed:**

- Server start banner: `Agent JWT: missing (run npx paperclipai onboard)`.
- Server log on a run: `local agent jwt secret missing or invalid; running without
  injected PAPERCLIP_API_KEY` (from
  `server/src/services/heartbeat/runtime-execution.ts`, where the token is
  created for adapters with `supportsLocalAgentJwt`).
- The agent process environment had `PAPERCLIP_AGENT_ID`, `PAPERCLIP_AGENT_KEY_ID`,
  `PAPERCLIP_AGENT_PRIVATE_KEY` and `PAPERCLIP_AGENT_PUBLIC_KEY`, and no
  `PAPERCLIP_API_KEY`.
- Without a bearer, `POST /api/issues/:id/comments` ran as `local-board`
  (`authorType: "user"`). With `authorType: "agent"` in the body the answer was
  422 `Comment authorType must match authenticated actor`.
- The agent sent `X-Paperclip-Run-Id` with a `PATCH /api/issues/:id`; that
  updated the issue and posted the comment as the user.

**Hypothesis, not verified:** the server was launched from PowerShell with
`PAPERCLIP_AGENT_JWT_SECRET` set in the same script. The warning says the secret
was missing or invalid, so the variable may not have reached the server process
(the exact cause was not traced). The earlier belief that this was a product bug
was based on checking the wrong log file.

## Reproduce

1. Follow `doc/DEVELOPING.md` to start a dev instance with the documented
   environment, once with and once without `PAPERCLIP_AGENT_JWT_SECRET`.
2. Assign a task to a `claude_local` agent and read the run's environment and the
   server log.

## Where to look

- `server/src/agent-auth-jwt.ts` (`jwtConfig`, `createLocalAgentJwt`).
- `server/src/services/heartbeat/runtime-execution.ts` (the warning, around the
  `createLocalAgentJwt` call).
- `server/src/startup-banner.ts` and `cli/src/checks/agent-jwt-secret-check.ts`.
- `scripts/` and `doc/DEVELOPING.md`: what a new contributor is told to set.

## Expected

One of:

- With the documented start, agents get a working credential, and the result of
  step 2 above is a bearer token. Close this issue with the evidence.
- The documented start leaves the secret unset. Then either generate and persist a
  local secret automatically in local trusted mode, or make the banner and
  `DEVELOPING.md` say clearly what to set, and fail loudly instead of running
  agents with a different identity.

## Acceptance criteria

- A short written finding in this file: root cause, with the steps that show it.
- If a change is needed: a test, and the docs updated.

## Out of scope

Authentication outside local trusted mode.
