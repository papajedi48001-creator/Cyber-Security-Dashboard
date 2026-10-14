import { describe, expect, it } from "vitest";
import { acknowledgeDue, DEFAULT_CALENDAR, slaState, type WorkingCalendar } from "./sla";

// Times are UTC; Asia/Bangkok is UTC+7. 2026-10-14 is a Wednesday.
const bkk = (local: string) => new Date(`${local}+07:00`);

describe("acknowledgeDue", () => {
  it("gives P1 15 minutes and P2 1 hour around the clock", () => {
    const sunday3am = bkk("2026-10-18T03:00:00");
    expect(acknowledgeDue("P1", sunday3am)).toEqual(bkk("2026-10-18T03:15:00"));
    expect(acknowledgeDue("P2", sunday3am)).toEqual(bkk("2026-10-18T04:00:00"));
  });

  it("gives P3 four working hours", () => {
    expect(acknowledgeDue("P3", bkk("2026-10-14T09:00:00"))).toEqual(bkk("2026-10-14T13:00:00"));
    // 15:30 Wed: 1h left today, 3h from 08:30 Thu
    expect(acknowledgeDue("P3", bkk("2026-10-14T15:30:00"))).toEqual(bkk("2026-10-15T11:30:00"));
    // Friday evening rolls to Monday
    expect(acknowledgeDue("P3", bkk("2026-10-16T20:00:00"))).toEqual(bkk("2026-10-19T12:30:00"));
  });

  it("gives P4 until the end of the next working day", () => {
    expect(acknowledgeDue("P4", bkk("2026-10-14T10:00:00"))).toEqual(bkk("2026-10-15T16:30:00"));
    expect(acknowledgeDue("P4", bkk("2026-10-16T10:00:00"))).toEqual(bkk("2026-10-19T16:30:00"));
  });

  it("skips configured public holidays", () => {
    const calendar: WorkingCalendar = { ...DEFAULT_CALENDAR, holidays: ["2026-10-15"] };
    expect(acknowledgeDue("P4", bkk("2026-10-14T10:00:00"), calendar)).toEqual(bkk("2026-10-16T16:30:00"));
    expect(acknowledgeDue("P3", bkk("2026-10-14T15:30:00"), calendar)).toEqual(bkk("2026-10-16T11:30:00"));
  });
});

describe("slaState", () => {
  const due = bkk("2026-10-14T10:00:00");
  it("reports met, breached, due soon or pending", () => {
    expect(slaState({ acknowledgeDue: due, acknowledgedAt: bkk("2026-10-14T09:59:00") }, bkk("2026-10-14T11:00:00"))).toBe("met");
    expect(slaState({ acknowledgeDue: due, acknowledgedAt: bkk("2026-10-14T10:01:00") }, bkk("2026-10-14T11:00:00"))).toBe("breached");
    expect(slaState({ acknowledgeDue: due, acknowledgedAt: null }, bkk("2026-10-14T10:05:00"))).toBe("breached");
    expect(slaState({ acknowledgeDue: due, acknowledgedAt: null }, bkk("2026-10-14T09:55:00"))).toBe("due_soon");
    expect(slaState({ acknowledgeDue: due, acknowledgedAt: null }, bkk("2026-10-14T08:00:00"))).toBe("pending");
  });
});
