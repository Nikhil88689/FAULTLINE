import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChaosExperimentConfig } from "@/types/chaos-lab";
import { DependencyGraph } from "./dependency-graph";
import { observatoryRoutes, defaultSimulationConfig } from "./observatory-scenario";
import { RequestRouter } from "./request-router";
import { SeededRandom } from "./seeded-random";
import { ServiceRegistry } from "./service-registry";
import { SimulationEngine } from "./simulation-engine";
import { ChaosExperimentRunner } from "./chaos-experiment-runner";
import { isPersistableIncident } from "../services/incident-validation";

const baseline: ChaosExperimentConfig = {
  name: "Database outage verification",
  faultType: "database-outage",
  targetServiceId: "postgres",
  intensity: 100,
  durationSeconds: 5,
  trafficVolume: 1,
  failureProbability: 1,
  recoveryStrategy: "fallback-cache",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("chaos faults and recovery policies", () => {
  it("propagates a database outage through service dependencies", () => {
    const engine = new SimulationEngine();
    engine.failService("postgres");
    const state = engine.advanceBy(1_000);

    expect(state.services.find((service) => service.id === "postgres")?.health).toBe("failed");
    expect(state.metrics.failedRequests).toBeGreaterThan(0);
    expect(
      state.events.some(
        (event) =>
          event.type === "request.completed" &&
          event.path.includes("postgres") &&
          event.outcome === "failure",
      ),
    ).toBe(true);
  });

  it("injects latency and failure probability into real request traces", () => {
    const engine = new SimulationEngine();
    engine.applyFaultProfile("payment", { latencyMs: 600, failureProbability: 0.8 });
    const state = engine.advanceBy(2_000);
    const payment = state.services.find((service) => service.id === "payment");

    expect(payment?.averageLatencyMs).toBeGreaterThan(100);
    expect(state.metrics.failedRequests).toBeGreaterThan(0);
    expect(
      state.events.some(
        (event) => event.type === "request.completed" && event.failedAt === "payment",
      ),
    ).toBe(true);
  });

  it("retries failed calls with exponential backoff", () => {
    const registry = new ServiceRegistry(defaultSimulationConfig.serviceDefinitions);
    registry.get("payment").setFaultProfile({ failureProbability: 1 });
    const random = new SeededRandom(3);
    vi.spyOn(random, "next").mockReturnValue(0.5);
    const router = new RequestRouter(
      registry,
      new DependencyGraph(defaultSimulationConfig.serviceDefinitions),
      random,
    );
    const actions: string[] = [];
    router.setRecoveryPolicy("retry-backoff", "payment", (_id, action) => actions.push(action));

    const trace = router.route(
      "retry-1",
      observatoryRoutes.find((route) => route.id === "payment-authorize")!,
    );

    expect(trace.outcome).toBe("failure");
    expect(actions).toContain("retry 1 scheduled after 50 ms exponential backoff");
    expect(actions).toContain("retry 2 scheduled after 100 ms exponential backoff");
    expect(trace.latencyMs).toBeGreaterThan(150);
  });

  it("opens a circuit breaker after repeated dependency failures", () => {
    const registry = new ServiceRegistry(defaultSimulationConfig.serviceDefinitions);
    registry.get("postgres").transitionHealth("failed");
    const random = new SeededRandom(19);
    vi.spyOn(random, "next").mockReturnValue(0.5);
    const router = new RequestRouter(
      registry,
      new DependencyGraph(defaultSimulationConfig.serviceDefinitions),
      random,
    );
    const actions: string[] = [];
    router.setRecoveryPolicy("circuit-breaker", "postgres", (_id, action) => actions.push(action));
    const route = observatoryRoutes.find((item) => item.id === "profile-read")!;

    router.route("breaker-1", route);
    router.route("breaker-2", route);
    router.route("breaker-3", route);
    const shortCircuited = router.route("breaker-4", route);

    expect(actions).toContain("circuit opened after three consecutive request failures");
    expect(shortCircuited.reason).toContain("open circuit breaker");
  });

  it("serves a healthy stale read through the fallback cache", () => {
    const registry = new ServiceRegistry(defaultSimulationConfig.serviceDefinitions);
    registry.get("postgres").transitionHealth("failed");
    const random = new SeededRandom(21);
    vi.spyOn(random, "next").mockReturnValue(0.5);
    const router = new RequestRouter(
      registry,
      new DependencyGraph(defaultSimulationConfig.serviceDefinitions),
      random,
    );
    const actions: string[] = [];
    router.setRecoveryPolicy("fallback-cache", "postgres", (_id, action) => actions.push(action));

    const trace = router.route(
      "fallback-1",
      observatoryRoutes.find((route) => route.id === "profile-read")!,
    );

    expect(trace.outcome).toBe("success");
    expect(trace.bypassedServiceIds).toContain("postgres");
    expect(actions).toContain("served a stale read from the local fallback cache");
    expect(trace.path).toContain("redis");
  });

  it("redistributes eligible reads to the healthy cache tier", () => {
    const registry = new ServiceRegistry(defaultSimulationConfig.serviceDefinitions);
    registry.get("postgres").transitionHealth("failed");
    const random = new SeededRandom(21);
    vi.spyOn(random, "next").mockReturnValue(0.5);
    const router = new RequestRouter(
      registry,
      new DependencyGraph(defaultSimulationConfig.serviceDefinitions),
      random,
    );
    const actions: string[] = [];
    router.setRecoveryPolicy("traffic-redistribution", "postgres", (_id, action) =>
      actions.push(action),
    );

    const trace = router.route(
      "route-shift-1",
      observatoryRoutes.find((route) => route.id === "profile-read")!,
    );

    expect(trace.outcome).toBe("success");
    expect(trace.path).toContain("redis");
    expect(actions).toContain("redistributed a read to the healthy cache tier");
  });

  it("shows lower CPU after horizontal capacity scaling", () => {
    const standard = new SimulationEngine();
    const scaled = new SimulationEngine();
    standard.setTrafficMultiplier(3);
    scaled.setTrafficMultiplier(3);
    scaled.setServiceScale("gateway", 2.5);
    const standardCpu = standard
      .advanceBy(2_000)
      .services.find((service) => service.id === "gateway")!.cpuUsage;
    const scaledCpu = scaled
      .advanceBy(2_000)
      .services.find((service) => service.id === "gateway")!.cpuUsage;

    expect(scaledCpu).toBeLessThan(standardCpu);
  });

  it("restarts a failed service and completes recovery on the simulation clock", () => {
    const engine = new SimulationEngine();
    engine.failService("redis");
    expect(engine.beginServiceRecovery("redis")).toBe(true);
    expect(engine.getSnapshot().services.find((service) => service.id === "redis")?.health).toBe(
      "recovering",
    );
    const state = engine.advanceBy(defaultSimulationConfig.recoveryDurationMs);

    expect(state.services.find((service) => service.id === "redis")?.health).toBe("healthy");
    expect(
      state.events.some(
        (event) => event.type === "service.recovery.completed" && event.serviceId === "redis",
      ),
    ).toBe(true);
  });

  it("selects random termination targets deterministically from the engine seed", () => {
    const left = new SimulationEngine();
    const right = new SimulationEngine();
    const leftTarget = left.chooseRandomService(["gateway"]);
    const rightTarget = right.chooseRandomService(["gateway"]);

    expect(leftTarget).toBe(rightTarget);
    expect(leftTarget).not.toBe("gateway");
  });
});

describe("experiment lifecycle", () => {
  it("keeps repeated recovery actions from hiding the original failure in the lab feed", () => {
    vi.useFakeTimers();
    const engine = new SimulationEngine();
    const runner = new ChaosExperimentRunner(engine);
    runner.prepare(baseline);
    runner.confirm();

    vi.advanceTimersByTime(2_000);

    const repeatedActions = engine
      .getSnapshot()
      .events.filter(
        (event) => event.type === "resilience.activated" && event.strategy === "fallback-cache",
      );
    const feedMessages = runner
      .getSnapshot()
      .logs.filter((entry) => entry.message.includes("fallback-cache: served a stale read"));
    expect(repeatedActions.length).toBeGreaterThan(1);
    expect(feedMessages).toHaveLength(1);
    expect(runner.getSnapshot().logs.some((entry) => entry.message.includes("injected into"))).toBe(
      true,
    );

    engine.pause();
    runner.dispose();
  });

  it("validates, preflights, runs, restores, and reports a deterministic experiment", () => {
    vi.useFakeTimers();
    const engine = new SimulationEngine();
    const completedIncidents: import("@/types/incidents").IncidentRecord[] = [];
    const runner = new ChaosExperimentRunner(engine, (incident) => {
      completedIncidents.push(incident);
    });
    const prepared = runner.prepare(baseline);
    expect(prepared.phase).toBe("confirmation");
    runner.confirm();
    expect(runner.getSnapshot().phase).toBe("execution");
    expect(engine.getSnapshot().services.find((service) => service.id === "postgres")?.health).toBe(
      "failed",
    );

    vi.advanceTimersByTime(22_000);

    const completed = runner.getSnapshot();
    expect(
      completed.phase,
      JSON.stringify({
        health: engine.getSnapshot().services.map(({ id, health }) => [id, health]),
        logs: completed.logs.slice(-15),
        elapsed: completed.elapsedMs,
      }),
    ).toBe("results");
    expect(completed.result?.requests).toBeGreaterThan(0);
    expect(completed.result?.failedRequests).toBeGreaterThan(0);
    expect(completed.result?.durationMs).toBe(5_000);
    expect(completed.result?.affectedServices).toContain("user");
    expect(completed.result?.recoveredServices).toContain("postgres");
    expect(
      engine.getSnapshot().services.find((service) => service.id === "postgres")?.health,
    ).not.toBe("failed");
    expect(completedIncidents).toHaveLength(1);
    expect(isPersistableIncident(completedIncidents[0])).toBe(true);
    expect(completedIncidents[0]?.failureConfiguration).toEqual({ ...baseline });
    expect(completedIncidents[0]?.affectedServices).toContain("user");
    expect(
      completedIncidents[0]?.events.some(
        (event) => event.type === "service.health.changed" && event.to === "failed",
      ),
    ).toBe(true);
    expect(
      completedIncidents[0]?.events.some((event) => event.type === "service.recovery.completed"),
    ).toBe(true);
    expect(completedIncidents[0]?.replayFrames.length).toBeGreaterThan(1);
    expect(completedIncidents[0]?.metrics.failedRequests).toBeGreaterThan(0);
    runner.dispose();
  });

  it("rejects invalid experiment configuration before preflight", () => {
    const runner = new ChaosExperimentRunner(new SimulationEngine());
    const state = runner.prepare({ ...baseline, durationSeconds: 1, targetServiceId: "missing" });

    expect(state.phase).toBe("failed");
    expect(state.validationErrors.length).toBeGreaterThanOrEqual(2);
    runner.dispose();
  });

  it("pauses and resumes the same virtual clock, then supports operator stop", () => {
    vi.useFakeTimers();
    const engine = new SimulationEngine();
    const runner = new ChaosExperimentRunner(engine);
    runner.prepare({ ...baseline, faultType: "network-latency", targetServiceId: "payment" });
    runner.confirm();
    vi.advanceTimersByTime(400);
    runner.pause();
    const pausedAt = engine.nowMs;
    vi.advanceTimersByTime(1_000);
    expect(engine.nowMs).toBe(pausedAt);
    runner.resume();
    vi.advanceTimersByTime(300);
    expect(engine.nowMs).toBeGreaterThan(pausedAt);
    runner.stop();
    vi.advanceTimersByTime(24_000);
    expect(runner.getSnapshot().phase).toBe("results");
    expect(runner.getSnapshot().result?.stoppedEarly).toBe(true);
    runner.dispose();
  });

  it("cascades failure through dependent services in staged waves", () => {
    vi.useFakeTimers();
    const engine = new SimulationEngine();
    const runner = new ChaosExperimentRunner(engine);
    runner.prepare({
      ...baseline,
      name: "Dependency cascade",
      faultType: "cascading-failure",
      durationSeconds: 10,
      recoveryStrategy: "none",
    });
    runner.confirm();
    vi.advanceTimersByTime(2_100);

    const failedIds = engine
      .getSnapshot()
      .services.filter((service) => service.health === "failed")
      .map((service) => service.id);
    expect(failedIds).toContain("postgres");
    expect(failedIds).toContain("user");
    expect(failedIds).toContain("payment");
    runner.reset();
    expect(runner.getSnapshot().phase).toBe("configuration");
    expect(engine.getSnapshot().services.every((service) => service.health === "healthy")).toBe(
      true,
    );
    runner.dispose();
  });

  it("resets engine, experiment state, and virtual time", () => {
    vi.useFakeTimers();
    const engine = new SimulationEngine();
    const runner = new ChaosExperimentRunner(engine);
    runner.prepare(baseline);
    runner.confirm();
    vi.advanceTimersByTime(500);
    runner.reset();

    expect(runner.getSnapshot().phase).toBe("configuration");
    expect(runner.getSnapshot().config).toBeNull();
    expect(engine.nowMs).toBe(0);
    expect(engine.getSnapshot().services.every((service) => service.health === "healthy")).toBe(
      true,
    );
    runner.dispose();
  });
});
