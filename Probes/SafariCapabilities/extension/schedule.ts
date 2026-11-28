/** Weekdays number Sunday as zero and belong to the day on which the window starts. */
export interface Schedule {
  readonly weekdays: readonly number[];
  readonly start: string;
  readonly end: string;
}

export const DEFAULT_SCHEDULE: Schedule = { start: "22:00", end: "07:00", weekdays: [5] };

const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidSchedule(value: unknown): value is Schedule {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Schedule>;
  return typeof s.start === "string" && clockTime.test(s.start)
    && typeof s.end === "string" && clockTime.test(s.end) && s.end !== s.start
    && Array.isArray(s.weekdays) && s.weekdays.length > 0
    && s.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6);
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function wallTime(now: Date, timeZone?: string) {
  if (timeZone === undefined) {
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return { day: now.getDay(), time: `${hh}:${mm}` };
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone,
  });
  const parts = formatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(field => field.type === type)?.value ?? "";
  return { day: weekdays.indexOf(part("weekday")), time: `${part("hour")}:${part("minute")}` };
}

/** Evaluate the current local minute on every wake, clock change, or zone change. Tests may supply an IANA zone. */
export function isScheduleActive(value: unknown, now: Date = new Date(), timeZone?: string): boolean {
  if (!isValidSchedule(value) || !Number.isFinite(now.getTime())) return false;
  const { day, time } = wallTime(now, timeZone);
  if (value.start < value.end) {
    return value.weekdays.includes(day) && time >= value.start && time < value.end;
  }
  return (time >= value.start && value.weekdays.includes(day))
    || (time < value.end && value.weekdays.includes((day + 6) % 7));
}
