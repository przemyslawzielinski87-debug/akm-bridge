/**
 * Core scheduler engine for OpenCode.
 * Checks due schedules, validates preconditions, creates tasks, and manages lifecycle.
 */

import { EventEmitter } from "events";
import { ScheduleStore, type Schedule, type ScheduleRun } from "./schedule-store.js";
import { getNextRun } from "./cron-parser.js";
import { parseInterval } from "./interval-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerEngine {
  start(): void;
  stop(): void;
  tick(): Promise<TickResult>;
  getDueSchedules(): Schedule[];
  createTaskForSchedule(schedule: Schedule): Promise<string | null>;
  calculateNextRun(schedule: Schedule): Date | null;
  handleRunComplete(
    scheduleId: string,
    runId: string,
    status: string,
    result?: RunResult,
  ): void;
  getStatus(): SchedulerStatus;
}

export interface TickResult {
  checked: number;
  due: number;
  executed: number;
  skipped: number;
  failed: number;
  autoPaused: number;
}

export interface RunResult {
  token_input?: number;
  token_output?: number;
  token_cached?: number;
  tool_calls?: number;
  duration_ms?: number;
  result_summary?: string;
}

export interface SchedulerStatus {
  running: boolean;
  tickInterval: number;
  lastTickAt: string | null;
  totalTicks: number;
  uptimeSeconds: number;
}

export interface SchedulerEvents {
  "schedule:executed": (data: {
    scheduleId: string;
    runId: string;
    taskId: string;
  }) => void;
  "schedule:skipped": (data: {
    scheduleId: string;
    reason: string;
  }) => void;
  "schedule:failed": (data: {
    scheduleId: string;
    runId: string;
    error: string;
  }) => void;
  "schedule:auto_paused": (data: {
    scheduleId: string;
    consecutiveFailures: number;
  }) => void;
  "schedule:next_run": (data: {
    scheduleId: string;
    nextRunAt: string;
  }) => void;
  "scheduler:tick": (result: TickResult) => void;
  "scheduler:started": () => void;
  "scheduler:stopped": () => void;
  notification: (data: {
    scheduleId: string;
    severity: string;
    title: string;
    body: string;
  }) => void;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const DEFAULT_TICK_INTERVAL_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const CURRENT_DATE_KEY = "current";

export class SchedulerEngineImpl
  extends EventEmitter
  implements SchedulerEngine
{
  private store: ScheduleStore;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickInterval: number;
  private lastTickAt: string | null = null;
  private totalTicks = 0;
  private startedAt: number = 0;

  private getDueSchedulesFn: () => Schedule[];
  private createTaskFn: (schedule: Schedule) => Promise<string | null>;

  constructor(opts: {
    store: ScheduleStore;
    tickIntervalMs?: number;
    getDueSchedules?: () => Schedule[];
    createTask?: (schedule: Schedule) => Promise<string | null>;
  }) {
    super();
    this.store = opts.store;
    this.tickInterval = opts.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.getDueSchedulesFn =
      opts.getDueSchedules ?? (() => this.store.listEnabledDueSchedules(new Date().toISOString()));
    this.createTaskFn = opts.createTask ?? (async () => null);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();

    this.tickTimer = setInterval(() => {
      this.tick().catch((err) => {
        this.emit("notification", {
          scheduleId: "",
          severity: "critical",
          title: "Scheduler tick error",
          body: String(err),
        });
      });
    }, this.tickInterval);

    this.emit("scheduler:started");
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.emit("scheduler:stopped");
  }

  getStatus(): SchedulerStatus {
    return {
      running: this.running,
      tickInterval: this.tickInterval,
      lastTickAt: this.lastTickAt,
      totalTicks: this.totalTicks,
      uptimeSeconds: this.running
        ? Math.floor((Date.now() - this.startedAt) / 1000)
        : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  async tick(): Promise<TickResult> {
    const result: TickResult = {
      checked: 0,
      due: 0,
      executed: 0,
      skipped: 0,
      failed: 0,
      autoPaused: 0,
    };

    this.lastTickAt = new Date().toISOString();
    this.totalTicks++;

    const now = new Date();
    const today = this.getDateStr(now);
    this.store.resetDailyCounters(today);

    const schedules = this.getDueSchedulesFn();
    result.checked = schedules.length;
    result.due = schedules.length;

    for (const schedule of schedules) {
      try {
        const outcome = await this.processSchedule(schedule, today);
        switch (outcome) {
          case "executed":
            result.executed++;
            break;
          case "skipped":
            result.skipped++;
            break;
          case "failed":
            result.failed++;
            break;
          case "auto_paused":
            result.autoPaused++;
            break;
        }
      } catch (err) {
        result.failed++;
        this.emit("schedule:failed", {
          scheduleId: schedule.id,
          runId: "",
          error: String(err),
        });
      }
    }

    this.emit("scheduler:tick", result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Schedule processing
  // -------------------------------------------------------------------------

  private async processSchedule(
    schedule: Schedule,
    today: string,
  ): Promise<"executed" | "skipped" | "failed" | "auto_paused"> {
    if (!this.checkPreconditions(schedule)) {
      const nextRun = this.calculateNextRun(schedule);
      if (nextRun) {
        this.store.updateSchedule(schedule.id, {
          next_run_at: nextRun.toISOString(),
        });
      }
      return "skipped";
    }

    if (this.isInMaintenanceWindow(schedule)) {
      const nextRun = this.calculateNextRun(schedule);
      if (nextRun) {
        this.store.updateSchedule(schedule.id, {
          next_run_at: nextRun.toISOString(),
        });
      }
      this.emit("schedule:skipped", {
        scheduleId: schedule.id,
        reason: "maintenance_window",
      });
      return "skipped";
    }

    if (schedule.total_runs_today >= schedule.max_runs_per_day) {
      const nextRun = this.calculateNextRun(schedule);
      if (nextRun) {
        this.store.updateSchedule(schedule.id, {
          next_run_at: nextRun.toISOString(),
        });
      }
      this.emit("schedule:skipped", {
        scheduleId: schedule.id,
        reason: "max_runs_per_day",
      });
      return "skipped";
    }

    if (schedule.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
      this.store.updateSchedule(schedule.id, {
        enabled: 0,
      });
      this.emit("schedule:auto_paused", {
        scheduleId: schedule.id,
        consecutiveFailures: schedule.consecutive_failures,
      });
      this.emit("notification", {
        scheduleId: schedule.id,
        severity: "critical",
        title: `Schedule auto-paused: ${schedule.name}`,
        body: `Schedule "${schedule.name}" has been auto-paused after ${schedule.consecutive_failures} consecutive failures.`,
      });
      return "auto_paused";
    }

    const pendingRuns = this.store.getPendingRuns(schedule.id);
    if (pendingRuns.length > 0) {
      if (schedule.concurrency_policy === "skip") {
        const nextRun = this.calculateNextRun(schedule);
        if (nextRun) {
          this.store.updateSchedule(schedule.id, {
            next_run_at: nextRun.toISOString(),
          });
        }
        return "skipped";
      }
      if (schedule.concurrency_policy === "replace") {
        for (const run of pendingRuns) {
          this.store.updateRun(run.id, { status: "skipped" as any, skip_reason: "replaced" });
        }
      }
    }

    const attempt = this.calculateAttemptNumber(schedule);
    const plannedAt = schedule.next_run_at ?? new Date().toISOString();
    const run = this.store.createRun(schedule.id, plannedAt, attempt);

    this.store.updateRun(run.id, {
      status: "running",
      started_at: new Date().toISOString(),
    });

    this.store.updateSchedule(schedule.id, {
      last_run_at: new Date().toISOString(),
    });

    this.store.incrementDailyCounter(schedule.id, today);

    const taskId = await this.createTaskForSchedule(schedule);

    if (!taskId) {
      this.store.updateRun(run.id, {
        status: "failed",
        finished_at: new Date().toISOString(),
        result_summary: "Failed to create task",
      });
      this.handleFailure(schedule, run.id);
      this.emit("schedule:failed", {
        scheduleId: schedule.id,
        runId: run.id,
        error: "Failed to create task in queue",
      });
      return "failed";
    }

    this.store.updateRun(run.id, { task_id: taskId });

    const nextRun = this.calculateNextRun(schedule);
    if (nextRun) {
      this.store.updateSchedule(schedule.id, {
        next_run_at: nextRun.toISOString(),
      });
      this.emit("schedule:next_run", {
        scheduleId: schedule.id,
        nextRunAt: nextRun.toISOString(),
      });
    }

    this.emit("schedule:executed", {
      scheduleId: schedule.id,
      runId: run.id,
      taskId,
    });

    return "executed";
  }

  // -------------------------------------------------------------------------
  // Preconditions
  // -------------------------------------------------------------------------

  private checkPreconditions(schedule: Schedule): boolean {
    if (schedule.read_only === 0 && schedule.approval_policy === "never_write") {
      return false;
    }

    if (this.isDisasterRestoreActive()) {
      return false;
    }

    if (this.isUpdatePromotionActive()) {
      return false;
    }

    if (this.isProjectLocked(schedule.project)) {
      return false;
    }

    return true;
  }

  private isDisasterRestoreActive(): boolean {
    return false;
  }

  private isUpdatePromotionActive(): boolean {
    return false;
  }

  private isProjectLocked(_project: string): boolean {
    return false;
  }

  // -------------------------------------------------------------------------
  // Maintenance window
  // -------------------------------------------------------------------------

  private isInMaintenanceWindow(schedule: Schedule): boolean {
    if (!schedule.maintenance_window_start || !schedule.maintenance_window_end) {
      return false;
    }

    const now = new Date();
    const tzTime = this.formatTimeInTimezone(now, schedule.timezone);
    const currentSeconds = this.timeToSeconds(tzTime);
    const startSeconds = this.timeToSeconds(schedule.maintenance_window_start);
    const endSeconds = this.timeToSeconds(schedule.maintenance_window_end);

    if (startSeconds <= endSeconds) {
      return currentSeconds >= startSeconds && currentSeconds <= endSeconds;
    }
    return currentSeconds >= startSeconds || currentSeconds <= endSeconds;
  }

  // -------------------------------------------------------------------------
  // Run completion
  // -------------------------------------------------------------------------

  handleRunComplete(
    scheduleId: string,
    runId: string,
    status: string,
    result?: RunResult,
  ): void {
    const schedule = this.store.getSchedule(scheduleId);
    if (!schedule) return;

    const finishedAt = new Date().toISOString();
    const updates: Partial<ScheduleRun> = {
      status: status as ScheduleRun["status"],
      finished_at: finishedAt,
    };

    if (result) {
      updates.token_input = result.token_input ?? 0;
      updates.token_output = result.token_output ?? 0;
      updates.token_cached = result.token_cached ?? 0;
      updates.tool_calls = result.tool_calls ?? 0;
      updates.duration_ms = result.duration_ms ?? 0;
      updates.result_summary = result.result_summary ?? null;
    }

    this.store.updateRun(runId, updates);

    if (status === "completed") {
      this.store.updateSchedule(scheduleId, {
        consecutive_failures: 0,
        last_status: "completed",
      });
    } else if (status === "failed") {
      this.handleFailure(schedule, runId);
    }
  }

  // -------------------------------------------------------------------------
  // Task creation
  // -------------------------------------------------------------------------

  async createTaskForSchedule(schedule: Schedule): Promise<string | null> {
    return this.createTaskFn(schedule);
  }

  // -------------------------------------------------------------------------
  // Next run calculation
  // -------------------------------------------------------------------------

  calculateNextRun(schedule: Schedule): Date | null {
    if (schedule.schedule_type === "once") {
      return null;
    }

    if (schedule.schedule_type === "cron") {
      const from = schedule.last_run_at
        ? new Date(schedule.last_run_at)
        : new Date();
      return getNextRun(schedule.schedule_expression, schedule.timezone, from);
    }

    if (schedule.schedule_type === "interval") {
      const result = parseInterval(schedule.schedule_expression);
      if (!result.valid) return null;

      const lastRun = schedule.last_run_at
        ? new Date(schedule.last_run_at)
        : new Date();
      return new Date(lastRun.getTime() + result.seconds * 1000);
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private handleFailure(schedule: Schedule, runId: string): void {
    const newFailures = schedule.consecutive_failures + 1;
    this.store.updateSchedule(schedule.id, {
      consecutive_failures: newFailures,
      last_status: "failed",
    });

    if (schedule.retry_max_attempts > 0) {
      const run = this.store.getRun(runId);
      if (run && run.attempt <= schedule.retry_max_attempts) {
        const delay = schedule.retry_initial_delay_seconds *
          Math.pow(schedule.retry_backoff_multiplier, run.attempt - 1);
        const retryAt = new Date(Date.now() + delay * 1000);
        this.store.updateSchedule(schedule.id, {
          next_run_at: retryAt.toISOString(),
        });
      }
    }
  }

  private calculateAttemptNumber(schedule: Schedule): number {
    const pendingRuns = this.store.getPendingRuns(schedule.id);
    if (pendingRuns.length === 0) return 1;
    const maxAttempt = Math.max(...pendingRuns.map((r) => r.attempt));
    return maxAttempt + 1;
  }

  private getDueSchedules(): Schedule[] {
    return this.store.listEnabledDueSchedules(new Date().toISOString());
  }

  private getDateStr(date: Date): string {
    return date.toISOString().split("T")[0]!;
  }

  private formatTimeInTimezone(date: Date, timezone: string): string {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return formatter.format(date);
  }

  private timeToSeconds(time: string): number {
    const [h, m] = time.split(":").map(Number);
    return (h ?? 0) * 3600 + (m ?? 0) * 60;
  }

  // -------------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------------

  on<K extends keyof SchedulerEvents>(
    event: K,
    listener: SchedulerEvents[K],
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof SchedulerEvents>(
    event: K,
    ...args: Parameters<SchedulerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}
