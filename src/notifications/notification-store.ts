import type {
  Notification,
  NotificationChannel,
  NotificationDelivery,
  NotificationPreferences,
  NotificationStatus,
  NotificationType,
  NotificationSeverity,
} from "./notification-types.ts";
import { DEFAULT_PREFERENCES } from "./notification-types.ts";

const SCHEMA_VERSION = 1;

type QueryRow = {
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => { changes: number; lastInsertRowid?: number | bigint };
};

type Database = {
  exec: (sql: string) => void;
  prepare: (sql: string) => QueryRow;
  run: (sql: string, ...params: unknown[]) => { changes: number };
  close: () => void;
};

export class NotificationStore {
  getLastSuccess(channel: string): string | undefined {
    const result = this.db.prepare(
      'SELECT finished_at FROM notification_deliveries WHERE channel = ? AND status = ? ORDER BY finished_at DESC LIMIT 1'
    ).get(channel, 'delivered') as { finished_at: string } | undefined;
    return result?.finished_at;
  }

  getLastFailure(channel: string): string | undefined {
    const result = this.db.prepare(
      'SELECT finished_at FROM notification_deliveries WHERE channel = ? AND status = ? ORDER BY finished_at DESC LIMIT 1'
    ).get(channel, 'failed') as { finished_at: string } | undefined;
    return result?.finished_at;
  }
  private db: Database;

  constructor(dbPath: string) {
    // Lazy-require bun:sqlite so it works under both bun test and jest
    // (jest needs the .js path to skip .ts-extension detection)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DatabaseCtor = loadBunSqlite();
    this.db = new DatabaseCtor(dbPath) as Database;
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    const row = this.db.prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get() as
      | { version: number }
      | null;
    const current = row?.version ?? 0;
    if (current < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          severity TEXT NOT NULL,
          channel TEXT NOT NULL,
          recipient TEXT NOT NULL,
          task_id TEXT,
          approval_id TEXT,
          schedule_id TEXT,
          title TEXT NOT NULL,
          safe_summary TEXT NOT NULL,
          deep_link TEXT,
          created_at TEXT NOT NULL,
          expires_at TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          attempts INTEGER NOT NULL DEFAULT 0,
          deduplication_key TEXT NOT NULL,
          metadata TEXT NOT NULL DEFAULT '{}',
          UNIQUE(deduplication_key, channel)
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_dedup ON notifications(deduplication_key);

        CREATE TABLE IF NOT EXISTS notification_deliveries (
          id TEXT PRIMARY KEY,
          notification_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL,
          error_category TEXT,
          provider_message_id TEXT,
          FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_deliveries_notification ON notification_deliveries(notification_id);

        CREATE TABLE IF NOT EXISTS notification_preferences (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          preferences TEXT NOT NULL
        );
      `);
      this.db.prepare("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)").run(SCHEMA_VERSION, new Date().toISOString());
    }
  }

  createNotification(input: Omit<Notification, "id" | "createdAt" | "attempts" | "status"> & {
    status?: NotificationStatus;
  }): Notification {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const status: NotificationStatus = input.status ?? "queued";
    try {
      this.db
        .prepare(
          `INSERT INTO notifications (
            id, type, severity, channel, recipient, task_id, approval_id, schedule_id,
            title, safe_summary, deep_link, created_at, expires_at, status, attempts,
            deduplication_key, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          id,
          input.type,
          input.severity,
          input.channel,
          input.recipient,
          input.taskId,
          input.approvalId,
          input.scheduleId,
          input.title || '',
          input.safeSummary || '',
          input.deepLink,
          createdAt,
          input.expiresAt,
          status,
          input.deduplicationKey,
          JSON.stringify(input.metadata),
        );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("UNIQUE")) {
        const existing = this.findByDedup(input.deduplicationKey, input.channel);
        if (existing) return existing;
      }
      throw e;
    }
    return {
      ...input,
      id,
      createdAt,
      status,
      attempts: 0,
    };
  }

  findByDedup(dedupKey: string, channel: NotificationChannel): Notification | null {
    const row = this.db
      .prepare("SELECT * FROM notifications WHERE deduplication_key = ? AND channel = ? LIMIT 1")
      .get(dedupKey, channel) as NotificationRow | null;
    return row ? this.mapRow(row) : null;
  }

  get(id: string): Notification | null {
    try {
      const stmt = this.db.prepare("SELECT * FROM notifications WHERE id = ?");
      const row = stmt.get(id) as NotificationRow | null;
      if (!row) return null;
      
      // Debug logging for test investigation
      if (process.env.NODE_ENV === 'test') {
        console.log('Retrieved notification row:', JSON.stringify(row, null, 2));
        console.log('SQL:', stmt.toString());
        
        // Verify DB state
        const allRows = this.db.prepare("SELECT id, title FROM notifications").all() as Array<{id: string, title: string}>;
        console.log('All notifications in DB:', allRows);
      }
      
      return this.mapRow(row);
    } catch (e) {
      if (process.env.NODE_ENV === 'test') {
        console.error('Error in get:', e);
      }
      throw e;
    }
  }

  count(filter: { status?: NotificationStatus } = {}): number {
    let sql = "SELECT COUNT(*) as count FROM notifications";
    const params: unknown[] = [];
    if (filter.status) {
      sql += " WHERE status = ?";
      params.push(filter.status);
    }
    const row = this.db.prepare(sql).get(...params) as { count: number };
    return row.count;
  }

  list(filter: { status?: NotificationStatus; limit?: number } = {}): Notification[] {
    let sql = "SELECT * FROM notifications";
    const params: unknown[] = [];
    if (filter.status) {
      sql += " WHERE status = ?";
      params.push(filter.status);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(filter.limit ?? 100);
    const rows = this.db.prepare(sql).all(...params) as NotificationRow[];
    return rows.map((r) => this.mapRow(r));
  }

  updateStatus(id: string, status: NotificationStatus): void {
    this.db.prepare("UPDATE notifications SET status = ? WHERE id = ?").run(status, id);
  }

  markResolvedByDedup(dedupKey: string): number {
    const result = this.db
      .prepare("UPDATE notifications SET status = 'resolved' WHERE deduplication_key = ? AND status IN ('queued','sending')")
      .run(dedupKey);
    return Number(result.changes ?? 0);
  }

  incrementAttempts(id: string): void {
    this.db.prepare("UPDATE notifications SET attempts = attempts + 1 WHERE id = ?").run(id);
  }

  recordDelivery(delivery: Omit<NotificationDelivery, "id">): NotificationDelivery {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO notification_deliveries (
          id, notification_id, channel, attempt, started_at, finished_at, status, error_category, provider_message_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        delivery.notification_id,
        delivery.channel,
        delivery.attempt,
        delivery.started_at,
        delivery.finished_at,
        delivery.status,
        delivery.error_category,
        delivery.provider_message_id,
      );
    return { id, ...delivery };
  }

  getDeliveries(notificationId: string): NotificationDelivery[] {
    const rows = this.db
      .prepare("SELECT * FROM notification_deliveries WHERE notification_id = ? ORDER BY started_at")
      .all(notificationId) as NotificationDeliveryRow[];
    return rows.map((r) => this.mapDeliveryRow(r));
  }

  getPreferences(): NotificationPreferences {
    const row = this.db.prepare("SELECT preferences FROM notification_preferences WHERE id = 1").get() as
      | { preferences: string }
      | null;
    if (!row) return { ...DEFAULT_PREFERENCES };
    try {
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(row.preferences) };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  savePreferences(prefs: Partial<NotificationPreferences>): NotificationPreferences {
    const current = this.getPreferences();
    const merged = { ...current, ...prefs };
    this.db
      .prepare("INSERT OR REPLACE INTO notification_preferences (id, preferences) VALUES (1, ?)")
      .run(JSON.stringify(merged));
    return merged;
  }

  countByStatus(): Record<NotificationStatus, number> {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) as count FROM notifications GROUP BY status")
      .all() as Array<{ status: NotificationStatus; count: number }>;
    const result: Record<string, number> = {};
    for (const r of rows) result[r.status] = r.count;
    return result as Record<NotificationStatus, number>;
  }

  private mapRow(row: NotificationRow): Notification {
    return {
      id: row.id,
      type: row.type as NotificationType,
      severity: row.severity as NotificationSeverity,
      channel: row.channel as NotificationChannel,
      recipient: row.recipient,
      taskId: row.task_id,
      approvalId: row.approval_id,
      scheduleId: row.schedule_id,
      title: row.title,
      safeSummary: row.safe_summary,
      deepLink: row.deep_link,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: row.status as NotificationStatus,
      attempts: row.attempts,
      deduplicationKey: row.deduplication_key,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  }

  private mapDeliveryRow(row: NotificationDeliveryRow): NotificationDelivery {
    return {
      id: row.id,
      notification_id: row.notification_id,
      channel: row.channel as NotificationChannel,
      attempt: row.attempt,
      started_at: row.started_at,
      finished_at: row.finished_at,
      status: row.status as NotificationStatus,
      error_category: row.error_category,
      provider_message_id: row.provider_message_id,
    };
  }

  close() {
    if (typeof this.db.close === 'function') {
      this.db.close();
    }
  }
}

function loadBunSqlite(): new (path: string) => unknown {
  try {
    // @ts-ignore - bun:sqlite is a Bun built-in
    const mod = require("bun:sqlite");
    return mod.Database;
  } catch {
    try {
      // @ts-ignore
      const mod = require("bun:sqlite").default || require("bun:sqlite");
      return mod.Database;
    } catch {
      throw new Error("bun:sqlite not available; this module requires Bun runtime");
    }
  }
}

interface NotificationRow {
  id: string;
  type: string;
  severity: string;
  channel: string;
  recipient: string;
  task_id: string | null;
  approval_id: string | null;
  schedule_id: string | null;
  title: string;
  safe_summary: string;
  deep_link: string | null;
  created_at: string;
  expires_at: string | null;
  status: string;
  attempts: number;
  deduplication_key: string;
  metadata: string;
}

interface NotificationDeliveryRow {
  id: string;
  notification_id: string;
  channel: string;
  attempt: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_category: string | null;
  provider_message_id: string | null;
}
