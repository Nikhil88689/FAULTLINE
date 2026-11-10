import type { IncidentRecord, IncidentReplayFrame } from "@/types/incidents";
import type { RuntimeHealth, SimulationEvent } from "@/types/observatory-runtime";

export type AnalyticsRange = "full" | "fault" | "recovery";
export type AnalyticsMetricName = "latency" | "error" | "throughput" | "cpu" | "memory";

export type AnalyticsPoint = {
  atMs: number;
  elapsedMs: number;
  value: number | null;
};

export type IncidentAnalytics = {
  availabilityPct: number | null;
  meanTimeToRecoveryMs: number | null;
  errorRatePct: number | null;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  failedRequests: number | null;
  throughputRps: number | null;
  resourceUtilizationPct: number | null;
  memoryUtilizationPct: number | null;
  recoveryEffectivenessPct: number | null;
  recoverySampleCount: number;
  latencySampleCount: number;
};

export type LatencyBin = { fromMs: number; toMs: number; count: number };

export type ServiceComparison = {
  id: string;
  name: string;
  baselineCpuPct: number | null;
  peakCpuPct: number | null;
  baselineMemoryPct: number | null;
  peakMemoryPct: number | null;
  baselineErrorPct: number | null;
  peakErrorPct: number | null;
  finalHealth: RuntimeHealth | null;
};

export type FailurePropagation = {
  nodes: Array<{ id: string; label: string; firstAtMs: number; health: RuntimeHealth }>;
  edges: Array<{ source: string; target: string; atMs: number }>;
  events: Array<{
    serviceId: string;
    atMs: number;
    from: RuntimeHealth;
    to: RuntimeHealth;
    reason: string;
  }>;
};

export type BeforeAfter = {
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
  unit: string;
};

export function analyzeIncident(record: IncidentRecord): IncidentAnalytics {
  const metrics = record.metrics;
  const latencySamples = validLatencySamples(record);
  const recoveryEvents = recoveryEventsFor(record);
  const failureAt = firstFailureAt(record.events);
  const recoveryEnd = recoveryEvents.length
    ? Math.max(...recoveryEvents.map((event) => event.atMs))
    : null;
  const meanTimeToRecoveryMs =
    failureAt !== null && recoveryEnd !== null && recoveryEnd >= failureAt
      ? recoveryEnd - failureAt
      : (metrics.recoveryDurationMs ?? null);
  const frames = record.replayFrames ?? [];
  const injectionEnd = record.simulationStartMs + record.durationMs;
  const utilizationFrames = frames.filter(
    (frame) => frame.nowMs >= record.simulationStartMs && frame.nowMs <= injectionEnd,
  );
  const serviceUsages = utilizationFrames.flatMap((frame) =>
    frame.services
      .filter((service) => record.affectedServices.includes(service.id))
      .map((service) => service.cpuUsage),
  );
  const serviceMemoryUsages = utilizationFrames.flatMap((frame) =>
    frame.services
      .filter((service) => record.affectedServices.includes(service.id))
      .map((service) => service.memoryUsage),
  );
  const finalFrame = frames.at(-1);
  const finalAffected =
    finalFrame?.services.filter((service) => record.affectedServices.includes(service.id)) ?? [];
  const actualRecoveryEffectiveness = finalAffected.length
    ? (finalAffected.filter((service) => service.health === "healthy").length /
        finalAffected.length) *
      100
    : (metrics.recoveryEffectivenessPct ?? null);
  const requests = finiteOrNull(metrics.requests);
  const failedRequests = finiteOrNull(metrics.failedRequests);
  const successfulRequests = finiteOrNull(metrics.successfulRequests);
  const p95 = latencySamples.length
    ? quantile(latencySamples, 0.95)
    : finiteOrNull(metrics.p95LatencyMs);
  const p99 = latencySamples.length
    ? quantile(latencySamples, 0.99)
    : finiteOrNull(metrics.p99LatencyMs);
  const averageLatency = latencySamples.length
    ? mean(latencySamples)
    : finiteOrNull(metrics.averageLatencyMs);

  return {
    availabilityPct:
      requests && successfulRequests !== null
        ? (successfulRequests / requests) * 100
        : finiteOrNull(metrics.availabilityPct),
    meanTimeToRecoveryMs,
    errorRatePct: requests ? ((failedRequests ?? 0) / requests) * 100 : null,
    averageLatencyMs: averageLatency,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    failedRequests,
    throughputRps:
      finiteOrNull(metrics.throughputRps) ??
      (record.durationMs > 0 && requests !== null ? requests / (record.durationMs / 1_000) : null),
    resourceUtilizationPct: serviceUsages.length ? mean(serviceUsages) : null,
    memoryUtilizationPct: serviceMemoryUsages.length ? mean(serviceMemoryUsages) : null,
    recoveryEffectivenessPct: actualRecoveryEffectiveness,
    recoverySampleCount: recoveryEvents.length,
    latencySampleCount: latencySamples.length || record.latencySampleCount || 0,
  };
}

export function meanTimeBetweenFailuresMs(records: readonly IncidentRecord[]): number | null {
  const timestamps = records
    .filter((record) =>
      record.events.some(
        (event) =>
          (event.type === "service.health.changed" &&
            (event.to === "failed" || event.to === "critical")) ||
          (event.type === "request.completed" && event.outcome === "failure"),
      ),
    )
    .map((record) => (record.occurredAt ? Date.parse(record.occurredAt) : Number.NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (timestamps.length < 2) return null;
  const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index]!);
  return mean(intervals);
}

export function timeSeries(
  record: IncidentRecord,
  serviceId: string,
  range: AnalyticsRange,
  metric: AnalyticsMetricName,
): AnalyticsPoint[] {
  const [from, to] = rangeBounds(record, range);
  return (record.replayFrames ?? [])
    .filter((frame) => frame.nowMs >= from && frame.nowMs <= to)
    .map((frame) => ({
      atMs: frame.nowMs,
      elapsedMs: Math.max(0, frame.nowMs - record.simulationStartMs),
      value: metricValue(frame, serviceId, metric),
    }));
}

export function latencyDistribution(record: IncidentRecord, bins = 12): LatencyBin[] {
  const values = validLatencySamples(record);
  if (!values.length) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const step = Math.max(1, (maximum - minimum) / bins);
  const result = Array.from({ length: bins }, (_, index) => ({
    fromMs: minimum + index * step,
    toMs: index === bins - 1 ? maximum : minimum + (index + 1) * step,
    count: 0,
  }));
  for (const value of values) {
    const index =
      maximum === minimum ? 0 : Math.min(bins - 1, Math.floor((value - minimum) / step));
    result[index]!.count += 1;
  }
  return result;
}

export function serviceHealthComparisons(record: IncidentRecord): ServiceComparison[] {
  const frames = record.replayFrames ?? [];
  if (!frames.length) return [];
  const baseline =
    frames.reduce<IncidentReplayFrame | null>(
      (picked, frame) =>
        frame.nowMs <= record.simulationStartMs && (!picked || frame.nowMs > picked.nowMs)
          ? frame
          : picked,
      null,
    ) ?? frames[0]!;
  const injectionEnd = record.simulationStartMs + record.durationMs;
  const injectionFrames = frames.filter(
    (frame) => frame.nowMs >= record.simulationStartMs && frame.nowMs <= injectionEnd,
  );
  const final = frames.at(-1)!;
  const affected = new Set(record.affectedServices);
  return final.services
    .filter((service) => affected.has(service.id))
    .map((service) => {
      const base = baseline.services.find((item) => item.id === service.id);
      const samples = injectionFrames.flatMap((frame) =>
        frame.services.filter((item) => item.id === service.id),
      );
      return {
        id: service.id,
        name: service.name,
        baselineCpuPct: base?.cpuUsage ?? null,
        peakCpuPct: samples.length ? Math.max(...samples.map((item) => item.cpuUsage)) : null,
        baselineMemoryPct: base?.memoryUsage ?? null,
        peakMemoryPct: samples.length ? Math.max(...samples.map((item) => item.memoryUsage)) : null,
        baselineErrorPct: base?.errorRate ?? null,
        peakErrorPct: samples.length ? Math.max(...samples.map((item) => item.errorRate)) : null,
        finalHealth: service.health,
      };
    });
}

export function failurePropagation(record: IncidentRecord): FailurePropagation {
  const transitions = record.events
    .filter(
      (event): event is Extract<SimulationEvent, { type: "service.health.changed" }> =>
        event.type === "service.health.changed" &&
        (event.to === "failed" || event.to === "critical"),
    )
    .sort((a, b) => a.atMs - b.atMs || a.sequence - b.sequence)
    .filter(
      (event, index, events) =>
        events.findIndex((candidate) => candidate.serviceId === event.serviceId) === index,
    )
    .map((event) => ({
      serviceId: event.serviceId,
      atMs: event.atMs,
      from: event.from,
      to: event.to,
      reason: event.reason,
    }));
  const frames = record.replayFrames ?? [];
  const topology = frames.at(-1)?.services ?? frames[0]?.services ?? [];
  const eventsByService = new Map(transitions.map((event) => [event.serviceId, event]));
  const edges = transitions.flatMap((failed) => {
    const provider = topology.find((service) => service.id === failed.serviceId);
    if (!provider) return [];
    return topology
      .filter((dependent) => dependent.dependsOn.includes(provider.id))
      .flatMap((dependent) => {
        const downstreamFailure = eventsByService.get(dependent.id);
        return downstreamFailure && downstreamFailure.atMs >= failed.atMs
          ? [{ source: provider.id, target: dependent.id, atMs: downstreamFailure.atMs }]
          : [];
      });
  });
  return {
    nodes: transitions.map((event) => ({
      id: event.serviceId,
      label: topology.find((service) => service.id === event.serviceId)?.name ?? event.serviceId,
      firstAtMs: event.atMs,
      health: event.to,
    })),
    edges,
    events: transitions,
  };
}

export function beforeAfterComparison(record: IncidentRecord, serviceId: string): BeforeAfter[] {
  const frames = record.replayFrames ?? [];
  if (!frames.length) return [];
  const before =
    frames.filter((frame) => frame.nowMs <= record.simulationStartMs).at(-1) ?? frames[0]!;
  const after = frames.at(-1)!;
  const beforeService = before.services.find((service) => service.id === serviceId);
  const afterService = after.services.find((service) => service.id === serviceId);
  const metrics: Array<{
    label: string;
    before: number | null;
    after: number | null;
    unit: string;
  }> = [
    {
      label: "CPU",
      before: beforeService?.cpuUsage ?? null,
      after: afterService?.cpuUsage ?? null,
      unit: "%",
    },
    {
      label: "MEMORY",
      before: beforeService?.memoryUsage ?? null,
      after: afterService?.memoryUsage ?? null,
      unit: "%",
    },
    {
      label: "LATENCY",
      before: beforeService?.averageLatencyMs ?? null,
      after: afterService?.averageLatencyMs ?? null,
      unit: "ms",
    },
    {
      label: "ERROR RATE",
      before: beforeService?.errorRate ?? null,
      after: afterService?.errorRate ?? null,
      unit: "%",
    },
  ];
  return metrics.map((metric) => ({
    ...metric,
    delta: metric.before !== null && metric.after !== null ? metric.after - metric.before : null,
  }));
}

export function recoveryPerformance(records: readonly IncidentRecord[]) {
  return [...records]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map((record) => ({
      id: record.id,
      name: record.name,
      timestamp: record.timestamp,
      outcome: record.finalOutcome,
      recoveryMs: analyzeIncident(record).meanTimeToRecoveryMs,
      effectivenessPct: analyzeIncident(record).recoveryEffectivenessPct,
    }));
}

export function scenarioComparison(primary: IncidentRecord, comparison: IncidentRecord | null) {
  const primaryMetrics = analyzeIncident(primary);
  const comparisonMetrics = comparison ? analyzeIncident(comparison) : null;
  return [
    {
      label: "Availability",
      unit: "%",
      primary: primaryMetrics.availabilityPct,
      comparison: comparisonMetrics?.availabilityPct ?? null,
    },
    {
      label: "Error rate",
      unit: "%",
      primary: primaryMetrics.errorRatePct,
      comparison: comparisonMetrics?.errorRatePct ?? null,
    },
    {
      label: "Average latency",
      unit: "ms",
      primary: primaryMetrics.averageLatencyMs,
      comparison: comparisonMetrics?.averageLatencyMs ?? null,
    },
    {
      label: "P95 latency",
      unit: "ms",
      primary: primaryMetrics.p95LatencyMs,
      comparison: comparisonMetrics?.p95LatencyMs ?? null,
    },
    {
      label: "Throughput",
      unit: "req/s",
      primary: primaryMetrics.throughputRps,
      comparison: comparisonMetrics?.throughputRps ?? null,
    },
  ];
}

export function evidenceBasedRecommendations(record: IncidentRecord): string[] {
  const analytics = analyzeIncident(record);
  const recommendations: string[] = [];
  const firstFailedRequest = record.events.find(
    (event) => event.type === "request.completed" && event.outcome === "failure",
  );
  if (firstFailedRequest?.type === "request.completed" && firstFailedRequest.failedAt) {
    recommendations.push(
      `Inspect ${serviceName(record, firstFailedRequest.failedAt)} first; it is the first recorded request failure point.`,
    );
  }
  if (
    analytics.p95LatencyMs !== null &&
    analytics.averageLatencyMs !== null &&
    analytics.p95LatencyMs > analytics.averageLatencyMs * 1.5
  ) {
    recommendations.push(
      `Review timeout and retry budgets around the observed tail latency: P95 was ${(analytics.p95LatencyMs / analytics.averageLatencyMs).toFixed(1)}x the recorded mean.`,
    );
  }
  if (analytics.recoveryEffectivenessPct !== null && analytics.recoveryEffectivenessPct < 100) {
    recommendations.push(
      `Recovery verification ended with ${analytics.recoveryEffectivenessPct.toFixed(0)}% of affected services healthy; inspect the unrecovered services before repeating this scenario.`,
    );
  }
  if (analytics.errorRatePct !== null && analytics.errorRatePct >= 5) {
    recommendations.push(
      `The recorded request error rate was ${analytics.errorRatePct.toFixed(1)}%; validate the configured recovery path against this failure mode.`,
    );
  }
  if (!recommendations.length) {
    recommendations.push(
      "No additional recommendation can be derived from this record's measured request and recovery signals.",
    );
  }
  return recommendations;
}

export function buildAnalyticsCsv(records: readonly IncidentRecord[]): string {
  const header = [
    "incident_id",
    "name",
    "occurred_at",
    "severity",
    "outcome",
    "availability_pct",
    "error_rate_pct",
    "average_latency_ms",
    "p95_latency_ms",
    "p99_latency_ms",
    "failed_requests",
    "throughput_rps",
    "mttr_ms",
    "recovery_effectiveness_pct",
    "mtbf_ms",
    "cpu_utilization_pct",
    "memory_utilization_pct",
  ];
  const failures = records
    .filter(
      (record) =>
        record.occurredAt &&
        record.events.some(
          (event) =>
            (event.type === "service.health.changed" &&
              (event.to === "failed" || event.to === "critical")) ||
            (event.type === "request.completed" && event.outcome === "failure"),
        ),
    )
    .map((record) => ({ id: record.id, at: Date.parse(record.occurredAt!) }))
    .filter((item) => Number.isFinite(item.at))
    .sort((a, b) => a.at - b.at);
  const mtbfById = new Map(
    failures.slice(1).map((failure, index) => [failure.id, failure.at - failures[index]!.at]),
  );
  const rows = records.map((record) => {
    const metrics = analyzeIncident(record);
    return [
      record.id,
      record.name,
      record.occurredAt ?? record.timestamp,
      record.severity,
      record.finalOutcome,
      metrics.availabilityPct,
      metrics.errorRatePct,
      metrics.averageLatencyMs,
      metrics.p95LatencyMs,
      metrics.p99LatencyMs,
      metrics.failedRequests,
      metrics.throughputRps,
      metrics.meanTimeToRecoveryMs,
      metrics.recoveryEffectivenessPct,
      mtbfById.get(record.id) ?? null,
      metrics.resourceUtilizationPct,
      metrics.memoryUtilizationPct,
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function formatMetric(value: number | null | undefined, unit = "", digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
  return unit === "%" ? `${formatted}%` : unit ? `${formatted} ${unit}` : formatted;
}

function metricValue(
  frame: IncidentReplayFrame,
  serviceId: string,
  metric: AnalyticsMetricName,
): number | null {
  if (serviceId === "all") {
    if (metric === "latency") return frame.metrics.averageLatencyMs;
    if (metric === "error") return frame.metrics.errorRate;
    if (metric === "throughput") return frame.metrics.requestsPerSecond;
    const values = frame.services.map((service) =>
      metric === "cpu" ? service.cpuUsage : service.memoryUsage,
    );
    return values.length ? mean(values) : null;
  }
  const service = frame.services.find((item) => item.id === serviceId);
  if (!service) return null;
  if (metric === "latency") return service.averageLatencyMs;
  if (metric === "error") return service.errorRate;
  if (metric === "throughput") return service.requestsPerSecond;
  if (metric === "cpu") return service.cpuUsage;
  return service.memoryUsage;
}

function rangeBounds(record: IncidentRecord, range: AnalyticsRange): [number, number] {
  const start = record.simulationStartMs;
  const end = record.simulationEndMs;
  const injectionEnd = Math.min(end, start + record.durationMs);
  if (range === "fault") return [start, injectionEnd];
  if (range === "recovery") return [injectionEnd, end];
  return [start, end];
}

function recoveryEventsFor(record: IncidentRecord) {
  return record.events.filter((event) => event.type === "service.recovery.completed");
}

function firstFailureAt(events: SimulationEvent[]): number | null {
  const times = events.flatMap((event) => {
    if (
      event.type === "service.health.changed" &&
      (event.to === "failed" || event.to === "critical")
    )
      return [event.atMs];
    if (event.type === "request.completed" && event.outcome === "failure") return [event.atMs];
    return [];
  });
  return times.length ? Math.min(...times) : null;
}

function validLatencySamples(record: IncidentRecord): number[] {
  return (record.latencySamplesMs ?? [])
    .filter((sample) => Number.isFinite(sample) && sample >= 0)
    .sort((a, b) => a - b);
}

function quantile(sorted: number[], percentile: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)] ?? null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function serviceName(record: IncidentRecord, id: string): string {
  return (
    record.replayFrames.flatMap((frame) => frame.services).find((service) => service.id === id)
      ?.name ?? id
  );
}

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
