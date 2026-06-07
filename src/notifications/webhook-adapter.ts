import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  AdapterConfigSummary,
  AdapterHealth,
  FormattedNotification,
  NotificationAdapter,
} from "./notification-adapter.ts";
import { AdapterError, classifyError, sanitizeForLog } from "./notification-adapter.ts";
import type { Notification } from "./notification-types.ts";
import { sanitizeBody, sanitizeSubject } from "./notification-redactor.ts";

export interface WebhookConfig {
  url: string;
  secret: string;
  allowed_hosts: string[];
  timeout_ms: number;
  max_redirects: number;
  dashboard_base_url?: string;
}

const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
];

function isPrivateHost(host: string): boolean {
  return PRIVATE_IP_PATTERNS.some((p) => p.test(host));
}

export class WebhookAdapter implements NotificationAdapter {
  readonly channel = "webhook" as const;
  private lastSuccess: string | null = null;
  private lastFailure: string | null = null;
  private lastErrorCategory: string | null = null;
  private lastLatency: number | null = null;
  private successCount = 0;
  private failureCount = 0;
  public seenNonces = new Set<string>();

  constructor(private config: WebhookConfig | null) {}

  isConfigured(): boolean {
    return !!(this.config?.url && this.config?.secret);
  }

  async send(notification: Notification, content: FormattedNotification) {
    const start = Date.now();
    if (!this.isConfigured()) {
      return { ok: false, error_category: "not_configured", error_message: "webhook not configured" };
    }
    let url: URL;
    try {
      url = new URL(this.config!.url);
    } catch {
      this.recordFailure("invalid_config");
      return { ok: false, error_category: "invalid_config", error_message: "invalid url" };
    }
    if (url.protocol !== "https:") {
      this.recordFailure("forbidden");
      return { ok: false, error_category: "forbidden", error_message: "https required" };
    }
    if (!this.config!.allowed_hosts.includes(url.hostname)) {
      this.recordFailure("forbidden");
      return { ok: false, error_category: "forbidden", error_message: `host not allowed: ${sanitizeForLog(url.hostname)}` };
    }
    if (isPrivateHost(url.hostname)) {
      this.recordFailure("forbidden");
      return { ok: false, error_category: "forbidden", error_message: "private host blocked" };
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString("hex");
    const body = JSON.stringify({
      id: notification.id,
      type: notification.type,
      severity: notification.severity,
      title: sanitizeSubject(content.subject),
      summary: sanitizeBody(content.body_text, 5000),
      deepLink: notification.deepLink,
      createdAt: notification.createdAt,
      expiresAt: notification.expiresAt,
    });
    const signature = createHmac("sha256", this.config!.secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config!.timeout_ms);
      const response = await fetch(this.config!.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenCode-Timestamp": timestamp,
          "X-OpenCode-Nonce": nonce,
          "X-OpenCode-Signature": `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
        redirect: "manual",
      });
      clearTimeout(timer);
      if (response.status >= 300 && response.status < 400) {
        this.recordFailure("forbidden");
        return { ok: false, error_category: "forbidden", error_message: "redirects not allowed" };
      }
      if (response.status >= 500) {
        this.recordFailure("provider_5xx");
        return { ok: false, error_category: "provider_5xx", error_message: `HTTP ${response.status}` };
      }
      if (response.status === 429) {
        this.recordFailure("rate_limited");
        return { ok: false, error_category: "rate_limited", error_message: "429" };
      }
      if (response.status === 401 || response.status === 403) {
        this.recordFailure("forbidden");
        return { ok: false, error_category: "forbidden", error_message: `HTTP ${response.status}` };
      }
      if (response.status >= 400) {
        this.recordFailure("payload_rejected");
        return { ok: false, error_category: "payload_rejected", error_message: `HTTP ${response.status}` };
      }
      this.recordSuccess();
      return { ok: true, provider_message_id: response.headers.get("x-request-id") || undefined };
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
        channel: "webhook",
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
      channel: "webhook",
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
    try {
      const url = new URL(this.config.url);
      if (url.protocol !== "https:") errors.push("https required");
      if (this.config.allowed_hosts.length === 0) errors.push("allowed_hosts must list at least one host");
      if (isPrivateHost(url.hostname) && !this.config.allowed_hosts.includes("private")) {
        errors.push("private hosts not allowed without explicit allow");
      }
    } catch {
      errors.push("invalid url");
    }
    if (!this.config.secret || this.config.secret.length < 16) errors.push("secret must be at least 16 chars");
    return { valid: errors.length === 0, errors };
  }

  async formatPreview(notification: Notification): Promise<FormattedNotification> {
    return {
      subject: `[PREVIEW] ${sanitizeSubject(notification.title)}`,
      body_text: sanitizeBody(notification.safeSummary, 1000),
      metadata: { preview: "true" },
    };
  }

  getConfigSummary(): AdapterConfigSummary {
    if (!this.config) return { channel: "webhook", configured: false, details: {} };
    let host = "";
    try {
      host = new URL(this.config.url).host;
    } catch {
      host = "invalid";
    }
    return {
      channel: "webhook",
      configured: true,
      details: {
        host,
        allowed_hosts_count: String(this.config.allowed_hosts.length),
      },
    };
  }

  verifySignature(timestamp: string, nonce: string, body: string, signature: string): boolean {
    if (!this.config) return false;
    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) return false;
    if (this.seenNonces.has(nonce)) return false;
    this.seenNonces.add(nonce);
    const expected = createHmac("sha256", this.config.secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
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
