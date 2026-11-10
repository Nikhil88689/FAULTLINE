export type ChaosFaultType =
  | "database-outage"
  | "api-overload"
  | "network-latency"
  | "random-termination"
  | "redis-failure"
  | "queue-backlog"
  | "authentication-outage"
  | "cascading-failure"
  | "custom";

export type RecoveryStrategy =
  | "none"
  | "retry-backoff"
  | "circuit-breaker"
  | "fallback-cache"
  | "traffic-redistribution"
  | "service-restart"
  | "horizontal-autoscaling";

export type ExperimentPhase =
  | "configuration"
  | "validation"
  | "precheck"
  | "confirmation"
  | "execution"
  | "paused"
  | "completion"
  | "results"
  | "failed";

export type ChaosExperimentConfig = {
  name: string;
  faultType: ChaosFaultType;
  targetServiceId: string;
  intensity: number;
  durationSeconds: number;
  trafficVolume: number;
  failureProbability: number;
  recoveryStrategy: RecoveryStrategy;
};

export type ChaosExperimentLog = {
  id: string;
  atMs: number;
  level: "info" | "warning" | "critical" | "success";
  message: string;
};

export type ChaosExperimentResult = {
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  peakErrorRate: number;
  peakLatencyMs: number;
  affectedServices: string[];
  recoveredServices: string[];
  stoppedEarly: boolean;
};

export type ChaosExperimentState = {
  phase: ExperimentPhase;
  config: ChaosExperimentConfig | null;
  validationErrors: string[];
  precheckWarnings: string[];
  startedAtMs: number | null;
  endsAtMs: number | null;
  elapsedMs: number;
  logs: ChaosExperimentLog[];
  result: ChaosExperimentResult | null;
};
