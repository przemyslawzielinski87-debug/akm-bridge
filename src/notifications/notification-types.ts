export type NotificationType =
  | "approval_required"
  | "approval_reminder"
  | "task_completed"
  | "task_failed"
  | "task_blocked"
  | "task_timed_out"
  | "task_cancelled"
  | "task_budget_exceeded"
  | "schedule_run_failed"
  | "schedule_auto_paused"
  | "schedule_budget_exceeded"
  | "recovery_escalation"
  | "recovery_degraded"
  | "update_available"
  | "update_high_risk"
  | "update_promotion_required"
  | "update_rollback_executed"
  | "dr_validation_failed"
  | "dr_clean_drill_overdue"
  | "daily_report"
  | "weekly_report"
  | "test";

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationChannel = "dashboard" | "pwa" | "email" | "telegram" | "webhook";

export type NotificationStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "suppressed"
  | "expired"
  | "resolved";

export interface Notification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  channel: NotificationChannel;
  recipient: string;
  taskId: string | null;
  approvalId: string | null;
  scheduleId: string | null;
  title: string;
  safeSummary: string;
  deepLink: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: NotificationStatus;
  attempts: number;
  deduplicationKey: string;
  metadata: Record<string, string>;
}

export interface NotificationDelivery {
  id: string;
  notification_id: string;
  channel: NotificationChannel;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  status: NotificationStatus;
  error_category: string | null;
  provider_message_id: string | null;
}

export interface NotificationPreferences {
  enabled_channels: NotificationChannel[];
  severity_threshold: NotificationSeverity;
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string;
  daily_digest: boolean;
  weekly_digest: boolean;
  approval_notifications: boolean;
  approval_reminder: boolean;
  task_completion_notifications: boolean;
  task_failure_notifications: boolean;
  recovery_notifications: boolean;
  scheduler_notifications: boolean;
  update_notifications: boolean;
  dr_notifications: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled_channels: ["dashboard", "pwa"],
  severity_threshold: "warning",
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  timezone: "Europe/Warsaw",
  daily_digest: true,
  weekly_digest: true,
  approval_notifications: true,
  approval_reminder: true,
  task_completion_notifications: false,
  task_failure_notifications: true,
  recovery_notifications: true,
  scheduler_notifications: true,
  update_notifications: true,
  dr_notifications: true,
};

export const NOTIFICATION_RETRYABLE_ERRORS = [
  "temporary_network",
  "provider_timeout",
  "provider_5xx",
  "rate_limited",
] as const;

export const NOTIFICATION_FATAL_ERRORS = [
  "invalid_recipient",
  "invalid_credentials",
  "forbidden",
  "payload_rejected",
  "expired_notification",
] as const;

export type NotificationRetryableError = (typeof NOTIFICATION_RETRYABLE_ERRORS)[number];
export type NotificationFatalError = (typeof NOTIFICATION_FATAL_ERRORS)[number];
export type NotificationErrorCategory = NotificationRetryableError | NotificationFatalError | "unknown";
