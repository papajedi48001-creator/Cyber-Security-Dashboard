// All times are stored in UTC and shown in Asia/Bangkok.
const formatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatBangkok(date: Date | null | undefined): string {
  return date ? formatter.format(date) : "-";
}
