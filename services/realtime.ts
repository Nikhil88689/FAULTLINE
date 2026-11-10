import type { ObservabilitySnapshot } from "@/types/observability";

export type SnapshotListener = (snapshot: ObservabilitySnapshot) => void;

export interface RealtimeSubscription {
  unsubscribe(): void;
}

export interface RealtimeTransport {
  subscribe(listener: SnapshotListener): RealtimeSubscription;
}

/**
 * Replace with an external managed realtime provider in a later phase.
 * Vercel Functions remain request-scoped and do not host socket servers.
 */
export const realtimeTransport: RealtimeTransport | null = null;
