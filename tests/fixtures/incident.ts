import { SimulationEngine } from "../../simulation/simulation-engine";
import type { IncidentRecord, IncidentReplayFrame } from "../../types/incidents";

export function makeIncidentFixture(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  const state = new SimulationEngine().getSnapshot();
  const { events, ...snapshot } = state;
  void events;
  const frame: IncidentReplayFrame = { ...snapshot, eventSequence: 0 };
  const base: IncidentRecord = {
    id: "FL-TEST-000001",
    name: "Database outage resilience check",
    timestamp: "2026-11-07T12:00:00.000Z",
    occurredAt: "2026-11-07T11:59:55.000Z",
    severity: "low",
    affectedServices: [],
    rootCause: "Database outage injected into postgres",
    failureConfiguration: {
      name: "Database outage resilience check",
      faultType: "database-outage",
      targetServiceId: "postgres",
      intensity: 100,
      durationSeconds: 1,
      trafficVolume: 1,
      failureProbability: 1,
      recoveryStrategy: "fallback-cache",
    },
    recoveryActions: [],
    durationMs: 0,
    finalOutcome: "recovered",
    metrics: {
      requests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      peakErrorRate: 0,
      peakLatencyMs: 0,
      finalErrorRate: 0,
      finalLatencyMs: 0,
      affectedCount: 0,
    },
    simulationStartMs: 0,
    simulationEndMs: 0,
    events: [],
    replayFrames: [frame],
    latencySamplesMs: [],
  };
  return { ...base, ...overrides };
}
