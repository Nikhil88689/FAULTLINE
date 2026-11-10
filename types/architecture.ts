import type { ServiceDefinition, SimulationConfig } from "@/types/simulation";

export type ArchitectureComponentType =
  | "api-gateway"
  | "microservice"
  | "database"
  | "cache"
  | "message-queue"
  | "load-balancer"
  | "background-worker"
  | "external-api";

export type ArchitectureNode = {
  id: string;
  type: ArchitectureComponentType;
  name: string;
  responsibility: string;
  x: number;
  y: number;
  capacityRequestsPerSecond: number;
  maxConcurrentRequests: number;
  baseLatencyMs: number;
  baselineMemoryPercent: number;
  baseFailureProbability: number;
  region: string;
};

export type ArchitectureEdge = {
  id: string;
  source: string;
  target: string;
};

export type ArchitectureDocument = {
  id: string;
  name: string;
  description: string;
  requestsPerSecond: number;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  updatedAt: string;
};

export type ArchitectureValidation = {
  errors: string[];
  warnings: string[];
  routes: Array<{ entryServiceId: string; targetServiceId: string }>;
};

export type ArchitectureSimulationConfig = SimulationConfig & {
  serviceDefinitions: ServiceDefinition[];
};
