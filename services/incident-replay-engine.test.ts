import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncidentRecord, IncidentReplayFrame } from "@/types/incidents";
import type { SimulationEvent } from "@/types/observatory-runtime";
import { SimulationEngine } from "../simulation/simulation-engine";
import { IncidentReplayEngine } from "./incident-replay-engine";

afterEach(() => vi.useRealTimers());

function frame(
  engine: SimulationEngine,
  nowMs: number,
  eventSequence: number,
  health: "healthy" | "failed" = "healthy",
): IncidentReplayFrame {
  const state = engine.getSnapshot();
  return {
    version: state.version,
    tick: Math.floor(nowMs / engine.config.tickMs),
    nowMs,
    status: "paused",
    speedMultiplier: 1,
    trafficMultiplier: 1,
    services: state.services.map((service) => ({
      ...service,
      health: service.id === "postgres" ? health : service.health,
    })),
    connections: state.connections,
    metrics: {
      ...state.metrics,
      completedRequests: nowMs / 100,
      failedRequests: health === "failed" ? 5 : 0,
      successfulRequests: health === "failed" ? 0 : nowMs / 100,
      errorRate: health === "failed" ? 100 : 0,
    },
    eventSequence,
  };
}

function incident(engine: SimulationEngine): IncidentRecord {
  const initial = frame(engine, 0, 0);
  const later = frame(engine, 800, 1);
  const events: SimulationEvent[] = [
    {
      type: "service.health.changed",
      sequence: 2,
      atMs: 300,
      serviceId: "postgres",
      from: "healthy",
      to: "failed",
      reason: "Database unavailable",
    },
    { type: "service.recovery.completed", sequence: 3, atMs: 650, serviceId: "postgres" },
  ];
  return {
    id: "FL-TEST-001",
    name: "Database outage",
    timestamp: "2026-11-07T00:00:00.000Z",
    severity: "critical",
    affectedServices: ["postgres", "user"],
    rootCause: "database outage at postgres",
    failureConfiguration: {
      name: "Database outage",
      faultType: "database-outage",
      targetServiceId: "postgres",
      intensity: 100,
      durationSeconds: 5,
      trafficVolume: 1,
      failureProbability: 1,
      recoveryStrategy: "fallback-cache",
    },
    recoveryActions: ["Fallback cache served dependent requests"],
    durationMs: 500,
    finalOutcome: "recovered",
    metrics: {
      requests: 30,
      successfulRequests: 14,
      failedRequests: 16,
      peakErrorRate: 53,
      peakLatencyMs: 900,
      finalErrorRate: 0,
      finalLatencyMs: 40,
      affectedCount: 2,
    },
    simulationStartMs: 0,
    simulationEndMs: 1_000,
    events,
    replayFrames: [initial, later],
  };
}

describe("IncidentReplayEngine", () => {
  it("reconstructs service health from the nearest frame and intervening typed events", () => {
    const engine = new SimulationEngine();
    const replay = new IncidentReplayEngine(incident(engine));
    replay.seek(500);
    expect(
      replay.getSnapshot().state.services.find((service) => service.id === "postgres")?.health,
    ).toBe("failed");
    expect(replay.getSnapshot().state.metrics.errorRate).toBe(0);
    replay.seek(700);
    expect(
      replay.getSnapshot().state.services.find((service) => service.id === "postgres")?.health,
    ).toBe("healthy");
    expect(
      replay.getSnapshot().state.services.find((service) => service.id === "postgres")
        ?.recoveryStep,
    ).toBe(6);
    replay.dispose();
  });

  it("seeks to adjacent events and restarts at the incident boundary", () => {
    const replay = new IncidentReplayEngine(incident(new SimulationEngine()));
    replay.nextEvent();
    expect(replay.getSnapshot().cursorMs).toBe(300);
    expect(
      replay.getSnapshot().state.services.find((service) => service.id === "postgres")?.health,
    ).toBe("failed");
    replay.nextEvent();
    expect(replay.getSnapshot().cursorMs).toBe(650);
    replay.previousEvent();
    expect(replay.getSnapshot().cursorMs).toBe(300);
    replay.restart();
    expect(replay.getSnapshot().cursorMs).toBe(0);
    expect(replay.getSnapshot().playing).toBe(false);
    replay.dispose();
  });

  it("steps through distinct events that share the same simulation timestamp", () => {
    const record = incident(new SimulationEngine());
    record.events = [
      record.events[0]!,
      {
        type: "resilience.activated",
        sequence: 3,
        atMs: 300,
        serviceId: "postgres",
        strategy: "fallback-cache",
        action: "served a stale read",
      },
      { type: "service.recovery.completed", sequence: 4, atMs: 650, serviceId: "postgres" },
    ];
    const replay = new IncidentReplayEngine(record);
    replay.nextEvent();
    expect(replay.getSnapshot().cursorMs).toBe(300);
    replay.nextEvent();
    expect(replay.getSnapshot().cursorMs).toBe(300);
    replay.previousEvent();
    expect(replay.getSnapshot().cursorMs).toBe(300);
    replay.previousEvent();
    expect(replay.getSnapshot().cursorMs).toBe(0);
    replay.dispose();
  });

  it("advances by the selected speed and pauses at the end of the recorded window", () => {
    vi.useFakeTimers();
    const replay = new IncidentReplayEngine(incident(new SimulationEngine()));
    replay.setSpeed(2);
    replay.play();
    vi.advanceTimersByTime(200);
    expect(replay.getSnapshot().cursorMs).toBe(400);
    expect(replay.getSnapshot().playing).toBe(true);
    vi.advanceTimersByTime(500);
    expect(replay.getSnapshot().cursorMs).toBe(1_000);
    expect(replay.getSnapshot().playing).toBe(false);
    replay.dispose();
  });

  it("rejects unsupported playback speeds and clamps seek values", () => {
    const replay = new IncidentReplayEngine(incident(new SimulationEngine()));
    expect(() => replay.setSpeed(3)).toThrow(RangeError);
    replay.seek(9_000);
    expect(replay.getSnapshot().cursorMs).toBe(1_000);
    replay.seek(-30);
    expect(replay.getSnapshot().cursorMs).toBe(0);
    replay.dispose();
  });
});
