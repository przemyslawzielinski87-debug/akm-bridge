export enum SliCategory {
  Availability = "availability",
  Latency = "latency",
  Correctness = "correctness",
  Saturation = "saturation",
}

export enum EnvironmentLabel {
  Local = "local",
  Staging = "staging",
  Production = "production",
}

export interface SliDefinition {
  id: string;
  name: string;
  category: SliCategory;
  environments: EnvironmentLabel[];
  measurementWindowMs: number;
  minSampleCount: number;
  unit: "ms" | "percent" | "count" | "bytes" | "ratio";
}

export interface SloTarget {
  id: string;
  sliId: string;
  targetPercent: number;
  warningPercent: number;
  criticalPercent: number;
  budgetPercentPerWindow: number;
}

export interface SloStatus {
  sloId: string;
  currentValue: number;
  targetPercent: number;
  status: "met" | "warning" | "violated";
  errorBudgetRemainingPercent: number;
  errorBudgetConsumedPercent: number;
  sliValues: number[];
  sampleCount: number;
  windowStart: string;
  windowEnd: string;
}

export interface ErrorBudget {
  sloId: string;
  sliId: string;
  totalBudget: number;
  consumed: number;
  remaining: number;
  remainingPercent: number;
  consumedPercent: number;
  windowStart: string;
  windowEnd: string;
  status: "healthy" | "warning" | "exhausted";
}

export interface SloPolicy {
  schemaVersion: number;
  updatedAt: string;
  slis: SliDefinition[];
  slos: SloTarget[];
  globalErrorBudgetWindowMs: number;
  measurementWindowMs: number;
  minimumSampleCount: number;
}

export function calculateSloStatus(
  values: number[],
  target: SloTarget,
  totalBudget: number
): SloStatus {
  if (values.length === 0) {
    return {
      sloId: target.id,
      currentValue: 0,
      targetPercent: target.targetPercent,
      status: "warning",
      errorBudgetRemainingPercent: 100,
      errorBudgetConsumedPercent: 0,
      sliValues: [],
      sampleCount: 0,
      windowStart: "",
      windowEnd: "",
    };
  }
  const successes = values.filter((v) => v === 1 || v === 0).length;
  const currentValue = (successes / values.length) * 100;
  const ratio = currentValue / target.targetPercent;
  const consumedPercent = Math.min(100, (1 - ratio) * 100);
  const remainingPercent = Math.max(0, 100 - consumedPercent);
  const consumed = Math.round((consumedPercent / 100) * totalBudget);
  const remaining = totalBudget - consumed;

  let status: "met" | "warning" | "violated";
  if (currentValue >= target.targetPercent) {
    status = "met";
  } else if (currentValue >= target.warningPercent) {
    status = "warning";
  } else {
    status = "violated";
  }

  return {
    sloId: target.id,
    currentValue: Math.round(currentValue * 100) / 100,
    targetPercent: target.targetPercent,
    status,
    errorBudgetRemainingPercent: Math.round(remainingPercent * 100) / 100,
    errorBudgetConsumedPercent: Math.round(consumedPercent * 100) / 100,
    sliValues: values,
    sampleCount: values.length,
    windowStart: "",
    windowEnd: "",
  };
}

export function calculateErrorBudget(
  sloStatus: SloStatus,
  totalBudget: number,
  windowStart: string,
  windowEnd: string
): ErrorBudget {
  const consumed = Math.round(
    (sloStatus.errorBudgetConsumedPercent / 100) * totalBudget
  );
  const remaining = totalBudget - consumed;
  let status: "healthy" | "warning" | "exhausted";
  if (sloStatus.status === "met") {
    status = "healthy";
  } else if (sloStatus.errorBudgetRemainingPercent > 0) {
    status = "warning";
  } else {
    status = "exhausted";
  }
  return {
    sloId: sloStatus.sloId,
    sliId: "",
    totalBudget,
    consumed,
    remaining,
    remainingPercent: sloStatus.errorBudgetRemainingPercent,
    consumedPercent: sloStatus.errorBudgetConsumedPercent,
    windowStart,
    windowEnd,
    status,
  };
}