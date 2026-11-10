import type {
  ArchitectureComponentType,
  ArchitectureDocument,
  ArchitectureEdge,
  ArchitectureNode,
} from "@/types/architecture";

type NodeSeed = [string, ArchitectureComponentType, string, number, number, string?];
type LinkSeed = [string, string];

const presets: Record<
  string,
  { name: string; description: string; nodes: NodeSeed[]; edges: LinkSeed[] }
> = {
  ecommerce: {
    name: "E-commerce platform",
    description:
      "Checkout, identity, inventory reads, and asynchronous fulfillment across a transactional data plane.",
    nodes: [
      ["edge", "load-balancer", "Edge Load Balancer", 82, 300],
      ["gateway", "api-gateway", "API Gateway", 220, 300],
      ["identity", "microservice", "Identity Service", 390, 126],
      ["catalog", "microservice", "Product Catalog", 390, 275],
      ["checkout", "microservice", "Checkout Service", 390, 455],
      ["users", "database", "User Database", 565, 105],
      ["cache", "cache", "Catalog Cache", 565, 255],
      ["orders", "database", "Orders Database", 565, 420],
      ["payments", "microservice", "Payment Service", 565, 525],
      ["events", "message-queue", "Order Events", 735, 462],
      ["worker", "background-worker", "Fulfillment Worker", 850, 340],
      ["shipping", "external-api", "Shipping Partner API", 850, 170],
    ],
    edges: [
      ["edge", "gateway"],
      ["gateway", "identity"],
      ["gateway", "catalog"],
      ["gateway", "checkout"],
      ["identity", "users"],
      ["identity", "cache"],
      ["catalog", "cache"],
      ["catalog", "users"],
      ["checkout", "orders"],
      ["checkout", "payments"],
      ["checkout", "events"],
      ["payments", "orders"],
      ["payments", "events"],
      ["events", "worker"],
      ["worker", "orders"],
      ["worker", "shipping"],
    ],
  },
  healthcare: {
    name: "Healthcare platform",
    description:
      "Patient access, scheduling, clinical records, and protected event processing with a clear integration boundary.",
    nodes: [
      ["edge", "load-balancer", "Regional Load Balancer", 82, 310],
      ["gateway", "api-gateway", "Clinical API Gateway", 220, 310],
      ["auth", "microservice", "Identity & Access", 390, 135],
      ["patients", "microservice", "Patient Service", 390, 290],
      ["schedule", "microservice", "Scheduling Service", 390, 465],
      ["records", "database", "Clinical Records DB", 570, 225],
      ["cache", "cache", "Read Cache", 570, 385],
      ["events", "message-queue", "Care Events Queue", 735, 470],
      ["worker", "background-worker", "Notification Worker", 850, 350],
      ["lab", "external-api", "Laboratory Network API", 850, 160],
    ],
    edges: [
      ["edge", "gateway"],
      ["gateway", "auth"],
      ["gateway", "patients"],
      ["gateway", "schedule"],
      ["auth", "patients"],
      ["patients", "records"],
      ["patients", "cache"],
      ["schedule", "records"],
      ["schedule", "events"],
      ["events", "worker"],
      ["worker", "lab"],
    ],
  },
  banking: {
    name: "Banking transaction platform",
    description:
      "A low-latency transaction path with an authoritative ledger, idempotent queue, and guarded external settlement.",
    nodes: [
      ["edge", "load-balancer", "Banking Edge", 82, 310],
      ["gateway", "api-gateway", "Transaction Gateway", 220, 310],
      ["auth", "microservice", "Authorization Service", 390, 140],
      ["transfer", "microservice", "Transfer Orchestrator", 390, 320],
      ["ledger", "microservice", "Ledger Service", 570, 245],
      ["cache", "cache", "Account Cache", 570, 115],
      ["db", "database", "Ledger PostgreSQL", 745, 270],
      ["queue", "message-queue", "Settlement Queue", 570, 470],
      ["worker", "background-worker", "Settlement Worker", 745, 455],
      ["network", "external-api", "Payment Network API", 870, 455],
    ],
    edges: [
      ["edge", "gateway"],
      ["gateway", "auth"],
      ["gateway", "transfer"],
      ["auth", "cache"],
      ["transfer", "ledger"],
      ["transfer", "queue"],
      ["ledger", "db"],
      ["ledger", "cache"],
      ["queue", "worker"],
      ["worker", "ledger"],
      ["worker", "network"],
    ],
  },
  content: {
    name: "Content delivery platform",
    description:
      "A global request edge, metadata and cache layers, and asynchronous media processing behind external storage.",
    nodes: [
      ["edge", "load-balancer", "Global Load Balancer", 82, 310],
      ["gateway", "api-gateway", "Content API Gateway", 220, 310],
      ["content", "microservice", "Content Service", 390, 200],
      ["media", "microservice", "Media Metadata", 390, 420],
      ["cache", "cache", "Edge Metadata Cache", 570, 145],
      ["db", "database", "Content PostgreSQL", 570, 300],
      ["queue", "message-queue", "Transcode Queue", 570, 480],
      ["worker", "background-worker", "Transcode Worker", 735, 480],
      ["storage", "external-api", "Object Storage API", 870, 340],
      ["origin", "external-api", "Origin Media API", 735, 180],
    ],
    edges: [
      ["edge", "gateway"],
      ["gateway", "content"],
      ["gateway", "media"],
      ["content", "cache"],
      ["content", "db"],
      ["content", "origin"],
      ["media", "db"],
      ["media", "queue"],
      ["queue", "worker"],
      ["worker", "storage"],
    ],
  },
};

export const componentCatalog: Array<{
  type: ArchitectureComponentType;
  label: string;
  abbreviation: string;
  color: string;
  responsibility: string;
  capacity: number;
  latency: number;
  memory: number;
  failureProbability: number;
  maxConcurrency: number;
  failureModes: string[];
  recovery: string[];
}> = [
  {
    type: "api-gateway",
    label: "API Gateway",
    abbreviation: "API",
    color: "cyan",
    responsibility: "Authenticates, routes, and shapes ingress traffic.",
    capacity: 90,
    latency: 8,
    memory: 34,
    failureProbability: 0.001,
    maxConcurrency: 40,
    failureModes: ["Route table drift", "Connection pool exhaustion", "Token validation latency"],
    recovery: [
      "Route retries with capped backoff",
      "Circuit breaker around downstream calls",
      "Shift ingress to a healthy gateway",
    ],
  },
  {
    type: "microservice",
    label: "Microservice",
    abbreviation: "SVC",
    color: "violet",
    responsibility: "Owns a bounded domain operation and its service contract.",
    capacity: 42,
    latency: 18,
    memory: 48,
    failureProbability: 0.0012,
    maxConcurrency: 24,
    failureModes: ["CPU saturation", "Thread pool exhaustion", "Dependency timeout"],
    recovery: [
      "Retry idempotent work",
      "Open a circuit on unstable dependencies",
      "Scale horizontally",
    ],
  },
  {
    type: "database",
    label: "Database",
    abbreviation: "DB",
    color: "amber",
    responsibility: "Persists authoritative transactional state.",
    capacity: 76,
    latency: 22,
    memory: 64,
    failureProbability: 0.0008,
    maxConcurrency: 42,
    failureModes: ["Primary failover", "Lock contention", "Connection limit reached"],
    recovery: [
      "Promote a healthy replica",
      "Serve safe stale reads from cache",
      "Retry after bounded backoff",
    ],
  },
  {
    type: "cache",
    label: "Cache",
    abbreviation: "CACHE",
    color: "green",
    responsibility: "Serves hot reads and short-lived computed state close to callers.",
    capacity: 120,
    latency: 4,
    memory: 42,
    failureProbability: 0.0006,
    maxConcurrency: 60,
    failureModes: ["Eviction storm", "Memory pressure", "Cluster partition"],
    recovery: ["Fall through to source of truth", "Rebuild keys gradually", "Redistribute reads"],
  },
  {
    type: "message-queue",
    label: "Message Queue",
    abbreviation: "MQ",
    color: "violet",
    responsibility: "Buffers work between synchronous requests and asynchronous consumers.",
    capacity: 48,
    latency: 9,
    memory: 50,
    failureProbability: 0.001,
    maxConcurrency: 28,
    failureModes: ["Consumer lag", "Partition leader loss", "Unbounded backlog"],
    recovery: ["Scale consumers", "Apply bounded retries", "Back-pressure producers"],
  },
  {
    type: "load-balancer",
    label: "Load Balancer",
    abbreviation: "LB",
    color: "cyan",
    responsibility: "Distributes inbound traffic across healthy service instances.",
    capacity: 150,
    latency: 3,
    memory: 24,
    failureProbability: 0.0004,
    maxConcurrency: 70,
    failureModes: ["Unhealthy target pool", "Uneven hashing", "Edge connection exhaustion"],
    recovery: [
      "Remove unhealthy targets",
      "Rebalance across zones",
      "Fail over to a secondary edge",
    ],
  },
  {
    type: "background-worker",
    label: "Background Worker",
    abbreviation: "WORKER",
    color: "amber",
    responsibility: "Consumes queued jobs and performs work outside request latency budgets.",
    capacity: 32,
    latency: 35,
    memory: 56,
    failureProbability: 0.0014,
    maxConcurrency: 18,
    failureModes: ["Poison message loop", "Worker crash", "Queue drain below arrival rate"],
    recovery: ["Dead-letter poison work", "Restart workers with jitter", "Autoscale consumers"],
  },
  {
    type: "external-api",
    label: "External API",
    abbreviation: "EXT",
    color: "red",
    responsibility: "Represents an upstream or third-party service boundary.",
    capacity: 28,
    latency: 85,
    memory: 30,
    failureProbability: 0.012,
    maxConcurrency: 14,
    failureModes: ["Provider outage", "Rate limiting", "Elevated response latency"],
    recovery: [
      "Use a timeout and circuit breaker",
      "Degrade gracefully with cached data",
      "Retry with provider-safe jitter",
    ],
  },
];

export const architectureTemplates = Object.entries(presets).map(([key, preset]) => {
  const nodes: ArchitectureNode[] = preset.nodes.map(([id, type, name, x, y, responsibility]) =>
    makeNode(id, type, name, x, y, responsibility),
  );
  const edges: ArchitectureEdge[] = preset.edges.map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target,
  }));
  return {
    id: `template-${key}`,
    name: preset.name,
    description: preset.description,
    requestsPerSecond: 36,
    nodes,
    edges,
    updatedAt: new Date(0).toISOString(),
  } satisfies ArchitectureDocument;
});

export function makeNode(
  id: string,
  type: ArchitectureComponentType,
  name: string,
  x: number,
  y: number,
  responsibility?: string,
): ArchitectureNode {
  const template = componentCatalog.find((component) => component.type === type)!;
  return {
    id,
    type,
    name,
    responsibility: responsibility ?? template.responsibility,
    x,
    y,
    capacityRequestsPerSecond: template.capacity,
    maxConcurrentRequests: template.maxConcurrency,
    baseLatencyMs: template.latency,
    baselineMemoryPercent: template.memory,
    baseFailureProbability: template.failureProbability,
    region: "us-east-1",
  };
}

export function cloneArchitecture(architecture: ArchitectureDocument): ArchitectureDocument {
  return {
    ...architecture,
    nodes: architecture.nodes.map((node) => ({ ...node })),
    edges: architecture.edges.map((edge) => ({ ...edge })),
  };
}
