import type {
  RuntimeHealth,
  RuntimeService,
  SimulationAggregateMetrics,
  SimulationEvent,
  SimulationState,
} from "@/types/observatory-runtime";

export type ServiceDefinition = Omit<
  RuntimeService,
  | "cpuUsage"
  | "memoryUsage"
  | "requestsPerSecond"
  | "averageLatencyMs"
  | "errorRate"
  | "health"
  | "queueBacklog"
  | "inFlight"
  | "recoveryStep"
> & {
  capacityRequestsPerSecond: number;
  maxConcurrentRequests: number;
  baseLatencyMs: number;
  baselineMemoryPercent: number;
  baseFailureProbability: number;
};

export type TrafficRoute = {
  id: string;
  entryServiceId: string;
  targetServiceId: string;
  weight: number;
};

export type SimulationConfig = {
  seed: number;
  tickMs: number;
  metricsWindowMs: number;
  requestsPerSecond: number;
  recoveryDurationMs: number;
  automaticRecoveryDelayMs: number;
  serviceDefinitions: ServiceDefinition[];
  routes: TrafficRoute[];
};

export type RequestOutcome = "success" | "failure";

export type ServiceRequestSample = {
  serviceId: string;
  latencyMs: number;
  accepted: boolean;
  releasedDuringRouting?: boolean;
};

export type ConnectionRequestSample = {
  connectionId: string;
  latencyMs: number;
};

export type RequestTrace = {
  requestId: string;
  routeId: string;
  path: string[];
  connectionIds: string[];
  connectionSamples: ConnectionRequestSample[];
  serviceSamples: ServiceRequestSample[];
  latencyMs: number;
  outcome: RequestOutcome;
  failedAt?: string;
  reason?: string;
  bypassedServiceIds?: string[];
};

export type SimulationTask =
  | { type: "simulation.tick" }
  | { type: "request.complete"; trace: RequestTrace }
  | { type: "service.auto-recovery"; serviceId: string }
  | { type: "service.recovery-complete"; serviceId: string };

export type ServiceMetricSample = {
  atMs: number;
  latencyMs: number;
  success: boolean;
};

export type AggregatedServiceMetrics = Pick<
  RuntimeService,
  "requestsPerSecond" | "averageLatencyMs" | "errorRate"
> & {
  completedRequests: number;
  failedRequests: number;
};

export type AggregatedSimulationMetrics = SimulationAggregateMetrics & {
  byService: Map<string, AggregatedServiceMetrics>;
  byConnection: Map<string, { throughput: number; averageLatencyMs: number; errorRate: number }>;
};

export type SimulationSnapshot = SimulationState;

export type SimulationEventType = SimulationEvent["type"];
export type SimulationHealth = RuntimeHealth;
