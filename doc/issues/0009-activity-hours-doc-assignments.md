# 0009: Activity hours doc says assignments wait; user assignments run

- Status: open
- Area: docs (`doc/ACTIVITY-HOURS.md`), possibly server tests
- Type: docs
- Priority: low
- Found in: develop @ 73c57431e9

## Summary

`doc/ACTIVITY-HOURS.md`, "What waits", lists "assignments" among the work that
waits in both modes. In `defer_automatic`, an assignment made by a board user
starts immediately. The UI option text is accurate ("Automatic work waits. Work a
person starts runs."); the doc table is not.

## Observed

**Confirmed.**

- Schedule: Wednesday 09:00-10:00 only, `defer_automatic`. On a Tuesday afternoon a
  board user created a task assigned to an agent through the API. The run
  started at once (`invocationSource: assignment`, wake `issue_assigned`). No
  `activity_hours_wait` was recorded.
- Same schedule with `defer_all`: the same kind of assignment was cancelled with
  `activity_hours_wait`, and a retry was scheduled for the window opening plus the
  stagger.
- Code: `server/src/services/heartbeat/activity-hours-wait.ts`, function
  `startedByPerson`: a wake whose `requestedByActorType` is `user` is exempt in
  `defer_automatic`; in `defer_all` only a wake with `manualUserWake` is exempt.

**Not verified:** what an assignment made by an *agent* does in `defer_automatic`.
The code suggests it waits.

## Expected

The doc table says who made the request: assignments made by a person run in
`defer_automatic`, assignments made by an agent or by a routine wait. Add a test
that pins both cases.

## Acceptance criteria

- `doc/ACTIVITY-HOURS.md` table corrected, with the actor distinction.
- A server test for the assignment case by a user and by an agent, in both modes
  (see `server/src/__tests__/heartbeat-activity-hours-wait.test.ts`).

## Out of scope

Changing the behavior.
