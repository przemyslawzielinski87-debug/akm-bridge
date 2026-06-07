import type { FormattedNotification } from "./notification-adapter.ts";
import type { Notification, NotificationChannel, NotificationType } from "./notification-types.ts";
import { redactSecrets, sanitizeBody, sanitizeSubject } from "./notification-redactor.ts";

const TYPE_TITLES: Record<NotificationType, string> = {
  approval_required: "Approval required",
  approval_reminder: "Approval reminder",
  task_completed: "Task completed",
  task_failed: "Task failed",
  task_blocked: "Task blocked",
  task_timed_out: "Task timed out",
  task_cancelled: "Task cancelled",
  task_budget_exceeded: "Task budget exceeded",
  schedule_run_failed: "Scheduled run failed",
  schedule_auto_paused: "Schedule auto-paused",
  schedule_budget_exceeded: "Schedule budget exceeded",
  recovery_escalation: "Recovery escalation",
  recovery_degraded: "Service degraded",
  update_available: "Update available",
  update_high_risk: "High-risk update available",
  update_promotion_required: "Update promotion approval required",
  update_rollback_executed: "Update rolled back",
  dr_validation_failed: "DR validation failed",
  dr_clean_drill_overdue: "Clean-server drill overdue",
  daily_report: "Daily report",
  weekly_report: "Weekly report",
  test: "Test notification",
};

export function formatNotification(notification: Notification, dashboardBaseUrl?: string): FormattedNotification {
  const subject = sanitizeSubject(TYPE_TITLES[notification.type] || notification.type);
  const safeSummary = sanitizeBody(notification.safeSummary, 2000);
  const deepLink = notification.deepLink || (dashboardBaseUrl ? buildSafeDeepLink(dashboardBaseUrl, notification) : null);

  let body = "";
  body += `${subject}\n`;
  body += `Severity: ${notification.severity.toUpperCase()}\n`;
  body += `Time: ${notification.createdAt}\n`;
  if (notification.taskId) body += `Task: ${sanitizeBody(notification.taskId, 64)}\n`;
  if (notification.approvalId) body += `Approval: ${sanitizeBody(notification.approvalId, 64)}\n`;
  if (notification.scheduleId) body += `Schedule: ${sanitizeBody(notification.scheduleId, 64)}\n`;
  body += `\n`;
  body += `${safeSummary}\n`;
  if (notification.expiresAt) body += `\nExpires: ${notification.expiresAt}\n`;
  if (deepLink) body += `\nOpen in dashboard: ${deepLink}\n`;

  const body_html = buildHtml(subject, notification, deepLink);

  return {
    subject,
    body_text: body,
    body_html,
    metadata: {
      type: notification.type,
      severity: notification.severity,
      taskId: notification.taskId || "",
      approvalId: notification.approvalId || "",
      scheduleId: notification.scheduleId || "",
    },
  };
}

function buildHtml(subject: string, notification: Notification, deepLink: string | null): string {
  const color = notification.severity === "critical" ? "#d73a49" : notification.severity === "warning" ? "#b08800" : "#0366d6";
  return `<!doctype html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px">
<div style="border-left:4px solid ${color};padding:8px 12px;background:#f6f8fa">
<h2 style="margin:0;color:${color}">${escapeHtml(subject)}</h2>
<p style="margin:4px 0;color:#586069">Severity: <strong>${notification.severity.toUpperCase()}</strong></p>
</div>
<p>${escapeHtml(notification.safeSummary).replace(/\n/g, "<br>")}</p>
${notification.expiresAt ? `<p><em>Expires: ${escapeHtml(notification.expiresAt)}</em></p>` : ""}
${deepLink ? `<p><a href="${escapeAttr(deepLink)}" style="display:inline-block;padding:10px 16px;background:#0366d6;color:#fff;text-decoration:none;border-radius:4px">Open in dashboard</a></p>` : ""}
<hr><p style="font-size:12px;color:#6a737d">OpenCode secure notification. Do not reply.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[c] || c;
  });
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[c] || c;
  });
}

function buildSafeDeepLink(baseUrl: string, notification: Notification): string | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") return null;
    let path = "/remote/notifications";
    if (notification.taskId) path = `/remote/tasks/${encodeURIComponent(notification.taskId)}`;
    else if (notification.approvalId) path = `/remote/approvals/${encodeURIComponent(notification.approvalId)}`;
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

export { redactSecrets, sanitizeBody, sanitizeSubject };
