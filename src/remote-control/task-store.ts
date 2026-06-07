import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

// ── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 2

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'dashboard',
      project TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'local',
      project_id TEXT,
      agent TEXT,
      command TEXT,
      prompt_summary TEXT NOT NULL,
      full_prompt TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      priority TEXT NOT NULL DEFAULT 'normal',
      session_id TEXT,
      started_at TEXT,
      finished_at TEXT,
      token_input INTEGER DEFAULT 0,
      token_output INTEGER DEFAULT 0,
      token_cached INTEGER DEFAULT 0,
      result_summary TEXT,
      error TEXT,
      idempotency_key TEXT UNIQUE,
      project_lock TEXT
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      operation_class TEXT NOT NULL,
      tool TEXT NOT NULL,
      safe_summary TEXT NOT NULL,
      risk TEXT,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decision_by TEXT,
      decision_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      path TEXT NOT NULL,
      checksum TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      session_id TEXT,
      action TEXT NOT NULL,
      task_id TEXT,
      agent TEXT,
      detail TEXT,
      ip_address TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
    CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_approvals_task_id ON approvals(task_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_task_id ON artifacts(task_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
  `,

  2: `
    ALTER TABLE tasks ADD COLUMN environment TEXT NOT NULL DEFAULT 'local';
    ALTER TABLE tasks ADD COLUMN project_id TEXT;

    CREATE TABLE IF NOT EXISTS project_profiles (
      profile_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      synced_at TEXT NOT NULL,
      checksum TEXT
    );
  `,
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface Task {
  id: string
  created_at: string
  created_by: string
  project: string
  environment: string
  project_id: string | null
  agent: string | null
  command: string | null
  prompt_summary: string
  full_prompt: string | null
  status: string
  priority: string
  session_id: string | null
  started_at: string | null
  finished_at: string | null
  token_input: number
  token_output: number
  token_cached: number
  result_summary: string | null
  error: string | null
  idempotency_key: string | null
  project_lock: string | null
}

export interface Approval {
  id: string
  task_id: string
  agent: string
  operation_class: string
  tool: string
  safe_summary: string
  risk: string | null
  requested_at: string
  expires_at: string
  status: string
  decision_by: string | null
  decision_at: string | null
}

export interface TaskEvent {
  id: number
  task_id: string
  event_type: string
  summary: string
  created_at: string
}

export interface Artifact {
  id: string
  task_id: string
  name: string
  mime_type: string | null
  size: number | null
  path: string
  checksum: string | null
  created_at: string
}

export interface AuditEntry {
  id: number
  timestamp: string
  session_id: string | null
  action: string
  task_id: string | null
  agent: string | null
  detail: string | null
  ip_address: string | null
}

// ── Store ───────────────────────────────────────────────────────────────────

const RETENTION = {
  tasks: 30 * 24 * 3600 * 1000,
  events: 14 * 24 * 3600 * 1000,
  artifacts: 7 * 24 * 3600 * 1000,
  approvals: 90 * 24 * 3600 * 1000,
}

export class TaskStore {
  private db: Database
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(dbPath?: string) {
    const dataDir = dbPath
      ? join(dbPath, '..')
      : join(process.env.HOME ?? '/root', '.config', 'akm-bridge', 'data')

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    const filePath = dbPath ?? join(dataDir, 'remote-tasks.db')
    this.db = new Database(filePath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')

    chmodSync(filePath, 0o600)

    this.migrate()
    this.startRetentionCleanup()
  }

  // ── Migration ──────────────────────────────────────────────────────────

  private migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT)')
    const currentVersion = this.db
      .query('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
      .get() as { version: number } | null

    const startVersion = currentVersion?.version ?? 0

    for (let v = startVersion + 1; v <= SCHEMA_VERSION; v++) {
      const sql = MIGRATIONS[v]
      if (!sql) continue
      this.db.exec(sql)
      this.db
        .query('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
        .run(v, new Date().toISOString())
    }
  }

  // ── Tasks ──────────────────────────────────────────────────────────────

  createTask(t: {
    id: string
    project: string
    prompt_summary: string
    full_prompt?: string
    agent?: string
    command?: string
    priority?: string
    created_by?: string
    idempotency_key?: string
    project_lock?: string
    environment?: string
    project_id?: string
  }): Task {
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT INTO tasks (id, created_at, created_by, project, environment, project_id, agent, command,
         prompt_summary, full_prompt, status, priority, idempotency_key, project_lock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
      )
      .run(
        t.id,
        now,
        t.created_by ?? 'dashboard',
        t.project,
        t.environment ?? 'local',
        t.project_id ?? null,
        t.agent ?? null,
        t.command ?? null,
        t.prompt_summary,
        t.full_prompt ?? null,
        t.priority ?? 'normal',
        t.idempotency_key ?? null,
        t.project_lock ?? null
      )
    return this.getTask(t.id)!
  }

  getTask(id: string): Task | null {
    return (
      (this.db.query('SELECT * FROM tasks WHERE id = ?').get(id) as Task) ?? null
    )
  }

  updateTask(
    id: string,
    patch: Partial<
      Pick<
        Task,
        | 'status'
        | 'agent'
        | 'session_id'
        | 'started_at'
        | 'finished_at'
        | 'token_input'
        | 'token_output'
        | 'token_cached'
        | 'result_summary'
        | 'error'
        | 'project_lock'
      >
    >
  ): void {
    const keys = Object.keys(patch).filter((k) => k !== 'id')
    if (keys.length === 0) return
    const sets = keys.map((k) => `${k} = ?`).join(', ')
    const vals = keys.map((k) => (patch as Record<string, unknown>)[k])
    this.db.query(`UPDATE tasks SET ${sets} WHERE id = ?`).run(...vals, id)
  }

  listTasks(opts: {
    status?: string
    project?: string
    environment?: string
    project_id?: string
    limit?: number
    offset?: number
  } = {}): Task[] {
    const where: string[] = []
    const params: unknown[] = []

    if (opts.status) {
      where.push('status = ?')
      params.push(opts.status)
    }
    if (opts.project) {
      where.push('project = ?')
      params.push(opts.project)
    }
    if (opts.environment) {
      where.push('environment = ?')
      params.push(opts.environment)
    }
    if (opts.project_id) {
      where.push('project_id = ?')
      params.push(opts.project_id)
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    return this.db
      .query(
        `SELECT * FROM tasks ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Task[]
  }

  nextQueuedTask(): Task | null {
    return (
      (this.db
        .query(
          `SELECT * FROM tasks WHERE status = 'queued'
           ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
           WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 2 END, created_at ASC
           LIMIT 1`
        )
        .get() as Task) ?? null
    )
  }

  // ── Approvals ──────────────────────────────────────────────────────────

  createApproval(a: {
    id: string
    task_id: string
    agent: string
    operation_class: string
    tool: string
    safe_summary: string
    risk?: string
    expires_in_ms?: number
  }): Approval {
    const now = new Date().toISOString()
    const expires = new Date(
      Date.now() + (a.expires_in_ms ?? 600_000)
    ).toISOString()

    this.db
      .query(
        `INSERT INTO approvals (id, task_id, agent, operation_class, tool,
         safe_summary, risk, requested_at, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(a.id, a.task_id, a.agent, a.operation_class, a.tool, a.safe_summary, a.risk ?? null, now, expires)

    return this.getApproval(a.id)!
  }

  getApproval(id: string): Approval | null {
    return (
      (this.db
        .query('SELECT * FROM approvals WHERE id = ?')
        .get(id) as Approval) ?? null
    )
  }

  pendingApprovals(taskId?: string): Approval[] {
    if (taskId) {
      return this.db
        .query(
          `SELECT * FROM approvals WHERE task_id = ? AND status = 'pending'
           AND expires_at > ?`
        )
        .all(taskId, new Date().toISOString()) as Approval[]
    }
    return this.db
      .query(
        `SELECT * FROM approvals WHERE status = 'pending' AND expires_at > ?`
      )
      .all(new Date().toISOString()) as Approval[]
  }

  decideApproval(
    id: string,
    decision: 'approved' | 'rejected',
    by: string
  ): void {
    this.db
      .query(
        `UPDATE approvals SET status = ?, decision_by = ?, decision_at = ? WHERE id = ?`
      )
      .run(decision, by, new Date().toISOString(), id)
  }

  expireStaleApprovals(): number {
    const result = this.db
      .query(
        `UPDATE approvals SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`
      )
      .run(new Date().toISOString())
    return result.changes
  }

  // ── Events ─────────────────────────────────────────────────────────────

  addEvent(taskId: string, eventType: string, summary: string): void {
    this.db
      .query(
        `INSERT INTO events (task_id, event_type, summary, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(taskId, eventType, summary, new Date().toISOString())
  }

  listEvents(taskId: string, limit = 100): TaskEvent[] {
    return this.db
      .query(
        `SELECT * FROM events WHERE task_id = ? ORDER BY created_at ASC LIMIT ?`
      )
      .all(taskId, limit) as TaskEvent[]
  }

  // ── Artifacts ──────────────────────────────────────────────────────────

  addArtifact(a: {
    id: string
    task_id: string
    name: string
    mime_type?: string
    size?: number
    path: string
    checksum?: string
  }): Artifact {
    this.db
      .query(
        `INSERT INTO artifacts (id, task_id, name, mime_type, size, path, checksum, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        a.id,
        a.task_id,
        a.name,
        a.mime_type ?? null,
        a.size ?? null,
        a.path,
        a.checksum ?? null,
        new Date().toISOString()
      )
    return this.getArtifact(a.id)!
  }

  getArtifact(id: string): Artifact | null {
    return (
      (this.db
        .query('SELECT * FROM artifacts WHERE id = ?')
        .get(id) as Artifact) ?? null
    )
  }

  // ── Audit Log ──────────────────────────────────────────────────────────

  audit(entry: {
    session_id?: string
    action: string
    task_id?: string
    agent?: string
    detail?: string
    ip_address?: string
  }): void {
    this.db
      .query(
        `INSERT INTO audit_log (timestamp, session_id, action, task_id, agent, detail, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        entry.session_id ?? null,
        entry.action,
        entry.task_id ?? null,
        entry.agent ?? null,
        entry.detail ?? null,
        entry.ip_address ?? null
      )
  }

  // ── Retention Cleanup ──────────────────────────────────────────────────

  private startRetentionCleanup() {
    this.cleanupInterval = setInterval(() => this.runRetention(), 3600_000)
  }

  runRetention(): { tasks: number; events: number; artifacts: number; approvals: number } {
    const now = Date.now()

    const cutoffTasks = new Date(now - RETENTION.tasks).toISOString()
    const tasks = this.db
      .query(
        `DELETE FROM tasks WHERE created_at < ? AND status IN ('completed', 'failed', 'cancelled')`
      )
      .run(cutoffTasks).changes

    const cutoffEvents = new Date(now - RETENTION.events).toISOString()
    const events = this.db
      .query(`DELETE FROM events WHERE created_at < ?`)
      .run(cutoffEvents).changes

    const cutoffArtifacts = new Date(now - RETENTION.artifacts).toISOString()
    const artifacts = this.db
      .query(`DELETE FROM artifacts WHERE created_at < ?`)
      .run(cutoffArtifacts).changes

    const cutoffApprovals = new Date(now - RETENTION.approvals).toISOString()
    const approvals = this.db
      .query(
        `DELETE FROM approvals WHERE expires_at < ? AND status IN ('approved', 'rejected', 'expired')`
      )
      .run(cutoffApprovals).changes

    return { tasks, events, artifacts, approvals }
  }

  close(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval)
    this.db.close()
  }
}
