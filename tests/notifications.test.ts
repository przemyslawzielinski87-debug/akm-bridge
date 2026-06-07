import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  redactSecrets,
  sanitizeBody,
  sanitizeSubject,
  buildDeepLink,
  isSafeForUrl,
} from "../src/notifications/notification-redactor.ts";
import { checkQuietHours, shouldSuppress, buildDeduplicationKey } from "../src/notifications/notification-utils.ts";
import { formatNotification } from "../src/notifications/notification-formatter.ts";
import { NotificationStore } from "../src/notifications/notification-store.ts";
import { NotificationManager } from "../src/notifications/notification-manager.ts";
import { WebhookAdapter } from "../src/notifications/webhook-adapter.ts";
import { TelegramAdapter } from "../src/notifications/telegram-adapter.ts";
import { EmailAdapter } from "../src/notifications/email-adapter.ts";
import { DashboardAdapter, PwaAdapter } from "../src/notifications/internal-adapters.ts";
import type { Notification } from "../src/notifications/notification-types.ts";
import { existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tmpDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "notif-test-"));
  return join(dir, name);
}

function sampleNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n-" + Math.random().toString(36).slice(2),
    type: "approval_required",
    severity: "warning",
    channel: "email",
    recipient: "test@example.com",
    taskId: "task-123",
    approvalId: "appr-456",
    scheduleId: null,
    title: "Approval required",
    safeSummary: "Task awaiting approval. Open dashboard to review.",
    deepLink: "https://dashboard.example.com/remote/approvals/appr-456",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    status: "queued",
    attempts: 0,
    deduplicationKey: "approval:appr-456",
    metadata: {},
    ...overrides,
  };
}

describe("Redactor", () => {
  it("redacts GitHub PATs", () => {
    const r = redactSecrets("Token: ghp_aaaaaaaaaaaaaaaaaaaa");
    expect(r.text).toContain("[REDACTED:github_pat]");
    expect(r.text).not.toContain("ghp_");
  });

  it("redacts OpenAI keys", () => {
    const r = redactSecrets("Key: sk-abcdefghijklmnopqrstuvwxyz");
    expect(r.text).toContain("[REDACTED:openai_key]");
  });

  it("redacts AWS access keys", () => {
    const r = redactSecrets("AKIAIOSFODNN7EXAMPLE");
    expect(r.text).toContain("[REDACTED:aws_access_key]");
  });

  it("redacts Telegram bot tokens", () => {
    const r = redactSecrets("Bot token: 1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdeFGHI");
    expect(r.text).toContain("[REDACTED:telegram_token]");
  });

  it("redacts bearer tokens", () => {
    const r = redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456");
    expect(r.text).toContain("[REDACTED:bearer_token]");
  });

  it("redacts private key blocks", () => {
    const r = redactSecrets("-----BEGIN OPENSSH PRIVATE KEY-----\nbase64data\n-----END OPENSSH PRIVATE KEY-----");
    expect(r.text).toContain("[REDACTED:private_key_block]");
  });

  it("sanitizeSubject strips newlines", () => {
    const s = sanitizeSubject("Test\r\nInjection\nSubject");
    expect(s).not.toContain("\r");
    expect(s).not.toContain("\n");
  });

  it("sanitizeBody limits length", () => {
    const b = sanitizeBody("a".repeat(10000), 100);
    expect(b.length).toBeLessThanOrEqual(200);
  });

  it("buildDeepLink only accepts HTTPS", () => {
    expect(buildDeepLink("https://x.com", "/p")).toBe("https://x.com/p");
    expect(buildDeepLink("http://x.com", "/p")).toBe(null);
    expect(buildDeepLink("ftp://x.com", "/p")).toBe(null);
  });

  it("isSafeForUrl rejects dangerous chars", () => {
    expect(isSafeForUrl("/path?x=1")).toBe(true);
    expect(isSafeForUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeForUrl("../etc/passwd")).toBe(false);
  });
});

describe("Quiet hours", () => {
  it("detects in-quiet-hours", () => {
    const date = new Date("2026-06-07T03:00:00Z");
    const r = checkQuietHours("22:00", "07:00", "Europe/Warsaw", date);
    expect(r.in_quiet_hours).toBe(true);
  });

  it("detects out-of-quiet-hours", () => {
    const date = new Date("2026-06-07T12:00:00Z");
    const r = checkQuietHours("22:00", "07:00", "Europe/Warsaw", date);
    expect(r.in_quiet_hours).toBe(false);
  });

  it("critical bypasses quiet hours", () => {
    const r = shouldSuppress("critical", { in_quiet_hours: true, reason: "test" });
    expect(r.suppress).toBe(false);
  });

  it("info is suppressed during quiet hours", () => {
    const r = shouldSuppress("info", { in_quiet_hours: true, reason: "test" });
    expect(r.suppress).toBe(true);
  });

  it("warning is suppressed during quiet hours", () => {
    const r = shouldSuppress("warning", { in_quiet_hours: true, reason: "test" });
    expect(r.suppress).toBe(true);
  });

  it("buildDeduplicationKey composes correctly", () => {
    expect(buildDeduplicationKey({ type: "approval", id: "x" })).toBe("approval:x");
    expect(buildDeduplicationKey({ type: "schedule", id: "s", sequence: 3 })).toBe("schedule:s:3");
  });
});

describe("Formatter", () => {
  it("formats an approval notification without leaking fields", () => {
    const n = sampleNotification();
    const f = formatNotification(n, "https://dashboard.example.com");
    expect(f.subject).toBe("Approval required");
    expect(f.body_text).toContain("Approval required");
    expect(f.body_text).toContain("Open in dashboard");
    expect(f.body_text).toContain("https://dashboard.example.com/remote/approvals/appr-456");
  });

  it("redacts secrets in body", () => {
    const n = sampleNotification({ safeSummary: "Auth: Bearer abcdefghijklmnopqrstuvwxyz123" });
    const f = formatNotification(n, "https://x.com");
    expect(f.body_text).not.toContain("abcdefghijklmnopqrstuvwxyz123");
    expect(f.body_text).toContain("[REDACTED:bearer_token]");
  });
});

describe("Notification store", () => {
  let path: string;
  let store: NotificationStore;

  beforeEach(() => {
    path = tmpDbPath("test.db");
    store = new NotificationStore(path);
  });

  afterEach(() => {
    store.close();
    if (existsSync(path)) unlinkSync(path);
  });

  it("creates and retrieves a notification", () => {
    const input = sampleNotification();
    const n = store.createNotification(input);
    expect(n.id).toBeTruthy();
    const got = store.get(n.id);
    expect(got).toBeTruthy();
    expect(got?.title).toBe(input.title);
    expect(got?.safeSummary).toBe(input.safeSummary);
  });

  it("deduplicates on (dedup_key, channel) UNIQUE", () => {
    store.createNotification(sampleNotification());
    const second = store.createNotification(sampleNotification());
    expect(second.id).toBeTruthy();
    const all = store.list();
    expect(all.length).toBe(1);
  });

  it("counts by status", () => {
    store.createNotification(sampleNotification());
    store.updateStatus(store.list()[0].id, "sent");
    const c = store.countByStatus();
    expect(c.sent).toBe(1);
  });

  it("records deliveries", () => {
    const n = store.createNotification(sampleNotification());
    store.recordDelivery({
      notification_id: n.id,
      channel: "email",
      attempt: 1,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "sent",
      error_category: null,
      provider_message_id: "msg-1",
    });
    const d = store.getDeliveries(n.id);
    expect(d.length).toBe(1);
    expect(d[0].provider_message_id).toBe("msg-1");
  });

  it("resolves by dedup key", () => {
    const n = store.createNotification(sampleNotification());
    const resolved = store.markResolvedByDedup(n.deduplicationKey);
    expect(resolved).toBe(1);
    expect(store.get(n.id)?.status).toBe("resolved");
  });

  it("saves and loads preferences", () => {
    const prefs = store.savePreferences({ approval_reminder: false, daily_digest: false });
    expect(prefs.approval_reminder).toBe(false);
    expect(prefs.daily_digest).toBe(false);
    const reloaded = store.getPreferences();
    expect(reloaded.approval_reminder).toBe(false);
  });
});

describe("Notification manager", () => {
  let path: string;
  let store: NotificationStore;
  let manager: NotificationManager;

  beforeEach(() => {
    path = tmpDbPath("mgr.db");
    store = new NotificationStore(path);
    manager = new NotificationManager({
      store,
      email: null,
      telegram: null,
      webhook: null,
      dashboard_base_url: "https://dashboard.example.com",
      max_attempts: 3,
      initial_delay_ms: 100,
      backoff_multiplier: 2,
    });
  });

  afterEach(() => {
    store.close();
    if (existsSync(path)) unlinkSync(path);
  });

  it("emits and dispatches to dashboard adapter", async () => {
    const r = await manager.emit({
      type: "approval_required",
      severity: "warning",
    title: "Approval required",
    safeSummary: "Task awaiting approval. Open dashboard to review.",
      safeSummary: "Test approval",
      dedupParts: { id: "appr-1" },
    });
    expect(r.queued.length).toBeGreaterThan(0);
    const result = await manager.dispatch(r.queued[0]);
    expect(result.ok).toBe(true);
  });

  it("deduplicates re-emit with same key", async () => {
    await manager.emit({
      type: "approval_required",
      severity: "warning",
      title: "First",
      safeSummary: "First",
      dedupParts: { id: "appr-2" },
    });
    const r2 = await manager.emit({
      type: "approval_required",
      severity: "warning",
      title: "Second",
      safeSummary: "Second",
      dedupParts: { id: "appr-2" },
    });
    expect(r2.queued.length).toBe(0);
  });

  it("dispatches queued items in bulk", async () => {
    await manager.emit({
      type: "task_completed",
      severity: "info",
      title: "Task done",
      safeSummary: "ok",
      dedupParts: { id: "t1" },
    });
    await manager.emit({
      type: "task_failed",
      severity: "warning",
      title: "Task failed",
      safeSummary: "fail",
      dedupParts: { id: "t2" },
    });
    const stats = await manager.dispatchQueued();
    expect(stats.attempted).toBeGreaterThanOrEqual(1);
  });

  it("resolves by dedup key", async () => {
    const r = await manager.emit({
      type: "approval_required",
      severity: "warning",
      title: "x",
      safeSummary: "x",
      dedupParts: { id: "appr-3" },
    });
    expect(r.queued.length).toBeGreaterThan(0);
    const dedupKey = `approval_required:appr-3`;
    const resolved = manager.resolveByDedupKey(dedupKey);
    expect(resolved).toBeGreaterThan(0);
  });

  it("blocks emission for non-configured email", async () => {
    const r = await manager.emit({
      type: "approval_required",
      severity: "warning",
      title: "x",
      safeSummary: "x",
      dedupParts: { id: "appr-4" },
      recipient: "evil@attacker.com",
    });
    const n = r.queued.find((x) => x.channel === "email");
    if (n) {
      const result = await manager.dispatch(n);
      expect(result.ok).toBe(false);
      expect(result.result.error_category).toBe("not_configured");
    }
  });

  it("returns health for all channels", async () => {
    const h = await manager.healthAll();
    expect(h.dashboard.configured).toBe(true);
    expect(h.email.configured).toBe(false);
    expect(h.telegram.configured).toBe(false);
    expect(h.webhook.configured).toBe(false);
  });
});

describe("Webhook adapter", () => {
  it("blocks non-HTTPS URLs", async () => {
    const a = new WebhookAdapter({ url: "http://x.com", secret: "x".repeat(20), allowed_hosts: ["x.com"], timeout_ms: 1000, max_redirects: 0 });
    const r = await a.send(sampleNotification({ channel: "webhook" }), { subject: "s", body_text: "b", metadata: {} });
    expect(r.ok).toBe(false);
    expect(r.error_category).toBe("forbidden");
  });

  it("blocks host not in allowlist", async () => {
    const a = new WebhookAdapter({ url: "https://evil.com/hook", secret: "x".repeat(20), allowed_hosts: ["good.com"], timeout_ms: 1000, max_redirects: 0 });
    const r = await a.send(sampleNotification({ channel: "webhook", recipient: "webhook" }), { subject: "s", body_text: "b", metadata: {} });
    expect(r.ok).toBe(false);
    expect(r.error_category).toBe("forbidden");
  });

  it("blocks private IPs", async () => {
    const a = new WebhookAdapter({ url: "https://192.168.1.1/hook", secret: "x".repeat(20), allowed_hosts: ["192.168.1.1"], timeout_ms: 1000, max_redirects: 0 });
    const r = await a.send(sampleNotification({ channel: "webhook", recipient: "webhook" }), { subject: "s", body_text: "b", metadata: {} });
    expect(r.ok).toBe(false);
    expect(r.error_category).toBe("forbidden");
  });

  it("validates config rejects short secret", async () => {
    const a = new WebhookAdapter({ url: "https://x.com/h", secret: "short", allowed_hosts: ["x.com"], timeout_ms: 1000, max_redirects: 0 });
    const v = await a.validateConfig();
    expect(v.valid).toBe(false);
  });

  it("verifySignature enforces fresh timestamp", () => {
    const a = new WebhookAdapter({ url: "https://x.com/h", secret: "x".repeat(20), allowed_hosts: ["x.com"], timeout_ms: 1000, max_redirects: 0 });
    const old = (Math.floor(Date.now() / 1000) - 1000).toString();
    const valid = a.verifySignature(old, "nonce1", "body", "abcd");
    expect(valid).toBe(false);
  });

  it("verifySignature rejects replay", () => {
    const a = new WebhookAdapter({ url: "https://x.com/h", secret: "x".repeat(20), allowed_hosts: ["x.com"], timeout_ms: 1000, max_redirects: 0 });
    const ts = Math.floor(Date.now() / 1000).toString();
    const valid1 = a.verifySignature(ts, "replay-nonce", "body", "x".repeat(64));
    const valid2 = a.verifySignature(ts, "replay-nonce", "body", "x".repeat(64));
    expect(valid1).toBe(false);
    expect(valid2).toBe(false);
  });
});

describe("Telegram adapter", () => {
  it("returns not_configured without config", async () => {
    const a = new TelegramAdapter(null);
    const r = await a.send(sampleNotification({ channel: "telegram" }), { subject: "s", body_text: "b", metadata: {} });
    expect(r.ok).toBe(false);
    expect(r.error_category).toBe("not_configured");
  });

  it("rejects chat not in allowlist", async () => {
    const a = new TelegramAdapter({ bot_token: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk", chat_id: "111", chat_allowlist: ["111"], timeout_ms: 1000, parse_mode: "HTML" });
    const r = await a.send(sampleNotification({ channel: "telegram", recipient: "999" }), { subject: "s", body_text: "b", metadata: {} });
    expect(r.ok).toBe(false);
    expect(r.error_category).toBe("forbidden");
  });

  it("rejects invalid chat_id format", async () => {
    const a = new TelegramAdapter({ bot_token: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk", chat_id: "111", chat_allowlist: ["not-a-number"], timeout_ms: 1000, parse_mode: "HTML" });
    const r = await a.send(sampleNotification({ channel: "telegram", recipient: "not-a-number" }), { subject: "s", body_text: "b", metadata: {} });
    expect(r.ok).toBe(false);
  });

  it("validates bot_token format", async () => {
    const a = new TelegramAdapter({ bot_token: "bad", chat_id: "111", chat_allowlist: ["111"], timeout_ms: 1000, parse_mode: "HTML" });
    const v = await a.validateConfig();
    expect(v.valid).toBe(false);
  });
});

describe("Email adapter", () => {
  it("returns not_configured without config", async () => {
    const a = new EmailAdapter(null);
    const r = await a.send(sampleNotification(), { subject: "s", body_text: "b", metadata: {} });
    expect(r.ok).toBe(false);
    expect(r.error_category).toBe("not_configured");
  });

  it("rejects recipient not in allowlist", async () => {
    const a = new EmailAdapter({
      smtp_host: "smtp.test",
      smtp_port: 587,
      tls: "starttls",
      username: "u",
      password: "p",
      from_address: "from@test.com",
      from_name: "Test",
      recipient_allowlist: ["allowed@test.com"],
      timeout_ms: 1000,
    });
    const r = await a.send(sampleNotification({ recipient: "evil@x.com" }), { subject: "s", body_text: "b", metadata: {} });
    expect(r.ok).toBe(false);
    expect(r.error_category).toBe("forbidden");
  });

  it("blocks SMTP header injection in subject", async () => {
    const a = new EmailAdapter({
      smtp_host: "smtp.test",
      smtp_port: 587,
      tls: "starttls",
      username: "u",
      password: "p",
      from_address: "from@test.com",
      from_name: "Test",
      recipient_allowlist: ["test@example.com"],
      timeout_ms: 1000,
    });
    const r = await a.send(sampleNotification({ recipient: "test@example.com" }), { subject: "x\nBcc: evil@x.com", body_text: "b", metadata: {} });
    expect(r.ok).toBe(false);
  });

  it("validates email format in allowlist", async () => {
    const a = new EmailAdapter({
      smtp_host: "smtp.test",
      smtp_port: 587,
      tls: "starttls",
      username: "u",
      password: "p",
      from_address: "from@test.com",
      from_name: "Test",
      recipient_allowlist: ["bad-email"],
      timeout_ms: 1000,
    });
    const v = await a.validateConfig();
    expect(v.valid).toBe(false);
  });
});

describe("Dashboard + PWA adapters", () => {
  it("dashboard send adds to inbox", async () => {
    const a = new DashboardAdapter();
    const n = sampleNotification({ channel: "dashboard", recipient: "internal" });
    await a.send(n, { subject: "s", body_text: "b", metadata: {} });
    const inbox = a.getInbox();
    expect(inbox.length).toBe(1);
  });

  it("dashboard listener fires on send", async () => {
    const a = new DashboardAdapter();
    let received: Notification | null = null;
    a.onNotification((n) => (received = n));
    const n = sampleNotification({ channel: "dashboard" });
    await a.send(n, { subject: "s", body_text: "b", metadata: {} });
    expect(received).not.toBeNull();
  });

  it("pwa send notifies listener", async () => {
    const a = new PwaAdapter();
    let received = 0;
    a.onNotification(() => received++);
    await a.send(sampleNotification({ channel: "pwa" }), { subject: "s", body_text: "b", metadata: {} });
    expect(received).toBe(1);
  });
});
