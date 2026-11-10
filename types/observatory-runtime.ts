export type ServiceCategory = "entry" | "core" | "data" | "async";

export type RuntimeHealth = "healthy" | "high-load" | "critical" | "failed" | "recovering";

export type RuntimeService = {
  id: string;
  name: string;
  shortName: string;
  category: ServiceCategory;
  description: string;
  position: [number, number, number];
  cpuUsage: number;
  memoryUsage: number;
  requestsPerSecond: number;
  averageLatencyMs: number;
  errorRate: number;
  queueBacklog: number;
  inFlight: number;
  health: RuntimeHealth;
  dependsOn: string[];
  region: string;
  recoveryStep: number;
};

export type RuntimeConnection = {
  id: string;
  source: string;
  target: string;
  throughput: number;
  averageLatencyMs: number;
  errorRate: number;
};

export type SimulationStatus = "running" | "paused";

export type SimulationEventBase = {
  sequence: number;
  atMs: number;
};

export type SimulationEvent =
  | (SimulationEventBase & {
      type: "simulation.started" | "simulation.paused" | "simulation.reset";
    })
  | (SimulationEventBase & {
      type: "simulation.tick";
      tick: number;
      generatedRequests: number;
    })
  | (SimulationEventBase & {
      type: "request.generated";
      requestId: string;
      routeId: string;
      targetServiceId: string;
    })
  | (SimulationEventBase & {
      type: "request.routed";
      requestId: string;
      routeId: string;
      path: string[];
      connectionIds: string[];
      estimatedLatencyMs: number;
    })
  | (SimulationEventBase & {
      type: "request.completed";
      requestId: string;
      routeId: string;
      path: string[];
      latencyMs: number;
      outcome: "success" | "failure";
      failedAt?: string;
      reason?: string;
    })
  | (SimulationEventBase & {
      type: "service.health.changed";
      serviceId: string;
      from: RuntimeHealth;
      to: RuntimeHealth;
      reason: string;
    })
  | (SimulationEventBase & {
      type: "service.recovery.completed";
      serviceId: string;
    })
  | (SimulationEventBase & {
      type: "resilience.activated";
      serviceId: string;
      strategy: string;
      action: string;
    })
  | (SimulationEventBase & {
      type: "traffic.rate.changed";
      multiplier: number;
      requestsPerSecond: number;
    })
  | (SimulationEventBase & {
      type: "metrics.updated";
      version: number;
    });

export type SimulationAggregateMetrics = {
  requestsPerSecond: number;
  successfulRequestsPerSecond: number;
  failedRequestsPerSecond: number;
  averageLatencyMs: number;
  errorRate: number;
  activeRequests: number;
  queuedRequests: number;
  completedRequests: number;
  successfulRequests: number;
  failedRequests: number;
};

export type SimulationState = {
  version: number;
  tick: number;
  nowMs: number;
  status: SimulationStatus;
  speedMultiplier: number;
  trafficMultiplier: number;
  services: RuntimeService[];
  connections: RuntimeConnection[];
  metrics: SimulationAggregateMetrics;
  events: SimulationEvent[];
};
