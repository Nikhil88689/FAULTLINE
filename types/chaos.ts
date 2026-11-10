import type { ServiceNode } from "@/types/observability";

export type FaultType = "latency" | "error-rate" | "service-unavailable";

export type BlastRadiusPreview = {
  targetServiceId: string;
  affectedServices: ServiceNode[];
};
