/**
 * Interval expression parser for OpenCode scheduler.
 * Supports: 5m, 1h, 24h, 1d, 30s, raw numbers (minutes).
 */

export interface IntervalParseResult {
  valid: boolean;
  seconds: number;
  errors: string[];
}

const MIN_SECONDS = 60;
const MAX_SECONDS = 365 * 24 * 60 * 60;

export function parseInterval(
  expression: string,
  minSeconds: number = MIN_SECONDS,
  maxSeconds: number = MAX_SECONDS,
): IntervalParseResult {
  const trimmed = expression.trim();
  const errors: string[] = [];

  if (!trimmed) {
    return { valid: false, seconds: 0, errors: ["Empty interval expression"] };
  }

  let seconds: number;

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i);
  if (match) {
    const value = parseFloat(match[1]!);
    const unit = match[2]!.toLowerCase();

    switch (unit) {
      case "s":
        seconds = value;
        break;
      case "m":
        seconds = value * 60;
        break;
      case "h":
        seconds = value * 3600;
        break;
      case "d":
        seconds = value * 86400;
        break;
      default:
        errors.push(`Unknown unit: ${unit}`);
        return { valid: false, seconds: 0, errors };
    }
  } else if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    seconds = parseFloat(trimmed) * 60;
  } else {
    return {
      valid: false,
      seconds: 0,
      errors: [
        `Invalid interval format: "${trimmed}". Use: 30s, 5m, 1h, 1d, or raw number (minutes)`,
      ],
    };
  }

  if (!Number.isFinite(seconds) || seconds < 0) {
    errors.push("Interval must be a positive number");
    return { valid: false, seconds: 0, errors };
  }

  if (seconds < minSeconds) {
    errors.push(
      `Interval ${seconds}s is below minimum of ${minSeconds}s (${Math.ceil(minSeconds / 60)}m)`,
    );
  }

  if (seconds > maxSeconds) {
    const days = Math.floor(maxSeconds / 86400);
    errors.push(`Interval ${seconds}s exceeds maximum of ${maxSeconds}s (${days}d)`);
  }

  return {
    valid: errors.length === 0,
    seconds,
    errors,
  };
}
