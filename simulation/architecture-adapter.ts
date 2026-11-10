import type {
  ArchitectureDocument,
  ArchitectureNode,
  ArchitectureValidation,
} from "@/types/architecture";
import type { ServiceDefinition, SimulationConfig, TrafficRoute } from "@/types/simulation";
import { DependencyGraph } from "./dependency-graph";

export function validateArchitecture(architecture: ArchitectureDocument): ArchitectureValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const routes: ArchitectureValidation["routes"] = [];
  if (!architecture.nodes.length)
    errors.push("Add at least one component before validating the architecture.");
  if (architecture.nodes.length > 40)
    errors.push("The editor supports up to 40 components per architecture.");
  if (!Number.isFinite(architecture.requestsPerSecond) || architecture.requestsPerSecond <= 0)
    errors.push("Traffic must be greater than zero requests per second.");
  const ids = new Set<string>();
  for (const node of architecture.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate component id: ${node.id}.`);
    ids.add(node.id);
    if (!node.name.trim()) errors.push(`Give ${node.id} a name.`);
    if (!Number.isFinite(node.capacityRequestsPerSecond) || node.capacityRequestsPerSecond <= 0)
      errors.push(`${node.name} needs a positive capacity.`);
    if (!Number.isFinite(node.maxConcurrentRequests) || node.maxConcurrentRequests < 1)
      errors.push(`${node.name} needs at least one concurrent request slot.`);
    if (!Number.isFinite(node.baseLatencyMs) || node.baseLatencyMs <= 0)
      errors.push(`${node.name} needs a positive base latency.`);
    if (
      !Number.isFinite(node.baselineMemoryPercent) ||
      node.baselineMemoryPercent < 0 ||
      node.baselineMemoryPercent > 100
    )
      errors.push(`${node.name} memory baseline must be between 0% and 100%.`);
    if (
      !Number.isFinite(node.baseFailureProbability) ||
      node.baseFailureProbability < 0 ||
      node.baseFailureProbability > 1
    )
      errors.push(`${node.name} failure probability must be between 0% and 100%.`);
  }
  const edgeKeys = new Set<string>();
  for (const edge of architecture.edges) {
    if (edge.source === edge.target)
      errors.push(`Self-dependency rejected on ${nodeName(architecture.nodes, edge.source)}.`);
    if (!ids.has(edge.source) || !ids.has(edge.target))
      errors.push(`Connection ${edge.id} references a component that no longer exists.`);
    const key = `${edge.source}\u0000${edge.target}`;
    if (edgeKeys.has(key))
      errors.push(
        `Duplicate connection between ${nodeName(architecture.nodes, edge.source)} and ${nodeName(architecture.nodes, edge.target)}.`,
      );
    edgeKeys.add(key);
  }

  const adjacency = new Map(architecture.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of architecture.edges)
    if (adjacency.has(edge.source) && adjacency.has(edge.target))
      adjacency.get(edge.source)!.push(edge.target);
  const active = new Set<string>();
  const complete = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (active.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(Math.max(0, cycleStart)), id].map((member) =>
        nodeName(architecture.nodes, member),
      );
      errors.push(`Circular dependency risk: ${cycle.join(" → ")}.`);
      return;
    }
    if (complete.has(id)) return;
    active.add(id);
    for (const target of adjacency.get(id) ?? []) visit(target, [...path, id]);
    active.delete(id);
    complete.add(id);
  };
  for (const node of architecture.nodes) visit(node.id, []);

  if (architecture.nodes.length && !errors.some((error) => error.includes("Circular dependency"))) {
    const incoming = new Set(architecture.edges.map((edge) => edge.target));
    const roots = architecture.nodes.filter((node) => !incoming.has(node.id));
    const preferredRoots = roots.filter(
      (node) => node.type === "load-balancer" || node.type === "api-gateway",
    );
    const entries = preferredRoots.length ? preferredRoots : roots;
    if (!entries.length) errors.push("No ingress component can be resolved from this graph.");
    for (const entry of entries) {
      const reachable = reachableFrom(entry.id, adjacency);
      const leaves = [...reachable].filter((id) => !adjacency.get(id)?.length);
      if (!leaves.length) routes.push({ entryServiceId: entry.id, targetServiceId: entry.id });
      else
        for (const target of leaves)
          routes.push({ entryServiceId: entry.id, targetServiceId: target });
      if (reachable.size <= 1 && architecture.nodes.length > 1)
        warnings.push(`${entry.name} has no downstream dependency route.`);
    }
    const reachableIds = new Set(
      entries.flatMap((entry) => [...reachableFrom(entry.id, adjacency)]),
    );
    const isolated = architecture.nodes.filter((node) => !reachableIds.has(node.id));
    if (isolated.length)
      warnings.push(
        `${isolated.length} component${isolated.length === 1 ? " is" : "s are"} outside the ingress request graph: ${isolated.map((node) => node.name).join(", ")}.`,
      );
    if (!routes.length)
      errors.push(
        "Connect an ingress component to at least one downstream service so traffic can be simulated.",
      );
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], routes };
}

export function toSimulationConfig(architecture: ArchitectureDocument): SimulationConfig {
  const validation = validateArchitecture(architecture);
  if (validation.errors.length) throw new Error(validation.errors.join(" "));
  const dependencies = new Map(
    architecture.nodes.map((node) => [
      node.id,
      architecture.edges.filter((edge) => edge.source === node.id).map((edge) => edge.target),
    ]),
  );
  const serviceDefinitions = architecture.nodes.map((node) =>
    toServiceDefinition(node, dependencies.get(node.id) ?? []),
  );
  // Keep DependencyGraph as the final execution-boundary check; it enforces the simulator's own graph contract.
  new DependencyGraph(serviceDefinitions);
  const routes: TrafficRoute[] = validation.routes.map((route, index) => ({
    id: `architecture-route-${index + 1}`,
    entryServiceId: route.entryServiceId,
    targetServiceId: route.targetServiceId,
    weight: 1,
  }));
  return {
    seed: stableSeed(
      JSON.stringify([
        architecture.requestsPerSecond,
        architecture.nodes.map((node) => [
          node.id,
          node.type,
          node.capacityRequestsPerSecond,
          node.maxConcurrentRequests,
          node.baseLatencyMs,
          node.baselineMemoryPercent,
          node.baseFailureProbability,
        ]),
        architecture.edges.map((edge) => [edge.source, edge.target]),
      ]),
    ),
    tickMs: 100,
    metricsWindowMs: 10_000,
    requestsPerSecond: architecture.requestsPerSecond,
    recoveryDurationMs: 6_000,
    automaticRecoveryDelayMs: 3_000,
    serviceDefinitions,
    routes,
  };
}

function toServiceDefinition(node: ArchitectureNode, dependsOn: string[]): ServiceDefinition {
  const category: ServiceDefinition["category"] =
    node.type === "database" || node.type === "cache"
      ? "data"
      : node.type === "message-queue" || node.type === "background-worker"
        ? "async"
        : node.type === "api-gateway" ||
            node.type === "load-balancer" ||
            node.type === "external-api"
          ? "entry"
          : "core";
  return {
    id: node.id,
    name: node.name.trim(),
    shortName: node.name.trim().toUpperCase().slice(0, 15),
    category,
    description: node.responsibility,
    position: [round((node.x / 1000 - 0.5) * 12, 2), round((0.5 - node.y / 620) * 8, 2), 0],
    dependsOn: [...dependsOn],
    region: node.region,
    capacityRequestsPerSecond: node.capacityRequestsPerSecond,
    maxConcurrentRequests: node.maxConcurrentRequests,
    baseLatencyMs: node.baseLatencyMs,
    baselineMemoryPercent: node.baselineMemoryPercent,
    baseFailureProbability: node.baseFailureProbability,
  };
}

function reachableFrom(id: string, adjacency: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const visit = (next: string) => {
    if (seen.has(next)) return;
    seen.add(next);
    for (const target of adjacency.get(next) ?? []) visit(target);
  };
  visit(id);
  return seen;
}

function nodeName(nodes: ArchitectureNode[], id: string) {
  return nodes.find((node) => node.id === id)?.name ?? id;
}
function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function stableSeed(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
