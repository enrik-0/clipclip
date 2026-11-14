# Activity hours

A company can limit when Paperclip starts work on its own. The board sets weekly
windows in **Company settings → Activity hours**. Outside the windows, work waits
for the next window.

## Settings

The schedule is the `activitySchedule` field of a company
(`PATCH /api/companies/:companyId`, board only). `null` or `enabled: false` sets
no limit.

| Field | Meaning |
| --- | --- |
| `enabled` | Turns the limit on. |
| `timezone` | IANA time zone. The windows follow its clock, including daylight saving. |
| `windows` | Up to 14 windows. Each has `days` (0 is Sunday, 6 is Saturday), `start` and `end` (`HH:MM`). |
| `outsideHours` | `defer_automatic` or `defer_all`. See below. |
| `staggerMinutes` | 0 to 120. Waiting work starts spread over this period after a window opens. |

A window belongs to the day on which it starts. An end at or before the start is
on the next day: Monday `18:00`–`04:00` ends on Tuesday at 04:00. Equal start and
end cover 24 hours.

## What waits

| Work | `defer_automatic` | `defer_all` |
| --- | --- | --- |
| Monitors, scheduled retries, routines, assignments and recovery wakes | Waits | Waits |
| A wake a person asked for, such as a board comment | Starts | Waits |
| A manual run (**Run now**) by a board user | Starts | Starts |
| A conversation turn | Starts | Starts |
| A run that already started | Finishes its turn | Finishes its turn |
| A periodic timer check | Skipped | Skipped |

A waiting run is cancelled before any workspace or provider work with the code
`activity_hours_wait`. Its retry is scheduled for the window opening plus a
stable share of the stagger period. The retry does not spend the failure retry
budget. The task keeps its status and shows "Waiting for activity hours".

A periodic timer check only looks for work, so a skipped check has no retry. The
next check inside a window does the same job.

## Interaction with provider limits

The activity hours are checked before the provider usage limit. A provider limit
that resets outside the windows waits for the next window.

## Code

- `packages/shared/src/activity-schedule.ts`: schema, window logic and stagger.
- `server/src/services/heartbeat/activity-hours-wait.ts`: the pre-dispatch wait.
- `ui/src/components/ActivityHoursSettings.tsx`: the settings section.

## Known limits

- The host cannot sleep while a run waits for a window. The retry scheduler
  treats a cancelled source run as unsettled, as it does for a provider limit wait.
- The wait reuses the `ai_connection_pool_wait` retry lane. The task monitor
  banner and the run retry badge read only the retry reason, so they show the
  "Pool exhausted" wording for this wait. The execution status shows the correct
  "Waiting for activity hours".
- A deferred run is not re-evaluated when the schedule changes. It starts at the
  time recorded when it was deferred. Start a manual run to continue sooner.
