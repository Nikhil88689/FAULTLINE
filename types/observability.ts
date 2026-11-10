export type ServiceHealth = "healthy" | "degraded" | "critical";
export type SystemHealth = "operational" | "degraded" | "critical";

export type ServiceNode = {
  id: string;
  name: string;
  domain: string;
  health: ServiceHealth;
  latencyMs: number;
  uptime: number;
  dependsOn: string[];
  region: string;
};

export type ObservabilitySnapshot = {
  capturedAt: string;
  health: SystemHealth;
  serviceCount: number;
  regionCount: number;
  services: ServiceNode[];
};
