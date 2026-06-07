/**
 * Schedule validation for OpenCode scheduler.
 * Validates creation and update payloads.
 */

import { parseCron } from "./cron-parser.js";
import { parseInterval } from "./interval-parser.js";
import type { Schedule, ApprovalPolicy, ScheduleType } from "./schedule-store.js";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const VALID_SCHEDULE_TYPES: ScheduleType[] = ["once", "interval", "cron"];
const VALID_APPROVAL_POLICIES: ApprovalPolicy[] = [
  "never_write",
  "per_run",
  "preapproved_limited",
];
const VALID_PRIORITIES = ["low", "normal", "high", "critical"];

const DANGEROUS_PATTERNS = [
  /\b(eval|exec|system|spawn|popen)\b/i,
  /\b(rm\s+-rf|del\s+\/[sfq]|format\s+[a-z]:)\b/i,
  /DROP\s+TABLE/i,
  /DELETE\s+FROM/i,
  /TRUNCATE/i,
  /--\s*$/,
  /;\s*DROP/i,
  /;\s*DELETE/i,
  /\b(sudo|chmod\s+777|chown)\b/i,
];

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /gho_[a-zA-Z0-9]{36}/,
  /xox[bpsa]-[a-zA-Z0-9-]+/,
  /AKIA[A-Z0-9]{16}/,
  /Bearer\s+[a-zA-Z0-9._-]{20,}/,
  /password\s*[:=]\s*\S{8,}/i,
  /secret\s*[:=]\s*\S{8,}/i,
  /api[_-]?key\s*[:=]\s*\S{8,}/i,
  /token\s*[:=]\s*\S{20,}/i,
];

const MAX_NAME_LENGTH = 100;
const MAX_PROMPT_LENGTH = 50000;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_MAINTENANCE_WINDOW_SECONDS = 86400;

export function validateScheduleCreate(
  input: Partial<Schedule>,
  allowedProjects: string[],
  allowedAgents: string[] = [],
  preapprovedScheduleIds: string[] = [],
): ValidationResult {
  const errors: ValidationError[] = [];

  validateCommonFields(input, errors, allowedProjects, allowedAgents);

  if (input.schedule_type === "cron" && input.schedule_expression) {
    const result = parseCron(input.schedule_expression);
    if (!result.valid) {
      for (const err of result.errors) {
        errors.push({ field: "schedule_expression", message: err });
      }
    }
  }

  if (input.schedule_type === "interval" && input.schedule_expression) {
    const result = parseInterval(input.schedule_expression);
    if (!result.valid) {
      for (const err of result.errors) {
        errors.push({ field: "schedule_expression", message: err });
      }
    }
  }

  if (
    input.schedule_type === "once" &&
    input.schedule_expression &&
    input.schedule_expression !== "now"
  ) {
    const date = new Date(input.schedule_expression);
    if (isNaN(date.getTime())) {
      errors.push({
        field: "schedule_expression",
        message: `Invalid date: "${input.schedule_expression}"`,
      });
    } else if (date.getTime() <= Date.now()) {
      errors.push({
        field: "schedule_expression",
        message: "Once schedule must be in the future",
      });
    }
  }

  if (
    input.read_only === 0 &&
    input.approval_policy === "preapproved_limited"
  ) {
    const id = input.id ?? "";
    if (!preapprovedScheduleIds.includes(id)) {
      errors.push({
        field: "approval_policy",
        message:
          "preapproved_limited requires explicit allowlist entry for non-read-only schedules",
      });
    }
  }

  if (
    input.read_only === 0 &&
    input.approval_policy === "never_write"
  ) {
    errors.push({
      field: "approval_policy",
      message:
        "Non-read-only schedules require approval_policy of per_run or preapproved_limited",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateScheduleUpdate(
  id: string,
  input: Partial<Schedule>,
  existing: Schedule,
  allowedProjects: string[],
  allowedAgents: string[] = [],
  preapprovedScheduleIds: string[] = [],
): ValidationResult {
  const errors: ValidationError[] = [];

  if (input.name !== undefined) {
    if (!input.name || input.name.trim().length === 0) {
      errors.push({ field: "name", message: "Name cannot be empty" });
    } else if (input.name.length > MAX_NAME_LENGTH) {
      errors.push({
        field: "name",
        message: `Name exceeds ${MAX_NAME_LENGTH} characters`,
      });
    }
  }

  if (input.project !== undefined) {
    if (!allowedProjects.includes(input.project)) {
      errors.push({
        field: "project",
        message: `Project "${input.project}" is not on the allowlist`,
      });
    }
  }

  if (input.agent !== undefined && input.agent !== null) {
    if (allowedAgents.length > 0 && !allowedAgents.includes(input.agent)) {
      errors.push({
        field: "agent",
        message: `Agent "${input.agent}" is not valid`,
      });
    }
  }

  if (input.schedule_type !== undefined) {
    if (!VALID_SCHEDULE_TYPES.includes(input.schedule_type)) {
      errors.push({
        field: "schedule_type",
        message: `Invalid schedule type: "${input.schedule_type}"`,
      });
    }
  }

  if (input.schedule_expression !== undefined && input.schedule_type) {
    if (input.schedule_type === "cron") {
      const result = parseCron(input.schedule_expression);
      if (!result.valid) {
        for (const err of result.errors) {
          errors.push({ field: "schedule_expression", message: err });
        }
      }
    } else if (input.schedule_type === "interval") {
      const result = parseInterval(input.schedule_expression);
      if (!result.valid) {
        for (const err of result.errors) {
          errors.push({ field: "schedule_expression", message: err });
        }
      }
    }
  }

  if (input.prompt_template !== undefined) {
    if (input.prompt_template.length > MAX_PROMPT_LENGTH) {
      errors.push({
        field: "prompt_template",
        message: `Prompt template exceeds ${MAX_PROMPT_LENGTH} characters`,
      });
    }
    const secretErrors = detectSecrets(input.prompt_template);
    for (const msg of secretErrors) {
      errors.push({ field: "prompt_template", message: msg });
    }
    const dangerousErrors = detectDangerous(input.prompt_template);
    for (const msg of dangerousErrors) {
      errors.push({ field: "prompt_template", message: msg });
    }
  }

  if (input.approval_policy !== undefined) {
    if (!VALID_APPROVAL_POLICIES.includes(input.approval_policy)) {
      errors.push({
        field: "approval_policy",
        message: `Invalid approval policy: "${input.approval_policy}"`,
      });
    }
  }

  if (input.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(input.priority)) {
      errors.push({
        field: "priority",
        message: `Invalid priority: "${input.priority}"`,
      });
    }
  }

  if (input.retry_max_attempts !== undefined) {
    if (input.retry_max_attempts < 0) {
      errors.push({
        field: "retry_max_attempts",
        message: "retry_max_attempts cannot be negative",
      });
    }
    if (input.retry_max_attempts > MAX_RETRY_ATTEMPTS) {
      errors.push({
        field: "retry_max_attempts",
        message: `retry_max_attempts cannot exceed ${MAX_RETRY_ATTEMPTS}`,
      });
    }
  }

  if (input.max_duration_seconds !== undefined) {
    if (input.max_duration_seconds <= 0) {
      errors.push({
        field: "max_duration_seconds",
        message: "max_duration_seconds must be positive",
      });
    }
  }

  if (input.max_input_tokens !== undefined) {
    if (input.max_input_tokens <= 0) {
      errors.push({
        field: "max_input_tokens",
        message: "max_input_tokens must be positive",
      });
    }
  }

  if (input.max_output_tokens !== undefined) {
    if (input.max_output_tokens <= 0) {
      errors.push({
        field: "max_output_tokens",
        message: "max_output_tokens must be positive",
      });
    }
  }

  if (input.max_tool_calls !== undefined) {
    if (input.max_tool_calls <= 0) {
      errors.push({
        field: "max_tool_calls",
        message: "max_tool_calls must be positive",
      });
    }
  }

  if (input.max_runs_per_day !== undefined) {
    if (input.max_runs_per_day <= 0) {
      errors.push({
        field: "max_runs_per_day",
        message: "max_runs_per_day must be positive",
      });
    }
  }

  if (input.max_cost_estimate !== undefined) {
    if (input.max_cost_estimate < 0) {
      errors.push({
        field: "max_cost_estimate",
        message: "max_cost_estimate cannot be negative",
      });
    }
  }

  if (input.maintenance_window_start !== undefined && input.maintenance_window_start !== null) {
    if (!isValidTime(input.maintenance_window_start)) {
      errors.push({
        field: "maintenance_window_start",
        message: `Invalid time format: "${input.maintenance_window_start}". Use HH:MM`,
      });
    }
  }

  if (input.maintenance_window_end !== undefined && input.maintenance_window_end !== null) {
    if (!isValidTime(input.maintenance_window_end)) {
      errors.push({
        field: "maintenance_window_end",
        message: `Invalid time format: "${input.maintenance_window_end}". Use HH:MM`,
      });
    }
  }

  const merged = { ...existing, ...input };
  if (
    merged.maintenance_window_start &&
    merged.maintenance_window_end
  ) {
    const start = timeToSeconds(merged.maintenance_window_start);
    const end = timeToSeconds(merged.maintenance_window_end);
    const diff = end > start ? end - start : 86400 - start + end;
    if (diff > MAX_MAINTENANCE_WINDOW_SECONDS) {
      errors.push({
        field: "maintenance_window",
        message: "Maintenance window exceeds 24 hours",
      });
    }
  }

  const readOnly = input.read_only !== undefined ? input.read_only : existing.read_only;
  const approval = input.approval_policy !== undefined
    ? input.approval_policy
    : existing.approval_policy;

  if (readOnly === 0 && approval === "preapproved_limited") {
    if (!preapprovedScheduleIds.includes(id)) {
      errors.push({
        field: "approval_policy",
        message:
          "preapproved_limited requires explicit allowlist entry for non-read-only schedules",
      });
    }
  }

  if (readOnly === 0 && approval === "never_write") {
    errors.push({
      field: "approval_policy",
      message:
        "Non-read-only schedules require approval_policy of per_run or preapproved_limited",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateCommonFields(
  input: Partial<Schedule>,
  errors: ValidationError[],
  allowedProjects: string[],
  allowedAgents: string[],
): void {
  if (!input.name || input.name.trim().length === 0) {
    errors.push({ field: "name", message: "Name is required" });
  } else if (input.name.length > MAX_NAME_LENGTH) {
    errors.push({
      field: "name",
      message: `Name exceeds ${MAX_NAME_LENGTH} characters`,
    });
  }

  if (!input.project) {
    errors.push({ field: "project", message: "Project is required" });
  } else if (!allowedProjects.includes(input.project)) {
    errors.push({
      field: "project",
      message: `Project "${input.project}" is not on the allowlist`,
    });
  }

  if (input.agent !== undefined && input.agent !== null && input.agent !== "") {
    if (allowedAgents.length > 0 && !allowedAgents.includes(input.agent)) {
      errors.push({
        field: "agent",
        message: `Agent "${input.agent}" is not valid`,
      });
    }
  }

  if (!input.prompt_template) {
    errors.push({
      field: "prompt_template",
      message: "Prompt template is required",
    });
  } else {
    if (input.prompt_template.length > MAX_PROMPT_LENGTH) {
      errors.push({
        field: "prompt_template",
        message: `Prompt template exceeds ${MAX_PROMPT_LENGTH} characters`,
      });
    }
    const secrets = detectSecrets(input.prompt_template);
    for (const msg of secrets) {
      errors.push({ field: "prompt_template", message: msg });
    }
    const dangerous = detectDangerous(input.prompt_template);
    for (const msg of dangerous) {
      errors.push({ field: "prompt_template", message: msg });
    }
  }

  if (
    input.schedule_type &&
    !VALID_SCHEDULE_TYPES.includes(input.schedule_type)
  ) {
    errors.push({
      field: "schedule_type",
      message: `Invalid schedule type: "${input.schedule_type}"`,
    });
  }

  if (!input.schedule_expression) {
    errors.push({
      field: "schedule_expression",
      message: "Schedule expression is required",
    });
  }

  if (input.timezone && !isValidTimezone(input.timezone)) {
    errors.push({
      field: "timezone",
      message: `Invalid timezone: "${input.timezone}"`,
    });
  }
}

function detectSecrets(text: string): string[] {
  const errors: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      errors.push("Prompt template appears to contain a secret or API key");
      break;
    }
  }
  return errors;
}

function detectDangerous(text: string): string[] {
  const errors: string[] = [];
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      errors.push(
        "Prompt template contains potentially dangerous instructions",
      );
      break;
    }
  }
  return errors;
}

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidTime(time: string): boolean {
  return /^\d{2}:\d{2}$/.test(time);
}

function timeToSeconds(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60;
}
