import type { NotificationSeverity } from "./notification-types.ts";

export interface QuietHoursCheck {
  in_quiet_hours: boolean;
  reason: string;
}

export function checkQuietHours(
  start: string,
  end: string,
  timezone: string,
  now: Date = new Date(),
): QuietHoursCheck {
  if (!start || !end || !timezone) {
    return { in_quiet_hours: false, reason: "no_quiet_hours_configured" };
  }
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const currentMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);
    const [sH, sM] = start.split(":").map((v) => parseInt(v, 10));
    const [eH, eM] = end.split(":").map((v) => parseInt(v, 10));
    const startMin = sH * 60 + sM;
    const endMin = eH * 60 + eM;
    let inQuiet: boolean;
    if (startMin <= endMin) {
      inQuiet = currentMinutes >= startMin && currentMinutes < endMin;
    } else {
      inQuiet = currentMinutes >= startMin || currentMinutes < endMin;
    }
    return {
      in_quiet_hours: inQuiet,
      reason: inQuiet ? "within_quiet_hours" : "outside_quiet_hours",
    };
  } catch {
    return { in_quiet_hours: false, reason: "timezone_lookup_failed" };
  }
}

export function shouldSuppress(
  severity: NotificationSeverity,
  quietHours: QuietHoursCheck,
): { suppress: boolean; reason: string } {
  if (!quietHours.in_quiet_hours) {
    return { suppress: false, reason: "outside_quiet_hours" };
  }
  if (severity === "critical") {
    return { suppress: false, reason: "critical_severity_bypasses_quiet_hours" };
  }
  if (severity === "warning") {
    return { suppress: true, reason: "warning_suppressed_during_quiet_hours" };
  }
  return { suppress: true, reason: "info_suppressed_during_quiet_hours" };
}

export function buildDeduplicationKey(parts: {
  type: string;
  id?: string;
  sequence?: number;
}): string {
  const p = [parts.type];
  if (parts.id) p.push(parts.id);
  if (parts.sequence !== undefined) p.push(String(parts.sequence));
  return p.join(":");
}
