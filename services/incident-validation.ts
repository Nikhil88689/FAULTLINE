import { validateIncidentForInvestigation } from "./incident-investigation";

export const maxIncidentPayloadBytes = 1_600_000;

/** Validates both the stored shape and fields that map to PostgreSQL integer columns. */
export function isPersistableIncident(
  value: unknown,
): value is import("@/types/incidents").IncidentRecord {
  const validated = validateIncidentForInvestigation(value);
  if (!validated) return false;

  const record = validated.record;
  return (
    Number.isSafeInteger(record.durationMs) &&
    Number.isSafeInteger(record.simulationStartMs) &&
    Number.isSafeInteger(record.simulationEndMs) &&
    Number.isSafeInteger(record.metrics.requests) &&
    Number.isSafeInteger(record.metrics.successfulRequests) &&
    Number.isSafeInteger(record.metrics.failedRequests) &&
    Number.isSafeInteger(record.metrics.affectedCount) &&
    record.replayFrames.every(
      (frame) => Number.isSafeInteger(frame.nowMs) && Number.isSafeInteger(frame.eventSequence),
    )
  );
}
