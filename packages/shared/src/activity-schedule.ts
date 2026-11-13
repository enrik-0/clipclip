import { z } from "zod";

/**
 * A company's activity hours: the weekly windows in which Paperclip may start
 * work on its own. Outside them, work waits for the next window.
 */

/** What waits outside the windows. A run that already started always finishes its turn. */
export const ACTIVITY_OUTSIDE_HOURS_MODES = ["defer_automatic", "defer_all"] as const;
export type ActivityOutsideHoursMode = (typeof ACTIVITY_OUTSIDE_HOURS_MODES)[number];

export const ACTIVITY_SCHEDULE_MAX_WINDOWS = 14;
export const ACTIVITY_SCHEDULE_MAX_STAGGER_MINUTES = 120;
export const ACTIVITY_SCHEDULE_DEFAULT_STAGGER_MINUTES = 10;

const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 24 * 60;
const MINUTE_MS = 60_000;
/** A weekly schedule repeats within seven days; one more covers daylight-saving shifts. */
const SEARCH_HORIZON_MINUTES = 8 * MINUTES_PER_DAY;

function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export const activityWindowSchema = z.object({
  /** Weekdays on which the window starts: 0 is Sunday, 6 is Saturday. */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, { message: "Each weekday can appear once" }),
  /** Local start, HH:MM. */
  start: z.string().regex(CLOCK_PATTERN),
  /** Local end, HH:MM. An end at or before the start is on the next day; equal times cover 24 hours. */
  end: z.string().regex(CLOCK_PATTERN),
}).strict();

export const companyActivityScheduleSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().trim().min(1).refine(isValidTimeZone, { message: "Invalid timezone identifier" }),
  windows: z.array(activityWindowSchema).max(ACTIVITY_SCHEDULE_MAX_WINDOWS),
  outsideHours: z.enum(ACTIVITY_OUTSIDE_HOURS_MODES),
  /** Waiting work starts spread over this many minutes after a window opens. */
  staggerMinutes: z.number().int().min(0).max(ACTIVITY_SCHEDULE_MAX_STAGGER_MINUTES),
}).strict().superRefine((schedule, ctx) => {
  if (schedule.enabled && schedule.windows.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["windows"], message: "Add at least one window, or turn activity hours off" });
  }
});

export type ActivityWindow = z.infer<typeof activityWindowSchema>;
export type CompanyActivitySchedule = z.infer<typeof companyActivityScheduleSchema>;

/** Reads a stored schedule; anything that does not validate applies no limit. */
export function parseCompanyActivitySchedule(value: unknown): CompanyActivitySchedule | null {
  if (value === null || value === undefined) return null;
  const parsed = companyActivityScheduleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function localClock(timezone: string, at: Date): { day: number; minute: number } {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    if (formatters.size >= 32) formatters.clear();
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  let day = 0, hour = 0, minute = 0;
  for (const part of formatter.formatToParts(at)) {
    if (part.type === "weekday") day = WEEKDAYS[part.value] ?? 0;
    else if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  return { day, minute: hour * 60 + minute };
}

function clockMinutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour! * 60 + minute!;
}

function windowCovers(window: ActivityWindow, day: number, minute: number): boolean {
  const start = clockMinutes(window.start);
  const end = clockMinutes(window.end);
  if (start < end) return window.days.includes(day) && minute >= start && minute < end;
  // The window runs past midnight: its tail belongs to the day after its start.
  const previousDay = (day + 6) % 7;
  return (window.days.includes(day) && minute >= start) || (window.days.includes(previousDay) && minute < end);
}

/** True when the schedule lets work start at `at`. No schedule, or one turned off, sets no limit. */
export function isWithinActivityHours(schedule: CompanyActivitySchedule | null | undefined, at: Date): boolean {
  if (!schedule || !schedule.enabled) return true;
  const { day, minute } = localClock(schedule.timezone, at);
  return schedule.windows.some((window) => windowCovers(window, day, minute));
}

/**
 * The first instant at or after `at` when work may start: `at` itself inside a
 * window, else the next window's opening. Null when no window opens.
 */
export function nextActivityHoursStart(schedule: CompanyActivitySchedule | null | undefined, at: Date): Date | null {
  if (isWithinActivityHours(schedule, at)) return at;
  // Windows have one-minute precision. Walking UTC minutes also follows local
  // times that daylight saving skips or repeats.
  let candidate = Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let step = 0; step < SEARCH_HORIZON_MINUTES; step += 1, candidate += MINUTE_MS) {
    if (isWithinActivityHours(schedule, new Date(candidate))) return new Date(candidate);
  }
  return null;
}

/**
 * A stable share of the stagger period for one piece of waiting work, so the
 * work that waited does not all start in the same instant.
 */
export function activityHoursStaggerMs(schedule: CompanyActivitySchedule, key: string): number {
  const spreadMs = schedule.staggerMinutes * MINUTE_MS;
  if (spreadMs <= 0) return 0;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % spreadMs;
}
