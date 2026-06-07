/**
 * Lightweight cron parser for OpenCode scheduler.
 * Standard 5-field cron: minute hour day-of-month month day-of-week
 */

export interface CronParseResult {
  valid: boolean;
  errors: string[];
}

interface CronField {
  type: "minute" | "hour" | "dom" | "month" | "dow";
  min: number;
  max: number;
  values: number[];
}

const CRON_FIELDS: Array<{ type: CronField["type"]; min: number; max: number; name: string }> = [
  { type: "minute", min: 0, max: 59, name: "minute" },
  { type: "hour", min: 0, max: 23, name: "hour" },
  { type: "dom", min: 1, max: 31, name: "day of month" },
  { type: "month", min: 1, max: 12, name: "month" },
  { type: "dow", min: 0, max: 6, name: "day of week" },
];

function expandField(field: string, min: number, max: number, fieldName: string): number[] {
  const values = new Set<number>();
  const parts = field.split(",");

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    const stepMatch = trimmed.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const [, range, stepStr] = stepMatch;
      const step = parseInt(stepStr, 10);
      if (step < 1) {
        throw new Error(`Invalid step in ${fieldName}: ${stepStr}`);
      }

      let rangeStart = min;
      let rangeEnd = max;

      if (range !== "*") {
        const dashMatch = range.match(/^(\d+)-(\d+)$/);
        if (dashMatch) {
          rangeStart = parseInt(dashMatch[1], 10);
          rangeEnd = parseInt(dashMatch[2], 10);
        } else if (/^\d+$/.test(range)) {
          rangeStart = parseInt(range, 10);
          rangeEnd = max;
        } else {
          throw new Error(`Invalid range in ${fieldName}: ${range}`);
        }
      }

      if (rangeStart < min || rangeStart > max) {
        throw new Error(`${fieldName} value ${rangeStart} out of range [${min}-${max}]`);
      }
      if (rangeEnd < min || rangeEnd > max) {
        throw new Error(`${fieldName} value ${rangeEnd} out of range [${min}-${max}]`);
      }

      for (let i = rangeStart; i <= rangeEnd; i += step) {
        values.add(i);
      }
      continue;
    }

    const dashMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (dashMatch) {
      const start = parseInt(dashMatch[1], 10);
      const end = parseInt(dashMatch[2], 10);
      if (start < min || start > max) {
        throw new Error(`${fieldName} value ${start} out of range [${min}-${max}]`);
      }
      if (end < min || end > max) {
        throw new Error(`${fieldName} value ${end} out of range [${min}-${max}]`);
      }
      if (start > end) {
        throw new Error(`${fieldName} range ${start}-${end} is backwards`);
      }
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }

    if (/^\d+$/.test(trimmed)) {
      const val = parseInt(trimmed, 10);
      if (val < min || val > max) {
        throw new Error(`${fieldName} value ${val} out of range [${min}-${max}]`);
      }
      values.add(val);
      continue;
    }

    throw new Error(`Invalid ${fieldName} field: "${trimmed}"`);
  }

  return Array.from(values).sort((a, b) => a - b);
}

export function parseCron(expression: string): CronParseResult {
  const errors: string[] = [];
  const fields = expression.trim().split(/\s+/);

  if (fields.length !== 5) {
    return {
      valid: false,
      errors: [`Expected 5 fields, got ${fields.length}`],
    };
  }

  const parsedFields: CronField[] = [];

  for (let i = 0; i < 5; i++) {
    const { type, min, max, name } = CRON_FIELDS[i];
    try {
      const values = expandField(fields[i], min, max, name);
      if (values.length === 0) {
        errors.push(`${name} field produces no values`);
      }
      parsedFields.push({ type, min, max, values });
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  if (parsedFields.length === 5) {
    const minuteField = parsedFields[0];
    const hourField = parsedFields[1];
    if (minuteField && hourField) {
      const interval = calculateIntervalMinutes(minuteField.values, hourField.values);
      if (interval !== null && interval < 1) {
        errors.push("Sub-minute intervals are not allowed");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function calculateIntervalMinutes(minutes: number[], hours: number[]): number | null {
  if (minutes.length === 0 || hours.length === 0) return null;
  if (minutes.length === 1 && hours.length === 1) {
    const m = minutes[0]!;
    const h = hours[0]!;
    return h * 60 + m;
  }
  if (minutes.length === 1 && hours.length > 1) {
    return 60;
  }
  if (minutes.length > 1 && hours.length === 1) {
    const diffs: number[] = [];
    for (let i = 1; i < minutes.length; i++) {
      diffs.push(minutes[i]! - minutes[i - 1]!);
    }
    return Math.min(...diffs);
  }
  return 60;
}

export function getNextRun(
  expression: string,
  timezone: string,
  from?: Date,
): Date | null {
  const result = parseCron(expression);
  if (!result.valid) return null;

  const fields = expression.trim().split(/\s+/);
  const base = from ? new Date(from.getTime()) : new Date();
  const check = new Date(base.getTime() + 60_000);
  check.setSeconds(0, 0);

  const monthValues = expandField(fields[3]!, 1, 12, "month");
  const domValues = expandField(fields[2]!, 1, 31, "day of month");
  const dowValues = expandField(fields[4]!, 0, 6, "day of week");
  const hourValues = expandField(fields[1]!, 0, 23, "hour");
  const minuteValues = expandField(fields[0]!, 0, 59, "minute");

  const maxIterations = 366 * 24 * 60;
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const tzDate = formatInTimezone(check, timezone);
    const m = tzDate.month;
    const d = tzDate.day;
    const dow = tzDate.dow;
    const h = tzDate.hour;
    const min = tzDate.minute;

    if (!monthValues.includes(m)) {
      check.setDate(check.getDate() + 1);
      check.setHours(0, 0, 0, 0);
      continue;
    }

    if (!domValues.includes(d) && !dowValues.includes(dow)) {
      check.setDate(check.getDate() + 1);
      check.setHours(0, 0, 0, 0);
      continue;
    }

    if (!hourValues.includes(h)) {
      check.setHours(check.getHours() + 1, 0, 0, 0);
      continue;
    }

    if (!minuteValues.includes(min)) {
      check.setMinutes(check.getMinutes() + 1, 0, 0);
      continue;
    }

    return new Date(check.getTime());
  }

  return null;
}

function formatInTimezone(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dow: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10);

  const weekdayStr = get("weekday");
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = weekdayMap[weekdayStr] ?? 0;

  return { year, month, day, hour, minute, dow };
}

export function getInterval(
  expression: string,
  timezone: string,
): number | null {
  const result = parseCron(expression);
  if (!result.valid) return null;

  const fields = expression.trim().split(/\s+/);
  const minuteValues = expandField(fields[0]!, 0, 59, "minute");
  const hourValues = expandField(fields[1]!, 0, 23, "hour");
  const domValues = expandField(fields[2]!, 1, 31, "day of month");
  const monthValues = expandField(fields[3]!, 1, 12, "month");
  const dowValues = expandField(fields[4]!, 0, 6, "day of week");

  if (
    monthValues.length === 12 &&
    domValues.length === 31 &&
    dowValues.length === 7
  ) {
    if (hourValues.length === 24 && minuteValues.length === 1) {
      return 86400;
    }
    if (hourValues.length === 1 && minuteValues.length === 1) {
      return 86400;
    }
    if (hourValues.length === 24 && minuteValues.length > 1) {
      const diffs: number[] = [];
      for (let i = 1; i < minuteValues.length; i++) {
        diffs.push((minuteValues[i]! - minuteValues[i - 1]!) * 60);
      }
      if (diffs.length > 0 && diffs.every((d) => d === diffs[0])) {
        return diffs[0]!;
      }
    }
  }

  return null;
}
