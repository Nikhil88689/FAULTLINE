import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestTrace, ServiceDefinition, SimulationConfig } from "@/types/simulation";
import { DependencyGraph } from "./dependency-graph";
import { MetricsAggregator } from "./metrics-aggregator";
import { MetricsCollector } from "./metrics-collector";
import { observatoryConnections, observatoryServices } from "./observatory-scenario";
import { RequestRouter } from "./request-router";
import { SeededRandom } from "./seeded-random";
import { ServiceNode } from "./service-node";
import { ServiceRegistry } from "./service-registry";
import { SimulationClock } from "./simulation-clock";
import { SimulationEngine } from "./simulation-engine";
import { SimulationScheduler } from "./simulation-scheduler";
import { TrafficGenerator } from "./traffic-generator";

function definition(
  id: string,
  category: ServiceDefinition["category"],
  dependsOn: string[] = [],
  overrides: Partial<ServiceDefinition> = {},
): ServiceDefinition {
  return {
    id,
    name: id.toUpperCase(),
    shortName: id.toUpperCase(),
    category,
    description: `${id} simulation node`,
    position: [0, 0, 0],
    dependsOn,
    region: "test-region",
    capacityRequestsPerSecond: 30,
    maxConcurrentRequests: 8,
    baseLatencyMs: 8,
    baselineMemoryPercent: 30,
    baseFailureProbability: 0,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  const serviceDefinitions = overrides.serviceDefinitions ?? [
    definition("edge", "entry", ["api"]),
    definition("api", "core", ["database"]),
    definition("database", "data"),
  ];
  return {
    seed: 1234,
    tickMs: 100,
    metricsWindowMs: 2_000,
    requestsPerSecond: 12,
    recoveryDurationMs: 400,
    automaticRecoveryDelayMs: 200,
    serviceDefinitions,
    routes: [{ id: "read", entryServiceId: "edge", targetServiceId: "api", weight: 1 }],
    ...overrides,
  };
}

function trace(overrides: Partial<RequestTrace> = {}): RequestTrace {
  return {
    requestId: "request-1",
    routeId: "read",
    path: ["edge", "api"],
    connectionIds: ["edge-api"],
    connectionSamples: [{ connectionId: "edge-api", latencyMs: 15 }],
    serviceSamples: [
      { serviceId: "edge", latencyMs: 5, accepted: true },
      { serviceId: "api", latencyMs: 8, accepted: true },
    ],
    latencyMs: 15,
    outcome: "success",
    ...overrides,
  };
}

describe("SimulationClock and SimulationScheduler", () => {
  it("advances monotonically and rejects negative or backwards time", () => {
    const clock = new SimulationClock();
    expect(clock.advanceBy(125)).toBe(125);
    clock.advanceTo(200);
    expect(clock.nowMs).toBe(200);
    expect(() => clock.advanceBy(-1)).toThrow(RangeError);
    expect(() => clock.advanceTo(199)).toThrow(RangeError);
  });

  it("runs tasks by due time and preserves insertion order for ties", () => {
    const scheduler = new SimulationScheduler<string>();
    scheduler.schedule(20, "late");
    scheduler.schedule(10, "first");
    scheduler.schedule(10, "second");
    const seen: string[] = [];
    expect(scheduler.runUntil(10, (task) => seen.push(task))).toBe(2);
    expect(seen).toEqual(["first", "second"]);
    scheduler.runUntil(20, (task) => seen.push(task));
    expect(seen).toEqual(["first", "second", "late"]);
  });
});

describe("seeded traffic and topology", () => {
  it("produces identical pseudo-random sequences for the same seed", () => {
    const left = new SeededRandom(77);
    const right = new SeededRandom(77);
    expect(Array.from({ length: 8 }, () => left.next())).toEqual(
      Array.from({ length: 8 }, () => right.next()),
    );
  });

  it("generates the configured request count and chooses weighted valid routes", () => {
    const random = new SeededRandom(4);
    const routes = [
      { id: "a", entryServiceId: "edge", targetServiceId: "api", weight: 1 },
      { id: "b", entryServiceId: "edge", targetServiceId: "database", weight: 3 },
    ];
    const generator = new TrafficGenerator(routes, random, 20);
    const requests = generator.generate(1000, 1);
    expect(requests).toHaveLength(20);
    expect(requests.every((route) => routes.includes(route))).toBe(true);
    expect(requests.filter((route) => route.id === "b").length).toBeGreaterThan(
      requests.filter((route) => route.id === "a").length,
    );
  });

  it("constructs all ten observatory services and directed dependencies", () => {
    expect(observatoryServices).toHaveLength(10);
    expect(observatoryConnections).toHaveLength(14);
    const graph = new DependencyGraph(observatoryServices);
    const paymentFlow = graph.resolveRequestPlan("gateway", "payment");
    expect(paymentFlow.serviceIds).toContain("postgres");
    expect(paymentFlow.serviceIds).toContain("queue");
    expect(paymentFlow.connectionIds).toContain("payment-queue");
    expect(paymentFlow.connectionIds).not.toContain("postgres-queue");
  });

  it("rejects unknown dependencies and cyclic service graphs", () => {
    expect(() => new DependencyGraph([definition("edge", "entry", ["missing"])])).toThrow(
      /unknown service/i,
    );
    expect(
      () =>
        new DependencyGraph([
          definition("edge", "entry", ["api"]),
          definition("api", "core", ["edge"]),
        ]),
    ).toThrow(/cycle/i);
  });
});

describe("service registry and router", () => {
  it("tracks request concurrency, queue depth, and resource utilization", () => {
    const service = new ServiceNode(definition("api", "core", [], { maxConcurrentRequests: 1 }));
    const random = new SeededRandom(1);
    service.beginRequest(random);
    service.beginRequest(random);
    service.updateResourceMetrics({
      requestsPerSecond: 12,
      averageLatencyMs: 9,
      errorRate: 0,
      completedRequests: 1,
      failedRequests: 0,
    });
    const snapshot = service.snapshot(
      {
        requestsPerSecond: 12,
        averageLatencyMs: 9,
        errorRate: 0,
        completedRequests: 1,
        failedRequests: 0,
      },
      0,
      1000,
    );
    expect(snapshot.inFlight).toBe(2);
    expect(snapshot.queueBacklog).toBe(1);
    expect(snapshot.cpuUsage).toBeGreaterThan(0);
    expect(snapshot.memoryUsage).toBeGreaterThan(30);
  });

  it("keeps service lookup strict and routes through dependencies", () => {
    const definitions = makeConfig().serviceDefinitions;
    const registry = new ServiceRegistry(definitions);
    const graph = new DependencyGraph(definitions);
    const router = new RequestRouter(registry, graph, new SeededRandom(7));
    const route = { id: "read", entryServiceId: "edge", targetServiceId: "api", weight: 1 };
    const request = router.route("request-1", route);
    expect(request.path).toEqual(["edge", "api", "database"]);
    expect(request.connectionIds).toEqual(["edge-api", "api-database"]);
    expect(request.outcome).toBe("success");
    expect(() => registry.get("missing")).toThrow(/unknown service/i);
  });

  it("propagates a failed dependency back along the request path", () => {
    const config = makeConfig();
    const registry = new ServiceRegistry(config.serviceDefinitions);
    registry.transition("database", "failed");
    const router = new RequestRouter(
      registry,
      new DependencyGraph(config.serviceDefinitions),
      new SeededRandom(8),
    );
    const result = router.route("request-failed", config.routes[0]);
    expect(result.outcome).toBe("failure");
    expect(result.failedAt).toBe("database");
    expect(result.path).toEqual(["edge", "api", "database"]);
    expect(result.connectionIds).toEqual(["edge-api", "api-database"]);
  });
});

describe("metrics collection and aggregation", () => {
  it("calculates throughput, latency, error rate, and per-edge activity from samples", () => {
    const collector = new MetricsCollector();
    collector.record(trace(), 500);
    collector.record(
      trace({
        requestId: "request-2",
        latencyMs: 30,
        outcome: "failure",
        failedAt: "api",
        serviceSamples: [
          { serviceId: "edge", latencyMs: 10, accepted: true },
          { serviceId: "api", latencyMs: 18, accepted: true },
        ],
        connectionSamples: [{ connectionId: "edge-api", latencyMs: 30 }],
      }),
      1500,
    );
    const aggregate = collector.aggregate(2000, 1000);
    expect(aggregate.requestsPerSecond).toBe(1);
    expect(aggregate.errorRate).toBe(100);
    expect(aggregate.averageLatencyMs).toBe(30);
    expect(aggregate.byService.get("api")?.errorRate).toBe(100);
    expect(aggregate.byConnection.get("edge-api")?.throughput).toBe(1);
    expect(aggregate.byConnection.get("edge-api")?.averageLatencyMs).toBe(30);
    expect(aggregate.completedRequests).toBe(2);
  });

  it("combines measured metrics with live registry resource state", () => {
    const config = makeConfig();
    const registry = new ServiceRegistry(config.serviceDefinitions);
    const collector = new MetricsCollector();
    collector.record(trace(), 100);
    const aggregator = new MetricsAggregator(config, registry, collector);
    const aggregate = aggregator.aggregate(1000);
    const services = aggregator.snapshotServices(1000, aggregate);
    const connections = aggregator.snapshotConnections(
      new DependencyGraph(config.serviceDefinitions).edges(),
      aggregate,
    );
    expect(services.find((service) => service.id === "edge")?.requestsPerSecond).toBeGreaterThan(0);
    expect(
      connections.find((connection) => connection.id === "edge-api")?.throughput,
    ).toBeGreaterThan(0);
  });
});

describe("SimulationEngine", () => {
  let config: SimulationConfig;

  beforeEach(() => {
    config = makeConfig();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances real request traffic and derives service and aggregate metrics", () => {
    const engine = new SimulationEngine(config);
    const state = engine.advanceBy(2000);
    expect(state.tick).toBe(20);
    expect(state.metrics.completedRequests).toBeGreaterThan(10);
    expect(state.metrics.requestsPerSecond).toBeGreaterThan(0);
    expect(state.metrics.averageLatencyMs).toBeGreaterThan(0);
    expect(
      state.services.find((service) => service.id === "api")?.requestsPerSecond,
    ).toBeGreaterThan(0);
    expect(
      state.services.find((service) => service.id === "database")?.requestsPerSecond,
    ).toBeGreaterThan(0);
    expect(
      state.connections.find((connection) => connection.id === "api-database")?.throughput,
    ).toBeGreaterThan(0);
  });

  it("propagates endpoint failures into upstream service and request error metrics", () => {
    const engine = new SimulationEngine(config);
    engine.failService("database");
    const state = engine.advanceBy(1500);
    expect(state.metrics.failedRequests).toBeGreaterThan(0);
    expect(state.metrics.errorRate).toBe(100);
    expect(state.services.find((service) => service.id === "edge")?.errorRate).toBe(100);
    expect(state.services.find((service) => service.id === "api")?.errorRate).toBe(100);
    expect(state.services.find((service) => service.id === "database")?.health).toBe("failed");
  });

  it("raises health state when traffic saturates a dependency", () => {
    const overloadedConfig = makeConfig({
      requestsPerSecond: 30,
      serviceDefinitions: [
        definition("edge", "entry", ["api"], {
          capacityRequestsPerSecond: 2,
          maxConcurrentRequests: 1,
        }),
        definition("api", "core", ["database"], {
          capacityRequestsPerSecond: 2,
          maxConcurrentRequests: 1,
        }),
        definition("database", "data", [], {
          capacityRequestsPerSecond: 2,
          maxConcurrentRequests: 1,
        }),
      ],
    });
    const engine = new SimulationEngine(overloadedConfig);
    engine.setTrafficMultiplier(3);
    const firstTick = engine.advanceBy(100);
    expect(firstTick.services.some((service) => service.queueBacklog > 0)).toBe(true);
    const state = engine.advanceBy(900);
    expect(
      state.events.some(
        (event) =>
          event.type === "service.health.changed" &&
          (event.to === "high-load" || event.to === "critical"),
      ),
    ).toBe(true);
  });

  it("applies failure and deterministic recovery transitions", () => {
    const engine = new SimulationEngine(config);
    engine.failService("api");
    expect(engine.getSnapshot().services.find((service) => service.id === "api")?.health).toBe(
      "failed",
    );
    expect(engine.beginServiceRecovery("api")).toBe(true);
    expect(engine.getSnapshot().services.find((service) => service.id === "api")?.health).toBe(
      "recovering",
    );
    engine.advanceBy(config.recoveryDurationMs);
    expect(engine.getSnapshot().services.find((service) => service.id === "api")?.health).toBe(
      "healthy",
    );
    expect(engine.beginServiceRecovery("api")).toBe(false);
  });

  it("automatically begins recovery after a transient critical fault", () => {
    const engine = new SimulationEngine(makeConfig({ requestsPerSecond: 0 }));
    engine.injectCriticalFault("api");
    engine.advanceBy(config.automaticRecoveryDelayMs);
    expect(engine.getSnapshot().services.find((service) => service.id === "api")?.health).toBe(
      "recovering",
    );
    engine.advanceBy(config.recoveryDurationMs);
    expect(engine.getSnapshot().services.find((service) => service.id === "api")?.health).toBe(
      "healthy",
    );
  });

  it("replays the same scenario, seed, and configuration exactly", () => {
    const left = new SimulationEngine(config);
    const right = new SimulationEngine(config);
    expect(left.advanceBy(5000)).toEqual(right.advanceBy(5000));
  });

  it("delivers typed events and batches snapshot notifications per advance", () => {
    const engine = new SimulationEngine(config);
    let subscriptions = 0;
    let completed = 0;
    const unsubscribe = engine.subscribe(() => subscriptions++);
    const unsubscribeEvents = engine.on("request.completed", (event) => {
      expect(event.outcome).toMatch(/success|failure/);
      completed += 1;
    });
    engine.advanceBy(1000);
    expect(subscriptions).toBe(1);
    expect(completed).toBeGreaterThan(0);
    unsubscribe();
    unsubscribeEvents();
  });

  it("runs through its wall-clock adapter and stops cleanly when paused", () => {
    vi.useFakeTimers();
    const engine = new SimulationEngine(config);
    engine.start();
    vi.advanceTimersByTime(1000);
    const activeTick = engine.getSnapshot().tick;
    expect(engine.getSnapshot().status).toBe("running");
    expect(activeTick).toBeGreaterThan(0);
    engine.pause();
    vi.advanceTimersByTime(1000);
    expect(engine.getSnapshot().status).toBe("paused");
    expect(engine.getSnapshot().tick).toBe(activeTick);
  });

  it("resets its random stream and service state for a repeatable replay", () => {
    const engine = new SimulationEngine(config);
    const original = engine.advanceBy(2500);
    engine.reset(false);
    const replay = engine.advanceBy(2500);
    expect(replay.services).toEqual(original.services);
    expect(replay.metrics).toEqual(original.metrics);
    expect(replay.connections).toEqual(original.connections);
  });
});
