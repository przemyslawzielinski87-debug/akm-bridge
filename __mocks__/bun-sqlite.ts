/**
 * In-memory SQLite mock for vitest.
 * Implements the minimal bun:sqlite API needed by ScheduleStore.
 * Supports persistence via shared state map when same path is reused.
 */

interface MockRow {
  [key: string]: unknown;
}

// Shared state keyed by path for persistence across instances
const SHARED_DB: Map<string, Map<string, MockRow[]>> = new Map();

export function __resetSharedDB(): void {
  SHARED_DB.clear();
}

class MockQuery {
  private sql: string;
  private db: MockDatabase;

  constructor(sql: string, db: MockDatabase) {
    this.sql = sql;
    this.db = db;
  }

  get(...params: unknown[]): MockRow | undefined {
    return this.db._queryOne(this.sql, params);
  }

  all(...params: unknown[]): MockRow[] {
    return this.db._queryAll(this.sql, params);
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    return this.db._run(this.sql, params);
  }
}

class MockDatabase {
  private tables: Map<string, MockRow[]>;
  private dbPath: string;

  constructor(public path: string) {
    this.dbPath = path;
    if (!SHARED_DB.has(path)) {
      const initial = new Map<string, MockRow[]>();
      initial.set('schedules', []);
      initial.set('schedule_runs', []);
      initial.set('notification_deliveries', []);
      initial.set('schema_meta', []);
      SHARED_DB.set(path, initial);
    }
    this.tables = SHARED_DB.get(path)!;
  }

  exec(sql: string): void {
    // No-op for PRAGMA, CREATE TABLE, CREATE INDEX, BEGIN, COMMIT, ROLLBACK
  }

  query(sql: string): MockQuery {
    return new MockQuery(sql, this);
  }

  close(): void {
    // Don't clear shared state — persistence is the point
  }

  _queryOne(sql: string, params: unknown[]): MockRow | undefined {
    const results = this._queryAll(sql, params);
    return results[0];
  }

  _queryAll(sql: string, params: unknown[]): MockRow[] {
    const upperSql = sql.toUpperCase().trim();

    // SELECT COUNT(*) ... FROM schedules
    if (upperSql.includes('SELECT COUNT(*)') && upperSql.includes('FROM SCHEDULES')) {
      let rows = (this.tables.get('schedules') ?? []).filter(
        r => r.deleted_at === null || r.deleted_at === undefined
      );
      if (upperSql.includes('AND ENABLED = 1'))
        rows = rows.filter(r => r.enabled === 1);
      if (upperSql.includes('CONSECUTIVE_FAILURES >= 3'))
        rows = rows.filter(r => (r.consecutive_failures as number) >= 3);
      if (upperSql.includes('COALESCE(SUM')) {
        return [{ c: rows.reduce((s, r) => s + ((r.total_runs_today as number) || 0), 0) }];
      }
      return [{ c: rows.length }];
    }

    // SELECT value FROM schema_meta WHERE key = ?
    if (upperSql.includes('SELECT VALUE FROM SCHEMA_META')) {
      return (this.tables.get('schema_meta') ?? []).filter(r => r.key === params[0]);
    }

    // SELECT * FROM schedules WHERE id = ? AND deleted_at IS NULL
    if (upperSql.includes('SELECT * FROM SCHEDULES') && upperSql.includes('WHERE ID = ?')) {
      return (this.tables.get('schedules') ?? []).filter(
        r => r.id === params[0] && (r.deleted_at === null || r.deleted_at === undefined)
      );
    }

    // SELECT * FROM schedules WHERE deleted_at IS NULL (with optional filters)
    if (upperSql.includes('SELECT * FROM SCHEDULES') && upperSql.includes('DELETED_AT IS NULL')) {
      let rows = (this.tables.get('schedules') ?? []).filter(
        r => r.deleted_at === null || r.deleted_at === undefined
      );
      // Filter by enabled + next_run_at for listEnabledDueSchedules
      if (upperSql.includes('AND ENABLED = 1') && upperSql.includes('NEXT_RUN_AT')) {
        const now = params[0] as string;
        rows = rows.filter(r =>
          r.enabled === 1 && r.next_run_at !== null && (r.next_run_at as string) <= now
        );
      } else if (upperSql.includes('AND PROJECT = ?')) {
        rows = rows.filter(r => r.project === params[0]);
      }
      if (upperSql.includes('ORDER BY NEXT_RUN_AT ASC'))
        rows.sort((a, b) => String(a.next_run_at).localeCompare(String(b.next_run_at)));
      else if (upperSql.includes('ORDER BY CREATED_AT DESC'))
        rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return rows;
    }

    // SELECT * FROM schedule_runs WHERE id = ?
    if (upperSql.includes('SELECT * FROM SCHEDULE_RUNS') && upperSql.includes('WHERE ID = ?')) {
      return (this.tables.get('schedule_runs') ?? []).filter(r => r.id === params[0]);
    }

    // SELECT * FROM schedule_runs WHERE schedule_id = ?
    if (upperSql.includes('SELECT * FROM SCHEDULE_RUNS') && upperSql.includes('SCHEDULE_ID = ?')) {
      let filtered = (this.tables.get('schedule_runs') ?? []).filter(
        r => r.schedule_id === params[0]
      );
      // Filter by status IN ('pending', 'running')
      if (upperSql.includes('STATUS IN')) {
        filtered = filtered.filter(r => r.status === 'pending' || r.status === 'running');
      }
      if (upperSql.includes('ORDER BY CREATED_AT DESC'))
        filtered.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      if (upperSql.includes('LIMIT ?')) {
        const limit = params[params.length - 1] as number;
        filtered = filtered.slice(0, limit);
      }
      return filtered;
    }

    // SELECT * FROM notification_deliveries WHERE read_at IS NULL
    if (upperSql.includes('NOTIFICATION_DELIVERIES') && upperSql.includes('READ_AT IS NULL')) {
      let filtered = (this.tables.get('notification_deliveries') ?? []).filter(
        r => r.read_at === null
      );
      if (upperSql.includes('AND SCHEDULE_ID = ?'))
        filtered = filtered.filter(r => r.schedule_id === params[0]);
      if (upperSql.includes('LIMIT ?')) {
        const limit = params[params.length - 1] as number;
        filtered = filtered.slice(0, limit);
      }
      return filtered;
    }

    return [];
  }

  _run(sql: string, params: unknown[]): { changes: number; lastInsertRowid: number } {
    const upperSql = sql.toUpperCase().trim();

    // INSERT INTO schedules
    if (upperSql.includes('INSERT INTO SCHEDULES')) {
      const fields = [
        'id', 'name', 'description', 'owner', 'project', 'agent', 'command', 'prompt_template',
        'schedule_type', 'schedule_expression', 'timezone', 'enabled', 'read_only',
        'approval_policy', 'priority', 'max_duration_seconds', 'max_input_tokens',
        'max_output_tokens', 'max_tool_calls', 'max_runs_per_day', 'max_cost_estimate',
        'concurrency_policy', 'misfire_policy', 'max_catch_up', 'retry_max_attempts',
        'retry_initial_delay_seconds', 'retry_backoff_multiplier',
        'maintenance_window_start', 'maintenance_window_end',
        'last_run_at', 'next_run_at', 'last_status', 'consecutive_failures',
        'total_runs_today', 'runs_today_date', 'created_at', 'updated_at', 'deleted_at',
      ];
      const row: MockRow = {};
      params.forEach((val, i) => { if (i < fields.length) row[fields[i]] = val; });
      this.tables.get('schedules')!.push(row);
      return { changes: 1, lastInsertRowid: 0 };
    }

    // INSERT INTO schedule_runs
    if (upperSql.includes('INSERT INTO SCHEDULE_RUNS')) {
      const fields = [
        'id', 'schedule_id', 'task_id', 'planned_at', 'started_at', 'finished_at',
        'status', 'skip_reason', 'attempt', 'duration_ms', 'token_input', 'token_output',
        'token_cached', 'tool_calls', 'approval_wait_ms', 'result_summary', 'created_at',
      ];
      const row: MockRow = {};
      params.forEach((val, i) => { if (i < fields.length) row[fields[i]] = val; });
      this.tables.get('schedule_runs')!.push(row);
      return { changes: 1, lastInsertRowid: 0 };
    }

    // INSERT INTO notification_deliveries
    if (upperSql.includes('INSERT INTO NOTIFICATION_DELIVERIES')) {
      const fields = ['schedule_id', 'task_id', 'channel', 'severity', 'title', 'body', 'created_at'];
      const row: MockRow = {};
      params.forEach((val, i) => { if (i < fields.length) row[fields[i]] = val; });
      const runs = this.tables.get('notification_deliveries')!;
      row.id = runs.length + 1;
      runs.push(row);
      return { changes: 1, lastInsertRowid: row.id as number };
    }

    // INSERT OR REPLACE INTO schema_meta
    if (upperSql.includes('INSERT OR REPLACE INTO SCHEMA_META')) {
      const rows = this.tables.get('schema_meta')!;
      const [key, value] = params as [string, string];
      const idx = rows.findIndex(r => r.key === key);
      if (idx >= 0) rows[idx].value = value;
      else rows.push({ key, value });
      return { changes: 1, lastInsertRowid: 0 };
    }

    // UPDATE schedules SET ... WHERE id = ?
    if (upperSql.includes('UPDATE SCHEDULES SET')) {
      return this._updateTable('schedules', sql, params);
    }

    // UPDATE schedule_runs SET ... WHERE id = ?
    if (upperSql.includes('UPDATE SCHEDULE_RUNS SET')) {
      return this._updateTable('schedule_runs', sql, params);
    }

    // UPDATE notification_deliveries SET ...
    if (upperSql.includes('UPDATE NOTIFICATION_DELIVERIES SET')) {
      return this._updateTable('notification_deliveries', sql, params);
    }

    return { changes: 0, lastInsertRowid: 0 };
  }

  private _updateTable(table: string, sql: string, params: unknown[]): { changes: number; lastInsertRowid: number } {
    const rows = this.tables.get(table)!;
    const idParam = params[params.length - 1];

    // Extract SET assignments: "field1 = ?, field2 = ?"
    const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is);
    if (!setMatch) return { changes: 0, lastInsertRowid: 0 };

    const setClause = setMatch[1];
    const assignments = setClause.split(',').map(s => s.trim());

    let changes = 0;
    for (const row of rows) {
      if (String(row.id) === String(idParam)) {
        let paramIdx = 0;
        for (const assignment of assignments) {
          const eqIdx = assignment.indexOf('=');
          if (eqIdx === -1) continue;
          const fieldName = assignment.substring(0, eqIdx).trim().toLowerCase();
          const rhs = assignment.substring(eqIdx + 1).trim();

          // Handle arithmetic expressions like "total_runs_today = total_runs_today + 1"
          if (rhs.includes(fieldName) && (rhs.includes('+') || rhs.includes('-'))) {
            const addMatch = rhs.match(new RegExp(fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\+\\s*(\\d+)'));
            if (addMatch) {
              row[fieldName] = ((row[fieldName] as number) || 0) + parseInt(addMatch[1], 10);
              continue;
            }
            const subMatch = rhs.match(new RegExp(fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*-\\s*(\\d+)'));
            if (subMatch) {
              row[fieldName] = ((row[fieldName] as number) || 0) - parseInt(subMatch[1], 10);
              continue;
            }
          }

          // Parameterized value
          if (paramIdx < params.length - 1) {
            row[fieldName] = params[paramIdx];
            paramIdx++;
          }
        }
        changes++;
        break;
      }
    }
    return { changes, lastInsertRowid: 0 };
  }
}

export { MockDatabase as Database };
