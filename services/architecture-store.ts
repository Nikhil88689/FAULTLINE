import type { ArchitectureDocument } from "@/types/architecture";
import { cloneArchitecture } from "@/simulation/architecture-templates";

const storageKey = "faultline.architecture.v1";

export function listSavedArchitectures(): ArchitectureDocument[] {
  if (typeof window === "undefined") return [];
  const stores: Storage[] = [];
  try {
    stores.push(window.sessionStorage);
  } catch {
    /* Continue with local storage. */
  }
  try {
    stores.push(window.localStorage);
  } catch {
    /* Continue with session storage. */
  }
  const saved = new Map<string, ArchitectureDocument>();
  for (const store of stores) {
    try {
      const raw = store.getItem(storageKey);
      if (!raw) continue;
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) {
        for (const architecture of value.filter(isArchitectureDocument)) {
          saved.set(architecture.id, cloneArchitecture(architecture));
        }
      }
    } catch {
      // A corrupt or unavailable browser store does not prevent reading the other one.
    }
  }
  return [...saved.values()];
}

export function saveArchitecture(architecture: ArchitectureDocument): ArchitectureDocument[] {
  const saved = listSavedArchitectures();
  const document = { ...cloneArchitecture(architecture), updatedAt: new Date().toISOString() };
  const updated = [document, ...saved.filter((item) => item.id !== document.id)].slice(0, 20);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(updated));
  } catch {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(updated));
    } catch {
      /* State remains active in the current editor session. */
    }
  }
  return updated;
}

function isArchitectureDocument(value: unknown): value is ArchitectureDocument {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ArchitectureDocument>;
  return (
    isText(record.id, 100) &&
    isText(record.name, 120) &&
    isText(record.description, 1_000) &&
    typeof record.requestsPerSecond === "number" &&
    Number.isFinite(record.requestsPerSecond) &&
    record.requestsPerSecond > 0 &&
    isText(record.updatedAt, 80) &&
    Number.isFinite(Date.parse(record.updatedAt)) &&
    Array.isArray(record.nodes) &&
    record.nodes.length <= 40 &&
    record.nodes.every(isArchitectureNode) &&
    Array.isArray(record.edges) &&
    record.edges.length <= 200 &&
    record.edges.every(isArchitectureEdge)
  );
}

function isArchitectureNode(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  return (
    isText(node.id, 100) &&
    isText(node.name, 120) &&
    isText(node.responsibility, 500) &&
    isText(node.region, 100) &&
    [
      "api-gateway",
      "microservice",
      "database",
      "cache",
      "message-queue",
      "load-balancer",
      "background-worker",
      "external-api",
    ].includes(String(node.type)) &&
    [
      node.x,
      node.y,
      node.capacityRequestsPerSecond,
      node.maxConcurrentRequests,
      node.baseLatencyMs,
      node.baselineMemoryPercent,
      node.baseFailureProbability,
    ].every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function isArchitectureEdge(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const edge = value as Record<string, unknown>;
  return isText(edge.id, 120) && isText(edge.source, 100) && isText(edge.target, 100);
}

function isText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}
