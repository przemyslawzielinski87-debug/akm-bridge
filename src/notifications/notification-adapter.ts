import type { Notification, NotificationChannel } from "./notification-types.ts";

export interface AdapterSendResult {
  ok: boolean;
  provider_message_id?: string;
  error_category?: string;
  error_message?: string;
}

export interface AdapterHealth {
  channel: NotificationChannel;
  configured: boolean;
  healthy: boolean;
  degraded: boolean;
  last_success: string | null;
  last_failure: string | null;
  last_error_category: string | null;
  latency_ms: number | null;
  failure_rate: number;
}

export interface AdapterConfigSummary {
  channel: NotificationChannel;
  configured: boolean;
  details: Record<string, string>;
}

export interface NotificationAdapter {
  readonly channel: NotificationChannel;
  send(notification: Notification, content: FormattedNotification): Promise<AdapterSendResult>;
  health(): Promise<AdapterHealth>;
  validateConfig(): Promise<{ valid: boolean; errors: string[] }>;
  formatPreview(notification: Notification): Promise<FormattedNotification>;
}

export interface FormattedNotification {
  subject: string;
  body_text: string;
  body_html?: string;
  metadata: Record<string, string>;
}

export class AdapterError extends Error {
  constructor(
    public category: string,
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export function classifyError(err: unknown): { category: string; message: string } {
  if (err instanceof AdapterError) {
    return { category: err.category, message: err.message };
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("timed out")) {
      return { category: "provider_timeout", message: err.message };
    }
    if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("network")) {
      return { category: "temporary_network", message: err.message };
    }
    if (msg.includes("5xx") || msg.includes("internal server") || msg.includes("service unavailable")) {
      return { category: "provider_5xx", message: err.message };
    }
    if (msg.includes("rate limit") || msg.includes("429")) {
      return { category: "rate_limited", message: err.message };
    }
    if (msg.includes("invalid recipient") || msg.includes("invalid email")) {
      return { category: "invalid_recipient", message: err.message };
    }
    if (msg.includes("auth") || msg.includes("credentials") || msg.includes("535")) {
      return { category: "invalid_credentials", message: err.message };
    }
    if (msg.includes("forbidden") || msg.includes("403")) {
      return { category: "forbidden", message: err.message };
    }
    return { category: "unknown", message: err.message };
  }
  return { category: "unknown", message: String(err) };
}

export function sanitizeForLog(value: string, maxLen = 200): string {
  if (!value) return "";
  let s = value.replace(/[\r\n\t]/g, " ");
  if (s.length > maxLen) s = s.substring(0, maxLen) + "...";
  return s;
}
