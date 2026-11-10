import type {
  ChaosExperimentConfig,
  ChaosExperimentLog,
  ChaosExperimentResult,
  ChaosExperimentState,
} from "@/types/chaos-lab";
import type { IncidentReplayFrame, IncidentRecord } from "@/types/incidents";
import type { SimulationEvent, SimulationState } from "@/types/observatory-runtime";
import { createIncidentRecord } from "../types/incidents";
import { saveIncident } from "../services/incident-store";
import { defaultSimulationConfig } from "./observatory-scenario";
import { observatorySimulation } from "./observatory-store";
import { SimulationEngine } from "./simulation-engine";

const logLimit = 80;
const replayEventLimit = 5_000;

/** Owns the lab lifecycle while all service and request behavior stays in the engine. */
export class ChaosExperimentRunner {
  private state: ChaosExperimentState = {
    phase: "configuration",
    config: null,
    validationErrors: [],
    precheckWarnings: [],
    startedAtMs: null,
    endsAtMs: null,
    elapsedMs: 0,
    logs: [],
    result: null,
  };
  private listeners = new Set<() => void>();
  private cascadeServiceIds: string[] = [];
  private cascadeApplied = 0;
  private preRecoveryMetrics: SimulationState["metrics"] | null = null;
  private peakErrorRate = 0;
  private peakLatencyMs = 0;
  private pendingRecoveredServices = new Set<string>();
  private recoveredServices = new Set<string>();
  private stoppedEarly = false;
  private injectionEndedAtMs: number | null = null;
  private recoverySettlingUntilMs: number | null = null;
  private logSequence = 0;
  private recordedEvents: SimulationEvent[] = [];
  private replayFrames: IncidentReplayFrame[] = [];
  private lastFrameAtMs = Number.NEGATIVE_INFINITY;
  private recording = false;
  private latencySamplesMs: number[] = [];
  private occurredAt: string | null = null;
  private loggedResilienceActions = new Set<string>();
  private readonly unsubscribers: Array<() => void>;

  constructor(
    private readonly engine: SimulationEngine,
    private readonly onIncidentCompleted: (
      record: IncidentRecord,
    ) => void | Promise<unknown> = saveIncident,
  ) {
    this.unsubscribers = [
      engine.subscribe(() => this.captureReplayFrame()),
      engine.on("simulation.tick", () => this.onTick()),
      engine.on("service.recovery.completed", (event) => {
        this.recordEvent(event);
        this.onRecoveryCompleted(event.serviceId);
      }),
      engine.on("service.health.changed", (event) => {
        this.recordEvent(event);
        if (this.state.phase === "completion" && event.to === "recovering") {
          this.pendingRecoveredServices.add(event.serviceId);
          this.addLog(
            "info",
            `${this.serviceName(event.serviceId)} entered automatic recovery and is being tracked.`,
          );
        }
        if (this.state.phase === "execution" || this.state.phase === "paused") {
          this.addLog(
            event.to === "failed" || event.to === "critical" ? "critical" : "info",
            `${this.serviceName(event.serviceId)} transitioned ${event.from} → ${event.to}. ${event.reason}`,
          );
        }
      }),
      engine.on("resilience.activated", (event) => {
        this.recordEvent(event);
        if (this.state.phase === "execution" || this.state.phase === "paused") {
          const actionKey = `${event.strategy}:${event.serviceId}:${event.action}`;
          if (!this.loggedResilienceActions.has(actionKey)) {
            this.loggedResilienceActions.add(actionKey);
            this.addLog(
              "success",
              `${event.strategy}: ${event.action} · ${this.serviceName(event.serviceId)}.`,
            );
          }
        }
      }),
      engine.on("simulation.started", (event) => this.recordEvent(event)),
      engine.on("simulation.paused", (event) => this.recordEvent(event)),
      engine.on("traffic.rate.changed", (event) => this.recordEvent(event)),
      engine.on("request.completed", (event) => {
        if (this.recording && (this.state.phase === "execution" || this.state.phase === "paused")) {
          this.latencySamplesMs.push(event.latencyMs);
        }
        if (event.outcome === "failure") this.recordEvent(event);
      }),
    ];
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ChaosExperimentState => this.state;
  readonly getServerSnapshot = (): ChaosExperimentState => this.state;

  prepare(config: ChaosExperimentConfig): ChaosExperimentState {
    if (this.state.phase === "execution" || this.state.phase === "paused") {
      this.addLog("warning", "Stop or reset the active run before preparing another experiment.");
      return this.state;
    }
    const validationErrors = validateConfig(config, this.engine);
    this.patch({
      phase: "validation",
      config: { ...config },
      validationErrors,
      precheckWarnings: [],
      startedAtMs: null,
      endsAtMs: null,
      elapsedMs: 0,
      result: null,
      logs: [],
    });
    if (validationErrors.length) {
      for (const error of validationErrors) this.addLog("critical", error);
      this.patch({ phase: "failed" });
      return this.state;
    }

    this.addLog(
      "success",
      "Configuration validated against the service registry and execution limits.",
    );
    this.patch({ phase: "precheck" });
    const services = this.engine.getSnapshot().services;
    const targetHealth = services.find((service) => service.id === config.targetServiceId)?.health;
    const precheckWarnings =
      targetHealth && targetHealth !== "healthy"
        ? [
            `Target precheck reports ${targetHealth} health. Reset telemetry or proceed with awareness.`,
          ]
        : [];
    this.patch({ phase: "confirmation", precheckWarnings });
    this.addLog(
      precheckWarnings.length ? "warning" : "success",
      precheckWarnings[0] ??
        "Pre-experiment health check passed. No active service faults detected.",
    );
    this.addLog("info", `${config.name} is staged. Confirm to inject the configured fault.`);
    return this.state;
  }

  confirm(): void {
    const config = this.state.config;
    if (!config || this.state.phase !== "confirmation") return;
    const actualTarget =
      config.faultType === "random-termination"
        ? this.engine.chooseRandomService(["gateway"])
        : config.targetServiceId;
    const activeConfig = { ...config, targetServiceId: actualTarget };
    const start = this.engine.nowMs;
    this.stoppedEarly = false;
    this.injectionEndedAtMs = null;
    this.recoverySettlingUntilMs = null;
    this.recoveredServices.clear();
    this.cascadeServiceIds =
      config.faultType === "cascading-failure" ? this.getDependentServices(actualTarget) : [];
    this.cascadeApplied = 0;
    this.pendingRecoveredServices.clear();
    this.preRecoveryMetrics = null;
    this.peakErrorRate = this.engine.getSnapshot().metrics.errorRate;
    this.peakLatencyMs = this.engine.getSnapshot().metrics.averageLatencyMs;
    this.loggedResilienceActions.clear();
    this.engine.setAutomaticRecoverySuppression(this.getDependentServices(actualTarget));
    this.recordedEvents = [];
    this.replayFrames = [];
    this.latencySamplesMs = [];
    this.occurredAt = new Date().toISOString();
    this.lastFrameAtMs = Number.NEGATIVE_INFINITY;
    this.recording = true;
    this.captureReplayFrame(true, start - 1);
    this.patch({
      phase: "execution",
      config: activeConfig,
      startedAtMs: start,
      endsAtMs: start + config.durationSeconds * 1_000,
      elapsedMs: 0,
      result: null,
    });

    this.engine.setTrafficMultiplier(config.trafficVolume);
    this.engine.activateRecoveryStrategy(config.recoveryStrategy, actualTarget);
    this.injectFault(activeConfig);
    this.addLog(
      "critical",
      `${faultLabel(config.faultType)} injected into ${this.serviceName(actualTarget)}.`,
    );
    this.addLog(
      "info",
      `Live run started · ${config.durationSeconds}s virtual duration · ${config.intensity}% intensity.`,
    );
    if (config.recoveryStrategy === "service-restart") {
      this.addLog(
        "info",
        "Restart policy armed. The target will enter recovery midway through the run.",
      );
    }
    this.engine.start();
  }

  pause(): void {
    if (this.state.phase !== "execution") return;
    this.engine.pause();
    this.patch({ phase: "paused" });
    this.addLog("warning", "Experiment paused. Virtual time and traffic generation are held.");
  }

  resume(): void {
    if (this.state.phase !== "paused") return;
    this.patch({ phase: "execution" });
    this.engine.start();
    this.addLog("success", "Experiment resumed from the saved simulation clock.");
  }

  stop(): void {
    if (this.state.phase !== "execution" && this.state.phase !== "paused") return;
    this.stoppedEarly = true;
    this.engine.pause();
    this.addLog("warning", "Operator requested an early stop. Fault injection is being withdrawn.");
    this.finishRun();
  }

  reset(): void {
    this.engine.reset(false);
    this.engine.clearChaosOverrides();
    this.cascadeServiceIds = [];
    this.cascadeApplied = 0;
    this.pendingRecoveredServices.clear();
    this.recoveredServices.clear();
    this.loggedResilienceActions.clear();
    this.preRecoveryMetrics = null;
    this.stoppedEarly = false;
    this.injectionEndedAtMs = null;
    this.recoverySettlingUntilMs = null;
    this.patch({
      phase: "configuration",
      config: null,
      validationErrors: [],
      precheckWarnings: [],
      startedAtMs: null,
      endsAtMs: null,
      elapsedMs: 0,
      logs: [],
      result: null,
    });
  }

  pauseForNavigation(): void {
    if (this.state.phase === "execution") this.pause();
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.listeners.clear();
  }

  private injectFault(config: ChaosExperimentConfig): void {
    const serviceId = config.targetServiceId;
    const probability = config.failureProbability;
    const intensity = config.intensity / 100;
    switch (config.faultType) {
      case "database-outage":
      case "redis-failure":
      case "authentication-outage":
      case "random-termination":
        this.engine.applyFaultProfile(serviceId, { failureProbability: 1 }, "failed");
        break;
      case "api-overload":
        this.engine.applyFaultProfile(
          serviceId,
          {
            capacityMultiplier: Math.max(0.12, 1 - intensity * 0.88),
            failureProbability: probability,
          },
          "critical",
        );
        break;
      case "network-latency":
        this.engine.applyFaultProfile(serviceId, {
          latencyMs: Math.round(40 + intensity * 1_160),
          failureProbability: probability,
        });
        break;
      case "queue-backlog":
        this.engine.applyFaultProfile(
          serviceId,
          {
            latencyMs: Math.round(25 + intensity * 400),
            capacityMultiplier: Math.max(0.18, 1 - intensity * 0.72),
            queuePressure: Math.round(2 + intensity * 30),
            failureProbability: probability,
          },
          "critical",
        );
        break;
      case "cascading-failure":
        this.engine.applyFaultProfile(serviceId, { failureProbability: 1 }, "failed");
        break;
      case "custom":
        this.engine.applyFaultProfile(
          serviceId,
          {
            latencyMs: Math.round(intensity * 450),
            capacityMultiplier: Math.max(0.25, 1 - intensity * 0.5),
            failureProbability: probability,
          },
          "critical",
        );
        break;
    }
  }

  private onTick(): void {
    if (this.state.phase === "completion") {
      this.settleRecovery();
      return;
    }
    if (this.state.phase !== "execution" || this.state.startedAtMs === null || !this.state.config)
      return;
    const elapsedMs = Math.max(0, this.engine.nowMs - this.state.startedAtMs);
    const snapshot = this.engine.getSnapshot();
    this.peakErrorRate = Math.max(
      this.peakErrorRate,
      snapshot.metrics.errorRate,
      ...snapshot.services.map((service) => service.errorRate),
    );
    this.peakLatencyMs = Math.max(
      this.peakLatencyMs,
      snapshot.metrics.averageLatencyMs,
      ...snapshot.services.map((service) => service.averageLatencyMs),
    );
    this.patch({ elapsedMs });
    if (this.state.config.faultType === "cascading-failure") {
      const dueCount = Math.min(this.cascadeServiceIds.length, Math.floor(elapsedMs / 650));
      while (this.cascadeApplied < dueCount) {
        const serviceId = this.cascadeServiceIds[this.cascadeApplied++];
        this.engine.applyFaultProfile(serviceId, { failureProbability: 1 }, "failed");
        this.addLog("critical", `Dependency cascade reached ${this.serviceName(serviceId)}.`);
      }
    }
    if (
      this.state.config.recoveryStrategy === "service-restart" &&
      elapsedMs >= this.state.config.durationSeconds * 500 &&
      this.state.config.targetServiceId &&
      !this.pendingRecoveredServices.has(this.state.config.targetServiceId)
    ) {
      const target = this.state.config.targetServiceId;
      if (this.engine.beginServiceRecovery(target, true)) {
        this.pendingRecoveredServices.add(target);
        this.addLog("success", `Restart controller is rebuilding ${this.serviceName(target)}.`);
      }
    }
    if (this.state.endsAtMs !== null && this.engine.nowMs >= this.state.endsAtMs) this.finishRun();
  }

  private finishRun(): void {
    if (!this.state.config || this.state.phase === "completion" || this.state.phase === "results")
      return;
    const config = this.state.config;
    this.injectionEndedAtMs = this.engine.nowMs;
    const metrics = this.engine.getSnapshot().metrics;
    this.preRecoveryMetrics = metrics;
    this.recoverySettlingUntilMs = this.engine.nowMs + this.engine.config.metricsWindowMs;
    const affected = new Set(this.getDependentServices(config.targetServiceId));
    this.engine.clearChaosOverrides([...affected]);
    const services = this.engine.getSnapshot().services;
    const toRecover = services
      .filter(
        (service) =>
          affected.has(service.id) &&
          (service.health !== "healthy" ||
            (service.id === config.targetServiceId && !this.recoveredServices.has(service.id))),
      )
      .map((service) => service.id)
      .reverse();
    for (const serviceId of toRecover) {
      if (this.engine.beginServiceRecovery(serviceId, true))
        this.pendingRecoveredServices.add(serviceId);
      else if (services.find((service) => service.id === serviceId)?.health === "recovering") {
        this.pendingRecoveredServices.add(serviceId);
      }
    }
    this.patch({ phase: "completion" });
    this.addLog("info", "Fault removed. Waiting for recovering services to rejoin the graph.");
    this.engine.start();
  }

  private onRecoveryCompleted(serviceId: string): void {
    const wasPending = this.pendingRecoveredServices.delete(serviceId);
    this.recoveredServices.add(serviceId);
    this.addLog(
      "success",
      `${this.serviceName(serviceId)} completed recovery and rejoined the graph.`,
    );
    if (wasPending && this.state.phase === "completion" && !this.pendingRecoveredServices.size)
      this.addLog(
        "info",
        "Repair complete. Holding traffic long enough to verify a stable health window.",
      );
  }

  private settleRecovery(): void {
    if (
      !this.state.config ||
      this.state.startedAtMs === null ||
      this.recoverySettlingUntilMs === null
    )
      return;
    const elapsedMs = Math.max(0, this.engine.nowMs - this.state.startedAtMs);
    this.patch({ elapsedMs });
    if (this.pendingRecoveredServices.size) return;

    const affected = new Set(this.getDependentServices(this.state.config.targetServiceId));
    const services = this.engine.getSnapshot().services;
    const unhealthy = services.filter(
      (service) =>
        affected.has(service.id) &&
        (service.health === "failed" ||
          service.health === "critical" ||
          service.health === "recovering"),
    );
    if (!unhealthy.length) {
      this.completeResults(this.state.config, this.state.startedAtMs);
      return;
    }
    if (this.engine.nowMs < this.recoverySettlingUntilMs) return;

    let restarted = 0;
    for (const service of unhealthy) {
      if (service.health === "recovering") {
        this.pendingRecoveredServices.add(service.id);
      } else if (this.engine.beginServiceRecovery(service.id, true)) {
        this.pendingRecoveredServices.add(service.id);
        restarted += 1;
      }
    }
    if (restarted || this.pendingRecoveredServices.size) {
      this.recoverySettlingUntilMs = this.engine.nowMs + this.engine.config.metricsWindowMs;
      this.addLog(
        "warning",
        `${unhealthy.length} affected service${unhealthy.length === 1 ? "" : "s"} still report degraded health; extending recovery verification.`,
      );
      return;
    }
    this.completeResults(this.state.config, this.state.startedAtMs);
  }

  private completeResults(config: ChaosExperimentConfig, startedAtMs: number): void {
    this.engine.setAutomaticRecoverySuppression([]);
    this.engine.pause();
    const metrics = this.preRecoveryMetrics ?? this.engine.getSnapshot().metrics;
    const affectedServices = this.getDependentServices(config.targetServiceId);
    this.captureReplayFrame(true);
    const finalState = this.engine.getSnapshot();
    const result: ChaosExperimentResult = {
      startedAtMs,
      endedAtMs: this.engine.nowMs,
      durationMs: Math.max(0, (this.injectionEndedAtMs ?? this.engine.nowMs) - startedAtMs),
      requests: metrics.completedRequests,
      successfulRequests: metrics.successfulRequests,
      failedRequests: metrics.failedRequests,
      peakErrorRate: Math.max(this.peakErrorRate, metrics.errorRate),
      peakLatencyMs: Math.max(this.peakLatencyMs, metrics.averageLatencyMs),
      affectedServices,
      recoveredServices: [...this.recoveredServices],
      stoppedEarly: this.stoppedEarly,
    };
    if (this.recording) {
      const incident = createIncidentRecord({
        config,
        startedAtMs,
        endedAtMs: result.endedAtMs,
        durationMs: result.durationMs,
        requests: result.requests,
        successfulRequests: result.successfulRequests,
        failedRequests: result.failedRequests,
        peakErrorRate: result.peakErrorRate,
        peakLatencyMs: result.peakLatencyMs,
        affectedServices,
        events: this.recordedEvents,
        replayFrames: this.replayFrames,
        latencySamplesMs: this.latencySamplesMs,
        finalState,
        occurredAt: this.occurredAt ?? undefined,
      });
      this.recording = false;
      void Promise.resolve(this.onIncidentCompleted(incident)).catch(() => undefined);
    }
    this.patch({
      phase: "results",
      elapsedMs: Math.max(0, result.endedAtMs - startedAtMs),
      result,
    });
    this.addLog(
      "success",
      `${config.name} closed. ${result.failedRequests} failed requests observed across ${result.requests} completions.`,
    );
  }

  private getDependentServices(targetId: string): string[] {
    const services = this.engine.getSnapshot().services;
    const affected = new Set<string>([targetId]);
    let added = true;
    while (added) {
      added = false;
      for (const service of services) {
        if (!affected.has(service.id) && service.dependsOn.some((id) => affected.has(id))) {
          affected.add(service.id);
          added = true;
        }
      }
    }
    return [...affected];
  }

  private serviceName(serviceId: string): string {
    return (
      this.engine.getSnapshot().services.find((service) => service.id === serviceId)?.name ??
      serviceId
    );
  }

  private recordEvent(event: SimulationEvent): void {
    if (!this.recording) return;
    if (this.recordedEvents.length >= replayEventLimit) {
      // Retain the leading causal events and the newest recovery tail if a run is unusually noisy.
      this.recordedEvents.splice(Math.floor(replayEventLimit / 2), 1);
    }
    this.recordedEvents.push(event);
  }

  private captureReplayFrame(force = false, atMs?: number): void {
    if (!this.recording) return;
    const state = this.engine.getSnapshot();
    const frameAt = atMs ?? state.nowMs;
    if (!force && frameAt - this.lastFrameAtMs < 1_000) return;
    const { events, ...frameState } = state;
    const eventSequence = events.at(-1)?.sequence ?? 0;
    this.replayFrames.push({ ...frameState, nowMs: frameAt, eventSequence });
    this.lastFrameAtMs = frameAt;
  }

  private addLog(level: ChaosExperimentLog["level"], message: string): void {
    const entry: ChaosExperimentLog = {
      id: `lab-${this.engine.nowMs}-${++this.logSequence}`,
      atMs: this.engine.nowMs,
      level,
      message,
    };
    this.patch({ logs: [...this.state.logs, entry].slice(-logLimit) });
  }

  private patch(patch: Partial<ChaosExperimentState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function validateConfig(config: ChaosExperimentConfig, engine: SimulationEngine): string[] {
  const errors: string[] = [];
  if (!config.name.trim()) errors.push("Give the experiment a scenario name.");
  if (!engine.getSnapshot().services.some((service) => service.id === config.targetServiceId)) {
    errors.push("Choose a target service from the registered infrastructure.");
  }
  if (!Number.isFinite(config.intensity) || config.intensity < 1 || config.intensity > 100) {
    errors.push("Failure intensity must be between 1% and 100%.");
  }
  if (
    !Number.isInteger(config.durationSeconds) ||
    config.durationSeconds < 5 ||
    config.durationSeconds > 180
  ) {
    errors.push("Duration must be between 5 and 180 seconds.");
  }
  if (
    !Number.isFinite(config.trafficVolume) ||
    config.trafficVolume < 0.1 ||
    config.trafficVolume > 6
  ) {
    errors.push("Traffic volume multiplier must be between 0.1× and 6×.");
  }
  if (
    !Number.isFinite(config.failureProbability) ||
    config.failureProbability < 0 ||
    config.failureProbability > 1
  ) {
    errors.push("Failure probability must be between 0% and 100%.");
  }
  if (
    !defaultSimulationConfig.serviceDefinitions.some(
      (service) => service.id === config.targetServiceId,
    )
  ) {
    errors.push("Target service is not part of this simulation scenario.");
  }
  return errors;
}

function faultLabel(faultType: ChaosExperimentConfig["faultType"]): string {
  return faultType.replaceAll("-", " ").toUpperCase();
}

export const chaosExperimentRunner = new ChaosExperimentRunner(observatorySimulation);
