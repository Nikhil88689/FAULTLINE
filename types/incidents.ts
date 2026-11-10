import type { ChaosExperimentConfig, RecoveryStrategy } from "@/types/chaos-lab";
import type { SimulationEvent, SimulationState } from "@/types/observatory-runtime";

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentOutcome = "recovered" | "degraded" | "failed";

export type IncidentReplayFrame = Omit<SimulationState, "events"> & { eventSequence: number };

export type IncidentMetrics = {
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  peakErrorRate: number;
  peakLatencyMs: number;
  finalErrorRate: number;
  finalLatencyMs: number;
  affectedCount: number;
  averageLatencyMs?: number | null;
  p95LatencyMs?: number | null;
  p99LatencyMs?: number | null;
  throughputRps?: number | null;
  availabilityPct?: number | null;
  recoveryDurationMs?: number | null;
  recoveryEffectivenessPct?: number | null;
  recoveredServiceCount?: number;
};

export type IncidentRecord = {
  id: string;
  name: string;
  timestamp: string;
  occurredAt?: string;
  severity: IncidentSeverity;
  affectedServices: string[];
  rootCause: string;
  failureConfiguration: ChaosExperimentConfig;
  recoveryActions: string[];
  durationMs: number;
  finalOutcome: IncidentOutcome;
  metrics: IncidentMetrics;
  simulationStartMs: number;
  simulationEndMs: number;
  events: SimulationEvent[];
  replayFrames: IncidentReplayFrame[];
  latencySamplesMs?: number[];
  latencySampleCount?: number;
  persistence?: "database" | "local";
};

export type IncidentSummary = Omit<
  IncidentRecord,
  "events" | "replayFrames" | "latencySamplesMs"
> & {
  replayFrameCount?: number;
  eventCount?: number;
};

export function createIncidentId(at = new Date()): string {
  const time = at
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(2, 12);
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 6).toUpperCase()
      : Math.random().toString(36).slice(2, 8).toUpperCase();
  return `FL-${time}-${suffix}`;
}

export function describeRecovery(strategy: RecoveryStrategy): string[] {
  const actions: Record<RecoveryStrategy, string[]> = {
    none: ["Fault injection withdrawn", "Health verification window completed"],
    "retry-backoff": [
      "Exponential backoff retries activated",
      "Fault injection withdrawn",
      "Health verification completed",
    ],
    "circuit-breaker": [
      "Circuit breaker opened to contain failures",
      "Circuit breaker half-opened during recovery",
      "Health verification completed",
    ],
    "fallback-cache": [
      "Fallback cache served dependent requests",
      "Primary path restored",
      "Health verification completed",
    ],
    "traffic-redistribution": [
      "Traffic redistributed across healthy paths",
      "Fault injection withdrawn",
      "Health verification completed",
    ],
    "service-restart": [
      "Service restart initiated",
      "Service rejoined dependency graph",
      "Health verification completed",
    ],
    "horizontal-autoscaling": [
      "Horizontal capacity added",
      "Traffic pressure normalized",
      "Health verification completed",
    ],
  };
  return actions[strategy];
}

export function createIncidentRecord(input: {
  config: ChaosExperimentConfig;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  peakErrorRate: number;
  peakLatencyMs: number;
  affectedServices: string[];
  events: SimulationEvent[];
  replayFrames: IncidentReplayFrame[];
  latencySamplesMs: number[];
  finalState: SimulationState;
  timestamp?: string;
  occurredAt?: string;
  id?: string;
}): IncidentRecord {
  const now = input.timestamp ? new Date(input.timestamp) : new Date();
  const finalAffected = input.finalState.services.filter((service) =>
    input.affectedServices.includes(service.id),
  );
  const hasFailed = finalAffected.some((service) => service.health === "failed");
  const hasDegraded = finalAffected.some(
    (service) =>
      service.health === "critical" ||
      service.health === "recovering" ||
      service.health === "high-load",
  );
  const finalOutcome: IncidentOutcome = hasFailed
    ? "failed"
    : hasDegraded
      ? "degraded"
      : "recovered";
  const peakErrorRate = Math.max(input.peakErrorRate, 0);
  const latencySamples = [...input.latencySamplesMs]
    .filter((sample) => Number.isFinite(sample) && sample >= 0)
    .sort((a, b) => a - b);
  const firstFailureAt = findFirstFailureAt(input.events);
  const recoveryEvents = input.events.filter(
    (event) =>
      event.type === "service.recovery.completed" &&
      firstFailureAt !== null &&
      event.atMs >= firstFailureAt,
  );
  const recoveryDurationMs =
    firstFailureAt !== null && recoveryEvents.length
      ? Math.max(0, Math.max(...recoveryEvents.map((event) => event.atMs)) - firstFailureAt)
      : null;
  const recoveredServiceCount = finalAffected.filter(
    (service) => service.health === "healthy",
  ).length;
  const recordedFailure = input.events.some(
    (event) =>
      (event.type === "service.health.changed" &&
        (event.to === "failed" || event.to === "critical")) ||
      (event.type === "request.completed" && event.outcome === "failure"),
  );
  const severity: IncidentSeverity =
    peakErrorRate >= 50 || hasFailed
      ? "critical"
      : peakErrorRate >= 20 || input.failedRequests >= 100
        ? "high"
        : peakErrorRate >= 5 || input.failedRequests > 0 || recordedFailure
          ? "medium"
          : "low";
  const firstFaultEvent = input.events.find(
    (event) =>
      (event.type === "service.health.changed" &&
        (event.to === "failed" || event.to === "critical")) ||
      (event.type === "request.completed" && event.outcome === "failure"),
  );
  const failedAt =
    firstFaultEvent?.type === "request.completed" ? firstFaultEvent.failedAt : undefined;
  const rootCause = failedAt
    ? `${input.config.faultType.replaceAll("-", " ")} at ${failedAt}`
    : `${input.config.faultType.replaceAll("-", " ")} injected into ${input.config.targetServiceId}`;

  return {
    id: input.id ?? createIncidentId(now),
    name: input.config.name,
    timestamp: now.toISOString(),
    ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt).toISOString() } : {}),
    severity,
    affectedServices: [...input.affectedServices],
    rootCause,
    failureConfiguration: { ...input.config },
    recoveryActions: deriveRecoveryActions(input.events),
    durationMs: input.durationMs,
    finalOutcome,
    metrics: {
      requests: input.requests,
      successfulRequests: input.successfulRequests,
      failedRequests: input.failedRequests,
      peakErrorRate,
      peakLatencyMs: input.peakLatencyMs,
      finalErrorRate: input.finalState.metrics.errorRate,
      finalLatencyMs: input.finalState.metrics.averageLatencyMs,
      affectedCount: input.affectedServices.length,
      averageLatencyMs: latencySamples.length ? mean(latencySamples) : null,
      p95LatencyMs: quantile(latencySamples, 0.95),
      p99LatencyMs: quantile(latencySamples, 0.99),
      throughputRps: input.durationMs > 0 ? input.requests / (input.durationMs / 1_000) : null,
      availabilityPct:
        input.requests > 0 ? (input.successfulRequests / input.requests) * 100 : null,
      recoveryDurationMs,
      recoveryEffectivenessPct: finalAffected.length
        ? (recoveredServiceCount / finalAffected.length) * 100
        : null,
      recoveredServiceCount,
    },
    simulationStartMs: input.startedAtMs,
    simulationEndMs: input.endedAtMs,
    events: [...input.events].sort((a, b) => a.atMs - b.atMs || a.sequence - b.sequence),
    replayFrames: [...input.replayFrames].sort((a, b) => a.nowMs - b.nowMs),
    latencySamplesMs: latencySamples,
  };
}

function findFirstFailureAt(events: SimulationEvent[]): number | null {
  const failures = events.flatMap((event) => {
    if (
      event.type === "service.health.changed" &&
      (event.to === "failed" || event.to === "critical")
    )
      return [event.atMs];
    if (event.type === "request.completed" && event.outcome === "failure") return [event.atMs];
    return [];
  });
  return failures.length ? Math.min(...failures) : null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sortedValues: number[], percentile: number): number | null {
  if (!sortedValues.length) return null;
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * percentile) - 1)] ?? null;
}

function deriveRecoveryActions(events: SimulationEvent[]): string[] {
  const observed = events.flatMap((event) => {
    if (event.type === "resilience.activated") return [`${event.strategy}: ${event.action}`];
    if (event.type === "service.recovery.completed")
      return [`${event.serviceId} completed recovery and rejoined the graph`];
    return [];
  });
  if (!observed.length)
    return ["Fault injection withdrawn", "Health verification window completed"];
  return [
    ...new Set([...observed, "Fault injection withdrawn", "Health verification window completed"]),
  ];
}
