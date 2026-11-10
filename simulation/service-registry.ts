import type { RuntimeHealth, RuntimeService } from "@/types/observatory-runtime";
import type { AggregatedServiceMetrics, ServiceDefinition } from "@/types/simulation";
import { ServiceNode, type ServiceHealthTransition } from "./service-node";

export class ServiceRegistry {
  private readonly nodes = new Map<string, ServiceNode>();

  constructor(definitions: readonly ServiceDefinition[]) {
    for (const definition of definitions) {
      if (this.nodes.has(definition.id)) throw new Error(`Duplicate service id: ${definition.id}`);
      this.nodes.set(definition.id, new ServiceNode(definition));
    }
  }

  get(serviceId: string): ServiceNode {
    const node = this.nodes.get(serviceId);
    if (!node) throw new Error(`Unknown service: ${serviceId}`);
    return node;
  }

  has(serviceId: string): boolean {
    return this.nodes.has(serviceId);
  }

  all(): ServiceNode[] {
    return [...this.nodes.values()];
  }

  definitions(): ServiceDefinition[] {
    return this.all().map((node) => node.definition);
  }

  transition(serviceId: string, health: RuntimeHealth): ServiceHealthTransition | null {
    return this.get(serviceId).transitionHealth(health);
  }

  updateResourceMetrics(metrics: ReadonlyMap<string, AggregatedServiceMetrics>): void {
    for (const node of this.nodes.values()) {
      const serviceMetrics = metrics.get(node.id);
      if (!serviceMetrics) continue;
      node.updateResourceMetrics(serviceMetrics);
    }
  }

  snapshot(
    metrics: ReadonlyMap<string, AggregatedServiceMetrics>,
    nowMs: number,
    recoveryDurationMs: number,
  ): RuntimeService[] {
    return this.all().map((node) =>
      node.snapshot(metrics.get(node.id) ?? emptyMetrics, nowMs, recoveryDurationMs),
    );
  }

  get totalInFlight(): number {
    return this.all().reduce((sum, node) => sum + node.activeRequests, 0);
  }

  get totalQueued(): number {
    return this.all().reduce((sum, node) => sum + node.queuedRequests, 0);
  }
}

const emptyMetrics: AggregatedServiceMetrics = {
  requestsPerSecond: 0,
  averageLatencyMs: 0,
  errorRate: 0,
  completedRequests: 0,
  failedRequests: 0,
};
