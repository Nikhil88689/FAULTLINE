import type { RecoveryStrategy } from "@/types/chaos-lab";
import type { TrafficRoute, RequestTrace, ServiceRequestSample } from "@/types/simulation";
import { DependencyGraph } from "./dependency-graph";
import { SeededRandom } from "./seeded-random";
import { ServiceRegistry } from "./service-registry";

type ResilienceAction = (serviceId: string, action: string) => void;

/** Routes real simulated requests and applies the selected resilience policy. */
export class RequestRouter {
  private strategy: RecoveryStrategy = "none";
  private focusServiceId: string | null = null;
  private readonly consecutiveFailures = new Map<string, number>();
  private readonly openBreakers = new Set<string>();
  private onResilienceAction: ResilienceAction = () => undefined;

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly graph: DependencyGraph,
    private readonly random: SeededRandom,
  ) {}

  setRecoveryPolicy(
    strategy: RecoveryStrategy,
    focusServiceId: string,
    onAction: ResilienceAction,
  ): void {
    this.strategy = strategy;
    this.focusServiceId = focusServiceId;
    this.onResilienceAction = onAction;
    this.consecutiveFailures.clear();
    this.openBreakers.clear();
  }

  clearRecoveryPolicy(): void {
    this.strategy = "none";
    this.focusServiceId = null;
    this.consecutiveFailures.clear();
    this.openBreakers.clear();
    this.onResilienceAction = () => undefined;
  }

  route(requestId: string, route: TrafficRoute): RequestTrace {
    const plan = this.graph.resolveRequestPlan(route.entryServiceId, route.targetServiceId);
    const samples: ServiceRequestSample[] = [];
    const bypassedServiceIds: string[] = [];
    let latencyMs = 0;
    let outcome: RequestTrace["outcome"] = "success";
    let failedAt: string | undefined;
    let reason: string | undefined;

    for (const [index, serviceId] of plan.serviceIds.entries()) {
      const node = this.registry.get(serviceId);
      if (index > 0) latencyMs += 2 + this.random.next() * 2;

      if (this.strategy === "circuit-breaker" && this.openBreakers.has(serviceId)) {
        samples.push({ serviceId, latencyMs: 0, accepted: false });
        outcome = "failure";
        failedAt = serviceId;
        reason = `${node.definition.name} was short-circuited by an open circuit breaker.`;
        this.onResilienceAction(
          serviceId,
          "open circuit rejected a request before it reached the service",
        );
        break;
      }

      const retryLimit =
        this.strategy === "retry-backoff" && serviceId === this.focusServiceId ? 3 : 1;
      let serviceSucceeded = false;
      let lastFailureReason = "";
      for (let attempt = 0; attempt < retryLimit; attempt += 1) {
        const result = node.beginRequest(this.random);
        if (!result.accepted) {
          samples.push({ serviceId, latencyMs: 0, accepted: false });
          lastFailureReason = `${node.definition.name} is offline.`;
          break;
        }
        samples.push({ serviceId, latencyMs: result.latencyMs, accepted: true });
        latencyMs += result.latencyMs;
        if (this.random.next() >= result.failureChance) {
          serviceSucceeded = true;
          break;
        }

        lastFailureReason = `${node.definition.name} rejected or timed out the request.`;
        if (attempt + 1 < retryLimit) {
          const backoffMs = 50 * 2 ** attempt;
          latencyMs += backoffMs;
          const lastSample = samples[samples.length - 1];
          lastSample.releasedDuringRouting = true;
          node.finishRequest();
          this.onResilienceAction(
            serviceId,
            `retry ${attempt + 1} scheduled after ${backoffMs} ms exponential backoff`,
          );
        }
      }

      if (!serviceSucceeded) {
        const isReadRoute = route.id.includes("read") || route.id.startsWith("profile");
        const canServeFromAlternateTier =
          this.strategy === "traffic-redistribution" &&
          ((serviceId === "postgres" &&
            this.registry.has("redis") &&
            this.registry.get("redis").currentHealth !== "failed") ||
            (serviceId === "redis" &&
              this.registry.has("postgres") &&
              this.registry.get("postgres").currentHealth !== "failed"));
        const canUseStaleRead =
          (this.strategy === "fallback-cache" &&
            isReadRoute &&
            (serviceId === "postgres" || serviceId === "redis") &&
            this.registry.has(serviceId)) ||
          (isReadRoute && canServeFromAlternateTier);
        if (canUseStaleRead) {
          bypassedServiceIds.push(serviceId);
          latencyMs += this.strategy === "fallback-cache" ? 7 : 4;
          const action =
            this.strategy === "fallback-cache"
              ? "served a stale read from the local fallback cache"
              : serviceId === "postgres"
                ? "redistributed a read to the healthy cache tier"
                : "redistributed a cache miss to the healthy primary database";
          this.onResilienceAction(serviceId, action);
          continue;
        }
        outcome = "failure";
        failedAt = serviceId;
        reason = lastFailureReason || `${node.definition.name} is unavailable.`;
        break;
      }
    }

    if (outcome === "success") {
      for (const sample of samples) this.consecutiveFailures.set(sample.serviceId, 0);
    } else if (failedAt) {
      const failures = (this.consecutiveFailures.get(failedAt) ?? 0) + 1;
      this.consecutiveFailures.set(failedAt, failures);
      if (
        this.strategy === "circuit-breaker" &&
        failures >= 3 &&
        !this.openBreakers.has(failedAt)
      ) {
        this.openBreakers.add(failedAt);
        this.onResilienceAction(
          failedAt,
          "circuit opened after three consecutive request failures",
        );
      }
    }

    const reachedServices = new Set(samples.map((sample) => sample.serviceId));
    const reachedConnections = plan.connections.filter(
      (connection) =>
        reachedServices.has(connection.source) && reachedServices.has(connection.target),
    );

    return {
      requestId,
      routeId: route.id,
      path: samples.map((sample) => sample.serviceId),
      connectionIds: reachedConnections.map((connection) => connection.id),
      connectionSamples: reachedConnections.map((connection) => {
        const sourceLatency =
          samples.find((sample) => sample.serviceId === connection.source)?.latencyMs ?? 0;
        const targetLatency =
          samples.find((sample) => sample.serviceId === connection.target)?.latencyMs ?? 0;
        return {
          connectionId: connection.id,
          latencyMs: sourceLatency + targetLatency + 2,
        };
      }),
      serviceSamples: samples,
      latencyMs: Math.max(1, latencyMs),
      outcome,
      failedAt,
      reason,
      ...(bypassedServiceIds.length ? { bypassedServiceIds } : {}),
    };
  }
}
