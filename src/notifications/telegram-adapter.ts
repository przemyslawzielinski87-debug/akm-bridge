import type {
  AdapterConfigSummary,
  AdapterHealth,
  FormattedNotification,
  NotificationAdapter,
} from "./notification-adapter.ts";
import { AdapterError, classifyError, sanitizeForLog } from "./notification-adapter.ts";
import type { Notification } from "./notification-types.ts";
import { sanitizeBody, sanitizeSubject } from "./notification-redactor.ts";

export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  chat_allowlist: string[];
  timeout_ms: number;
  parse_mode: "HTML" | "MarkdownV2" | "plain";
  dashboard_base_url?: string;
}

export class TelegramAdapter implements NotificationAdapter {
  readonly channel = "telegram" as const;
  private lastSuccess: string | null = null;
  private lastFailure: string | null = null;
  private lastErrorCategory: string | null = null;
  private lastLatency: number | null = null;
  private successCount = 0;
  private failureCount = 0;

  constructor(private config: TelegramConfig | null) {}

  isConfigured(): boolean {
    return !!(this.config?.bot_token && this.config?.chat_id);
  }

  private validateRecipient(recipient: string) {
    if (!this.config) throw new AdapterError("not_configured", "telegram not configured");
    if (!this.config.chat_allowlist.includes(recipient)) {
      throw new AdapterError("forbidden", `chat_id not in allowlist: ${sanitizeForLog(recipient)}`);
    }
    if (!/^-?\d+$/.test(recipient)) {
      throw new AdapterError("invalid_recipient", `invalid telegram chat_id: ${sanitizeForLog(recipient)}`);
    }
  }

  async send(notification: Notification, content: FormattedNotification) {
    const start = Date.now();
    if (!this.isConfigured()) {
      return { ok: false, error_category: "not_configured", error_message: "telegram not configured" };
    }
    try {
      this.validateRecipient(notification.recipient);
    } catch (e) {
      const { category, message } = classifyError(e);
      this.recordFailure(category);
      return { ok: false, error_category: category, error_message: message };
    }

    const subject = sanitizeSubject(content.subject);
    const body = sanitizeBody(content.body_text, 4000);

    let message = `<b>${escapeTelegramHtml(subject)}</b>\n\n${escapeTelegramHtml(body)}`;
    if (notification.deepLink) message += `\n\n<a href="${escapeTelegramAttr(notification.deepLink)}">Open dashboard</a>`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config!.timeout_ms);
      const response = await fetch(`https://api.telegram.org/bot${this.config!.bot_token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: notification.recipient,
          text: message,
          parse_mode: this.config!.parse_mode === "plain" ? undefined : this.config!.parse_mode,
          disable_web_page_preview: true,
          disable_notification: notification.severity === "info",
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        const errBody = await response.text();
        if (response.status === 401 || response.status === 403) {
          this.recordFailure("invalid_credentials");
          return { ok: false, error_category: "invalid_credentials", error_message: `HTTP ${response.status}` };
        }
        if (response.status === 400) {
          this.recordFailure("payload_rejected");
          return { ok: false, error_category: "payload_rejected", error_message: sanitizeForLog(errBody, 200) };
        }
        if (response.status === 429) {
          this.recordFailure("rate_limited");
          return { ok: false, error_category: "rate_limited", error_message: "telegram 429" };
        }
        if (response.status >= 500) {
          this.recordFailure("provider_5xx");
          return { ok: false, error_category: "provider_5xx", error_message: `HTTP ${response.status}` };
        }
        this.recordFailure("unknown");
        return { ok: false, error_category: "unknown", error_message: sanitizeForLog(errBody, 200) };
      }
      const json = (await response.json()) as { result?: { message_id?: number } };
      this.recordSuccess();
      return { ok: true, provider_message_id: json.result?.message_id?.toString() };
    } catch (e) {
      const { category, message } = classifyError(e);
      this.recordFailure(category);
      return { ok: false, error_category: category, error_message: message };
    } finally {
      this.lastLatency = Date.now() - start;
    }
  }

  async health(): Promise<AdapterHealth> {
    if (!this.isConfigured()) {
      return {
        channel: "telegram",
        configured: false,
        healthy: false,
        degraded: false,
        last_success: this.lastSuccess,
        last_failure: this.lastFailure,
        last_error_category: this.lastErrorCategory,
        latency_ms: this.lastLatency,
        failure_rate: this.failureCount / Math.max(1, this.successCount + this.failureCount),
      };
    }
    return {
      channel: "telegram",
      configured: true,
      healthy: this.failureCount === 0 || this.lastSuccess !== null,
      degraded: this.failureCount > 0 && this.successCount > 0,
      last_success: this.lastSuccess,
      last_failure: this.lastFailure,
      last_error_category: this.lastErrorCategory,
      latency_ms: this.lastLatency,
      failure_rate: this.failureCount / Math.max(1, this.successCount + this.failureCount),
    };
  }

  async validateConfig() {
    const errors: string[] = [];
    if (!this.config) return { valid: false, errors: ["not_configured"] };
    if (!this.config.bot_token) errors.push("bot_token required");
    else if (!/^\d{8,12}:[A-Za-z0-9_\-]{35}$/.test(this.config.bot_token)) errors.push("bot_token invalid format");
    if (!this.config.chat_id) errors.push("chat_id required");
    if (!this.config.chat_allowlist || this.config.chat_allowlist.length === 0) errors.push("chat_allowlist empty");
    return { valid: errors.length === 0, errors };
  }

  async formatPreview(notification: Notification): Promise<FormattedNotification> {
    return {
      subject: `[PREVIEW] ${sanitizeSubject(notification.title)}`,
      body_text: `[PREVIEW]\n${sanitizeBody(notification.safeSummary, 1000)}`,
      metadata: { preview: "true" },
    };
  }

  getConfigSummary(): AdapterConfigSummary {
    if (!this.config) return { channel: "telegram", configured: false, details: {} };
    return {
      channel: "telegram",
      configured: true,
      details: {
        chat_id: this.config.chat_id,
        chat_allowlist_count: String(this.config.chat_allowlist.length),
        parse_mode: this.config.parse_mode,
      },
    };
  }

  private recordSuccess() {
    this.lastSuccess = new Date().toISOString();
    this.successCount++;
  }

  private recordFailure(category: string) {
    this.lastFailure = new Date().toISOString();
    this.lastErrorCategory = category;
    this.failureCount++;
  }
}

function escapeTelegramHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
    return map[c] || c;
  });
}

function escapeTelegramAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[c] || c;
  });
}
