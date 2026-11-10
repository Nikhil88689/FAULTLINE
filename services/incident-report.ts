import type { IncidentRecord } from "@/types/incidents";
import {
  analyzeIncident,
  evidenceBasedRecommendations,
  formatMetric,
} from "./intelligence-analytics";

type ReportLine = { text: string; type?: "title" | "heading" | "body" | "muted" };

export function incidentReportLines(record: IncidentRecord): ReportLine[] {
  const analytics = analyzeIncident(record);
  const lines: ReportLine[] = [
    { text: "FAULTLINE / INCIDENT ANALYSIS", type: "title" },
    { text: `${record.name}  |  ${record.id}`, type: "muted" },
    {
      text: `Incident started: ${record.occurredAt ? new Date(record.occurredAt).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC" : "Start time unavailable in this historical record"}`,
      type: "muted",
    },
    { text: "EXPERIMENT SUMMARY", type: "heading" },
    {
      text: `Severity: ${record.severity.toUpperCase()}    Outcome: ${record.finalOutcome.toUpperCase()}`,
    },
    {
      text: `Fault injection duration: ${formatDuration(record.durationMs)}    Captured simulation window: ${formatDuration(record.simulationEndMs - record.simulationStartMs)}`,
    },
    { text: `Root cause: ${record.rootCause}` },
    { text: "FAILURE CONFIGURATION", type: "heading" },
    { text: `Failure type: ${record.failureConfiguration.faultType.replaceAll("-", " ")}` },
    {
      text: `Target: ${serviceName(record, record.failureConfiguration.targetServiceId)}    Intensity: ${record.failureConfiguration.intensity}%`,
    },
    {
      text: `Traffic multiplier: ${record.failureConfiguration.trafficVolume}x    Failure probability: ${(record.failureConfiguration.failureProbability * 100).toFixed(1)}%`,
    },
    {
      text: `Configured recovery strategy: ${record.failureConfiguration.recoveryStrategy.replaceAll("-", " ")}`,
    },
    { text: "KEY METRICS", type: "heading" },
    {
      text: `Availability: ${formatMetric(analytics.availabilityPct, "%")}    Request error rate: ${formatMetric(analytics.errorRatePct, "%")}`,
    },
    {
      text: `Average latency: ${formatMetric(analytics.averageLatencyMs, "ms")}    P95: ${formatMetric(analytics.p95LatencyMs, "ms")}    P99: ${formatMetric(analytics.p99LatencyMs, "ms")}`,
    },
    {
      text: `Throughput: ${formatMetric(analytics.throughputRps, "req/s")}    Failed requests: ${record.metrics.failedRequests}    Latency samples: ${analytics.latencySampleCount}`,
    },
    {
      text: `Mean time to recovery: ${formatMetric(analytics.meanTimeToRecoveryMs, "ms")}    Recovery effectiveness: ${formatMetric(analytics.recoveryEffectivenessPct, "%")}`,
    },
    {
      text: `Resource utilization (affected-service mean CPU / memory): ${formatMetric(analytics.resourceUtilizationPct, "%")} / ${formatMetric(analytics.memoryUtilizationPct, "%")}`,
    },
    { text: "AFFECTED SERVICES", type: "heading" },
  ];
  const finalServices = record.replayFrames.at(-1)?.services ?? [];
  if (record.affectedServices.length) {
    for (const id of record.affectedServices) {
      const service = finalServices.find((item) => item.id === id);
      lines.push({
        text: `- ${service?.name ?? id}    Final health: ${service?.health.toUpperCase() ?? "NOT RECORDED"}`,
      });
    }
  } else lines.push({ text: "Affected-service list was not recorded." });
  lines.push({ text: "RECORDED TIMELINE", type: "heading" });
  const timeline = record.events
    .filter(
      (event) =>
        event.type === "service.health.changed" ||
        event.type === "service.recovery.completed" ||
        event.type === "resilience.activated" ||
        (event.type === "request.completed" && event.outcome === "failure"),
    )
    .slice(0, 120);
  if (timeline.length) {
    for (const event of timeline)
      lines.push({
        text: `T+${formatDuration(event.atMs - record.simulationStartMs)}  ${eventDescription(record, event)}`,
      });
  } else
    lines.push({ text: "No discrete failure or recovery events were retained for this incident." });
  if (record.events.length > timeline.length)
    lines.push({
      text: `${record.events.length - timeline.length} additional non-critical events omitted from this report.`,
      type: "muted",
    });
  lines.push({ text: "RECOVERY ANALYSIS", type: "heading" });
  if (record.recoveryActions.length)
    for (const action of record.recoveryActions) lines.push({ text: `- ${action}` });
  else lines.push({ text: "No recovery actions were recorded." });
  lines.push({ text: "EVIDENCE-BASED RECOMMENDATIONS", type: "heading" });
  for (const recommendation of evidenceBasedRecommendations(record))
    lines.push({ text: `- ${recommendation}` });
  lines.push({ text: "DATA PROVENANCE", type: "heading" });
  lines.push({
    text: `This report is derived from incident ${record.id}, ${record.replayFrames.length} recorded simulation snapshots, ${record.events.length} retained events, and ${analytics.latencySampleCount} request latency samples.`,
  });
  lines.push({
    text: "Missing measurements are shown as unavailable; no chart or metric is filled with synthetic values.",
    type: "muted",
  });
  return lines;
}

export function generateIncidentReportPdf(record: IncidentRecord): Uint8Array {
  const lines = incidentReportLines(record).flatMap(wrapLine);
  const pages = paginate(lines);

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;

  pages.forEach((pageLines, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const stream = renderPdfPage(pageLines, index + 1, pages.length);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n%FAULTLINE\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1)
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function renderPdfPage(lines: ReportLine[], page: number, pageCount: number): string {
  let y = 748;
  const commands: string[] = [
    "0.025 0.033 0.047 rg 0 0 612 792 re f",
    "0.91 0.96 0.98 rg",
    `BT /F2 16 Tf 48 ${y} Td (${escapePdf("FAULTLINE / INCIDENT REPORT")}) Tj ET`,
  ];
  y -= 29;
  commands.push("0.36 0.84 0.88 RG 48 735 m 564 735 l S");
  for (const line of lines) {
    if (line.type === "title") continue;
    y -= line.type === "heading" ? 21 : line.type === "muted" ? 12 : 14;
    const text = escapePdf(line.text);
    if (line.type === "heading") {
      commands.push("0.38 0.83 0.86 rg", `BT /F2 9 Tf 48 ${y} Td (${text.toUpperCase()}) Tj ET`);
      y -= 2;
    } else if (line.type === "muted") {
      commands.push("0.54 0.61 0.69 rg", `BT /F1 8 Tf 48 ${y} Td (${text}) Tj ET`);
    } else {
      commands.push("0.82 0.87 0.91 rg", `BT /F1 9 Tf 48 ${y} Td (${text}) Tj ET`);
    }
  }
  commands.push(
    "0.35 0.42 0.50 rg",
    `BT /F1 7 Tf 48 28 Td (${escapePdf(`FAULTLINE / RECORDED SIMULATION DATA  |  PAGE ${page} OF ${pageCount}`)}) Tj ET`,
  );
  return commands.join("\n");
}

function wrapLine(line: ReportLine): ReportLine[] {
  if (line.text.length <= 92) return [line];
  const words = line.text.split(/\s+/);
  const result: ReportLine[] = [];
  let current = "";
  for (const word of words) {
    if (current && `${current} ${word}`.length > 92) {
      result.push({ ...line, text: current });
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) result.push({ ...line, text: current });
  return result;
}

function paginate(lines: ReportLine[]): ReportLine[][] {
  const pages: ReportLine[][] = [];
  let page: ReportLine[] = [];
  let used = 0;
  for (const line of lines) {
    const height = line.type === "heading" ? 23 : line.type === "muted" ? 12 : 14;
    if (page.length && used + height > 650) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(line);
    used += height;
  }
  if (page.length || !pages.length) pages.push(page);
  return pages;
}

function escapePdf(text: string): string {
  return text
    .normalize("NFKD")
    .replaceAll("→", "->")
    .replaceAll("×", "x")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("’", "'")
    .replaceAll("·", "|")
    .replace(/[^\x20-\x7E]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function serviceName(record: IncidentRecord, id: string): string {
  return (
    record.replayFrames.flatMap((frame) => frame.services).find((service) => service.id === id)
      ?.name ?? id
  );
}

function eventDescription(record: IncidentRecord, event: IncidentRecord["events"][number]): string {
  if (event.type === "service.health.changed")
    return `${serviceName(record, event.serviceId)} health ${event.from} -> ${event.to}: ${event.reason}`;
  if (event.type === "service.recovery.completed")
    return `${serviceName(record, event.serviceId)} recovery completed`;
  if (event.type === "resilience.activated")
    return `${event.strategy} at ${serviceName(record, event.serviceId)}: ${event.action}`;
  if (event.type === "request.completed")
    return `Request failed at ${event.failedAt ? serviceName(record, event.failedAt) : "unknown service"} (${event.latencyMs.toFixed(1)} ms): ${event.reason ?? "no reason recorded"}`;
  return "Recorded simulation event";
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1_000;
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}
