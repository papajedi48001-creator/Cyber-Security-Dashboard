// SLA targets from the design spec. P1/P2 run 24x7; P3/P4 follow working hours.
// Working hours are a placeholder (Mon-Fri 08:30-16:30 Asia/Bangkok, no holidays)
// until the hospital confirms its calendar.

import type { Severity } from "../wazuh/normalize-alert";

export interface WorkingCalendar {
  /** Offset of the hospital timezone from UTC in minutes (Asia/Bangkok = +420, no DST). */
  utcOffsetMinutes: number;
  /** ISO weekday numbers, 1 = Monday ... 7 = Sunday. */
  workingDays: number[];
  startMinute: number;
  endMinute: number;
  /** Local dates (YYYY-MM-DD) that are not working days. */
  holidays: string[];
}

export const DEFAULT_CALENDAR: WorkingCalendar = {
  utcOffsetMinutes: 7 * 60,
  workingDays: [1, 2, 3, 4, 5],
  startMinute: 8 * 60 + 30,
  endMinute: 16 * 60 + 30,
  holidays: [],
};

const MINUTE = 60_000;
const DUE_SOON_MS = 10 * MINUTE;

// Work in "local" time by shifting into a UTC-based Date, then shift back.
const toLocal = (d: Date, cal: WorkingCalendar) => new Date(d.getTime() + cal.utcOffsetMinutes * MINUTE);
const fromLocal = (d: Date, cal: WorkingCalendar) => new Date(d.getTime() - cal.utcOffsetMinutes * MINUTE);
const minuteOfDay = (local: Date) => local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;
const startOfDay = (local: Date) => new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
const isoWeekday = (local: Date) => ((local.getUTCDay() + 6) % 7) + 1;

function isWorkingDay(local: Date, cal: WorkingCalendar): boolean {
  return cal.workingDays.includes(isoWeekday(local)) && !cal.holidays.includes(local.toISOString().slice(0, 10));
}

function nextWorkingDayStart(local: Date, cal: WorkingCalendar): Date {
  let day = new Date(startOfDay(local).getTime() + 24 * 60 * MINUTE);
  for (let i = 0; i < 366 && !isWorkingDay(day, cal); i++) day = new Date(day.getTime() + 24 * 60 * MINUTE);
  return new Date(day.getTime() + cal.startMinute * MINUTE);
}

export function addWorkingMinutes(start: Date, minutes: number, cal: WorkingCalendar = DEFAULT_CALENDAR): Date {
  let local = toLocal(start, cal);
  let remaining = minutes;
  for (let guard = 0; guard < 1000; guard++) {
    const minute = minuteOfDay(local);
    if (!isWorkingDay(local, cal) || minute >= cal.endMinute) {
      local = nextWorkingDayStart(local, cal);
      continue;
    }
    if (minute < cal.startMinute) local = new Date(startOfDay(local).getTime() + cal.startMinute * MINUTE);
    const available = cal.endMinute - minuteOfDay(local);
    if (remaining <= available) return fromLocal(new Date(local.getTime() + remaining * MINUTE), cal);
    remaining -= available;
    local = nextWorkingDayStart(local, cal);
  }
  throw new Error("working calendar has no working time");
}

export function acknowledgeDue(severity: Severity, detectedAt: Date, cal: WorkingCalendar = DEFAULT_CALENDAR): Date {
  switch (severity) {
    case "P1":
      return new Date(detectedAt.getTime() + 15 * MINUTE);
    case "P2":
      return new Date(detectedAt.getTime() + 60 * MINUTE);
    case "P3":
      return addWorkingMinutes(detectedAt, 4 * 60, cal);
    case "P4": {
      const next = nextWorkingDayStart(toLocal(detectedAt, cal), cal);
      return fromLocal(new Date(startOfDay(next).getTime() + cal.endMinute * MINUTE), cal);
    }
  }
}

export type SlaState = "met" | "breached" | "due_soon" | "pending";

export function slaState(incident: { acknowledgeDue: Date; acknowledgedAt: Date | null }, now: Date): SlaState {
  if (incident.acknowledgedAt) return incident.acknowledgedAt <= incident.acknowledgeDue ? "met" : "breached";
  if (now > incident.acknowledgeDue) return "breached";
  return incident.acknowledgeDue.getTime() - now.getTime() <= DUE_SOON_MS ? "due_soon" : "pending";
}

export const NOTIFY_ANY_TIME: ReadonlySet<Severity> = new Set(["P1", "P2"]);

/** P1/P2 notify immediately; P3/P4 wait for the next working time. */
export function notificationTime(severity: Severity, at: Date, cal: WorkingCalendar = DEFAULT_CALENDAR): Date {
  return NOTIFY_ANY_TIME.has(severity) ? at : addWorkingMinutes(at, 0, cal);
}
