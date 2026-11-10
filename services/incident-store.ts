import type { IncidentRecord, IncidentSummary } from "@/types/incidents";
import { isPersistableIncident } from "./incident-validation";

const storageKey = "faultline.incidents.v1";
const localLimit = 8;
const localByteBudget = 3_200_000;
const sessionRecords = new Map<string, IncidentRecord>();

function readLocal(): IncidentRecord[] {
  if (typeof window === "undefined") return [];
  const stored: IncidentRecord[] = [];
  const stores: Storage[] = [];
  try {
    stores.push(window.sessionStorage);
  } catch {
    /* Continue with whichever guest store is available. */
  }
  try {
    stores.push(window.localStorage);
  } catch {
    /* Browser policy may disable durable storage. */
  }
  for (const store of stores) {
    try {
      const raw = store.getItem(storageKey);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        stored.push(...parsed.filter(isPersistableIncident).map((record) => ({ ...record })));
      }
    } catch {
      // Check the other browser store and in-memory session cache independently.
    }
  }
  const merged = new Map<string, IncidentRecord>();
  for (const record of stored) merged.set(record.id, record);
  for (const [id, record] of sessionRecords) merged.set(id, record);
  return newest([...merged.values()]);
}

function writeLocal(records: IncidentRecord[]): IncidentRecord[] {
  if (typeof window === "undefined") return records;
  let retained = records.slice(0, localLimit);
  while (retained.length > 1 && JSON.stringify(retained).length * 2 > localByteBudget)
    retained = retained.slice(0, -1);
  sessionRecords.clear();
  for (const record of retained) sessionRecords.set(record.id, record);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(retained));
  } catch {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(retained));
    } catch {
      // Browser privacy policies can disable both stores; this tab can still keep the current run in memory.
    }
  }
  return retained;
}

function newest(records: IncidentRecord[]): IncidentRecord[] {
  return [...records].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export async function saveIncident(record: IncidentRecord): Promise<"database" | "local"> {
  const locallyPersisted = { ...record, persistence: "local" as const };
  writeLocal(newest([locallyPersisted, ...readLocal().filter((item) => item.id !== record.id)]));
  try {
    const response = await fetch("/api/incidents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    if (!response.ok) return "local";
    const databaseRecord = { ...record, persistence: "database" as const };
    writeLocal(newest([databaseRecord, ...readLocal().filter((item) => item.id !== record.id)]));
    return "database";
  } catch {
    return "local";
  }
}

export async function listIncidents(): Promise<IncidentRecord[]> {
  const localRecords = readLocal();
  try {
    const response = await fetch("/api/incidents", { cache: "no-store" });
    if (!response.ok) return newest(localRecords);
    const data = (await response.json()) as { incidents?: IncidentRecord[] };
    const merged = new Map<string, IncidentRecord>();
    for (const record of localRecords) merged.set(record.id, record);
    for (const record of data.incidents ?? []) {
      const existing = merged.get(record.id);
      merged.set(record.id, {
        ...existing,
        ...record,
        events: record.events ?? existing?.events ?? [],
        replayFrames: record.replayFrames ?? existing?.replayFrames ?? [],
        latencySamplesMs: record.latencySamplesMs ?? existing?.latencySamplesMs ?? [],
        persistence: "database",
      } as IncidentRecord);
    }
    return newest([...merged.values()]);
  } catch {
    return newest(localRecords);
  }
}

export async function getIncident(id: string): Promise<IncidentRecord | null> {
  try {
    const response = await fetch(`/api/incidents?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (response.ok) {
      const data = (await response.json()) as { incident?: IncidentRecord };
      if (data.incident) return { ...data.incident, persistence: "database" };
    }
  } catch {
    // Fall through to the guest cache.
  }
  return readLocal().find((record) => record.id === id) ?? null;
}

export function toIncidentSummary(record: IncidentRecord): IncidentSummary {
  const { events, replayFrames, latencySamplesMs, ...summary } = record;
  return {
    ...summary,
    replayFrameCount: replayFrames.length,
    eventCount: events.length,
    latencySampleCount: latencySamplesMs?.length ?? 0,
  };
}
