/**
 * SQLite-based schedule store for OpenCode scheduler.
 * Uses bun:sqlite. Extends task-store patterns.
 */

import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleType = "once" | "interval" | "cron";
export type ApprovalPolicy = "never_write" | "per_run" | "preapproved_limited";
export type ConcurrencyPolicy = "skip" | "queue" | "replace";
export type MisfirePolicy = "skip" | "run_once" | "catch_up_limited";
export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "budget_exceeded";
export type NotificationChannel =
  | "dashboard"
  | "pwa"
  | "email"
  | "telegram"
  | "webhook";
export type NotificationSeverity = "info" | "warning" | "critical";
export type SchedulePriority = "low" | "normal" | "high" | "critical";

export interface Schedule {
  id: string;
  name: string;
  description: string;
  owner: string;
  project: string;
  agent: string | null;
  command: string | null;
  prompt_template: string;
  schedule_type: ScheduleType;
  schedule_expression: string;
  timezone: string;
  enabled: number;
  read_only: number;
  approval_policy: ApprovalPolicy;
  priority: SchedulePriority;
  max_duration_seconds: number;
  max_input_tokens: number;
  max_output_tokens: number;
  max_tool_calls: number;
  max_runs_per_day: number;
  max_cost_estimate: number;
  concurrency_policy: ConcurrencyPolicy;
  misfire_policy: MisfirePolicy;
  max_catch_up: number;
  retry_max_attempts: number;
  retry_initial_delay_seconds: number;
  retry_backoff_multiplier: number;
  maintenance_window_start: string | null;
  maintenance_window_end: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  consecutive_failures: number;
  total_runs_today: number;
  runs_today_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ScheduleRun {
  id: string;
  schedule_id: string;
  task_id: string | null;
  planned_at: string;
  started_at: string | null;
  finished_at: string | null;
  status: RunStatus;
  skip_reason: string | null;
  attempt: number;
  duration_ms: number;
  token_input: number;
  token_output: number;
  token_cached: number;
  tool_calls: number;
  approval_wait_ms: number;
  result_summary: string | null;
  created_at: string;
}

export interface NotificationDelivery {
  id: number;
  schedule_id: string | null;
  task_id: string | null;
  channel: NotificationChannel;
  severity: NotificationSeverity;
  title: string;
  body: string;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

type Row = Record<string, unknown>;

function rowToSchedule(row: Row): Schedule {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    owner: row.owner as string,
    project: row.project as string,
    agent: row.agent as string | null,
    command: row.command as string | null,
    prompt_template: row.prompt_template as string,
    schedule_type: row.schedule_type as ScheduleType,
    schedule_expression: row.schedule_expression as string,
    timezone: row.timezone as string,
    enabled: row.enabled as number,
    read_only: row.read_only as number,
    approval_policy: row.approval_policy as ApprovalPolicy,
    priority: (row.priority as SchedulePriority) ?? "normal",
    max_duration_seconds: row.max_duration_seconds as number,
    max_input_tokens: row.max_input_tokens as number,
    max_output_tokens: row.max_output_tokens as number,
    max_tool_calls: row.max_tool_calls as number,
    max_runs_per_day: row.max_runs_per_day as number,
    max_cost_estimate: (row.max_cost_estimate as number) ?? 0,
    concurrency_policy: row.concurrency_policy as ConcurrencyPolicy,
    misfire_policy: row.misfire_policy as MisfirePolicy,
    max_catch_up: row.max_catch_up as number,
    retry_max_attempts: row.retry_max_attempts as number,
    retry_initial_delay_seconds: row.retry_initial_delay_seconds as number,
    retry_backoff_multiplier: row.retry_backoff_multiplier as number,
    maintenance_window_start: row.maintenance_window_start as string | null,
    maintenance_window_end: row.maintenance_window_end as string | null,
    last_run_at: row.last_run_at as string | null,
    next_run_at: row.next_run_at as string | null,
    last_status: row.last_status as string | null,
    consecutive_failures: row.consecutive_failures as number,
    total_runs_today: row.total_runs_today as number,
    runs_today_date: row.runs_today_date as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    deleted_at: row.deleted_at as string | null,
  };
}

function rowToScheduleRun(row: Row): ScheduleRun {
  return {
    id: row.id as string,
    schedule_id: row.schedule_id as string,
    task_id: row.task_id as string | null,
    planned_at: row.planned_at as string,
    started_at: row.started_at as string | null,
    finished_at: row.finished_at as string | null,
    status: row.status as RunStatus,
    skip_reason: row.skip_reason as string | null,
    attempt: row.attempt as number,
    duration_ms: (row.duration_ms as number) ?? 0,
    token_input: (row.token_input as number) ?? 0,
    token_output: (row.token_output as number) ?? 0,
    token_cached: (row.token_cached as number) ?? 0,
    tool_calls: (row.tool_calls as number) ?? 0,
    approval_wait_ms: (row.approval_wait_ms as number) ?? 0,
    result_summary: row.result_summary as string | null,
    created_at: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      owner TEXT NOT NULL DEFAULT 'dashboard',
      project TEXT NOT NULL,
      agent TEXT,
      command TEXT,
      prompt_template TEXT NOT NULL,
      schedule_type TEXT NOT NULL DEFAULT 'once',
      schedule_expression TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Europe/Warsaw',
      enabled INTEGER NOT NULL DEFAULT 1,
      read_only INTEGER NOT NULL DEFAULT 1,
      approval_policy TEXT NOT NULL DEFAULT 'never_write',
      priority TEXT NOT NULL DEFAULT 'normal',
      max_duration_seconds INTEGER NOT NULL DEFAULT 300,
      max_input_tokens INTEGER NOT NULL DEFAULT 100000,
      max_output_tokens INTEGER NOT NULL DEFAULT 50000,
      max_tool_calls INTEGER NOT NULL DEFAULT 50,
      max_runs_per_day INTEGER NOT NULL DEFAULT 24,
      max_cost_estimate REAL DEFAULT 0,
      concurrency_policy TEXT NOT NULL DEFAULT 'skip',
      misfire_policy TEXT NOT NULL DEFAULT 'skip',
      max_catch_up INTEGER NOT NULL DEFAULT 1,
      retry_max_attempts INTEGER NOT NULL DEFAULT 0,
      retry_initial_delay_seconds INTEGER NOT NULL DEFAULT 60,
      retry_backoff_multiplier REAL NOT NULL DEFAULT 2.0,
      maintenance_window_start TEXT,
      maintenance_window_end TEXT,
      last_run_at TEXT,
      next_run_at TEXT,
      last_status TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      total_runs_today INTEGER NOT NULL DEFAULT 0,
      runs_today_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_runs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      task_id TEXT,
      planned_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      skip_reason TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER DEFAULT 0,
      token_input INTEGER DEFAULT 0,
      token_output INTEGER DEFAULT 0,
      token_cached INTEGER DEFAULT 0,
      tool_calls INTEGER DEFAULT 0,
      approval_wait_ms INTEGER DEFAULT 0,
      result_summary TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (schedule_id) REFERENCES schedules(id)
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id TEXT,
      task_id TEXT,
      channel TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_schedules_next_run
      ON schedules(next_run_at) WHERE deleted_at IS NULL AND enabled = 1;
    CREATE INDEX IF NOT EXISTS idx_schedules_project
      ON schedules(project) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule
      ON schedule_runs(schedule_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_runs_status
      ON schedule_runs(status);
    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_schedule
      ON notification_deliveries(schedule_id);
  `,
];

export class ScheduleStore {
  private db: Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  // -------------------------------------------------------------------------
  // Migration
  // -------------------------------------------------------------------------

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const row = this.db
      .query("SELECT value FROM schema_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    const currentVersion = row ? parseInt(row.value, 10) : 0;

    if (currentVersion < SCHEMA_VERSION) {
      this.db.exec("BEGIN TRANSACTION");
      try {
        for (let i = currentVersion; i < SCHEMA_VERSION; i++) {
          const sql = MIGRATIONS[i];
          if (sql) {
            this.db.exec(sql);
          }
        }
        this.db
          .query(
            "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)",
          )
          .run(String(SCHEMA_VERSION));
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Schedules
  // -------------------------------------------------------------------------

  createSchedule(
    input: Omit<Schedule, "id" | "created_at" | "updated_at" | "deleted_at" | "consecutive_failures" | "total_runs_today" | "runs_today_date" | "last_run_at" | "next_run_at" | "last_status">,
  ): Schedule {
    const now = new Date().toISOString();
    const id = randomUUID();
    const schedule: Schedule = {
      ...input,
      id,
      consecutive_failures: 0,
      total_runs_today: 0,
      runs_today_date: null,
      last_run_at: null,
      next_run_at: null,
      last_status: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };

    this.db
      .query(
        `INSERT INTO schedules (
          id, name, description, owner, project, agent, command, prompt_template,
          schedule_type, schedule_expression, timezone, enabled, read_only,
          approval_policy, priority, max_duration_seconds, max_input_tokens,
          max_output_tokens, max_tool_calls, max_runs_per_day, max_cost_estimate,
          concurrency_policy, misfire_policy, max_catch_up, retry_max_attempts,
          retry_initial_delay_seconds, retry_backoff_multiplier,
          maintenance_window_start, maintenance_window_end,
          last_run_at, next_run_at, last_status, consecutive_failures,
          total_runs_today, runs_today_date, created_at, updated_at, deleted_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )`,
      )
      .run(
        schedule.id,
        schedule.name,
        schedule.description,
        schedule.owner,
        schedule.project,
        schedule.agent,
        schedule.command,
        schedule.prompt_template,
        schedule.schedule_type,
        schedule.schedule_expression,
        schedule.timezone,
        schedule.enabled,
        schedule.read_only,
        schedule.approval_policy,
        schedule.priority,
        schedule.max_duration_seconds,
        schedule.max_input_tokens,
        schedule.max_output_tokens,
        schedule.max_tool_calls,
        schedule.max_runs_per_day,
        schedule.max_cost_estimate,
        schedule.concurrency_policy,
        schedule.misfire_policy,
        schedule.max_catch_up,
        schedule.retry_max_attempts,
        schedule.retry_initial_delay_seconds,
        schedule.retry_backoff_multiplier,
        schedule.maintenance_window_start,
        schedule.maintenance_window_end,
        schedule.last_run_at,
        schedule.next_run_at,
        schedule.last_status,
        schedule.consecutive_failures,
        schedule.total_runs_today,
        schedule.runs_today_date,
        schedule.created_at,
        schedule.updated_at,
        schedule.deleted_at,
      );

    return schedule;
  }

  getSchedule(id: string): Schedule | null {
    const row = this.db
      .query("SELECT * FROM schedules WHERE id = ? AND deleted_at IS NULL")
      .get(id) as Row | undefined;
    return row ? rowToSchedule(row) : null;
  }

  listSchedules(project?: string): Schedule[] {
    let query = "SELECT * FROM schedules WHERE deleted_at IS NULL";
    const params: unknown[] = [];

    if (project) {
      query += " AND project = ?";
      params.push(project);
    }

    query += " ORDER BY created_at DESC";
    const rows = this.db.query(query).all(...params) as Row[];
    return rows.map(rowToSchedule);
  }

  listEnabledDueSchedules(now: string): Schedule[] {
    const rows = this.db
      .query(
        `SELECT * FROM schedules
         WHERE deleted_at IS NULL
           AND enabled = 1
           AND next_run_at IS NOT NULL
           AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(now) as Row[];
    return rows.map(rowToSchedule);
  }

  updateSchedule(
    id: string,
    updates: Partial<Omit<Schedule, "id" | "created_at">>,
  ): Schedule | null {
    const existing = this.getSchedule(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const merged = { ...existing, ...updates, updated_at: now };

    const fields = Object.keys(merged).filter(
      (k) => k !== "id" && k !== "created_at",
    );
    const setClause = fields.map((f) => `${f} = ?`).join(", ");
    const values = fields.map((f) => (merged as Record<string, unknown>)[f]);

    this.db.query(`UPDATE schedules SET ${setClause} WHERE id = ?`).run(
      ...values,
      id,
    );

    return this.getSchedule(id);
  }

  softDeleteSchedule(id: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .query(
        "UPDATE schedules SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(now, now, id);
    return (result as { changes: number }).changes > 0;
  }

  // -------------------------------------------------------------------------
  // Daily counter reset
  // -------------------------------------------------------------------------

  resetDailyCounters(today: string): number {
    const result = this.db
      .query(
        `UPDATE schedules
         SET total_runs_today = 0, runs_today_date = ?
         WHERE runs_today_date != ?
           AND deleted_at IS NULL`,
      )
      .run(today, today);
    return (result as { changes: number }).changes;
  }

  incrementDailyCounter(scheduleId: string, today: string): Schedule | null {
    this.db
      .query(
        `UPDATE schedules
         SET total_runs_today = total_runs_today + 1, runs_today_date = ?
         WHERE id = ?`,
      )
      .run(today, scheduleId);
    return this.getSchedule(scheduleId);
  }

  // -------------------------------------------------------------------------
  // Schedule runs
  // -------------------------------------------------------------------------

  createRun(
    scheduleId: string,
    plannedAt: string,
    attempt: number = 1,
  ): ScheduleRun {
    const id = randomUUID();
    const now = new Date().toISOString();
    const run: ScheduleRun = {
      id,
      schedule_id: scheduleId,
      task_id: null,
      planned_at: plannedAt,
      started_at: null,
      finished_at: null,
      status: "pending",
      skip_reason: null,
      attempt,
      duration_ms: 0,
      token_input: 0,
      token_output: 0,
      token_cached: 0,
      tool_calls: 0,
      approval_wait_ms: 0,
      result_summary: null,
      created_at: now,
    };

    this.db
      .query(
        `INSERT INTO schedule_runs (
          id, schedule_id, task_id, planned_at, started_at, finished_at,
          status, skip_reason, attempt, duration_ms, token_input, token_output,
          token_cached, tool_calls, approval_wait_ms, result_summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.schedule_id,
        run.task_id,
        run.planned_at,
        run.started_at,
        run.finished_at,
        run.status,
        run.skip_reason,
        run.attempt,
        run.duration_ms,
        run.token_input,
        run.token_output,
        run.token_cached,
        run.tool_calls,
        run.approval_wait_ms,
        run.result_summary,
        run.created_at,
      );

    return run;
  }

  updateRun(
    runId: string,
    updates: Partial<Omit<ScheduleRun, "id" | "schedule_id" | "created_at">>,
  ): ScheduleRun | null {
    const fields = Object.keys(updates).filter(
      (k) => k !== "id" && k !== "schedule_id" && k !== "created_at",
    );
    if (fields.length === 0) return this.getRun(runId);

    const setClause = fields.map((f) => `${f} = ?`).join(", ");
    const values = fields.map(
      (f) => (updates as Record<string, unknown>)[f],
    );

    this.db
      .query(`UPDATE schedule_runs SET ${setClause} WHERE id = ?`)
      .run(...values, runId);

    return this.getRun(runId);
  }

  getRun(runId: string): ScheduleRun | null {
    const row = this.db
      .query("SELECT * FROM schedule_runs WHERE id = ?")
      .get(runId) as Row | undefined;
    return row ? rowToScheduleRun(row) : null;
  }

  getRunsForSchedule(scheduleId: string, limit: number = 50): ScheduleRun[] {
    const rows = this.db
      .query(
        "SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(scheduleId, limit) as Row[];
    return rows.map(rowToScheduleRun);
  }

  getPendingRuns(scheduleId: string): ScheduleRun[] {
    const rows = this.db
      .query(
        `SELECT * FROM schedule_runs
         WHERE schedule_id = ? AND status IN ('pending', 'running')
         ORDER BY planned_at ASC`,
      )
      .all(scheduleId) as Row[];
    return rows.map(rowToScheduleRun);
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  createNotification(
    input: Omit<NotificationDelivery, "id" | "delivered_at" | "read_at" | "created_at">,
  ): NotificationDelivery {
    const now = new Date().toISOString();

    const result = this.db
      .query(
        `INSERT INTO notification_deliveries (
          schedule_id, task_id, channel, severity, title, body, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.schedule_id,
        input.task_id,
        input.channel,
        input.severity,
        input.title,
        input.body,
        now,
      );

    const id = (result as { lastInsertRowid: number }).lastInsertRowid;
    return {
      id,
      ...input,
      delivered_at: null,
      read_at: null,
      created_at: now,
    };
  }

  markNotificationDelivered(id: number): void {
    this.db
      .query(
        "UPDATE notification_deliveries SET delivered_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), id);
  }

  markNotificationRead(id: number): void {
    this.db
      .query("UPDATE notification_deliveries SET read_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  getUnreadNotifications(
    scheduleId?: string,
    limit: number = 50,
  ): NotificationDelivery[] {
    let query =
      "SELECT * FROM notification_deliveries WHERE read_at IS NULL";
    const params: unknown[] = [];

    if (scheduleId) {
      query += " AND schedule_id = ?";
      params.push(scheduleId);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    return this.db.query(query).all(...params) as NotificationDelivery[];
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(): {
    total: number;
    enabled: number;
    disabled: number;
    totalRunsToday: number;
    failedSchedules: number;
  } {
    const total = (
      this.db
        .query(
          "SELECT COUNT(*) as c FROM schedules WHERE deleted_at IS NULL",
        )
        .get() as { c: number }
    ).c;

    const enabled = (
      this.db
        .query(
          "SELECT COUNT(*) as c FROM schedules WHERE deleted_at IS NULL AND enabled = 1",
        )
        .get() as { c: number }
    ).c;

    const totalRunsToday = (
      this.db
        .query(
          "SELECT COALESCE(SUM(total_runs_today), 0) as c FROM schedules WHERE deleted_at IS NULL",
        )
        .get() as { c: number }
    ).c;

    const failedSchedules = (
      this.db
        .query(
          "SELECT COUNT(*) as c FROM schedules WHERE deleted_at IS NULL AND consecutive_failures >= 3",
        )
        .get() as { c: number }
    ).c;

    return {
      total,
      enabled,
      disabled: total - enabled,
      totalRunsToday,
      failedSchedules,
    };
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
