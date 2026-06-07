import type {
  AdapterConfigSummary,
  AdapterHealth,
  FormattedNotification,
  NotificationAdapter,
} from "./notification-adapter.ts";
import { AdapterError, classifyError, sanitizeForLog } from "./notification-adapter.ts";
import type { Notification } from "./notification-types.ts";
import { redactSecrets, sanitizeBody, sanitizeSubject } from "./notification-redactor.ts";

export interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  tls: "starttls" | "tls" | "none";
  username: string;
  password: string;
  from_address: string;
  from_name: string;
  recipient_allowlist: string[];
  timeout_ms: number;
  dashboard_base_url?: string;
}

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

export class EmailAdapter implements NotificationAdapter {
  readonly channel = "email" as const;
  private lastSuccess: string | null = null;
  private lastFailure: string | null = null;
  private lastErrorCategory: string | null = null;
  private lastLatency: number | null = null;
  private successCount = 0;
  private failureCount = 0;

  constructor(private config: EmailConfig | null) {}

  isConfigured(): boolean {
    return !!(this.config?.smtp_host && this.config?.username && this.config?.password && this.config?.from_address);
  }

  private validateRecipient(recipient: string): void {
    if (!EMAIL_RE.test(recipient)) {
      throw new AdapterError("invalid_recipient", `Invalid email recipient format: ${sanitizeForLog(recipient)}`);
    }
    if (this.config && !this.config.recipient_allowlist.includes(recipient)) {
      throw new AdapterError("forbidden", `Recipient not in allowlist: ${sanitizeForLog(recipient)}`);
    }
  }

  async send(notification: Notification, content: FormattedNotification) {
    const start = Date.now();
    if (!this.isConfigured()) {
      return { ok: false, error_category: "not_configured", error_message: "email not configured" };
    }
    try {
      this.validateRecipient(notification.recipient);
    } catch (e) {
      const { category, message } = classifyError(e);
      this.recordFailure(category);
      return { ok: false, error_category: category, error_message: message };
    }

    const subject = sanitizeSubject(content.subject);
    const bodyText = sanitizeBody(content.body_text, 10000);
    const bodyHtml = content.body_html ? sanitizeBody(content.body_html, 50000) : undefined;

    const headerInjection = /(\r|\n|%0a|%0d)(bcc|cc|to|from|subject):/i;
    if (headerInjection.test(subject) || headerInjection.test(notification.recipient)) {
      this.recordFailure("invalid_recipient");
      return { ok: false, error_category: "invalid_recipient", error_message: "header injection attempt blocked" };
    }

    try {
      const { default: nodemailer } = await import("nodemailer").catch(() => ({ default: null as unknown }));
      const nm = nodemailer as any;
      if (!nodemailer) {
        return {
          ok: false,
          error_category: "missing_dependency",
          error_message: "nodemailer not installed; install via: bun add nodemailer",
        };
      }
      const transport = nm.createTransport({
        host: this.config!.smtp_host,
        port: this.config!.smtp_port,
        secure: this.config!.tls === "tls",
        requireTLS: this.config!.tls === "starttls",
        auth: { user: this.config!.username, pass: this.config!.password },
        connectionTimeout: this.config!.timeout_ms,
        greetingTimeout: this.config!.timeout_ms,
      });
      const info = await transport.sendMail({
        from: `"${this.config!.from_name.replace(/[<>"]/g, "")}" <${this.config!.from_address}>`,
        to: notification.recipient,
        subject: subject.substring(0, 200),
        text: bodyText,
        html: bodyHtml ? `<html><body>${bodyHtml}</body></html>` : undefined,
        headers: { "X-OpenCode-Notification": "1" },
      });
      this.recordSuccess();
      return { ok: true, provider_message_id: info.messageId };
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
        channel: "email",
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
      channel: "email",
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
    if (!this.config.smtp_host) errors.push("smtp_host required");
    if (!this.config.smtp_port) errors.push("smtp_port required");
    if (!this.config.username) errors.push("username required");
    if (!this.config.password) errors.push("password required");
    if (!this.config.from_address) errors.push("from_address required");
    if (!EMAIL_RE.test(this.config.from_address)) errors.push("from_address invalid");
    if (!Array.isArray(this.config.recipient_allowlist) || this.config.recipient_allowlist.length === 0) {
      errors.push("recipient_allowlist must contain at least one address");
    }
    for (const r of this.config.recipient_allowlist ?? []) {
      if (!EMAIL_RE.test(r)) errors.push(`invalid recipient: ${sanitizeForLog(r)}`);
    }
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
    if (!this.config) {
      return { channel: "email", configured: false, details: {} };
    }
    return {
      channel: "email",
      configured: true,
      details: {
        smtp_host: this.config.smtp_host,
        smtp_port: String(this.config.smtp_port),
        tls: this.config.tls,
        username: this.config.username,
        from_address: this.config.from_address,
        recipient_count: String(this.config.recipient_allowlist.length),
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
