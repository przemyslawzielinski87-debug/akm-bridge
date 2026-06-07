import type { Notification, NotificationSeverity, NotificationType } from "./notification-types.ts";
import { sanitizeBody } from "./notification-redactor.ts";

export interface DigestSection {
  title: string;
  summary: string;
  items: Array<{ id: string; title: string; safeSummary: string; createdAt: string; severity: NotificationSeverity }>;
}

export interface Digest {
  period: "daily" | "weekly";
  generatedAt: string;
  overallSeverity: NotificationSeverity;
  sections: DigestSection[];
  total: number;
  rawCounts: Record<string, number>;
}

export function buildDigest(
  notifications: Notification[],
  period: "daily" | "weekly",
  generatedAt: string = new Date().toISOString(),
): Digest {
  const inWindow = notifications.filter((n) => n.createdAt);
  const grouped: Record<string, Notification[]> = {};
  for (const n of inWindow) {
    const k = n.type;
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(n);
  }

  const sectionDefs: Array<{ key: string; title: string; filter: (t: NotificationType) => boolean }> = [
    { key: "tasks", title: "Task activity", filter: (t) => t.startsWith("task_") },
    { key: "approvals", title: "Approvals", filter: (t) => t.startsWith("approval_") },
    { key: "schedules", title: "Scheduler", filter: (t) => t.startsWith("schedule_") },
    { key: "recovery", title: "Recovery", filter: (t) => t.startsWith("recovery_") },
    { key: "updates", title: "Updates", filter: (t) => t.startsWith("update_") },
    { key: "dr", title: "Disaster recovery", filter: (t) => t.startsWith("dr_") },
  ];

  const sections: DigestSection[] = [];
  const rawCounts: Record<string, number> = {};
  for (const def of sectionDefs) {
    const items = inWindow
      .filter((n) => def.filter(n.type))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((n) => ({
        id: n.id,
        title: sanitizeBody(n.title, 200),
        safeSummary: sanitizeBody(n.safeSummary, 500),
        createdAt: n.createdAt,
        severity: n.severity,
      }));
    rawCounts[def.key] = inWindow.filter((n) => def.filter(n.type)).length;
    if (items.length > 0) {
      sections.push({
        title: def.title,
        summary: `${items.length} ${def.title.toLowerCase()} event(s)`,
        items,
      });
    }
  }

  const critical = inWindow.some((n) => n.severity === "critical");
  const warning = inWindow.some((n) => n.severity === "warning");
  const overallSeverity: NotificationSeverity = critical ? "critical" : warning ? "warning" : "info";

  return {
    period,
    generatedAt,
    overallSeverity,
    sections,
    total: inWindow.length,
    rawCounts,
  };
}

export function renderDigestText(digest: Digest): string {
  const lines: string[] = [];
  lines.push(`OpenCode ${digest.period} report`);
  lines.push(`Generated: ${digest.generatedAt}`);
  lines.push(`Overall severity: ${digest.overallSeverity.toUpperCase()}`);
  lines.push(`Total events: ${digest.total}`);
  lines.push("");
  for (const s of digest.sections) {
    lines.push(`## ${s.title} (${s.items.length})`);
    for (const item of s.items) {
      lines.push(`- [${item.severity}] ${item.title} @ ${item.createdAt}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
