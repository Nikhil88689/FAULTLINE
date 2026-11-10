import type {
  RuntimeConnection,
  RuntimeService,
  SimulationAggregateMetrics,
} from "@/types/observatory-runtime";
import type { AggregatedSimulationMetrics, SimulationConfig } from "@/types/simulation";
import { MetricsCollector } from "./metrics-collector";
import { ServiceRegistry } from "./service-registry";

export class MetricsAggregator {
  constructor(
    private readonly config: Pick<SimulationConfig, "metricsWindowMs" | "recoveryDurationMs">,
    private readonly registry: ServiceRegistry,
    private readonly collector: MetricsCollector,
  ) {}

  aggregate(
    nowMs: number,
    activeRequests = this.registry.totalInFlight,
  ): AggregatedSimulationMetrics {
    const result = this.collector.aggregate(nowMs, this.config.metricsWindowMs);
    for (const node of this.registry.all()) {
      if (!result.byService.has(node.id)) {
        result.byService.set(node.id, {
          requestsPerSecond: 0,
          averageLatencyMs: 0,
          errorRate: 0,
          completedRequests: 0,
          failedRequests: 0,
        });
      }
    }
    this.registry.updateResourceMetrics(result.byService);
    return {
      ...result,
      activeRequests,
      queuedRequests: this.registry.totalQueued,
    };
  }

  snapshotServices(nowMs: number, aggregate: AggregatedSimulationMetrics): RuntimeService[] {
    return this.registry.snapshot(aggregate.byService, nowMs, this.config.recoveryDurationMs);
  }

  snapshotConnections(
    topology: readonly RuntimeConnection[],
    aggregate: AggregatedSimulationMetrics,
  ): RuntimeConnection[] {
    return topology.map((connection) => ({
      ...connection,
      throughput: roundTo(aggregate.byConnection.get(connection.id)?.throughput ?? 0, 2),
      averageLatencyMs: roundTo(
        aggregate.byConnection.get(connection.id)?.averageLatencyMs ?? 0,
        2,
      ),
      errorRate: roundTo(aggregate.byConnection.get(connection.id)?.errorRate ?? 0, 2),
    }));
  }

  publicMetrics(aggregate: AggregatedSimulationMetrics): SimulationAggregateMetrics {
    return {
      requestsPerSecond: roundTo(aggregate.requestsPerSecond, 2),
      successfulRequestsPerSecond: roundTo(aggregate.successfulRequestsPerSecond, 2),
      failedRequestsPerSecond: roundTo(aggregate.failedRequestsPerSecond, 2),
      averageLatencyMs: roundTo(aggregate.averageLatencyMs, 2),
      errorRate: roundTo(aggregate.errorRate, 2),
      activeRequests: aggregate.activeRequests,
      queuedRequests: aggregate.queuedRequests,
      completedRequests: aggregate.completedRequests,
      successfulRequests: aggregate.successfulRequests,
      failedRequests: aggregate.failedRequests,
    };
  }
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
