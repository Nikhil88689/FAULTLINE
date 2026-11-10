import type { RuntimeConnection } from "@/types/observatory-runtime";
import type { ServiceDefinition } from "@/types/simulation";

export class DependencyGraph {
  private readonly definitions = new Map<string, ServiceDefinition>();

  constructor(definitions: readonly ServiceDefinition[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.id))
        throw new Error(`Duplicate service id: ${definition.id}`);
      this.definitions.set(definition.id, definition);
    }
    for (const definition of definitions) {
      for (const dependencyId of definition.dependsOn) {
        if (!this.definitions.has(dependencyId)) {
          throw new Error(`${definition.id} depends on unknown service ${dependencyId}`);
        }
      }
    }
    this.assertAcyclic();
  }

  dependenciesOf(serviceId: string): string[] {
    const definition = this.getDefinition(serviceId);
    return [...definition.dependsOn];
  }

  edges(): RuntimeConnection[] {
    return [...this.definitions.values()].flatMap((definition) =>
      definition.dependsOn.map((dependencyId) => ({
        id: `${definition.id}-${dependencyId}`,
        source: definition.id,
        target: dependencyId,
        throughput: 0,
        averageLatencyMs: 0,
        errorRate: 0,
      })),
    );
  }

  /** Resolves an entry-to-operation route, followed by all downstream dependencies. */
  resolveRequestPath(entryServiceId: string, targetServiceId: string): string[] {
    return this.resolveRequestPlan(entryServiceId, targetServiceId).serviceIds;
  }

  resolveRequestPlan(
    entryServiceId: string,
    targetServiceId: string,
  ): {
    serviceIds: string[];
    connectionIds: string[];
    connections: Array<{ id: string; source: string; target: string }>;
  } {
    const route = this.findPath(entryServiceId, targetServiceId);
    const ordered = [...route];
    const included = new Set(ordered);
    const connections: string[] = [];
    const connectionEdges: Array<{ id: string; source: string; target: string }> = [];
    const addConnection = (sourceId: string, targetId: string) => {
      const id = `${sourceId}-${targetId}`;
      if (connections.includes(id)) return;
      connections.push(id);
      connectionEdges.push({ id, source: sourceId, target: targetId });
    };
    for (let index = 1; index < route.length; index += 1) {
      addConnection(route[index - 1], route[index]);
    }
    const visitDependencies = (serviceId: string) => {
      for (const dependencyId of this.dependenciesOf(serviceId)) {
        addConnection(serviceId, dependencyId);
        if (included.has(dependencyId)) continue;
        included.add(dependencyId);
        ordered.push(dependencyId);
        visitDependencies(dependencyId);
      }
    };
    visitDependencies(targetServiceId);
    return { serviceIds: ordered, connectionIds: connections, connections: connectionEdges };
  }

  private findPath(start: string, target: string): string[] {
    this.getDefinition(start);
    this.getDefinition(target);
    const pending: string[][] = [[start]];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const path = pending.shift()!;
      const current = path[path.length - 1];
      if (current === target) return path;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const dependency of this.dependenciesOf(current)) pending.push([...path, dependency]);
    }
    throw new Error(`No dependency path from ${start} to ${target}`);
  }

  private getDefinition(serviceId: string): ServiceDefinition {
    const definition = this.definitions.get(serviceId);
    if (!definition) throw new Error(`Unknown service: ${serviceId}`);
    return definition;
  }

  private assertAcyclic(): void {
    const active = new Set<string>();
    const complete = new Set<string>();
    const visit = (serviceId: string, path: string[]) => {
      if (active.has(serviceId)) {
        throw new Error(`Dependency cycle detected: ${[...path, serviceId].join(" -> ")}`);
      }
      if (complete.has(serviceId)) return;
      active.add(serviceId);
      for (const dependency of this.dependenciesOf(serviceId))
        visit(dependency, [...path, serviceId]);
      active.delete(serviceId);
      complete.add(serviceId);
    };
    for (const serviceId of this.definitions.keys()) visit(serviceId, []);
  }
}
