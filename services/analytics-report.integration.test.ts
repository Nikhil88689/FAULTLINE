import { describe, expect, it } from "vitest";
import { makeIncidentFixture } from "../tests/fixtures/incident";
import { analyzeIncident, buildAnalyticsCsv } from "./intelligence-analytics";
import { generateIncidentReportPdf } from "./incident-report";

describe("analytics and report integration", () => {
  it("uses the selected incident evidence for calculated analytics, CSV, and PDF output", () => {
    const incident = makeIncidentFixture({
      metrics: {
        requests: 4,
        successfulRequests: 3,
        failedRequests: 1,
        peakErrorRate: 25,
        peakLatencyMs: 180,
        finalErrorRate: 0,
        finalLatencyMs: 30,
        affectedCount: 0,
      },
      durationMs: 1_000,
      latencySamplesMs: [20, 30, 40, 180],
      replayFrames: makeIncidentFixture().replayFrames,
    });
    const metrics = analyzeIncident(incident);

    expect(metrics.availabilityPct).toBe(75);
    expect(metrics.errorRatePct).toBe(25);
    expect(metrics.averageLatencyMs).toBe(67.5);
    expect(metrics.p95LatencyMs).toBe(180);
    expect(metrics.throughputRps).toBe(4);
    expect(buildAnalyticsCsv([incident])).toContain(",75,25,67.5,180,180,1,4,");

    const pdf = new TextDecoder().decode(generateIncidentReportPdf(incident));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("Database outage resilience check");
    expect(pdf).toContain("75.0%");
    expect(pdf).toContain("P95: 180.0 ms");
    expect(pdf.endsWith("%%EOF")).toBe(true);
  });
});
