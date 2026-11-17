import { describe, expect, it } from "vitest";
import {
  activityHoursStaggerMs,
  companyActivityScheduleSchema,
  isWithinActivityHours,
  nextActivityHoursStart,
  parseCompanyActivitySchedule,
  type CompanyActivitySchedule,
} from "./activity-schedule.js";

/** Weeknights 18:00–04:00 and the whole weekend, in Madrid. */
const schedule: CompanyActivitySchedule = {
  enabled: true,
  timezone: "Europe/Madrid",
  windows: [
    { days: [1, 2, 3, 4, 5], start: "18:00", end: "04:00" },
    { days: [0, 6], start: "00:00", end: "00:00" },
  ],
  outsideHours: "defer_automatic",
  staggerMinutes: 10,
};

// November 2026 in Madrid is UTC+1. The 13th is a Friday.
const madrid = (day: number, clock: string) => new Date(`2026-11-${String(day).padStart(2, "0")}T${clock}:00+01:00`);

describe("isWithinActivityHours", () => {
  it("sets no limit without a schedule or with one turned off", () => {
    expect(isWithinActivityHours(null, madrid(13, "10:00"))).toBe(true);
    expect(isWithinActivityHours({ ...schedule, enabled: false }, madrid(13, "10:00"))).toBe(true);
  });

  it("follows a window across midnight", () => {
    expect(isWithinActivityHours(schedule, madrid(12, "17:59"))).toBe(false);
    expect(isWithinActivityHours(schedule, madrid(12, "18:00"))).toBe(true);
    expect(isWithinActivityHours(schedule, madrid(13, "03:59"))).toBe(true);
    expect(isWithinActivityHours(schedule, madrid(13, "04:00"))).toBe(false);
    expect(isWithinActivityHours(schedule, madrid(13, "10:00"))).toBe(false);
  });

  it("gives the hours after midnight to the day the window started", () => {
    // Monday 02:00 follows Sunday, which has the all-day window and not a night one.
    const nightsOnly: CompanyActivitySchedule = { ...schedule, windows: [{ days: [1], start: "18:00", end: "04:00" }] };
    expect(isWithinActivityHours(nightsOnly, madrid(16, "02:00"))).toBe(false);
    expect(isWithinActivityHours(nightsOnly, madrid(17, "02:00"))).toBe(true);
  });

  it("reads equal start and end as a full day", () => {
    expect(isWithinActivityHours(schedule, madrid(14, "00:00"))).toBe(true);
    expect(isWithinActivityHours(schedule, madrid(14, "12:00"))).toBe(true);
    expect(isWithinActivityHours(schedule, madrid(15, "23:59"))).toBe(true);
  });
});

describe("nextActivityHoursStart", () => {
  it("returns the same instant inside a window", () => {
    const at = madrid(12, "20:00");
    expect(nextActivityHoursStart(schedule, at)).toBe(at);
  });

  it("returns the next opening outside a window", () => {
    expect(nextActivityHoursStart(schedule, madrid(13, "10:00"))?.toISOString()).toBe(madrid(13, "18:00").toISOString());
    expect(nextActivityHoursStart(schedule, madrid(13, "04:00"))?.toISOString()).toBe(madrid(13, "18:00").toISOString());
  });

  it("finds an opening several days away", () => {
    const mondayOnly: CompanyActivitySchedule = { ...schedule, windows: [{ days: [1], start: "09:00", end: "10:00" }] };
    expect(nextActivityHoursStart(mondayOnly, madrid(10, "10:00"))?.toISOString()).toBe(madrid(16, "09:00").toISOString());
  });

  it("follows the local clock through a daylight-saving change", () => {
    // Madrid leaves summer time on 2026-10-25; 18:00 local moves from 16:00Z to 17:00Z.
    expect(nextActivityHoursStart(schedule, new Date("2026-10-23T10:00:00Z"))?.toISOString()).toBe("2026-10-23T16:00:00.000Z");
    expect(nextActivityHoursStart(schedule, new Date("2026-10-26T10:00:00Z"))?.toISOString()).toBe("2026-10-26T17:00:00.000Z");
  });

  it("returns null when no window opens", () => {
    expect(nextActivityHoursStart({ ...schedule, windows: [] }, madrid(13, "10:00"))).toBeNull();
  });
});

describe("activityHoursStaggerMs", () => {
  it("spreads work inside the stagger period and is stable per key", () => {
    const offsets = ["run-a", "run-b", "run-c", "run-d"].map((key) => activityHoursStaggerMs(schedule, key));
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(10 * 60_000);
    }
    expect(new Set(offsets).size).toBeGreaterThan(1);
    expect(activityHoursStaggerMs(schedule, "run-a")).toBe(offsets[0]);
    expect(activityHoursStaggerMs({ ...schedule, staggerMinutes: 0 }, "run-a")).toBe(0);
  });
});

describe("companyActivityScheduleSchema", () => {
  it("accepts a valid schedule and rejects a bad one", () => {
    expect(companyActivityScheduleSchema.safeParse(schedule).success).toBe(true);
    expect(companyActivityScheduleSchema.safeParse({ ...schedule, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(companyActivityScheduleSchema.safeParse({ ...schedule, windows: [] }).success).toBe(false);
    expect(companyActivityScheduleSchema.safeParse({ ...schedule, windows: [{ days: [1, 1], start: "18:00", end: "04:00" }] }).success).toBe(false);
    expect(companyActivityScheduleSchema.safeParse({ ...schedule, windows: [{ days: [1], start: "25:00", end: "04:00" }] }).success).toBe(false);
    expect(companyActivityScheduleSchema.safeParse({ ...schedule, enabled: false, windows: [] }).success).toBe(true);
  });

  it("applies no limit when a stored value does not validate", () => {
    expect(parseCompanyActivitySchedule({ enabled: true })).toBeNull();
    expect(parseCompanyActivitySchedule(null)).toBeNull();
    expect(parseCompanyActivitySchedule(schedule)).toEqual(schedule);
  });
});
