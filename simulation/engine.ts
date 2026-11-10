import type { BlastRadiusPreview } from "@/types/chaos";
import type { ServiceNode } from "@/types/observability";

/**
 * Estimates downstream impact by walking reverse dependency edges.
 * This is a pure preview; it does not inject faults or change service state.
 */
export function estimateBlastRadius(
  services: ServiceNode[],
  targetServiceId: string,
): BlastRadiusPreview {
  const byId = new Map(services.map((service) => [service.id, service]));
  const affected = new Set<string>(byId.has(targetServiceId) ? [targetServiceId] : []);
  const queue = [...affected];

  while (queue.length > 0) {
    const dependencyId = queue.shift();
    if (!dependencyId) continue;

    for (const service of services) {
      if (!affected.has(service.id) && service.dependsOn.includes(dependencyId)) {
        affected.add(service.id);
        queue.push(service.id);
      }
    }
  }

  return {
    targetServiceId,
    affectedServices: services.filter((service) => affected.has(service.id)),
  };
}
