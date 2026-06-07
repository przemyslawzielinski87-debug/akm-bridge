import type { NotificationManager } from "./notification-manager.ts";
import { formatNotification } from "./notification-formatter.ts";
import type { NotificationChannel, NotificationType, NotificationSeverity } from "./notification-types.ts";

export interface NotificationApiDeps {
  manager: NotificationManager;
  requireAuth: (req: Request) => unknown | null;
  csrfCheck: (req: Request) => { valid: boolean; error?: string };
  recordAudit: (action: string, target: string, outcome: string) => void;
  isAllowedOrigin: (origin: string | null) => boolean;
  securityHeaders: () => Record<string, string>;
  corsHeaders: (origin: string | null) => Record<string, string>;
  errorResponse: (msg: string, status: number, req: Request) => Response;
  okResponse: (data: unknown, req: Request) => Response;
  rateLimit: (ip: string, key: string, limit: number, windowMs: number) => boolean;
  logRequest: (method: string, path: string, status: number, ip: string) => void;
}

const TEST_RATE_LIMIT = 3;
const TEST_WINDOW_MS = 60_000;

export function buildNotificationRoutes(deps: NotificationApiDeps) {
  const { manager, requireAuth, csrfCheck, recordAudit, isAllowedOrigin, securityHeaders, corsHeaders, errorResponse, okResponse, rateLimit, logRequest } = deps;

  async function handleGetNotifications(req: Request, url: URL, ip: string): Promise<Response> {
    const session = requireAuth(req);
    if (!session) return errorResponse("Unauthorized", 401, req);
    const status = url.searchParams.get("status") as NotificationChannel | null;
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const list = manager.list({ status: (status as never) || undefined, limit });
    return okResponse({ notifications: list, count: list.length }, req);
  }

  async function handleGetPreferences(req: Request, ip: string): Promise<Response> {
    const session = requireAuth(req);
    if (!session) return errorResponse("Unauthorized", 401, req);
    return okResponse({ preferences: manager.getPreferences() }, req);
  }

  async function handlePutPreferences(req: Request, ip: string): Promise<Response> {
    const session = requireAuth(req);
    if (!session) return errorResponse("Unauthorized", 401, req);
    const csrf = csrfCheck(req);
    if (!csrf.valid) return errorResponse(csrf.error || "CSRF failed", 403, req);
    let body: { preferences?: Record<string, unknown> };
    try {
      body = (await req.json()) as { preferences?: Record<string, unknown> };
    } catch {
      return errorResponse("Invalid JSON", 400, req);
    }
    if (!body.preferences) return errorResponse("preferences required", 400, req);
    const allowedKeys = new Set([
      "enabled_channels",
      "severity_threshold",
      "quiet_hours_start",
      "quiet_hours_end",
      "timezone",
      "daily_digest",
      "weekly_digest",
      "approval_notifications",
      "approval_reminder",
      "task_completion_notifications",
      "task_failure_notifications",
      "recovery_notifications",
      "scheduler_notifications",
      "update_notifications",
      "dr_notifications",
    ]);
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.preferences)) {
      if (!allowedKeys.has(k)) continue;
      if (k === "enabled_channels" && Array.isArray(v)) {
        filtered[k] = v.filter((c): c is NotificationChannel => ["dashboard", "pwa", "email", "telegram", "webhook"].includes(c as string));
      } else {
        filtered[k] = v;
      }
    }
    const saved = manager.savePreferences(filtered as never);
    recordAudit("notifications.preferences.update", "self", "ok");
    return okResponse({ preferences: saved }, req);
  }

  async function handleGetChannels(req: Request, ip: string): Promise<Response> {
    const session = requireAuth(req);
    if (!session) return errorResponse("Unauthorized", 401, req);
    return okResponse({ channels: manager.configSummaryAll(), health: await manager.healthAll() }, req);
  }

  async function handlePostTest(req: Request, ip: string): Promise<Response> {
    const session = requireAuth(req);
    if (!session) return errorResponse("Unauthorized", 401, req);
    const csrf = csrfCheck(req);
    if (!csrf.valid) return errorResponse(csrf.error || "CSRF failed", 403, req);
    if (!rateLimit(ip, "notif_test", TEST_RATE_LIMIT, TEST_WINDOW_MS)) {
      return errorResponse("Rate limit exceeded", 429, req);
    }
    let body: { channel?: string; recipient?: string };
    try {
      body = (await req.json()) as { channel?: string; recipient?: string };
    } catch {
      return errorResponse("Invalid JSON", 400, req);
    }
    const allowedChannels: NotificationChannel[] = ["dashboard", "pwa", "email", "telegram", "webhook"];
    const channel = (body.channel || "dashboard") as NotificationChannel;
    if (!allowedChannels.includes(channel)) return errorResponse("Invalid channel", 400, req);
    const result = await manager.emit({
      type: "test",
      severity: "info",
      title: "Test notification",
      safeSummary: "This is a test notification from OpenCode dashboard.",
      dedupParts: { id: `test-${Date.now()}` },
      recipient: body.recipient,
    });
    recordAudit("notifications.test", channel, result.queued.length > 0 ? "queued" : "suppressed");
    return okResponse({ queued: result.queued.length, suppressed: result.suppressed }, req);
  }

  async function handleGetDeliveries(req: Request, url: URL, ip: string): Promise<Response> {
    const session = requireAuth(req);
    if (!session) return errorResponse("Unauthorized", 401, req);
    const id = url.searchParams.get("id");
    if (!id) return errorResponse("id required", 400, req);
    const deliveries = manager.getDeliveries(id);
    return okResponse({ deliveries }, req);
  }

  async function handlePostAcknowledge(req: Request, url: URL, ip: string): Promise<Response> {
    const session = requireAuth(req);
    if (!session) return errorResponse("Unauthorized", 401, req);
    const csrf = csrfCheck(req);
    if (!csrf.valid) return errorResponse(csrf.error || "CSRF failed", 403, req);
    const id = url.pathname.split("/").slice(-2, -1)[0];
    if (!id) return errorResponse("id required", 400, req);
    recordAudit("notifications.acknowledge", id, "ok");
    return okResponse({ acknowledged: id }, req);
  }

  async function handleGetStatus(req: Request, ip: string): Promise<Response> {
    const session = requireAuth(req);
    if (!session) return errorResponse("Unauthorized", 401, req);
    return okResponse(
      {
        counts: manager.countByStatus(),
        health: await manager.healthAll(),
        channels: manager.configSummaryAll(),
        preferences: manager.getPreferences(),
      },
      req,
    );
  }

  return {
    handleGetNotifications,
    handleGetPreferences,
    handlePutPreferences,
    handleGetChannels,
    handlePostTest,
    handleGetDeliveries,
    handlePostAcknowledge,
    handleGetStatus,
  };
}

export function tryFormatNotification(notification: Parameters<typeof formatNotification>[0], baseUrl: string) {
  return formatNotification(notification, baseUrl);
}
