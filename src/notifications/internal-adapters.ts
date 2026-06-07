import type {
  AdapterConfigSummary,
  AdapterHealth,
  FormattedNotification,
  NotificationAdapter,
} from "./notification-adapter.ts";
import type { Notification } from "./notification-types.ts";
import { sanitizeBody, sanitizeSubject } from "./notification-redactor.ts";

export class DashboardAdapter implements NotificationAdapter {
  readonly channel = "dashboard" as const;
  private lastSuccess: string | null = null;
  private lastLatency: number | null = 0;
  private inbox: Notification[] = [];
  private listeners = new Set<(n: Notification) => void>();
  private maxInbox = 200;

  onNotification(listener: (n: Notification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getInbox(): Notification[] {
    return [...this.inbox];
  }

  clearInbox(): void {
    this.inbox = [];
  }

  async send(notification: Notification, _content: FormattedNotification) {
    const start = Date.now();
    this.inbox.unshift(notification);
    if (this.inbox.length > this.maxInbox) this.inbox.length = this.maxInbox;
    this.lastSuccess = new Date().toISOString();
    this.lastLatency = Date.now() - start;
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch {
      }
    }
    return { ok: true, provider_message_id: `dashboard-${notification.id}` };
  }

  async health(): Promise<AdapterHealth> {
    return {
      channel: "dashboard",
      configured: true,
      healthy: true,
      degraded: false,
      last_success: this.lastSuccess,
      last_failure: null,
      last_error_category: null,
      latency_ms: this.lastLatency,
      failure_rate: 0,
    };
  }

  async validateConfig() {
    return { valid: true, errors: [] };
  }

  async formatPreview(notification: Notification): Promise<FormattedNotification> {
    return {
      subject: `[PREVIEW] ${sanitizeSubject(notification.title)}`,
      body_text: sanitizeBody(notification.safeSummary, 1000),
      metadata: { preview: "true" },
    };
  }

  getConfigSummary(): AdapterConfigSummary {
    return { channel: "dashboard", configured: true, details: {} };
  }
}

export class PwaAdapter implements NotificationAdapter {
  readonly channel = "pwa" as const;
  private lastSuccess: string | null = null;
  private lastLatency: number | null = 0;
  private listeners = new Set<(n: Notification) => void>();

  onNotification(listener: (n: Notification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(notification: Notification, _content: FormattedNotification) {
    const start = Date.now();
    this.lastSuccess = new Date().toISOString();
    this.lastLatency = Date.now() - start;
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch {
      }
    }
    return { ok: true, provider_message_id: `pwa-${notification.id}` };
  }

  async health(): Promise<AdapterHealth> {
    return {
      channel: "pwa",
      configured: true,
      healthy: true,
      degraded: false,
      last_success: this.lastSuccess,
      last_failure: null,
      last_error_category: null,
      latency_ms: this.lastLatency,
      failure_rate: 0,
    };
  }

  async validateConfig() {
    return { valid: true, errors: [] };
  }

  async formatPreview(notification: Notification): Promise<FormattedNotification> {
    return {
      subject: `[PREVIEW] ${sanitizeSubject(notification.title)}`,
      body_text: sanitizeBody(notification.safeSummary, 1000),
      metadata: { preview: "true" },
    };
  }

  getConfigSummary(): AdapterConfigSummary {
    return { channel: "pwa", configured: true, details: {} };
  }
}
