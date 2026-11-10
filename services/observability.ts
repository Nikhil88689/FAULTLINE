import type { ObservabilitySnapshot, ServiceNode } from "@/types/observability";

const demoServices: ServiceNode[] = [
  {
    id: "edge",
    name: "Edge gateway",
    domain: "Ingress",
    health: "healthy",
    latencyMs: 18,
    uptime: 99.99,
    dependsOn: [],
    region: "US-West",
  },
  {
    id: "identity",
    name: "Identity",
    domain: "Core services",
    health: "healthy",
    latencyMs: 42,
    uptime: 99.97,
    dependsOn: ["edge"],
    region: "US-West",
  },
  {
    id: "ledger",
    name: "Ledger",
    domain: "Data plane",
    health: "degraded",
    latencyMs: 126,
    uptime: 99.91,
    dependsOn: ["identity", "database"],
    region: "US-East",
  },
  {
    id: "events",
    name: "Event stream",
    domain: "Messaging",
    health: "healthy",
    latencyMs: 36,
    uptime: 99.98,
    dependsOn: ["database"],
    region: "EU-West",
  },
  {
    id: "database",
    name: "Primary store",
    domain: "Persistence",
    health: "healthy",
    latencyMs: 24,
    uptime: 99.99,
    dependsOn: [],
    region: "US-East",
  },
  {
    id: "insights",
    name: "Insight worker",
    domain: "Intelligence",
    health: "healthy",
    latencyMs: 58,
    uptime: 99.95,
    dependsOn: ["events"],
    region: "EU-West",
  },
];

export function getDemoObservabilitySnapshot(): ObservabilitySnapshot {
  const hasCritical = demoServices.some((service) => service.health === "critical");
  const hasDegraded = demoServices.some((service) => service.health === "degraded");

  return {
    capturedAt: new Date().toISOString(),
    health: hasCritical ? "critical" : hasDegraded ? "degraded" : "operational",
    serviceCount: demoServices.length,
    regionCount: new Set(demoServices.map((service) => service.region)).size,
    services: demoServices.map((service) => ({ ...service, dependsOn: [...service.dependsOn] })),
  };
}

export function getServiceTopology(): ServiceNode[] {
  return getDemoObservabilitySnapshot().services;
}
