import type { RuntimeHealth, RuntimeService } from "@/types/observatory-runtime";
import type { AggregatedServiceMetrics, ServiceDefinition } from "@/types/simulation";
import { SeededRandom } from "./seeded-random";

export type ServiceHealthTransition = {
  from: RuntimeHealth;
  to: RuntimeHealth;
};

export type ServiceFaultProfile = {
  latencyMs?: number;
  failureProbability?: number;
  capacityMultiplier?: number;
  queuePressure?: number;
};

export class ServiceNode {
  readonly definition: ServiceDefinition;
  private health: RuntimeHealth = "healthy";
  private inFlight = 0;
  private queueBacklog = 0;
  private cpuUsage = 0;
  private memoryUsage: number;
  private recoveryStartedAt: number | null = null;
  private recoveryStep = 0;
  private faultProfile: ServiceFaultProfile = {};
  private scaleMultiplier = 1;

  constructor(definition: ServiceDefinition) {
    this.definition = {
      ...definition,
      position: [...definition.position],
      dependsOn: [...definition.dependsOn],
    };
    this.memoryUsage = definition.baselineMemoryPercent;
  }

  get id(): string {
    return this.definition.id;
  }

  get currentHealth(): RuntimeHealth {
    return this.health;
  }

  get activeRequests(): number {
    return this.inFlight;
  }

  get queuedRequests(): number {
    return this.queueBacklog;
  }

  get effectiveCapacityRequestsPerSecond(): number {
    return (
      this.definition.capacityRequestsPerSecond *
      this.faultCapacityMultiplier *
      this.scaleMultiplier
    );
  }

  private get faultCapacityMultiplier(): number {
    return this.faultProfile.capacityMultiplier ?? 1;
  }

  get effectiveMaxConcurrentRequests(): number {
    return Math.max(
      1,
      this.definition.maxConcurrentRequests * this.faultCapacityMultiplier * this.scaleMultiplier,
    );
  }

  setFaultProfile(profile: ServiceFaultProfile): void {
    this.faultProfile = { ...profile };
  }

  clearFaultProfile(): void {
    this.faultProfile = {};
    this.queueBacklog = Math.max(0, this.inFlight - this.effectiveMaxConcurrentRequests);
  }

  setScaleMultiplier(multiplier: number): void {
    this.scaleMultiplier = Math.max(1, Math.min(4, multiplier));
    this.queueBacklog = Math.max(0, this.inFlight - this.effectiveMaxConcurrentRequests);
  }

  clearRuntimeOverrides(): void {
    this.faultProfile = {};
    this.scaleMultiplier = 1;
    this.queueBacklog = Math.max(0, this.inFlight - this.definition.maxConcurrentRequests);
  }

  beginRequest(random: SeededRandom): {
    accepted: boolean;
    latencyMs: number;
    failureChance: number;
  } {
    if (this.health === "failed") return { accepted: false, latencyMs: 0, failureChance: 1 };

    this.inFlight += 1;
    this.queueBacklog = Math.max(
      this.faultProfile.queuePressure ?? 0,
      Math.max(0, this.inFlight - this.effectiveMaxConcurrentRequests),
    );
    const utilization = Math.max(0, this.inFlight / this.effectiveMaxConcurrentRequests - 1);
    const queueDelay = this.queueBacklog * Math.max(2, this.definition.baseLatencyMs * 0.55);
    const jitter = 0.88 + random.next() * 0.24;
    const latencyMs = Math.max(
      1,
      this.definition.baseLatencyMs * (1 + Math.min(3, utilization * 1.6)) * jitter +
        queueDelay +
        (this.faultProfile.latencyMs ?? 0),
    );
    const pressure = Math.max(0, this.cpuUsage / 100 - 0.68);
    const healthPenalty =
      this.health === "critical"
        ? 0.48
        : this.health === "high-load"
          ? 0.035
          : this.health === "recovering"
            ? 0.02
            : 0;
    const failureChance = Math.min(
      0.95,
      this.definition.baseFailureProbability +
        pressure * 0.4 +
        healthPenalty +
        (this.faultProfile.failureProbability ?? 0),
    );
    return { accepted: true, latencyMs, failureChance };
  }

  finishRequest(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.queueBacklog = Math.max(
      this.faultProfile.queuePressure ?? 0,
      Math.max(0, this.inFlight - this.effectiveMaxConcurrentRequests),
    );
  }

  updateResourceMetrics(metrics: AggregatedServiceMetrics): void {
    if (this.health === "failed") {
      this.cpuUsage = 0;
      this.memoryUsage = Math.min(100, this.definition.baselineMemoryPercent + this.inFlight * 0.5);
      return;
    }
    const throughputLoad = metrics.requestsPerSecond / this.effectiveCapacityRequestsPerSecond;
    const concurrencyLoad = this.inFlight / this.effectiveMaxConcurrentRequests;
    this.cpuUsage = clampPercent(
      throughputLoad * 78 + concurrencyLoad * 22 + this.queueBacklog * 1.4,
    );
    this.memoryUsage = clampPercent(
      this.definition.baselineMemoryPercent + this.inFlight * 1.25 + this.queueBacklog * 0.65,
    );
  }

  transitionHealth(next: RuntimeHealth): ServiceHealthTransition | null {
    if (next === this.health) return null;
    if (!allowedTransitions[this.health].includes(next)) return null;
    const transition = { from: this.health, to: next };
    this.health = next;
    if (next !== "recovering") {
      this.recoveryStartedAt = null;
      this.recoveryStep = 0;
    }
    return transition;
  }

  startRecovery(nowMs: number, force = false): ServiceHealthTransition | null {
    if (!force && this.health !== "failed" && this.health !== "critical") return null;
    if (this.health === "recovering") return null;
    this.recoveryStartedAt = nowMs;
    this.recoveryStep = 0;
    return this.transitionHealth("recovering");
  }

  completeRecovery(): { transition: ServiceHealthTransition | null; wasRecovering: boolean } {
    if (this.health !== "recovering") return { transition: null, wasRecovering: false };
    this.recoveryStep = 6;
    return { transition: this.transitionHealth("healthy"), wasRecovering: true };
  }

  updateRecoveryProgress(nowMs: number, recoveryDurationMs: number): void {
    if (this.health !== "recovering" || this.recoveryStartedAt === null) return;
    const progress = (nowMs - this.recoveryStartedAt) / recoveryDurationMs;
    this.recoveryStep = Math.max(0, Math.min(5, Math.floor(progress * 6)));
  }

  snapshot(
    metrics: AggregatedServiceMetrics,
    nowMs: number,
    recoveryDurationMs: number,
  ): RuntimeService {
    this.updateRecoveryProgress(nowMs, recoveryDurationMs);
    return {
      id: this.definition.id,
      name: this.definition.name,
      shortName: this.definition.shortName,
      category: this.definition.category,
      description: this.definition.description,
      position: [...this.definition.position],
      cpuUsage: roundTo(this.cpuUsage, 1),
      memoryUsage: roundTo(this.memoryUsage, 1),
      requestsPerSecond: roundTo(metrics.requestsPerSecond, 2),
      averageLatencyMs: roundTo(metrics.averageLatencyMs, 1),
      errorRate: roundTo(metrics.errorRate, 2),
      queueBacklog: this.queueBacklog,
      inFlight: this.inFlight,
      health: this.health,
      dependsOn: [...this.definition.dependsOn],
      region: this.definition.region,
      recoveryStep: this.recoveryStep,
    };
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const allowedTransitions: Record<RuntimeHealth, readonly RuntimeHealth[]> = {
  healthy: ["high-load", "critical", "failed", "recovering"],
  "high-load": ["healthy", "critical", "failed", "recovering"],
  critical: ["recovering", "failed"],
  failed: ["recovering"],
  recovering: ["healthy", "failed", "critical"],
};
