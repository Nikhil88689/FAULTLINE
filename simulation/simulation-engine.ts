import type { RuntimeHealth, SimulationEvent, SimulationState } from "@/types/observatory-runtime";
import type { RuntimeConnection } from "@/types/observatory-runtime";
import type { RecoveryStrategy } from "@/types/chaos-lab";
import type {
  RequestTrace,
  SimulationConfig,
  SimulationTask,
  TrafficRoute,
} from "@/types/simulation";
import { DependencyGraph } from "./dependency-graph";
import { MetricsAggregator } from "./metrics-aggregator";
import { MetricsCollector } from "./metrics-collector";
import { RequestRouter } from "./request-router";
import { SeededRandom } from "./seeded-random";
import { ServiceRegistry } from "./service-registry";
import { SimulationClock } from "./simulation-clock";
import { SimulationScheduler } from "./simulation-scheduler";
import { TrafficGenerator } from "./traffic-generator";
import type { ServiceFaultProfile } from "./service-node";
import { defaultSimulationConfig } from "./observatory-scenario";

type SimulationEventInput = SimulationEvent extends infer Event
  ? Event extends SimulationEvent
    ? Omit<Event, "sequence" | "atMs">
    : never
  : never;
type EventOfType<Type extends SimulationEvent["type"]> = Extract<SimulationEvent, { type: Type }>;
type SimulationListener = () => void;
type TypedEventListener<Type extends SimulationEvent["type"]> = (event: EventOfType<Type>) => void;

const maxEvents = 120;
const minTrafficMultiplier = 0.1;
const maxTrafficMultiplier = 6;
const minSpeedMultiplier = 0.25;
const maxSpeedMultiplier = 8;

/**
 * Event-driven, deterministic distributed-system simulator.
 * Use advanceBy/runTicks for deterministic runs; start() is only a wall-clock adapter.
 */
export class SimulationEngine {
  readonly config: SimulationConfig;

  private clock = new SimulationClock();
  private scheduler = new SimulationScheduler<SimulationTask>();
  private random = new SeededRandom(1);
  private registry!: ServiceRegistry;
  private graph!: DependencyGraph;
  private topology: RuntimeConnection[] = [];
  private generator!: TrafficGenerator;
  private router!: RequestRouter;
  private collector = new MetricsCollector();
  private aggregator!: MetricsAggregator;
  private listeners = new Set<SimulationListener>();
  private typedListeners = new Map<
    SimulationEvent["type"],
    Set<(event: SimulationEvent) => void>
  >();
  private eventHistory: SimulationEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private requestSequence = 0;
  private inFlightRequests = new Set<string>();
  private externallyManagedFaults = new Set<string>();
  private tickNumber = 0;
  private speedMultiplier = 1;
  private trafficMultiplier = 1;
  private status: SimulationState["status"] = "paused";
  private stateVersion = 0;
  private snapshot!: SimulationState;

  constructor(config: SimulationConfig = defaultSimulationConfig) {
    this.config = cloneConfig(config);
    this.initializeCore();
    this.emit({ type: "simulation.reset" });
    this.snapshot = this.createSnapshot();
  }

  readonly subscribe = (listener: SimulationListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SimulationState => this.snapshot;

  readonly getServerSnapshot = (): SimulationState => this.snapshot;

  get nowMs(): number {
    return this.clock.nowMs;
  }

  on<Type extends SimulationEvent["type"]>(
    type: Type,
    listener: TypedEventListener<Type>,
  ): () => void {
    const listeners = this.typedListeners.get(type) ?? new Set<(event: SimulationEvent) => void>();
    listeners.add(listener as (event: SimulationEvent) => void);
    this.typedListeners.set(type, listeners);
    return () => listeners.delete(listener as (event: SimulationEvent) => void);
  }

  start(): void {
    if (this.status === "running") return;
    this.status = "running";
    this.emit({ type: "simulation.started" });
    this.startTimer();
    this.publish();
  }

  pause(): void {
    if (this.status === "paused") return;
    this.stopTimer();
    this.status = "paused";
    this.emit({ type: "simulation.paused" });
    this.publish();
  }

  /** Advance virtual time independently of wall time, React, or browser lifecycle. */
  advanceBy(durationMs: number): SimulationState {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError("Simulation duration must be a non-negative number.");
    }
    const targetMs = this.clock.nowMs + durationMs;
    this.scheduler.runUntil(targetMs, (task, atMs) => {
      this.clock.advanceTo(atMs);
      this.handleTask(task);
    });
    this.clock.advanceTo(targetMs);
    this.refreshResourcesAndHealth();
    this.publish();
    return this.snapshot;
  }

  runTicks(ticks: number): SimulationState {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new RangeError("Tick count must be a non-negative integer.");
    }
    return this.advanceBy(ticks * this.config.tickMs);
  }

  setSpeedMultiplier(multiplier: number): void {
    const next = clamp(multiplier, minSpeedMultiplier, maxSpeedMultiplier);
    if (next === this.speedMultiplier) return;
    this.speedMultiplier = next;
    if (this.status === "running") this.restartTimer();
    this.publish();
  }

  setTrafficMultiplier(multiplier: number): void {
    const next = clamp(multiplier, minTrafficMultiplier, maxTrafficMultiplier);
    if (next === this.trafficMultiplier) return;
    this.trafficMultiplier = next;
    this.emit({
      type: "traffic.rate.changed",
      multiplier: next,
      requestsPerSecond: this.config.requestsPerSecond * next,
    });
    this.publish();
  }

  /** Applies an operational fault profile that affects request latency, capacity and errors. */
  applyFaultProfile(
    serviceId: string,
    profile: ServiceFaultProfile,
    health: "failed" | "critical" | null = null,
  ): void {
    const node = this.registry.get(serviceId);
    this.externallyManagedFaults.add(serviceId);
    node.setFaultProfile(profile);
    if (health === "failed") this.failService(serviceId);
    else if (health === "critical") {
      const transition = this.registry.transition(serviceId, "critical");
      if (transition) {
        this.emit({
          type: "service.health.changed",
          serviceId,
          from: transition.from,
          to: transition.to,
          reason: `${node.definition.name} entered critical state under the active injected fault profile.`,
        });
      }
    }
    this.publish();
  }

  setServiceScale(serviceId: string, multiplier: number): void {
    this.registry.get(serviceId).setScaleMultiplier(multiplier);
    this.publish();
  }

  setAutomaticRecoverySuppression(serviceIds: readonly string[]): void {
    this.externallyManagedFaults = new Set(
      serviceIds.filter((serviceId) => this.registry.has(serviceId)),
    );
  }

  activateRecoveryStrategy(strategy: RecoveryStrategy, serviceId: string): void {
    this.router.setRecoveryPolicy(strategy, serviceId, (affectedServiceId, action) => {
      this.emit({
        type: "resilience.activated",
        serviceId: affectedServiceId,
        strategy,
        action,
      });
    });
    if (strategy === "horizontal-autoscaling") {
      this.setServiceScale(serviceId, 2.5);
      this.emit({
        type: "resilience.activated",
        serviceId,
        strategy,
        action: "added 150% request capacity to absorb the fault load",
      });
    }
    this.publish();
  }

  clearChaosOverrides(preserveAutomaticRecoveryFor: readonly string[] = []): void {
    for (const node of this.registry.all()) node.clearRuntimeOverrides();
    this.setAutomaticRecoverySuppression(preserveAutomaticRecoveryFor);
    this.router.clearRecoveryPolicy();
    this.setTrafficMultiplier(1);
    this.publish();
  }

  chooseRandomService(exclude: readonly string[] = []): string {
    const candidates = this.registry
      .all()
      .map((node) => node.id)
      .filter((serviceId) => !exclude.includes(serviceId));
    return this.random.pick(candidates);
  }

  injectCriticalFault(serviceId: string): void {
    const node = this.registry.get(serviceId);
    const transition = this.registry.transition(serviceId, "critical");
    if (!transition) return;
    this.emit({
      type: "service.health.changed",
      serviceId,
      from: transition.from,
      to: transition.to,
      reason: `${node.definition.name} received a critical fault injection.`,
    });
    this.scheduler.schedule(this.clock.nowMs + this.config.automaticRecoveryDelayMs, {
      type: "service.auto-recovery",
      serviceId,
    });
    this.publish();
  }

  failService(serviceId: string): void {
    const node = this.registry.get(serviceId);
    const transition = this.registry.transition(serviceId, "failed");
    if (!transition) return;
    this.emit({
      type: "service.health.changed",
      serviceId,
      from: transition.from,
      to: transition.to,
      reason: `${node.definition.name} was taken offline. Dependent requests will fail.`,
    });
    this.publish();
  }

  beginServiceRecovery(serviceId: string, force = false): boolean {
    const node = this.registry.get(serviceId);
    node.clearFaultProfile();
    const transition = node.startRecovery(this.clock.nowMs, force);
    if (!transition) return false;
    this.emit({
      type: "service.health.changed",
      serviceId,
      from: transition.from,
      to: transition.to,
      reason: `${node.definition.name} is rebuilding capacity and reconnecting to the graph.`,
    });
    this.scheduler.schedule(this.clock.nowMs + this.config.recoveryDurationMs, {
      type: "service.recovery-complete",
      serviceId,
    });
    this.publish();
    return true;
  }

  reset(resume = true): void {
    this.stopTimer();
    this.initializeCore();
    this.emit({ type: "simulation.reset" });
    this.status = "paused";
    this.publish();
    if (resume) this.start();
  }

  private initializeCore(): void {
    this.clock.reset();
    this.scheduler.clear();
    this.random = new SeededRandom(this.config.seed);
    this.registry = new ServiceRegistry(this.config.serviceDefinitions);
    this.graph = new DependencyGraph(this.config.serviceDefinitions);
    this.topology = this.graph.edges();
    for (const route of this.config.routes) {
      if (!this.registry.has(route.entryServiceId) || !this.registry.has(route.targetServiceId)) {
        throw new Error(`Traffic route ${route.id} references an unknown service.`);
      }
      this.graph.resolveRequestPlan(route.entryServiceId, route.targetServiceId);
    }
    this.generator = new TrafficGenerator(
      this.config.routes,
      this.random,
      this.config.requestsPerSecond,
    );
    this.router = new RequestRouter(this.registry, this.graph, this.random);
    this.collector = new MetricsCollector();
    this.aggregator = new MetricsAggregator(this.config, this.registry, this.collector);
    this.eventHistory = [];
    this.sequence = 0;
    this.requestSequence = 0;
    this.inFlightRequests = new Set();
    this.externallyManagedFaults = new Set();
    this.tickNumber = 0;
    this.speedMultiplier = 1;
    this.trafficMultiplier = 1;
    this.status = "paused";
    this.scheduler.schedule(this.config.tickMs, { type: "simulation.tick" });
  }

  private handleTask(task: SimulationTask): void {
    switch (task.type) {
      case "simulation.tick":
        this.handleTick();
        break;
      case "request.complete":
        this.completeRequest(task.trace);
        break;
      case "service.auto-recovery":
        if (
          !this.externallyManagedFaults.has(task.serviceId) &&
          this.registry.get(task.serviceId).currentHealth === "critical"
        ) {
          this.beginServiceRecovery(task.serviceId);
        }
        break;
      case "service.recovery-complete": {
        const node = this.registry.get(task.serviceId);
        const recovery = node.completeRecovery();
        if (recovery.transition) {
          this.emit({
            type: "service.health.changed",
            serviceId: task.serviceId,
            from: recovery.transition.from,
            to: recovery.transition.to,
            reason: `${node.definition.name} recovered and rejoined the service graph.`,
          });
          this.emit({ type: "service.recovery.completed", serviceId: task.serviceId });
        }
        break;
      }
    }
  }

  private handleTick(): void {
    this.tickNumber += 1;
    const routes = this.generator.generate(this.config.tickMs, this.trafficMultiplier);
    for (const route of routes) this.startRequest(route);
    this.refreshResourcesAndHealth();
    this.emit({
      type: "simulation.tick",
      tick: this.tickNumber,
      generatedRequests: routes.length,
    });
    this.scheduler.schedule(this.clock.nowMs + this.config.tickMs, { type: "simulation.tick" });
  }

  private startRequest(route: TrafficRoute): void {
    const requestId = `r-${this.config.seed.toString(36)}-${++this.requestSequence}`;
    this.emit({
      type: "request.generated",
      requestId,
      routeId: route.id,
      targetServiceId: route.targetServiceId,
    });
    const trace = this.router.route(requestId, route);
    this.emit({
      type: "request.routed",
      requestId,
      routeId: route.id,
      path: [...trace.path],
      connectionIds: [...trace.connectionIds],
      estimatedLatencyMs: trace.latencyMs,
    });
    this.inFlightRequests.add(requestId);
    this.scheduler.schedule(this.clock.nowMs + trace.latencyMs, {
      type: "request.complete",
      trace,
    });
  }

  private completeRequest(trace: RequestTrace): void {
    this.inFlightRequests.delete(trace.requestId);
    const failedService = trace.path.find(
      (serviceId) =>
        this.registry.get(serviceId).currentHealth === "failed" &&
        !trace.bypassedServiceIds?.includes(serviceId),
    );
    const completedTrace = failedService
      ? {
          ...trace,
          outcome: "failure" as const,
          failedAt: failedService,
          reason: `${this.registry.get(failedService).definition.name} failed while the request was in flight.`,
        }
      : trace;
    for (const sample of trace.serviceSamples) {
      if (sample.accepted && !sample.releasedDuringRouting)
        this.registry.get(sample.serviceId).finishRequest();
    }
    this.collector.record(completedTrace, this.clock.nowMs);
    this.emit({
      type: "request.completed",
      requestId: trace.requestId,
      routeId: trace.routeId,
      path: [...completedTrace.path],
      latencyMs: completedTrace.latencyMs,
      outcome: completedTrace.outcome,
      ...(completedTrace.failedAt ? { failedAt: completedTrace.failedAt } : {}),
      ...(completedTrace.reason ? { reason: completedTrace.reason } : {}),
    });
    this.refreshResourcesAndHealth();
  }

  private refreshResourcesAndHealth(): void {
    const aggregate = this.aggregator.aggregate(this.clock.nowMs, this.inFlightRequests.size);
    for (const node of this.registry.all()) {
      if (
        node.currentHealth === "failed" ||
        node.currentHealth === "critical" ||
        node.currentHealth === "recovering"
      ) {
        continue;
      }
      const serviceMetrics = aggregate.byService.get(node.id);
      if (!serviceMetrics) continue;
      const nextHealth = healthFromMetrics(
        serviceMetrics.requestsPerSecond,
        serviceMetrics.errorRate,
        node.effectiveCapacityRequestsPerSecond,
        node.queuedRequests,
      );
      const transition = this.registry.transition(node.id, nextHealth);
      if (!transition) continue;
      this.emit({
        type: "service.health.changed",
        serviceId: node.id,
        from: transition.from,
        to: transition.to,
        reason: describeHealthReason(transition.to),
      });
      if (transition.to === "critical") {
        this.scheduler.schedule(this.clock.nowMs + this.config.automaticRecoveryDelayMs, {
          type: "service.auto-recovery",
          serviceId: node.id,
        });
      }
    }
  }

  private createSnapshot(): SimulationState {
    const aggregate = this.aggregator.aggregate(this.clock.nowMs, this.inFlightRequests.size);
    const services = this.aggregator.snapshotServices(this.clock.nowMs, aggregate);
    const connections = this.aggregator.snapshotConnections(this.topology, aggregate);
    return {
      version: this.stateVersion,
      tick: this.tickNumber,
      nowMs: this.clock.nowMs,
      status: this.status,
      speedMultiplier: this.speedMultiplier,
      trafficMultiplier: this.trafficMultiplier,
      services,
      connections,
      metrics: this.aggregator.publicMetrics(aggregate),
      events: [...this.eventHistory],
    };
  }

  private publish(): void {
    this.stateVersion += 1;
    const aggregate = this.aggregator.aggregate(this.clock.nowMs, this.inFlightRequests.size);
    this.emit({ type: "metrics.updated", version: this.stateVersion });
    this.snapshot = {
      version: this.stateVersion,
      tick: this.tickNumber,
      nowMs: this.clock.nowMs,
      status: this.status,
      speedMultiplier: this.speedMultiplier,
      trafficMultiplier: this.trafficMultiplier,
      services: this.aggregator.snapshotServices(this.clock.nowMs, aggregate),
      connections: this.aggregator.snapshotConnections(this.topology, aggregate),
      metrics: this.aggregator.publicMetrics(aggregate),
      events: [...this.eventHistory],
    };
    for (const listener of this.listeners) listener();
  }

  private emit(event: SimulationEventInput): SimulationEvent {
    const typed = {
      ...event,
      sequence: ++this.sequence,
      atMs: this.clock.nowMs,
    } as SimulationEvent;
    this.eventHistory.push(typed);
    if (this.eventHistory.length > maxEvents)
      this.eventHistory.splice(0, this.eventHistory.length - maxEvents);
    const listeners = this.typedListeners.get(typed.type);
    if (listeners) for (const listener of listeners) listener(typed);
    return typed;
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(
      () => this.advanceBy(this.config.tickMs * this.speedMultiplier),
      this.config.tickMs,
    );
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private restartTimer(): void {
    this.stopTimer();
    this.startTimer();
  }
}

function healthFromMetrics(
  requestsPerSecond: number,
  errorRate: number,
  capacityRequestsPerSecond: number,
  queueBacklog: number,
): RuntimeHealth {
  const utilization = requestsPerSecond / capacityRequestsPerSecond;
  if (utilization >= 1.3 || errorRate >= 24 || queueBacklog >= 8) return "critical";
  if (utilization >= 0.76 || errorRate >= 5 || queueBacklog > 0) return "high-load";
  return "healthy";
}

function describeHealthReason(health: RuntimeHealth): string {
  if (health === "critical") return "Capacity or error budget crossed the critical threshold.";
  if (health === "high-load") return "Traffic is using a high share of available service capacity.";
  return "Traffic and error rate returned below service watch thresholds.";
}

function cloneConfig(config: SimulationConfig): SimulationConfig {
  if (
    !Number.isInteger(config.seed) ||
    !Number.isFinite(config.tickMs) ||
    config.tickMs <= 0 ||
    !Number.isFinite(config.metricsWindowMs) ||
    config.metricsWindowMs <= 0 ||
    !Number.isFinite(config.requestsPerSecond) ||
    config.requestsPerSecond < 0 ||
    !Number.isFinite(config.recoveryDurationMs) ||
    config.recoveryDurationMs <= 0 ||
    !Number.isFinite(config.automaticRecoveryDelayMs) ||
    config.automaticRecoveryDelayMs < 0
  ) {
    throw new RangeError("Simulation timing, seed, and traffic settings are invalid.");
  }
  for (const service of config.serviceDefinitions) {
    if (
      !Number.isFinite(service.capacityRequestsPerSecond) ||
      service.capacityRequestsPerSecond <= 0 ||
      !Number.isInteger(service.maxConcurrentRequests) ||
      service.maxConcurrentRequests <= 0 ||
      !Number.isFinite(service.baseLatencyMs) ||
      service.baseLatencyMs < 0 ||
      !Number.isFinite(service.baselineMemoryPercent) ||
      service.baselineMemoryPercent < 0 ||
      service.baselineMemoryPercent > 100 ||
      !Number.isFinite(service.baseFailureProbability) ||
      service.baseFailureProbability < 0 ||
      service.baseFailureProbability > 1
    ) {
      throw new RangeError(`Invalid simulation parameters for service ${service.id}.`);
    }
  }
  return {
    ...config,
    serviceDefinitions: config.serviceDefinitions.map((service) => ({
      ...service,
      position: [...service.position],
      dependsOn: [...service.dependsOn],
    })),
    routes: config.routes.map((route) => ({ ...route })),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Simulation multiplier must be finite.");
  return Math.max(minimum, Math.min(maximum, value));
}
