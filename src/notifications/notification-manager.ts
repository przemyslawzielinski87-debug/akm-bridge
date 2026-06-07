import type { NotificationAdapter, AdapterHealth, AdapterConfigSummary } from "./notification-adapter.ts";
import { DashboardAdapter, PwaAdapter } from "./internal-adapters.ts";
import { EmailAdapter, type EmailConfig } from "./email-adapter.ts";
import { TelegramAdapter, type TelegramConfig } from "./telegram-adapter.ts";
import { WebhookAdapter, type WebhookConfig } from "./webhook-adapter.ts";
import type {
  Notification,
  NotificationChannel,
  NotificationPreferences,
  NotificationType,
  NotificationSeverity,
} from "./notification-types.ts";
import { DEFAULT_PREFERENCES, NOTIFICATION_FATAL_ERRORS, NOTIFICATION_RETRYABLE_ERRORS } from "./notification-types.ts";
import { NotificationStore } from "./notification-store.ts";
import { formatNotification } from "./notification-formatter.ts";
import { buildDeduplicationKey, checkQuietHours, shouldSuppress } from "./notification-utils.ts";
import { buildDeepLink } from "./notification-redactor.ts";

export interface NotificationManagerConfig {
  store: NotificationStore;
  email: EmailConfig | null;
  telegram: TelegramConfig | null;
  webhook: WebhookConfig | null;
  dashboard_base_url: string;
  max_attempts: number;
  initial_delay_ms: number;
  backoff_multiplier: number;
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = { info: 0, warning: 1, critical: 2 };

export class NotificationManager {
  private store: NotificationStore;
  private email: EmailAdapter;
  private telegram: TelegramAdapter;
  private webhook: WebhookAdapter;
  private dashboard: DashboardAdapter;
  private pwa: PwaAdapter;
  private baseUrl: string;
  private maxAttempts: number;
  private initialDelay: number;
  private backoff: number;

  constructor(cfg: NotificationManagerConfig) {
    this.store = cfg.store;
    this.email = new EmailAdapter(cfg.email);
    this.telegram = new TelegramAdapter(cfg.telegram);
    this.webhook = new WebhookAdapter(cfg.webhook);
    this.dashboard = new DashboardAdapter();
    this.pwa = new PwaAdapter();
    this.baseUrl = cfg.dashboard_base_url;
    this.maxAttempts = cfg.max_attempts;
    this.initialDelay = cfg.initial_delay_ms;
    this.backoff = cfg.backoff_multiplier;
  }

  getAdapters(): Record<NotificationChannel, NotificationAdapter> {
    return {
      dashboard: this.dashboard,
      pwa: this.pwa,
      email: this.email,
      telegram: this.telegram,
      webhook: this.webhook,
    };
  }

  getDashboardAdapter(): DashboardAdapter {
    return this.dashboard;
  }

  getPwaAdapter(): PwaAdapter {
    return this.pwa;
  }

  getPreferences(): NotificationPreferences {
    return this.store.getPreferences();
  }

  savePreferences(prefs: Partial<NotificationPreferences>): NotificationPreferences {
    return this.store.savePreferences(prefs);
  }

  async emit(input: {
    type: NotificationType;
    severity: NotificationSeverity;
    recipient?: string;
    taskId?: string;
    approvalId?: string;
    scheduleId?: string;
    title: string;
    safeSummary: string;
    dedupParts: { id?: string; sequence?: number };
    deepLinkPath?: string;
    expiresAt?: string;
    metadata?: Record<string, string>;
  }): Promise<{ queued: Notification[]; suppressed: { reason: string; severity: NotificationSeverity }[] }> {
    const prefs = this.getPreferences();
    const dedupKey = buildDeduplicationKey({ type: input.type, id: input.dedupParts.id, sequence: input.dedupParts.sequence });
    const deepLink = input.deepLinkPath
      ? buildDeepLink(this.baseUrl, input.deepLinkPath, { id: input.taskId || input.approvalId || "" })
      : null;
    const channels = this.recipientChannels(input.severity, input.type, prefs);
    const recipient = input.recipient || this.defaultRecipientForChannel(channels[0], prefs);

    const quietHours = checkQuietHours(prefs.quiet_hours_start, prefs.quiet_hours_end, prefs.timezone);
    const suppress = shouldSuppress(input.severity, quietHours);
    const queued: Notification[] = [];
    const suppressed: { reason: string; severity: NotificationSeverity }[] = [];

    for (const channel of channels) {
      if (suppress.suppress && channel !== "dashboard") {
        suppressed.push({ reason: suppress.reason, severity: input.severity });
        continue;
      }
      const existing = this.store.findByDedup(dedupKey, channel);
      if (existing && existing.status !== "failed" && existing.status !== "expired") {
        continue;
      }
      const targetRecipient = channel === "dashboard" || channel === "pwa" ? "internal" : recipient;
      const n = this.store.createNotification({
        type: input.type,
        severity: input.severity,
        channel,
        recipient: targetRecipient,
        taskId: input.taskId || null,
        approvalId: input.approvalId || null,
        scheduleId: input.scheduleId || null,
        title: input.title,
        safeSummary: input.safeSummary,
        deepLink,
        expiresAt: input.expiresAt || null,
        deduplicationKey: dedupKey,
        metadata: input.metadata || {},
      });
      queued.push(n);
    }
    return { queued, suppressed };
  }

  async dispatch(notification: Notification): Promise<{ ok: boolean; result: { ok: boolean; error_category?: string; provider_message_id?: string } }> {
    const adapter = this.adapterFor(notification.channel);
    if (!adapter) {
      this.store.updateStatus(notification.id, "failed");
      return { ok: false, result: { ok: false, error_category: "no_adapter" } };
    }
    const content = await adapter.formatPreview(notification);
    this.store.updateStatus(notification.id, "sending");
    this.store.incrementAttempts(notification.id);
    const delivery = this.store.recordDelivery({
      notification_id: notification.id,
      channel: notification.channel,
      attempt: notification.attempts + 1,
      started_at: new Date().toISOString(),
      finished_at: null,
      status: "sending",
      error_category: null,
      provider_message_id: null,
    });
    const result = await adapter.send(notification, content);
    const finishedAt = new Date().toISOString();
    this.store.recordDelivery({
      ...delivery,
      finished_at: finishedAt,
      status: result.ok ? "sent" : "failed",
      error_category: result.error_category || null,
      provider_message_id: result.provider_message_id || null,
    });
    this.store.updateStatus(notification.id, result.ok ? "sent" : "failed");
    return { ok: result.ok, result };
  }

  async dispatchQueued(): Promise<{ attempted: number; sent: number; failed: number; retried: number }> {
    const all = this.store.list({ status: "queued", limit: 100 });
    let attempted = 0;
    let sent = 0;
    let failed = 0;
    let retried = 0;
    for (const n of all) {
      if (n.expiresAt && new Date(n.expiresAt) < new Date()) {
        this.store.updateStatus(n.id, "expired");
        continue;
      }
      if (n.attempts >= this.maxAttempts) {
        this.store.updateStatus(n.id, "failed");
        failed++;
        continue;
      }
      const result = await this.dispatch(n);
      attempted++;
      if (result.ok) sent++;
      else {
        if (n.attempts < this.maxAttempts && (NOTIFICATION_RETRYABLE_ERRORS as readonly string[]).includes(result.result.error_category || "")) {
          this.store.updateStatus(n.id, "queued");
          retried++;
        } else {
          this.store.updateStatus(n.id, "failed");
          failed++;
        }
      }
    }
    return { attempted, sent, failed, retried };
  }

  resolveByDedupKey(dedupKey: string): number {
    return this.store.markResolvedByDedup(dedupKey);
  }

  list(filter: { status?: Notification["status"]; limit?: number } = {}) {
    return this.store.list(filter);
  }

  getDeliveries(notificationId: string) {
    return this.store.getDeliveries(notificationId);
  }

  async healthAll(): Promise<Record<NotificationChannel, AdapterHealth>> {
    const channels: NotificationChannel[] = ["dashboard", "pwa", "email", "telegram", "webhook"];
    const out: Record<string, AdapterHealth> = {};
    for (const ch of channels) {
      const adapter = this.adapterFor(ch);
      if (!adapter) continue;
      out[ch] = await adapter.health();
    }
    return out as Record<NotificationChannel, AdapterHealth>;
  }

  configSummaryAll(): Record<NotificationChannel, AdapterConfigSummary> {
    return {
      dashboard: this.dashboard.getConfigSummary(),
      pwa: this.pwa.getConfigSummary(),
      email: this.email.getConfigSummary(),
      telegram: this.telegram.getConfigSummary(),
      webhook: this.webhook.getConfigSummary(),
    };
  }

  countByStatus() {
    return this.store.countByStatus();
  }

  private adapterFor(channel: NotificationChannel): NotificationAdapter | null {
    switch (channel) {
      case "dashboard":
        return this.dashboard;
      case "pwa":
        return this.pwa;
      case "email":
        return this.email;
      case "telegram":
        return this.telegram;
      case "webhook":
        return this.webhook;
    }
  }

  private recipientChannels(severity: NotificationSeverity, type: NotificationType, prefs: NotificationPreferences): NotificationChannel[] {
    if (SEVERITY_RANK[severity] < SEVERITY_RANK[prefs.severity_threshold]) {
      return ["dashboard"];
    }
    if (type === "approval_required" && !prefs.approval_notifications) {
      return ["dashboard"];
    }
    if (type === "task_completed" && !prefs.task_completion_notifications) {
      return ["dashboard"];
    }
    if (type === "task_failed" && !prefs.task_failure_notifications) {
      return ["dashboard"];
    }
    if (type.startsWith("schedule_") && !prefs.scheduler_notifications) {
      return ["dashboard"];
    }
    if (type.startsWith("recovery_") && !prefs.recovery_notifications) {
      return ["dashboard"];
    }
    if (type.startsWith("update_") && !prefs.update_notifications) {
      return ["dashboard"];
    }
    if (type.startsWith("dr_") && !prefs.dr_notifications) {
      return ["dashboard"];
    }
    return prefs.enabled_channels;
  }

  private defaultRecipientForChannel(channel: NotificationChannel | undefined, prefs: NotificationPreferences): string {
    if (!channel) return "internal";
    if (channel === "dashboard" || channel === "pwa") return "internal";
    if (channel === "email") {
      return "test@example.com";
    }
    if (channel === "telegram") return "0";
    if (channel === "webhook") return "webhook";
    return "internal";
  }
}

export function buildManagerFromEnv(store: NotificationStore): NotificationManager {
  const emailCfg: EmailConfig | null = process.env.SMTP_HOST
    ? {
        smtp_host: process.env.SMTP_HOST,
        smtp_port: parseInt(process.env.SMTP_PORT || "587", 10),
        tls: (process.env.SMTP_TLS as "starttls" | "tls" | "none") || "starttls",
        username: process.env.SMTP_USERNAME || "",
        password: process.env.SMTP_PASSWORD || "",
        from_address: process.env.SMTP_FROM_ADDRESS || "",
        from_name: process.env.SMTP_FROM_NAME || "OpenCode",
        recipient_allowlist: (process.env.SMTP_RECIPIENT_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean),
        timeout_ms: parseInt(process.env.SMTP_TIMEOUT_MS || "10000", 10),
        dashboard_base_url: process.env.DASHBOARD_BASE_URL || "",
      }
    : null;

  const telegramCfg: TelegramConfig | null = process.env.TELEGRAM_BOT_TOKEN
    ? {
        bot_token: process.env.TELEGRAM_BOT_TOKEN,
        chat_id: process.env.TELEGRAM_CHAT_ID || "",
        chat_allowlist: (process.env.TELEGRAM_CHAT_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean),
        timeout_ms: parseInt(process.env.TELEGRAM_TIMEOUT_MS || "10000", 10),
        parse_mode: ((process.env.TELEGRAM_PARSE_MODE as "HTML" | "MarkdownV2" | "plain") || "HTML"),
        dashboard_base_url: process.env.DASHBOARD_BASE_URL || "",
      }
    : null;

  const webhookCfg: WebhookConfig | null = process.env.WEBHOOK_URL
    ? {
        url: process.env.WEBHOOK_URL,
        secret: process.env.WEBHOOK_SECRET || "",
        allowed_hosts: (process.env.WEBHOOK_ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean),
        timeout_ms: parseInt(process.env.WEBHOOK_TIMEOUT_MS || "10000", 10),
        max_redirects: 0,
        dashboard_base_url: process.env.DASHBOARD_BASE_URL || "",
      }
    : null;

  return new NotificationManager({
    store,
    email: emailCfg,
    telegram: telegramCfg,
    webhook: webhookCfg,
    dashboard_base_url: process.env.DASHBOARD_BASE_URL || "https://localhost",
    max_attempts: parseInt(process.env.NOTIFICATION_MAX_ATTEMPTS || "3", 10),
    initial_delay_ms: parseInt(process.env.NOTIFICATION_INITIAL_DELAY_MS || "60000", 10),
    backoff_multiplier: parseFloat(process.env.NOTIFICATION_BACKOFF_MULTIPLIER || "2"),
  });
}

export { DEFAULT_PREFERENCES, NOTIFICATION_RETRYABLE_ERRORS, NOTIFICATION_FATAL_ERRORS };
