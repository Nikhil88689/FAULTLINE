import { analyzeIncident } from "./intelligence-analytics";
import type { IncidentRecord } from "@/types/incidents";
import type {
  InvestigationEvidence,
  InvestigationFinding,
  InvestigationResponse,
  InvestigationUnavailableReason,
} from "@/types/incident-investigation";
import type { SimulationEvent } from "@/types/observatory-runtime";

const healthStates = ["healthy", "high-load", "critical", "failed", "recovering"] as const;
const severities = ["critical", "high", "medium", "low"] as const;
const outcomes = ["recovered", "degraded", "failed"] as const;
const faultTypes = [
  "database-outage",
  "api-overload",
  "network-latency",
  "random-termination",
  "redis-failure",
  "queue-backlog",
  "authentication-outage",
  "cascading-failure",
  "custom",
] as const;
const recoveryStrategies = [
  "none",
  "retry-backoff",
  "circuit-breaker",
  "fallback-cache",
  "traffic-redistribution",
  "service-restart",
  "horizontal-autoscaling",
] as const;
const eventTypes = [
  "simulation.started",
  "simulation.paused",
  "simulation.reset",
  "simulation.tick",
  "request.generated",
  "request.routed",
  "request.completed",
  "service.health.changed",
  "service.recovery.completed",
  "resilience.activated",
  "traffic.rate.changed",
  "metrics.updated",
] as const;

const maxEvents = 5_000;
const maxFrames = 2_500;
const maxServices = 100;
const maxSamples = 100_000;

export type ValidatedInvestigationInput = {
  record: IncidentRecord;
  evidence: InvestigationEvidence;
  allowedRefs: Set<string>;
  affectedServiceIds: Set<string>;
};

export function validateIncidentForInvestigation(
  value: unknown,
): ValidatedInvestigationInput | null {
  if (!isObject(value)) return null;
  const record = value as unknown as IncidentRecord;
  if (
    !isText(record.id, 80) ||
    !isText(record.name, 200) ||
    !isIsoDate(record.timestamp) ||
    (record.occurredAt !== undefined && !isIsoDate(record.occurredAt)) ||
    !isOneOf(record.severity, severities) ||
    !isOneOf(record.finalOutcome, outcomes) ||
    !isText(record.rootCause, 800) ||
    !isFiniteInRange(record.durationMs, 0, 86_400_000) ||
    !isFiniteInRange(record.simulationStartMs, 0, Number.MAX_SAFE_INTEGER) ||
    !isFiniteInRange(record.simulationEndMs, record.simulationStartMs, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(record.affectedServices) ||
    record.affectedServices.length > maxServices ||
    !record.affectedServices.every((id) => isText(id, 100)) ||
    new Set(record.affectedServices).size !== record.affectedServices.length ||
    !isObject(record.failureConfiguration) ||
    !isIncidentMetrics(record.metrics) ||
    !Array.isArray(record.events) ||
    record.events.length > maxEvents ||
    !record.events.every(validateEvent) ||
    new Set(record.events.map((event) => event.sequence)).size !== record.events.length ||
    !Array.isArray(record.replayFrames) ||
    record.replayFrames.length < 1 ||
    record.replayFrames.length > maxFrames ||
    !record.replayFrames.every(validateFrame) ||
    !Array.isArray(record.recoveryActions) ||
    record.recoveryActions.length > 100 ||
    !record.recoveryActions.every((action) => isText(action, 500)) ||
    (record.latencySamplesMs !== undefined &&
      (!Array.isArray(record.latencySamplesMs) ||
        record.latencySamplesMs.length > maxSamples ||
        !record.latencySamplesMs.every((sample) => isFiniteInRange(sample, 0, 1_000_000))))
  )
    return null;
  if (
    record.metrics.requests !== record.metrics.successfulRequests + record.metrics.failedRequests ||
    record.metrics.affectedCount !== record.affectedServices.length
  )
    return null;

  const config = record.failureConfiguration;
  if (
    !isText(config.name, 200) ||
    !isOneOf(config.faultType, faultTypes) ||
    !isText(config.targetServiceId, 100) ||
    !isFiniteInRange(config.intensity, 0, 100) ||
    !isFiniteInRange(config.durationSeconds, 0, 3_600) ||
    !isFiniteInRange(config.trafficVolume, 0, 1_000) ||
    !isFiniteInRange(config.failureProbability, 0, 1) ||
    !isOneOf(config.recoveryStrategy, recoveryStrategies)
  )
    return null;

  const frames = [...record.replayFrames].sort((a, b) => a.nowMs - b.nowMs);
  const topology = frames.at(-1)!.services;
  const topologyIds = new Set(topology.map((service) => service.id));
  if (
    new Set(topology.map((service) => service.id)).size !== topology.length ||
    !topologyIds.has(config.targetServiceId) ||
    record.affectedServices.some((id) => !topologyIds.has(id)) ||
    topology.some((service) => service.dependsOn.some((id) => !topologyIds.has(id)))
  )
    return null;

  const evidence = buildEvidence(record, frames);
  return {
    record,
    evidence,
    allowedRefs: new Set(evidence.evidenceRefs),
    affectedServiceIds: new Set(record.affectedServices),
  };
}

export function validateInvestigationFinding(
  value: unknown,
  context: Pick<ValidatedInvestigationInput, "allowedRefs" | "affectedServiceIds">,
): value is InvestigationFinding {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      "summary",
      "rootCauseAnalysis",
      "propagationExplanation",
      "affectedServices",
      "recoveryAssessment",
      "preventiveMeasures",
      "alternativeRecoveryStrategies",
    ])
  )
    return false;
  const root = value.rootCauseAnalysis;
  const propagation = value.propagationExplanation;
  const recovery = value.recoveryAssessment;
  if (
    !isText(value.summary, 900) ||
    !isObject(root) ||
    !hasExactKeys(root, ["finding", "confidence", "evidenceRefs"]) ||
    !isText(root.finding, 1_600) ||
    !isOneOf(root.confidence, ["high", "medium", "low"] as const) ||
    !isEvidenceRefs(root.evidenceRefs, context.allowedRefs) ||
    !isObject(propagation) ||
    !hasExactKeys(propagation, ["narrative", "evidenceRefs"]) ||
    !isText(propagation.narrative, 1_800) ||
    !isEvidenceRefs(propagation.evidenceRefs, context.allowedRefs) ||
    !Array.isArray(value.affectedServices) ||
    value.affectedServices.length !== context.affectedServiceIds.size ||
    !isObject(recovery) ||
    !hasExactKeys(recovery, ["summary", "strengths", "gaps", "evidenceRefs"]) ||
    !isText(recovery.summary, 1_200) ||
    !isTextArray(recovery.strengths, 8, 700) ||
    !isTextArray(recovery.gaps, 8, 700) ||
    !isEvidenceRefs(recovery.evidenceRefs, context.allowedRefs) ||
    !Array.isArray(value.preventiveMeasures) ||
    value.preventiveMeasures.length > 8 ||
    !value.preventiveMeasures.every((item) => {
      if (!isObject(item) || !hasExactKeys(item, ["recommendation", "rationale", "evidenceRefs"]))
        return false;
      return (
        isText(item.recommendation, 700) &&
        isText(item.rationale, 700) &&
        isEvidenceRefs(item.evidenceRefs, context.allowedRefs)
      );
    }) ||
    !Array.isArray(value.alternativeRecoveryStrategies) ||
    value.alternativeRecoveryStrategies.length > 6 ||
    !value.alternativeRecoveryStrategies.every((item) => {
      if (
        !isObject(item) ||
        !hasExactKeys(item, ["strategy", "rationale", "tradeoffs", "evidenceRefs"])
      )
        return false;
      return (
        isText(item.strategy, 120) &&
        isText(item.rationale, 700) &&
        isTextArray(item.tradeoffs, 4, 500) &&
        isEvidenceRefs(item.evidenceRefs, context.allowedRefs)
      );
    })
  )
    return false;

  const returned = value.affectedServices as unknown[];
  const ids = returned.map((item) => (isObject(item) ? item.serviceId : null));
  if (
    ids.some((id) => typeof id !== "string" || !context.affectedServiceIds.has(id)) ||
    new Set(ids).size !== context.affectedServiceIds.size
  )
    return false;
  return returned.every(
    (item) =>
      isObject(item) &&
      hasExactKeys(item, ["serviceId", "impact", "evidenceRefs"]) &&
      isText(item.serviceId, 100) &&
      isText(item.impact, 700) &&
      isEvidenceRefs(item.evidenceRefs, context.allowedRefs),
  );
}

export function createLocalInvestigationFallback(
  input: ValidatedInvestigationInput,
  reason: InvestigationUnavailableReason,
): InvestigationResponse {
  const evidence = input.evidence;
  const messages: Record<InvestigationUnavailableReason, string> = {
    not_configured:
      "AI analysis is unavailable because OPENAI_API_KEY is not configured on the server.",
    provider_error:
      "AI analysis is unavailable because the configured provider could not complete this request.",
    invalid_output: "AI analysis is unavailable because provider output did not pass validation.",
  };
  const transitions = evidence.timeline.filter((event) => event.type === "service.health.changed");
  const recoveries = evidence.timeline.filter(
    (event) => event.type === "service.recovery.completed",
  );
  const resilienceActions = evidence.timeline.filter(
    (event) => event.type === "resilience.activated",
  );
  const unhealthy = evidence.dependencies.filter(
    (service) => service.finalHealth !== null && service.finalHealth !== "healthy",
  );
  const rootCause = evidence.incident.rootCauseRecorded
    ? "Recorded root-cause field: " +
      evidence.incident.rootCauseRecorded +
      ". This is simulation metadata; the local fallback does not infer causality."
    : "No root-cause value was recorded, and the local fallback does not infer one.";
  const propagation = transitions.length
    ? "Recorded health-transition sequence: " +
      transitions.map((event) => event.detail).join(" → ") +
      ". This sequence is observed; causal links are not inferred by the local fallback."
    : "No service health transitions were recorded, so local failure propagation cannot be described.";
  const errorText =
    evidence.metrics.errorRatePct === null
      ? "no recorded error-rate value"
      : evidence.metrics.errorRatePct.toFixed(1) + "% request error rate";
  const finding: InvestigationFinding = {
    summary:
      "AI analysis was not generated. Recorded experiment " +
      evidence.incident.name +
      " (" +
      evidence.incident.id +
      ") ended " +
      evidence.incident.outcome +
      " with " +
      evidence.metrics.failedRequests +
      " failed requests and " +
      errorText +
      ".",
    rootCauseAnalysis: {
      finding: rootCause,
      confidence: "low",
      evidenceRefs: evidence.incident.rootCauseRecorded ? ["meta:rootCause"] : [],
    },
    propagationExplanation: {
      narrative: propagation,
      evidenceRefs: transitions.map((event) => event.ref),
    },
    affectedServices: evidence.dependencies
      .filter((service) => input.affectedServiceIds.has(service.serviceId))
      .map((service) => ({
        serviceId: service.serviceId,
        impact:
          service.initialHealth !== service.finalHealth
            ? "Recorded health changed from " +
              (service.initialHealth ?? "not recorded") +
              " to " +
              (service.finalHealth ?? "not recorded") +
              "."
            : "Final recorded health: " + (service.finalHealth ?? "not recorded") + ".",
        evidenceRefs: ["service:" + service.serviceId],
      })),
    recoveryAssessment: {
      summary:
        "Recorded outcome: " +
        evidence.incident.outcome +
        ". The incident contains " +
        recoveries.length +
        " service recovery completion event" +
        (recoveries.length === 1 ? "" : "s") +
        ".",
      strengths: resilienceActions.map((event) => event.detail),
      gaps: unhealthy.map(
        (service) => service.name + " ended at " + service.finalHealth + " health.",
      ),
      evidenceRefs: [
        "meta:outcome",
        ...resilienceActions.map((event) => event.ref),
        ...recoveries.map((event) => event.ref),
        ...unhealthy.map((service) => "service:" + service.serviceId),
      ],
    },
    preventiveMeasures: [],
    alternativeRecoveryStrategies: [],
  };
  return {
    status: "unavailable",
    source: "local",
    reason,
    message: messages[reason],
    investigation: finding,
  };
}

export function isInvestigationResponse(value: unknown): value is InvestigationResponse {
  if (!isObject(value)) return false;
  if (value.status === "complete") {
    return value.source === "ai" && isText(value.model, 100) && isObject(value.investigation);
  }
  if (value.status === "unavailable") {
    return (
      value.source === "local" &&
      isOneOf(value.reason, ["not_configured", "provider_error", "invalid_output"] as const) &&
      isText(value.message, 500) &&
      isObject(value.investigation)
    );
  }
  return false;
}

function buildEvidence(
  record: IncidentRecord,
  frames: IncidentRecord["replayFrames"],
): InvestigationEvidence {
  const first = frames.reduce(
    (chosen, frame) =>
      frame.nowMs <= record.simulationStartMs && frame.nowMs > chosen.nowMs ? frame : chosen,
    frames[0]!,
  );
  const final = frames.at(-1)!;
  const injectionEnd = record.simulationStartMs + record.durationMs;
  const faultFrames = frames.filter(
    (frame) => frame.nowMs >= record.simulationStartMs && frame.nowMs <= injectionEnd,
  );
  const initialServices = new Map(first.services.map((service) => [service.id, service]));
  const finalServices = new Map(final.services.map((service) => [service.id, service]));
  const dependencies = final.services.map((service) => {
    const faultSamples = faultFrames.flatMap((frame) =>
      frame.services.filter((item) => item.id === service.id),
    );
    const initial = initialServices.get(service.id);
    const end = finalServices.get(service.id);
    return {
      serviceId: service.id,
      name: service.name,
      dependsOn: [...service.dependsOn],
      initialHealth: initial?.health ?? null,
      finalHealth: end?.health ?? null,
      cpu: {
        baselinePct: initial?.cpuUsage ?? null,
        peakPct: maximum(faultSamples.map((item) => item.cpuUsage)),
      },
      memory: {
        baselinePct: initial?.memoryUsage ?? null,
        peakPct: maximum(faultSamples.map((item) => item.memoryUsage)),
      },
      latency: {
        baselineMs: initial?.averageLatencyMs ?? null,
        peakMs: maximum(faultSamples.map((item) => item.averageLatencyMs)),
        finalMs: end?.averageLatencyMs ?? null,
      },
      errorRate: {
        baselinePct: initial?.errorRate ?? null,
        peakPct: maximum(faultSamples.map((item) => item.errorRate)),
        finalPct: end?.errorRate ?? null,
      },
    };
  });
  const names = new Map(dependencies.map((service) => [service.serviceId, service.name]));
  const timelineEvents = record.events
    .filter(isInvestigationEvent)
    .sort((a, b) => a.atMs - b.atMs || a.sequence - b.sequence);
  const timeline = sampleItems(timelineEvents, 160).map((event) => ({
    ref: "event:" + event.sequence,
    atMs: event.atMs,
    type: event.type,
    detail: describeEvent(event, names),
  }));
  const snapshots = sampleFrames(frames, 20).map((frame, index) => ({
    ref: "snapshot:" + index,
    elapsedMs: Math.max(0, frame.nowMs - record.simulationStartMs),
    requestsPerSecond: frame.metrics.requestsPerSecond,
    averageLatencyMs: frame.metrics.averageLatencyMs,
    errorRatePct: frame.metrics.errorRate,
    services: frame.services
      .filter((service) => record.affectedServices.includes(service.id))
      .map((service) => ({
        serviceId: service.id,
        health: service.health,
        cpuPct: service.cpuUsage,
        memoryPct: service.memoryUsage,
        latencyMs: service.averageLatencyMs,
        errorRatePct: service.errorRate,
      })),
  }));
  const analyzed = analyzeIncident(record);
  const metrics = {
    requests: record.metrics.requests,
    successfulRequests: record.metrics.successfulRequests,
    failedRequests: record.metrics.failedRequests,
    availabilityPct: analyzed.availabilityPct,
    errorRatePct: analyzed.errorRatePct,
    averageLatencyMs: analyzed.averageLatencyMs,
    p95LatencyMs: analyzed.p95LatencyMs,
    p99LatencyMs: analyzed.p99LatencyMs,
    throughputRps: analyzed.throughputRps,
    peakErrorRatePct: record.metrics.peakErrorRate,
    peakLatencyMs: record.metrics.peakLatencyMs,
    mttrMs: analyzed.meanTimeToRecoveryMs,
    recoveryEffectivenessPct: analyzed.recoveryEffectivenessPct,
  };
  const evidenceRefs = [
    "meta:incident",
    "meta:rootCause",
    "meta:configuration",
    "meta:outcome",
    ...Object.entries(metrics)
      .filter((entry) => entry[1] !== null)
      .map((entry) => "metric:" + entry[0]),
    ...dependencies.map((service) => "service:" + service.serviceId),
    ...timeline.map((event) => event.ref),
    ...snapshots.map((snapshot) => snapshot.ref),
  ];
  return {
    incident: {
      id: record.id,
      name: record.name,
      severity: record.severity,
      outcome: record.finalOutcome,
      occurredAt: record.occurredAt ?? null,
      rootCauseRecorded: record.rootCause,
      failureConfiguration: {
        failureType: record.failureConfiguration.faultType,
        targetServiceId: record.failureConfiguration.targetServiceId,
        intensityPct: record.failureConfiguration.intensity,
        durationSeconds: record.failureConfiguration.durationSeconds,
        trafficMultiplier: record.failureConfiguration.trafficVolume,
        failureProbability: record.failureConfiguration.failureProbability,
        configuredRecoveryStrategy: record.failureConfiguration.recoveryStrategy,
      },
    },
    dependencies,
    metrics,
    timeline,
    snapshots,
    recoveryActions: record.recoveryActions.slice(0, 30),
    evidenceRefs,
  };
}

function validateEvent(value: unknown): value is SimulationEvent {
  if (
    !isObject(value) ||
    !isOneOf(value.type, eventTypes) ||
    !isFiniteInRange(value.sequence, 0, Number.MAX_SAFE_INTEGER) ||
    !Number.isInteger(value.sequence) ||
    !isFiniteInRange(value.atMs, 0, Number.MAX_SAFE_INTEGER)
  )
    return false;
  if (value.type === "service.health.changed") {
    return (
      isText(value.serviceId, 100) &&
      isOneOf(value.from, healthStates) &&
      isOneOf(value.to, healthStates) &&
      isText(value.reason, 500)
    );
  }
  if (value.type === "service.recovery.completed") return isText(value.serviceId, 100);
  if (value.type === "resilience.activated") {
    return isText(value.serviceId, 100) && isText(value.strategy, 100) && isText(value.action, 500);
  }
  if (value.type === "request.completed") {
    return (
      isText(value.requestId, 120) &&
      isText(value.routeId, 120) &&
      isTextArray(value.path, 100, 100) &&
      isFiniteInRange(value.latencyMs, 0, 1_000_000) &&
      isOneOf(value.outcome, ["success", "failure"] as const) &&
      (value.failedAt === undefined || isText(value.failedAt, 100)) &&
      (value.reason === undefined || isText(value.reason, 500))
    );
  }
  if (value.type === "traffic.rate.changed") {
    return (
      isFiniteInRange(value.multiplier, 0, 1_000) &&
      isFiniteInRange(value.requestsPerSecond, 0, 1_000_000)
    );
  }
  if (value.type === "simulation.tick") {
    return (
      isFiniteInRange(value.tick, 0, Number.MAX_SAFE_INTEGER) &&
      isFiniteInRange(value.generatedRequests, 0, 1_000_000)
    );
  }
  if (value.type === "request.generated") {
    return (
      isText(value.requestId, 120) &&
      isText(value.routeId, 120) &&
      isText(value.targetServiceId, 100)
    );
  }
  if (value.type === "request.routed") {
    return (
      isText(value.requestId, 120) &&
      isText(value.routeId, 120) &&
      isTextArray(value.path, 100, 100) &&
      isTextArray(value.connectionIds, 100, 120) &&
      isFiniteInRange(value.estimatedLatencyMs, 0, 1_000_000)
    );
  }
  if (value.type === "metrics.updated") {
    return isFiniteInRange(value.version, 0, Number.MAX_SAFE_INTEGER);
  }
  return true;
}

function validateFrame(value: unknown): value is IncidentRecord["replayFrames"][number] {
  if (
    !isObject(value) ||
    !isFiniteInRange(value.nowMs, -1, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(value.services) ||
    value.services.length > maxServices ||
    !isObject(value.metrics) ||
    !isFiniteInRange(value.metrics.requestsPerSecond, 0, 1_000_000) ||
    !isFiniteInRange(value.metrics.averageLatencyMs, 0, 1_000_000) ||
    !isFiniteInRange(value.metrics.errorRate, 0, 100)
  )
    return false;
  return value.services.every(
    (service) =>
      isObject(service) &&
      isText(service.id, 100) &&
      isText(service.name, 160) &&
      Array.isArray(service.dependsOn) &&
      service.dependsOn.length <= maxServices &&
      service.dependsOn.every((id) => isText(id, 100)) &&
      isOneOf(service.health, healthStates) &&
      isFiniteInRange(service.cpuUsage, 0, 100) &&
      isFiniteInRange(service.memoryUsage, 0, 100) &&
      isFiniteInRange(service.averageLatencyMs, 0, 1_000_000) &&
      isFiniteInRange(service.errorRate, 0, 100),
  );
}

function isIncidentMetrics(value: unknown): value is IncidentRecord["metrics"] {
  if (!isObject(value)) return false;
  const required = [
    value.requests,
    value.successfulRequests,
    value.failedRequests,
    value.peakErrorRate,
    value.peakLatencyMs,
    value.finalErrorRate,
    value.finalLatencyMs,
    value.affectedCount,
  ];
  return (
    required.every((metric) => isFiniteInRange(metric, 0, Number.MAX_SAFE_INTEGER)) &&
    isFiniteInRange(value.peakErrorRate, 0, 100) &&
    isFiniteInRange(value.finalErrorRate, 0, 100)
  );
}

function isInvestigationEvent(event: SimulationEvent): boolean {
  return (
    event.type === "service.health.changed" ||
    event.type === "service.recovery.completed" ||
    event.type === "resilience.activated" ||
    event.type === "traffic.rate.changed" ||
    (event.type === "request.completed" && event.outcome === "failure")
  );
}

function describeEvent(event: SimulationEvent, names: Map<string, string>): string {
  if (event.type === "service.health.changed") {
    return (
      (names.get(event.serviceId) ?? event.serviceId) +
      ": " +
      event.from +
      " → " +
      event.to +
      ". " +
      event.reason
    );
  }
  if (event.type === "service.recovery.completed") {
    return (names.get(event.serviceId) ?? event.serviceId) + ": recovery completed.";
  }
  if (event.type === "resilience.activated") {
    return (
      event.strategy +
      " on " +
      (names.get(event.serviceId) ?? event.serviceId) +
      ": " +
      event.action
    );
  }
  if (event.type === "traffic.rate.changed") {
    return (
      "Traffic changed to " +
      event.multiplier +
      "× (" +
      event.requestsPerSecond +
      " requests per second)."
    );
  }
  if (event.type === "request.completed") {
    return (
      "Request failed" +
      (event.failedAt ? " at " + (names.get(event.failedAt) ?? event.failedAt) : "") +
      "; " +
      event.latencyMs +
      " ms. " +
      (event.reason ?? "")
    );
  }
  return event.type;
}

function sampleFrames(frames: IncidentRecord["replayFrames"], limit: number) {
  if (frames.length <= limit) return frames;
  return Array.from(
    { length: limit },
    (_, index) => frames[Math.round((index * (frames.length - 1)) / (limit - 1))]!,
  );
}

function sampleItems<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from(
    { length: limit },
    (_, index) => items[Math.round((index * (items.length - 1)) / (limit - 1))]!,
  );
}

function maximum(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isTextArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => isText(item, maxLength))
  );
}

function isFiniteInRange(value: unknown, minimum: number, maximumValue: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximumValue
  );
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isEvidenceRefs(value: unknown, allowed: Set<string>): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 10 &&
    value.every((ref) => typeof ref === "string" && allowed.has(ref)) &&
    new Set(value).size === value.length
  );
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
