import { useEffect, useMemo, useState } from "react";
import {
  ACTIVITY_SCHEDULE_DEFAULT_STAGGER_MINUTES,
  ACTIVITY_SCHEDULE_MAX_STAGGER_MINUTES,
  ACTIVITY_SCHEDULE_MAX_WINDOWS,
  companyActivityScheduleSchema,
  isWithinActivityHours,
  nextActivityHoursStart,
  type ActivityOutsideHoursMode,
  type ActivityWindow,
  type CompanyActivitySchedule,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, ToggleField } from "./agent-config-primitives";

/** Monday first, as the week is read; the value is the JavaScript weekday. */
const WEEKDAYS: Array<{ value: number; short: string; label: string }> = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
];

const OUTSIDE_HOURS_OPTIONS: Array<{ value: ActivityOutsideHoursMode; label: string }> = [
  { value: "defer_automatic", label: "Automatic work waits. Work a person starts runs." },
  { value: "defer_all", label: "All work waits. Only a manual run starts." },
];

const FIELD_CLASS = "w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none";

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function supportedTimeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function defaultActivitySchedule(): CompanyActivitySchedule {
  return {
    enabled: true,
    timezone: browserTimeZone(),
    windows: [{ days: [1, 2, 3, 4, 5], start: "18:00", end: "04:00" }],
    outsideHours: "defer_automatic",
    staggerMinutes: ACTIVITY_SCHEDULE_DEFAULT_STAGGER_MINUTES,
  };
}

function describeNow(schedule: CompanyActivitySchedule, now: Date): string {
  if (!schedule.enabled) return "Agents can work at any time.";
  if (isWithinActivityHours(schedule, now)) return "Agents can work now.";
  const opensAt = nextActivityHoursStart(schedule, now);
  if (!opensAt) return "No window opens. Agents start work only when a person runs it.";
  const formatted = new Intl.DateTimeFormat(undefined, {
    weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: schedule.timezone, timeZoneName: "short",
  }).format(opensAt);
  return `Agents are waiting. The next window opens ${formatted}.`;
}

export function ActivityHoursSettings({
  schedule,
  onSave,
  isPending,
  errorMessage,
}: {
  schedule: CompanyActivitySchedule | null;
  onSave: (next: CompanyActivitySchedule) => void;
  isPending: boolean;
  errorMessage: string | null;
}) {
  const [draft, setDraft] = useState<CompanyActivitySchedule>(() => schedule ?? { ...defaultActivitySchedule(), enabled: false });
  const timeZones = useMemo(supportedTimeZones, []);

  useEffect(() => {
    setDraft(schedule ?? { ...defaultActivitySchedule(), enabled: false });
  }, [schedule]);

  const saved = schedule ?? { ...defaultActivitySchedule(), enabled: false };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const validation = companyActivityScheduleSchema.safeParse(draft);
  const validationMessage = validation.success ? null : validation.error.issues[0]?.message ?? "Check the activity hours.";

  const setWindow = (index: number, patch: Partial<ActivityWindow>) =>
    setDraft({ ...draft, windows: draft.windows.map((window, at) => (at === index ? { ...window, ...patch } : window)) });
  const toggleDay = (index: number, day: number) => {
    const days = draft.windows[index]!.days;
    setWindow(index, { days: days.includes(day) ? days.filter((value) => value !== day) : [...days, day] });
  };

  return (
    <div className="max-w-2xl space-y-4" data-testid="company-settings-activity-hours">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Activity hours
      </div>
      <div className="space-y-3">
        <ToggleField
          label="Limit when agents work"
          hint="Outside these hours, work waits for the next window. A run that already started finishes its turn."
          checked={draft.enabled}
          onChange={(enabled) => setDraft({
            ...draft,
            enabled,
            windows: enabled && draft.windows.length === 0 ? defaultActivitySchedule().windows : draft.windows,
          })}
          toggleTestId="company-settings-activity-hours-toggle"
        />

        {draft.enabled && (
          <>
            <Field label="Time zone" hint="The windows follow this time zone's clock, including daylight saving.">
              <input
                className={FIELD_CLASS}
                type="text"
                list="activity-hours-time-zones"
                value={draft.timezone}
                aria-label="Activity hours time zone"
                onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
              />
              <datalist id="activity-hours-time-zones">
                {timeZones.map((zone) => <option key={zone} value={zone} />)}
              </datalist>
            </Field>

            <Field
              label="Windows"
              hint="An end time at or before the start runs into the next day. Equal times cover the whole day."
            >
              <div className="space-y-2">
                {draft.windows.map((window, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2" data-testid="activity-hours-window">
                    <div className="flex flex-wrap gap-1" role="group" aria-label={`Window ${index + 1} days`}>
                      {WEEKDAYS.map((day) => (
                        <Button
                          key={day.value}
                          type="button"
                          size="sm"
                          variant={window.days.includes(day.value) ? "default" : "outline"}
                          aria-pressed={window.days.includes(day.value)}
                          aria-label={day.label}
                          onClick={() => toggleDay(index, day.value)}
                        >
                          {day.short}
                        </Button>
                      ))}
                    </div>
                    <Input
                      type="time"
                      value={window.start}
                      onChange={(event) => setWindow(index, { start: event.target.value })}
                      className="h-8 w-32"
                      aria-label={`Window ${index + 1} start`}
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      type="time"
                      value={window.end}
                      onChange={(event) => setWindow(index, { end: event.target.value })}
                      className="h-8 w-32"
                      aria-label={`Window ${index + 1} end`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft({ ...draft, windows: draft.windows.filter((_, at) => at !== index) })}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={draft.windows.length >= ACTIVITY_SCHEDULE_MAX_WINDOWS}
                  onClick={() => setDraft({ ...draft, windows: [...draft.windows, { days: [0, 6], start: "00:00", end: "00:00" }] })}
                >
                  Add window
                </Button>
              </div>
            </Field>

            <Field label="Outside the windows" hint="A manual run is the Run now action on an agent or a task.">
              <select
                className={FIELD_CLASS}
                value={draft.outsideHours}
                aria-label="Outside the windows"
                onChange={(event) => setDraft({ ...draft, outsideHours: event.target.value as ActivityOutsideHoursMode })}
              >
                {OUTSIDE_HOURS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>

            <Field
              label="Spread waiting work (minutes)"
              hint="When a window opens, the work that waited starts spread over this many minutes instead of all at once."
            >
              <Input
                type="number"
                min={0}
                max={ACTIVITY_SCHEDULE_MAX_STAGGER_MINUTES}
                step={1}
                value={draft.staggerMinutes}
                className="h-8 w-32"
                aria-label="Spread waiting work (minutes)"
                onChange={(event) => setDraft({ ...draft, staggerMinutes: Math.trunc(Number(event.target.value) || 0) })}
              />
            </Field>
          </>
        )}

        <p className="text-xs text-muted-foreground" data-testid="activity-hours-status">
          {validation.success ? describeNow(validation.data, new Date()) : validationMessage}
        </p>
      </div>

      {(dirty || errorMessage) && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => validation.success && onSave(validation.data)} disabled={isPending || !dirty || !validation.success}>
            {isPending ? "Saving..." : "Save activity hours"}
          </Button>
          {errorMessage && <span className="text-xs text-destructive">{errorMessage}</span>}
        </div>
      )}
    </div>
  );
}
