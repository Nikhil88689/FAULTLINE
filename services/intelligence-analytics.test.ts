import { describe, expect, it } from "vitest";
import type { IncidentRecord, IncidentReplayFrame } from "@/types/incidents";
import type { RuntimeService, SimulationEvent } from "@/types/observatory-runtime";
import { SimulationEngine } from "../simulation/simulation-engine";
import {
  analyzeIncident,
  beforeAfterComparison,
  buildAnalyticsCsv,
  failurePropagation,
  latencyDistribution,
  meanTimeBetweenFailuresMs,
  timeSeries,
} from "./intelligence-analytics";
import { generateIncidentReportPdf, incidentReportLines } from "./incident-report";

function makeIncident(): IncidentRecord {
  const base = new SimulationEngine().getSnapshot();
  const healthyServices: RuntimeService[] = base.services.map((service) => ({
    ...service,
    cpuUsage: 20,
    memoryUsage: 40,
    errorRate: 0,
    averageLatencyMs: 30,
    health: "healthy",
  }));
  const failedServices = healthyServices.map((service) =>
    service.id === "postgres"
      ? { ...service, cpuUsage: 0, health: "failed" as const, errorRate: 100 }
      : service.id === "gateway"
        ? {
            ...service,
            cpuUsage: 80,
            health: "critical" as const,
            errorRate: 20,
            averageLatencyMs: 200,
          }
        : service,
  );
  const recoveringServices = healthyServices.map((service) =>
    service.id === "gateway"
      ? { ...service, cpuUsage: 55, health: "recovering" as const, errorRate: 4 }
      : service,
  );
  const frame = (
    nowMs: number,
    services: typeof healthyServices,
    version: number,
  ): IncidentReplayFrame => ({
    version,
    tick: nowMs / 100,
    nowMs,
    status: "paused",
    speedMultiplier: 1,
    trafficMultiplier: 1,
    services,
    connections: base.connections,
    metrics: {
      ...base.metrics,
      requestsPerSecond: 2,
      averageLatencyMs: nowMs === 500 ? 200 : 30,
      errorRate: nowMs === 500 ? 20 : 0,
      completedRequests: 5,
      successfulRequests: 4,
      failedRequests: 1,
    },
    eventSequence: version,
  });
  const events: SimulationEvent[] = [
    {
      type: "service.health.changed",
      sequence: 1,
      atMs: 200,
      serviceId: "postgres",
      from: "healthy",
      to: "failed",
      reason: "Database unavailable",
    },
    {
      type: "request.completed",
      sequence: 2,
      atMs: 300,
      requestId: "req-1",
      routeId: "profile-read",
      path: ["gateway", "user", "postgres"],
      latencyMs: 100,
      outcome: "failure",
      failedAt: "postgres",
      reason: "dependency failed",
    },
    {
      type: "service.health.changed",
      sequence: 3,
      atMs: 400,
      serviceId: "gateway",
      from: "healthy",
      to: "critical",
      reason: "Error threshold crossed",
    },
    { type: "service.recovery.completed", sequence: 4, atMs: 800, serviceId: "postgres" },
    { type: "service.recovery.completed", sequence: 5, atMs: 900, serviceId: "gateway" },
  ];
  return {
    id: "FL-TEST-ANALYTICS",
    name: "Database resilience",
    timestamp: "2026-11-09T00:00:00.000Z",
    occurredAt: "2026-11-08T23:59:58.000Z",
    severity: "critical",
    affectedServices: ["postgres", "gateway"],
    rootCause: "Database outage at postgres",
    failureConfiguration: {
      name: "Database resilience",
      faultType: "database-outage",
      targetServiceId: "postgres",
      intensity: 100,
      durationSeconds: 0.7,
      trafficVolume: 1,
      failureProbability: 1,
      recoveryStrategy: "fallback-cache",
    },
    recoveryActions: [
      "Fallback cache served a stale read",
      "PostgreSQL completed recovery and rejoined the graph",
    ],
    durationMs: 700,
    finalOutcome: "recovered",
    metrics: {
      requests: 5,
      successfulRequests: 4,
      failedRequests: 1,
      peakErrorRate: 20,
      peakLatencyMs: 200,
      finalErrorRate: 0,
      finalLatencyMs: 30,
      affectedCount: 2,
      throughputRps: 5,
    },
    simulationStartMs: 100,
    simulationEndMs: 1_100,
    events,
    replayFrames: [
      frame(99, healthyServices, 0),
      frame(500, failedServices, 3),
      frame(850, recoveringServices, 4),
      frame(1_100, healthyServices, 5),
    ],
    latencySamplesMs: [10, 20, 30, 40, 100],
  };
}

describe("incident analytics", () => {
  it("derives availability, latency percentiles, throughput, recovery duration, and effectiveness from recorded data", () => {
    const record = makeIncident();
    const analytics = analyzeIncident(record);
    expect(analytics.availabilityPct).toBe(80);
    expect(analytics.errorRatePct).toBe(20);
    expect(analytics.averageLatencyMs).toBe(40);
    expect(analytics.p95LatencyMs).toBe(100);
    expect(analytics.p99LatencyMs).toBe(100);
    expect(analytics.throughputRps).toBe(5);
    expect(analytics.meanTimeToRecoveryMs).toBe(700);
    expect(analytics.recoveryEffectivenessPct).toBe(100);
    expect(analytics.resourceUtilizationPct).toBe(40);
    expect(analytics.memoryUtilizationPct).toBe(40);
    expect(analytics.latencySampleCount).toBe(5);
  });

  it("keeps percentiles unavailable when an older record has no request latency samples", () => {
    const record = makeIncident();
    delete record.latencySamplesMs;
    delete record.metrics.p95LatencyMs;
    delete record.metrics.p99LatencyMs;
    expect(analyzeIncident(record).p95LatencyMs).toBeNull();
    expect(analyzeIncident(record).p99LatencyMs).toBeNull();
    expect(latencyDistribution(record)).toEqual([]);
  });

  it("computes MTBF only from recorded failure start timestamps", () => {
    const first = makeIncident();
    const second = { ...first, id: "FL-TEST-2", occurredAt: "2026-11-09T00:09:58.000Z" };
    expect(meanTimeBetweenFailuresMs([first, second])).toBe(600_000);
    expect(meanTimeBetweenFailuresMs([{ ...first, occurredAt: undefined }, second])).toBeNull();
    expect(meanTimeBetweenFailuresMs([{ ...first, events: [] }, second])).toBeNull();
  });

  it("limits time series to selected experiment windows and compares before/after snapshots", () => {
    const record = makeIncident();
    expect(timeSeries(record, "gateway", "fault", "cpu").map((point) => point.atMs)).toEqual([500]);
    expect(timeSeries(record, "gateway", "recovery", "cpu").map((point) => point.atMs)).toEqual([
      850, 1_100,
    ]);
    expect(
      beforeAfterComparison(record, "gateway").find((item) => item.label === "CPU"),
    ).toMatchObject({ before: 20, after: 20, delta: 0 });
  });

  it("reconstructs failure propagation only where health events and recorded dependencies agree", () => {
    const propagation = failurePropagation(makeIncident());
    expect(propagation.nodes.map((node) => node.id)).toEqual(["postgres", "gateway"]);
    expect(propagation.edges).toEqual([]);
  });

  it("exports actual summary values to CSV with escaped scenario text", () => {
    const record = makeIncident();
    record.name = 'Database, "primary"';
    const csv = buildAnalyticsCsv([record]);
    expect(csv).toContain('"Database, ""primary"""');
    expect(csv).toContain(",80,20,40,100,100,1,5,700,100");
  });
});

describe("incident report PDF", () => {
  it("includes experiment, configuration, timeline, affected services, metrics, recovery, and recommendations", () => {
    const record = makeIncident();
    const lines = incidentReportLines(record)
      .map((line) => line.text)
      .join("\n");
    expect(lines).toContain("EXPERIMENT SUMMARY");
    expect(lines).toContain("FAILURE CONFIGURATION");
    expect(lines).toContain("RECORDED TIMELINE");
    expect(lines).toContain("AFFECTED SERVICES");
    expect(lines).toContain("KEY METRICS");
    expect(lines).toContain("RECOVERY ANALYSIS");
    expect(lines).toContain("EVIDENCE-BASED RECOMMENDATIONS");

    const pdf = generateIncidentReportPdf(record);
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("EXPERIMENT SUMMARY");
    expect(text).toContain("Failure type: database outage");
    expect(text).toContain("P95: 100.0 ms");
    expect(text.endsWith("%%EOF")).toBe(true);
  });
});
