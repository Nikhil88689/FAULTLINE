export type InvestigationConfidence = "high" | "medium" | "low";

export type InvestigationFinding = {
  summary: string;
  rootCauseAnalysis: {
    finding: string;
    confidence: InvestigationConfidence;
    evidenceRefs: string[];
  };
  propagationExplanation: {
    narrative: string;
    evidenceRefs: string[];
  };
  affectedServices: Array<{
    serviceId: string;
    impact: string;
    evidenceRefs: string[];
  }>;
  recoveryAssessment: {
    summary: string;
    strengths: string[];
    gaps: string[];
    evidenceRefs: string[];
  };
  preventiveMeasures: Array<{
    recommendation: string;
    rationale: string;
    evidenceRefs: string[];
  }>;
  alternativeRecoveryStrategies: Array<{
    strategy: string;
    rationale: string;
    tradeoffs: string[];
    evidenceRefs: string[];
  }>;
};

export type InvestigationUnavailableReason = "not_configured" | "provider_error" | "invalid_output";

export type InvestigationResponse =
  | {
      status: "complete";
      source: "ai";
      model: string;
      investigation: InvestigationFinding;
    }
  | {
      status: "unavailable";
      source: "local";
      reason: InvestigationUnavailableReason;
      message: string;
      investigation: InvestigationFinding;
    };

export type InvestigationEvidence = {
  incident: {
    id: string;
    name: string;
    severity: string;
    outcome: string;
    occurredAt: string | null;
    rootCauseRecorded: string;
    failureConfiguration: {
      failureType: string;
      targetServiceId: string;
      intensityPct: number;
      durationSeconds: number;
      trafficMultiplier: number;
      failureProbability: number;
      configuredRecoveryStrategy: string;
    };
  };
  dependencies: Array<{
    serviceId: string;
    name: string;
    dependsOn: string[];
    initialHealth: string | null;
    finalHealth: string | null;
    cpu: { baselinePct: number | null; peakPct: number | null };
    memory: { baselinePct: number | null; peakPct: number | null };
    latency: { baselineMs: number | null; peakMs: number | null; finalMs: number | null };
    errorRate: { baselinePct: number | null; peakPct: number | null; finalPct: number | null };
  }>;
  metrics: {
    requests: number;
    successfulRequests: number;
    failedRequests: number;
    availabilityPct: number | null;
    errorRatePct: number | null;
    averageLatencyMs: number | null;
    p95LatencyMs: number | null;
    p99LatencyMs: number | null;
    throughputRps: number | null;
    peakErrorRatePct: number;
    peakLatencyMs: number;
    mttrMs: number | null;
    recoveryEffectivenessPct: number | null;
  };
  timeline: Array<{
    ref: string;
    atMs: number;
    type: string;
    detail: string;
  }>;
  snapshots: Array<{
    ref: string;
    elapsedMs: number;
    requestsPerSecond: number;
    averageLatencyMs: number;
    errorRatePct: number;
    services: Array<{
      serviceId: string;
      health: string;
      cpuPct: number;
      memoryPct: number;
      latencyMs: number;
      errorRatePct: number;
    }>;
  }>;
  recoveryActions: string[];
  evidenceRefs: string[];
};
