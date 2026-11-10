import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationEngine } from "../simulation/simulation-engine";
import { POST as investigateIncident } from "../app/api/investigations/route";
import type { IncidentRecord, IncidentReplayFrame } from "@/types/incidents";
import type { RuntimeService, SimulationEvent } from "@/types/observatory-runtime";
import {
  createLocalInvestigationFallback,
  isInvestigationResponse,
  validateIncidentForInvestigation,
  validateInvestigationFinding,
} from "./incident-investigation";
import type { InvestigationFinding } from "@/types/incident-investigation";

function makeRecord(): IncidentRecord {
  const snapshot = new SimulationEngine().getSnapshot();
  const healthy: RuntimeService[] = snapshot.services.map((service) => ({
    ...service,
    health: "healthy",
    cpuUsage: 20,
    memoryUsage: 40,
    averageLatencyMs: 25,
    errorRate: 0,
  }));
  const failed = healthy.map((service) =>
    service.id === "postgres"
      ? { ...service, health: "failed" as const, cpuUsage: 0, errorRate: 100 }
      : service.id === "gateway"
        ? {
            ...service,
            health: "critical" as const,
            cpuUsage: 85,
            errorRate: 35,
            averageLatencyMs: 400,
          }
        : service,
  );
  const { events: snapshotEvents, ...snapshotBase } = snapshot;
  void snapshotEvents;
  const frame = (
    nowMs: number,
    services: RuntimeService[],
    version: number,
  ): IncidentReplayFrame => ({
    ...snapshotBase,
    nowMs,
    services,
    metrics: {
      ...snapshot.metrics,
      requestsPerSecond: 4,
      averageLatencyMs: nowMs === 500 ? 400 : 25,
      errorRate: nowMs === 500 ? 35 : 0,
      completedRequests: 10,
      successfulRequests: 7,
      failedRequests: 3,
    },
    eventSequence: version,
  });
  const events: SimulationEvent[] = [
    {
      type: "service.health.changed",
      sequence: 1,
      atMs: 250,
      serviceId: "postgres",
      from: "healthy",
      to: "failed",
      reason: "Connection pool exhausted",
    },
    {
      type: "request.completed",
      sequence: 2,
      atMs: 300,
      requestId: "r1",
      routeId: "checkout",
      path: ["gateway", "orders", "postgres"],
      latencyMs: 400,
      outcome: "failure",
      failedAt: "postgres",
      reason: "Database timeout",
    },
    {
      type: "service.health.changed",
      sequence: 3,
      atMs: 500,
      serviceId: "gateway",
      from: "healthy",
      to: "critical",
      reason: "Error budget exceeded",
    },
    {
      type: "resilience.activated",
      sequence: 4,
      atMs: 650,
      serviceId: "postgres",
      strategy: "fallback-cache",
      action: "Serve stale catalog reads",
    },
    { type: "service.recovery.completed", sequence: 5, atMs: 900, serviceId: "postgres" },
  ];
  return {
    id: "FL-INVESTIGATION-1",
    name: "Checkout database resilience",
    timestamp: "2026-11-09T12:00:00.000Z",
    occurredAt: "2026-11-09T11:59:58.000Z",
    severity: "critical",
    affectedServices: ["postgres", "gateway"],
    rootCause: "database-outage at postgres",
    failureConfiguration: {
      name: "Checkout database resilience",
      faultType: "database-outage",
      targetServiceId: "postgres",
      intensity: 100,
      durationSeconds: 0.7,
      trafficVolume: 2,
      failureProbability: 1,
      recoveryStrategy: "fallback-cache",
    },
    recoveryActions: ["fallback-cache: Serve stale catalog reads", "postgres completed recovery"],
    durationMs: 700,
    finalOutcome: "recovered",
    metrics: {
      requests: 10,
      successfulRequests: 7,
      failedRequests: 3,
      peakErrorRate: 35,
      peakLatencyMs: 400,
      finalErrorRate: 0,
      finalLatencyMs: 25,
      affectedCount: 2,
      throughputRps: 10 / 0.7,
      averageLatencyMs: 70,
      p95LatencyMs: 400,
      p99LatencyMs: 400,
    },
    simulationStartMs: 100,
    simulationEndMs: 1_100,
    events,
    replayFrames: [
      frame(99, healthy, 0),
      frame(500, failed, 3),
      frame(800, failed, 4),
      frame(1_100, healthy, 5),
    ],
    latencySamplesMs: [20, 25, 30, 45, 400],
  };
}

const originalApiKey = process.env.OPENAI_API_KEY;
const testOrigin = "https://faultline.test";
afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  vi.unstubAllGlobals();
});

function investigationRequest(record = makeRecord()) {
  return new Request(`${testOrigin}/api/investigations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ incident: record }),
  });
}

function modelFinding(): InvestigationFinding {
  return {
    summary: "The database outage drove failed checkout requests before gateway health degraded.",
    rootCauseAnalysis: {
      finding: "The recorded outage at postgres precedes request failures on the checkout path.",
      confidence: "high",
      evidenceRefs: ["meta:rootCause", "event:1", "event:2"],
    },
    propagationExplanation: {
      narrative:
        "Postgres failed first, then checkout requests failed and the gateway became critical.",
      evidenceRefs: ["event:1", "event:2", "event:3"],
    },
    affectedServices: [
      {
        serviceId: "postgres",
        impact: "Database health moved to failed.",
        evidenceRefs: ["service:postgres", "event:1"],
      },
      {
        serviceId: "gateway",
        impact: "Gateway health moved to critical.",
        evidenceRefs: ["service:gateway", "event:3"],
      },
    ],
    recoveryAssessment: {
      summary: "The fallback action was activated and postgres later completed recovery.",
      strengths: ["Fallback cache activation was recorded."],
      gaps: [],
      evidenceRefs: ["event:4", "event:5", "meta:outcome"],
    },
    preventiveMeasures: [
      {
        recommendation: "Set a pool saturation alert.",
        rationale: "The recorded cause identifies pool exhaustion.",
        evidenceRefs: ["event:1"],
      },
    ],
    alternativeRecoveryStrategies: [
      {
        strategy: "Circuit breaker",
        rationale: "It could isolate calls during the observed database failure.",
        tradeoffs: ["Requests may fail fast until recovery."],
        evidenceRefs: ["event:2", "service:postgres"],
      },
    ],
  };
}

describe("incident investigation evidence contract", () => {
  it("packages dependencies, typed failure events, measured metrics, snapshots, and recovery actions", () => {
    const validated = validateIncidentForInvestigation(makeRecord());
    expect(validated).not.toBeNull();
    expect(
      validated?.evidence.dependencies.find((service) => service.serviceId === "gateway")
        ?.dependsOn,
    ).toContain("orders");
    expect(validated?.evidence.timeline.map((event) => event.ref)).toEqual([
      "event:1",
      "event:2",
      "event:3",
      "event:4",
      "event:5",
    ]);
    expect(validated?.evidence.metrics).toMatchObject({
      failedRequests: 3,
      availabilityPct: 70,
      errorRatePct: 30,
      p95LatencyMs: 400,
      p99LatencyMs: 400,
    });
    expect(validated?.evidence.snapshots).toHaveLength(4);
    expect(validated?.evidence.recoveryActions[0]).toContain("fallback-cache");
  });

  it("accepts only complete structured output that references known evidence and services", () => {
    const validated = validateIncidentForInvestigation(makeRecord());
    expect(validated).not.toBeNull();
    if (!validated) return;
    const finding = modelFinding();
    expect(validateInvestigationFinding(finding, validated)).toBe(true);
    expect(
      validateInvestigationFinding(
        {
          ...finding,
          rootCauseAnalysis: { ...finding.rootCauseAnalysis, evidenceRefs: ["event:999999"] },
        },
        validated,
      ),
    ).toBe(false);
    expect(
      validateInvestigationFinding(
        {
          ...finding,
          affectedServices: [
            ...finding.affectedServices,
            { serviceId: "unknown-service", impact: "not observed", evidenceRefs: [] },
          ],
        },
        validated,
      ),
    ).toBe(false);
    expect(
      validateInvestigationFinding({ ...finding, inventedField: "not allowed" }, validated),
    ).toBe(false);
  });

  it("returns a deterministic, clearly local fallback with no AI recommendations", () => {
    const validated = validateIncidentForInvestigation(makeRecord());
    expect(validated).not.toBeNull();
    if (!validated) return;
    const first = createLocalInvestigationFallback(validated, "not_configured");
    const second = createLocalInvestigationFallback(validated, "not_configured");
    expect(first).toEqual(second);
    expect(isInvestigationResponse(first)).toBe(true);
    expect(first.status).toBe("unavailable");
    if (first.status === "unavailable") {
      expect(first.source).toBe("local");
      expect(first.message).toContain("not configured");
      expect(first.investigation.summary).toContain("AI analysis was not generated");
      expect(first.investigation.propagationExplanation.narrative).toContain(
        "causal links are not inferred",
      );
      expect(first.investigation.preventiveMeasures).toEqual([]);
      expect(first.investigation.alternativeRecoveryStrategies).toEqual([]);
    }
  });

  it("rejects malformed metrics, invalid event values, and inconsistent service topology", () => {
    const original = makeRecord();
    expect(
      validateIncidentForInvestigation({
        ...original,
        metrics: { ...original.metrics, failedRequests: -1 },
      }),
    ).toBeNull();
    expect(
      validateIncidentForInvestigation({
        ...original,
        events: [{ ...original.events[0]!, atMs: Number.NaN }],
      }),
    ).toBeNull();
    const brokenFrames = original.replayFrames.map((frame) => ({
      ...frame,
      services: frame.services.map((service) =>
        service.id === "gateway"
          ? { ...service, dependsOn: ["service-that-does-not-exist"] }
          : service,
      ),
    }));
    expect(
      validateIncidentForInvestigation({ ...original, replayFrames: brokenFrames }),
    ).toBeNull();
  });
});

describe("incident investigation API", () => {
  it("returns an explicit local fallback when no provider key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const response = await investigateIncident(investigationRequest());
    const body: unknown = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "unavailable",
      source: "local",
      reason: "not_configured",
    });
  });

  it("returns an explicit fallback when the provider request fails", async () => {
    process.env.OPENAI_API_KEY = "server-test-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("provider error", { status: 502 })),
    );
    const response = await investigateIncident(investigationRequest());
    const body: unknown = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "unavailable",
      source: "local",
      reason: "provider_error",
    });
    expect(JSON.stringify(body)).not.toContain("server-test-secret");
  });

  it("rejects provider output that fails structured finding validation", async () => {
    process.env.OPENAI_API_KEY = "server-test-secret";
    const encoder = new TextEncoder();
    const providerStream = [
      'data: {"type":"response.output_text.delta","delta":"{}"}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(encoder.encode(providerStream), { status: 200 })),
    );
    const response = await investigateIncident(investigationRequest());
    const body: unknown = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "unavailable",
      source: "local",
      reason: "invalid_output",
    });
  });

  it("streams only a complete, validated provider result", async () => {
    process.env.OPENAI_API_KEY = "server-test-secret";
    const finding = modelFinding();
    const providerEvents = [
      "data: " +
        JSON.stringify({
          type: "response.output_text.delta",
          delta: JSON.stringify(finding),
        }) +
        "\n\n",
      'data: {"type":"response.completed"}\n\n',
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(providerEvents, { status: 200 })),
    );
    const response = await investigateIncident(investigationRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const messages = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map(
        (block) => JSON.parse(block.replace(/^data:\s*/, "")) as { type: string; text?: string },
      );
    const serialized = messages
      .filter((message) => message.type === "chunk")
      .map((message) => message.text ?? "")
      .join("");
    const complete = JSON.parse(serialized) as {
      status: string;
      source: string;
      investigation: InvestigationFinding;
    };
    expect(messages.at(-1)?.type).toBe("done");
    expect(complete).toMatchObject({ status: "complete", source: "ai" });
    expect(complete.investigation.affectedServices).toHaveLength(2);
  });

  it("rejects invalid records before attempting a provider call", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const response = await investigateIncident(investigationRequest({ ...makeRecord(), id: "" }));
    expect(response.status).toBe(400);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before parsing or sending incident data", async () => {
    const response = await investigateIncident(
      new Request(`${testOrigin}/api/investigations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ incident: makeRecord() }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
