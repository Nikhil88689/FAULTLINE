"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Filter,
  GitBranch,
  Layers3,
  LoaderCircle,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getIncident, listIncidents } from "@/services/incident-store";
import {
  analyzeIncident,
  beforeAfterComparison,
  buildAnalyticsCsv,
  evidenceBasedRecommendations,
  failurePropagation,
  formatMetric,
  latencyDistribution,
  meanTimeBetweenFailuresMs,
  recoveryPerformance,
  scenarioComparison,
  serviceHealthComparisons,
  timeSeries,
  type AnalyticsMetricName,
  type AnalyticsRange,
} from "@/services/intelligence-analytics";
import { generateIncidentReportPdf } from "@/services/incident-report";
import type { IncidentRecord } from "@/types/incidents";
import styles from "./intelligence-workbench.module.css";
import { motionDuration, motionEase } from "@/animations/tokens";

type HistoryRange = "all" | "24h" | "7d" | "30d";
const metricOptions: Array<{
  id: AnalyticsMetricName;
  label: string;
  unit: string;
  color: string;
}> = [
  { id: "latency", label: "LATENCY", unit: "ms", color: "cyan" },
  { id: "error", label: "ERROR RATE", unit: "%", color: "red" },
  { id: "throughput", label: "THROUGHPUT", unit: "req/s", color: "violet" },
  { id: "cpu", label: "CPU UTILIZATION", unit: "%", color: "amber" },
  { id: "memory", label: "MEMORY UTILIZATION", unit: "%", color: "green" },
];
const ranges: Array<{ id: AnalyticsRange; label: string }> = [
  { id: "full", label: "FULL RUN" },
  { id: "fault", label: "FAULT WINDOW" },
  { id: "recovery", label: "RECOVERY" },
];

export function IntelligenceWorkbench() {
  const reduceMotion = useReducedMotion();
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [comparisonId, setComparisonId] = useState("");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [faultFilter, setFaultFilter] = useState("all");
  const [signalRange, setSignalRange] = useState<AnalyticsRange>("full");
  const [seriesMetric, setSeriesMetric] = useState<AnalyticsMetricName>("latency");
  const [loading, setLoading] = useState(true);
  const [exportNotice, setExportNotice] = useState("");
  const [reportGenerating, setReportGenerating] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let alive = true;
    void listIncidents()
      .then((records) => {
        if (!alive) return;
        setNow(Date.now());
        setIncidents(records);
        setSelectedId(records[0]?.id ?? "");
        setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setNow(Date.now());
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const selected = incidents.find((item) => item.id === selectedId);
    if (selected?.events && selected.replayFrames?.length) return;
    let alive = true;
    void getIncident(selectedId).then((record) => {
      if (alive && record)
        setIncidents((current) => current.map((item) => (item.id === record.id ? record : item)));
    });
    return () => {
      alive = false;
    };
  }, [selectedId, incidents]);

  const availableFaults = useMemo(
    () => [
      ...new Set(incidents.map((item) => item.failureConfiguration?.faultType).filter(Boolean)),
    ],
    [incidents],
  );
  const availableServices = useMemo(
    () => [...new Set(incidents.flatMap((item) => item.affectedServices ?? []))].sort(),
    [incidents],
  );
  const filtered = useMemo(() => {
    const cutoff =
      historyRange === "all"
        ? -Infinity
        : now -
          ({ "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 } as const)[historyRange];
    return incidents.filter((item) => {
      const recordedAt = Date.parse(item.occurredAt ?? item.timestamp);
      return (
        recordedAt >= cutoff &&
        (serviceFilter === "all" || item.affectedServices.includes(serviceFilter)) &&
        (faultFilter === "all" || item.failureConfiguration?.faultType === faultFilter)
      );
    });
  }, [faultFilter, historyRange, incidents, now, serviceFilter]);
  const selected =
    incidents.find(
      (item) =>
        item.id === selectedId && filtered.some((filteredItem) => filteredItem.id === item.id),
    ) ??
    filtered[0] ??
    null;
  const comparison =
    filtered.find((item) => item.id === comparisonId && item.id !== selected?.id) ?? null;
  const metrics = selected ? analyzeIncident(selected) : null;
  const mtbf = meanTimeBetweenFailuresMs(filtered);
  const series = selected
    ? timeSeries(
        selected,
        serviceFilter !== "all" ? serviceFilter : "all",
        signalRange,
        seriesMetric,
      )
    : [];
  const distribution = selected ? latencyDistribution(selected) : [];
  const serviceComparisons = selected
    ? serviceHealthComparisons(selected).filter(
        (item) => serviceFilter === "all" || item.id === serviceFilter,
      )
    : [];
  const propagation = selected ? failurePropagation(selected) : null;
  const recovery = recoveryPerformance(filtered).slice(-8);
  const beforeAfter = selected
    ? beforeAfterComparison(
        selected,
        serviceFilter === "all" ? (selected.affectedServices[0] ?? "") : serviceFilter,
      )
    : [];
  const scenarioMetrics = selected ? scenarioComparison(selected, comparison) : [];

  function exportCsv() {
    const csv = buildAnalyticsCsv(filtered);
    download(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `faultline-analytics-${dateStamp()}.csv`,
    );
    setExportNotice(
      `CSV exported with ${filtered.length} recorded experiment${filtered.length === 1 ? "" : "s"}.`,
    );
  }

  async function exportPdf() {
    if (!selected || reportGenerating) return;
    setReportGenerating(true);
    setExportNotice("Preparing PDF from recorded incident evidence…");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const bytes = generateIncidentReportPdf(selected);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      download(
        new Blob([copy.buffer], { type: "application/pdf" }),
        `faultline-incident-${selected.id.toLowerCase()}.pdf`,
      );
      setExportNotice(`PDF report generated from incident ${selected.id}.`);
    } catch {
      setExportNotice(
        "PDF generation failed. The source incident remains available in the archive.",
      );
    } finally {
      setReportGenerating(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            <span /> OBSERVABILITY / EXPERIMENT ANALYTICS
          </div>
          <h1>
            Intelligence <i>through evidence.</i>
          </h1>
          <p>
            Read the system from the record: request samples, historical snapshots, and typed
            recovery events.
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.sourceBadge}>
            <span className={styles.pulse} />{" "}
            {loading
              ? "SYNCING RECORDS"
              : `${filtered.length} RECORDED RUN${filtered.length === 1 ? "" : "S"}`}
          </div>
          <button
            className={styles.exportButton}
            type="button"
            onClick={exportCsv}
            disabled={!filtered.length}
          >
            <Download size={14} /> EXPORT CSV
          </button>
          <button
            className={styles.reportButton}
            type="button"
            onClick={exportPdf}
            disabled={!selected || !selected.replayFrames?.length || reportGenerating}
            aria-busy={reportGenerating}
          >
            {reportGenerating ? (
              <LoaderCircle size={14} className={styles.reportSpinner} />
            ) : (
              <FileText size={14} />
            )}
            {reportGenerating ? "BUILDING REPORT" : "INCIDENT PDF"}
          </button>
          <AnimatePresence initial={false}>
            {reportGenerating && (
              <motion.div
                key="report-progress"
                className={styles.reportProgress}
                role="status"
                aria-live="polite"
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -3 }}
                transition={{
                  duration: reduceMotion ? 0 : motionDuration.fast,
                  ease: motionEase.standard,
                }}
              >
                <span /> Assembling report from the selected incident record
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      <section className={styles.controlBar} aria-label="Analytics filters">
        <div className={styles.filterTitle}>
          <SlidersHorizontal size={14} />
          <span>ANALYTICS SCOPE</span>
        </div>
        <Select
          label="Time range"
          value={historyRange}
          onChange={(value) => setHistoryRange(value as HistoryRange)}
          options={[
            { value: "all", label: "ALL TIME" },
            { value: "24h", label: "LAST 24 HOURS" },
            { value: "7d", label: "LAST 7 DAYS" },
            { value: "30d", label: "LAST 30 DAYS" },
          ]}
        />
        <Select
          label="Service selection"
          value={serviceFilter}
          onChange={setServiceFilter}
          options={[
            { value: "all", label: "ALL SERVICES" },
            ...availableServices.map((id) => ({ value: id, label: serviceName(incidents, id) })),
          ]}
        />
        <Select
          label="Failure type filter"
          value={faultFilter}
          onChange={setFaultFilter}
          options={[
            { value: "all", label: "ALL FAILURE TYPES" },
            ...availableFaults.map((fault) => ({
              value: fault,
              label: fault.replaceAll("-", " ").toUpperCase(),
            })),
          ]}
        />
        <Select
          label="Experiment selection"
          value={selected?.id ?? ""}
          onChange={(value) => setSelectedId(value)}
          options={filtered.map((item) => ({ value: item.id, label: item.name }))}
          emptyLabel="NO RECORDED EXPERIMENTS"
        />
        <Select
          label="Comparison selection"
          value={comparison?.id ?? ""}
          onChange={setComparisonId}
          options={[
            { value: "", label: "NO COMPARISON" },
            ...filtered
              .filter((item) => item.id !== selected?.id)
              .map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      </section>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            className={styles.empty}
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <span className={styles.spinner} />
            <strong>Reading experiment records</strong>
            <p>Synchronizing saved snapshots and measured request samples.</p>
          </motion.div>
        ) : !filtered.length ? (
          <motion.div
            className={styles.empty}
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className={styles.emptyIcon}>
              <BarChart3 size={20} />
            </span>
            <strong>
              {incidents.length
                ? "No records match this scope"
                : "Analytics begin with a recorded experiment"}
            </strong>
            <p>
              {incidents.length
                ? "Change the time, service, or experiment filters to inspect available evidence."
                : "Complete a run in Chaos Lab. FAULTLINE will store its measured request samples, event timeline, and state snapshots here."}
            </p>
            {!incidents.length && (
              <Link href="/chaos-lab">
                OPEN CHAOS LAB <ArrowRight size={13} />
              </Link>
            )}
          </motion.div>
        ) : selected && metrics ? (
          <motion.div
            className={styles.dashboard}
            key={`${selected.id}-${historyRange}-${serviceFilter}-${comparison?.id ?? "none"}`}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.25 }}
          >
            <section className={styles.metricGrid} aria-label="Measured experiment metrics">
              <Metric
                label="AVAILABILITY"
                value={formatMetric(metrics.availabilityPct, "%")}
                note={
                  metrics.availabilityPct === null
                    ? "request outcome data unavailable"
                    : `${selected.metrics.successfulRequests.toLocaleString()} successful / ${selected.metrics.requests.toLocaleString()} requests`
                }
                color="green"
                icon={<ShieldCheck size={14} />}
              />
              <Metric
                label="MEAN TIME TO RECOVERY"
                value={formatDuration(metrics.meanTimeToRecoveryMs)}
                note={
                  metrics.recoverySampleCount
                    ? `${metrics.recoverySampleCount} recovery completions recorded`
                    : "no recovery completion event"
                }
                color="cyan"
                icon={<Clock3 size={14} />}
              />
              <Metric
                label="MEAN TIME BETWEEN FAILURES"
                value={formatDuration(mtbf)}
                note={
                  mtbf === null
                    ? "requires two dated failure starts"
                    : `${filtered.length} dated experiments in scope`
                }
                color="violet"
                icon={<Activity size={14} />}
              />
              <Metric
                label="P95 / P99 LATENCY"
                value={
                  metrics.p95LatencyMs === null || metrics.p99LatencyMs === null
                    ? "—"
                    : `${formatMetric(metrics.p95LatencyMs, "ms")} / ${formatMetric(metrics.p99LatencyMs, "ms")}`
                }
                note={
                  metrics.latencySampleCount
                    ? `${metrics.latencySampleCount.toLocaleString()} request latency samples`
                    : "percentiles not recorded for this run"
                }
                color="amber"
                icon={<Waves size={14} />}
                compact
              />
              <Metric
                label="FAILED REQUESTS"
                value={metrics.failedRequests?.toLocaleString() ?? "—"}
                note={
                  metrics.errorRatePct === null
                    ? "request counts unavailable"
                    : `${formatMetric(metrics.errorRatePct, "%")} observed error rate`
                }
                color="red"
                icon={<TriangleAlert size={14} />}
              />
              <Metric
                label="RECOVERY EFFECTIVENESS"
                value={formatMetric(metrics.recoveryEffectivenessPct, "%")}
                note={
                  metrics.recoveryEffectivenessPct === null
                    ? "no final service snapshot"
                    : `${selected.metrics.recoveredServiceCount ?? Math.round((metrics.recoveryEffectivenessPct / 100) * selected.affectedServices.length)} / ${selected.affectedServices.length} affected services healthy`
                }
                color="green"
                icon={<Check size={14} />}
              />
              <Metric
                label="AVERAGE LATENCY"
                value={formatMetric(metrics.averageLatencyMs, "ms")}
                note={`${metrics.latencySampleCount.toLocaleString()} recorded request samples`}
                color="cyan"
                icon={<Waves size={14} />}
              />
              <Metric
                label="THROUGHPUT"
                value={formatMetric(metrics.throughputRps, "req/s")}
                note="completed requests / experiment duration"
                color="violet"
                icon={<ArrowUpRight size={14} />}
              />
              <Metric
                label="RESOURCE UTILIZATION"
                value={`CPU ${formatMetric(metrics.resourceUtilizationPct, "%")} / MEM ${formatMetric(metrics.memoryUtilizationPct, "%")}`}
                note="mean affected-service load during injection"
                color="amber"
                icon={<Layers3 size={14} />}
                compact
              />
            </section>

            <section className={styles.primaryGrid}>
              <article className={styles.panel}>
                <PanelHeading
                  index="01"
                  title="Signal over time"
                  note={`${selected.name} · ${series.length} recorded snapshots`}
                  icon={<Activity size={15} />}
                />
                <div className={styles.chartControls}>
                  <div className={styles.metricTabs}>
                    {metricOptions.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        className={`${styles.metricTab} ${seriesMetric === option.id ? styles.metricTabActive : ""}`}
                        onClick={() => setSeriesMetric(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <Select
                    label="Experiment phase"
                    value={signalRange}
                    onChange={(value) => setSignalRange(value as AnalyticsRange)}
                    options={ranges.map((range) => ({ value: range.id, label: range.label }))}
                    compact
                  />
                </div>
                <TimeSeriesChart
                  key={`${selected.id}-${serviceFilter}-${signalRange}-${seriesMetric}`}
                  points={series}
                  unit={metricOptions.find((item) => item.id === seriesMetric)?.unit ?? ""}
                  color={metricOptions.find((item) => item.id === seriesMetric)?.color ?? "cyan"}
                  reduceMotion={Boolean(reduceMotion)}
                />
                <div className={styles.chartFoot}>
                  <span>
                    <i
                      className={
                        styles[
                          `dot_${metricOptions.find((item) => item.id === seriesMetric)?.color ?? "cyan"}`
                        ]
                      }
                    />{" "}
                    OBSERVED {metricOptions.find((item) => item.id === seriesMetric)?.label}
                  </span>
                  <span>SIMULATION TIME · {selected.replayFrames.length} SNAPSHOTS AVAILABLE</span>
                </div>
              </article>
              <article className={styles.panel}>
                <PanelHeading
                  index="02"
                  title="Latency distribution"
                  note="Request completion samples"
                  icon={<BarChart3 size={15} />}
                />
                <LatencyChart
                  bins={distribution}
                  samples={metrics.latencySampleCount}
                  reduceMotion={Boolean(reduceMotion)}
                />
                <div className={styles.distributionFoot}>
                  <span>
                    MEAN <b>{formatMetric(metrics.averageLatencyMs, "ms")}</b>
                  </span>
                  <span>
                    P95 <b>{formatMetric(metrics.p95LatencyMs, "ms")}</b>
                  </span>
                  <span>
                    P99 <b>{formatMetric(metrics.p99LatencyMs, "ms")}</b>
                  </span>
                </div>
              </article>
            </section>

            <section className={styles.secondaryGrid}>
              <article className={styles.panel}>
                <PanelHeading
                  index="03"
                  title="Service health comparison"
                  note="Baseline vs peak during fault injection"
                  icon={<Layers3 size={15} />}
                />
                {serviceComparisons.length ? (
                  <div className={styles.serviceRows}>
                    {serviceComparisons.map((service, index) => (
                      <ServiceRow
                        key={service.id}
                        service={service}
                        index={index}
                        reduceMotion={Boolean(reduceMotion)}
                      />
                    ))}
                  </div>
                ) : (
                  <ChartEmpty>
                    Service-level snapshots are unavailable for this selection.
                  </ChartEmpty>
                )}
                <div className={styles.legend}>
                  <span>
                    <i className={styles.legendBaseline} /> BASELINE
                  </span>
                  <span>
                    <i className={styles.legendPeak} /> FAULT PEAK
                  </span>
                  <span>HEALTH AT FINAL SNAPSHOT</span>
                </div>
              </article>
              <article className={styles.panel}>
                <PanelHeading
                  index="04"
                  title="Failure propagation"
                  note="Health transitions aligned to dependency edges"
                  icon={<GitBranch size={15} />}
                />
                {propagation?.nodes.length ? (
                  <PropagationGraph propagation={propagation} start={selected.simulationStartMs} />
                ) : (
                  <ChartEmpty>
                    No service failure or critical transition was recorded in this run.
                  </ChartEmpty>
                )}
                <div className={styles.graphFoot}>
                  <span>{propagation?.nodes.length ?? 0} TRANSITIONING SERVICES</span>
                  <span>{propagation?.edges.length ?? 0} DEPENDENCY PROPAGATIONS OBSERVED</span>
                </div>
              </article>
            </section>

            <section className={styles.tertiaryGrid}>
              <article className={styles.panel}>
                <PanelHeading
                  index="05"
                  title="Recovery performance"
                  note="Recorded experiments in the selected history scope"
                  icon={<Clock3 size={15} />}
                />
                {recovery.length ? (
                  <RecoveryChart rows={recovery} reduceMotion={Boolean(reduceMotion)} />
                ) : (
                  <ChartEmpty>No historical recovery measurements are available.</ChartEmpty>
                )}
              </article>
              <article className={styles.panel}>
                <PanelHeading
                  index="06"
                  title="Before / after"
                  note={serviceName(
                    incidents,
                    serviceFilter === "all" ? (selected.affectedServices[0] ?? "") : serviceFilter,
                  )}
                  icon={<ArrowDownRight size={15} />}
                />
                {beforeAfter.length ? (
                  <div className={styles.deltaList}>
                    {beforeAfter.map((item) => (
                      <div key={item.label}>
                        <span>{item.label}</span>
                        <b>
                          {formatMetric(item.before, item.unit)} <i>→</i>{" "}
                          {formatMetric(item.after, item.unit)}
                        </b>
                        <em
                          className={
                            item.delta !== null && item.delta > 0
                              ? styles.deltaUp
                              : styles.deltaDown
                          }
                        >
                          {item.delta === null
                            ? "—"
                            : `${item.delta > 0 ? "+" : ""}${formatMetric(item.delta, item.unit)}`}
                        </em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ChartEmpty>Paired pre-run and final snapshots are unavailable.</ChartEmpty>
                )}
              </article>
              <article className={styles.panel}>
                <PanelHeading
                  index="07"
                  title="Scenario comparison"
                  note={
                    comparison
                      ? `${selected.name} / ${comparison.name}`
                      : "Choose a comparison in the scope bar"
                  }
                  icon={<GitBranch size={15} />}
                />
                {comparison ? (
                  <div className={styles.scenarioList}>
                    {scenarioMetrics.map((item) => (
                      <div key={item.label}>
                        <span>{item.label}</span>
                        <b>{formatMetric(item.primary, item.unit)}</b>
                        <span className={styles.comparisonTrack}>
                          <i style={{ width: comparisonWidth(item.primary, item.comparison) }} />
                          <i
                            className={styles.compareLine}
                            style={{ left: comparisonWidth(item.comparison, item.primary) }}
                          />
                        </span>
                        <em>{formatMetric(item.comparison, item.unit)}</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ChartEmpty>
                    Select a second recorded experiment to compare measured outcomes.
                  </ChartEmpty>
                )}
              </article>
            </section>

            <section className={styles.insightStrip}>
              <div className={styles.insightIcon}>
                <Sparkles size={16} />
              </div>
              <div className={styles.insightCopy}>
                <span>OBSERVATIONS FROM THIS RECORD</span>
                <div>
                  {evidenceBasedRecommendations(selected).map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              </div>
              <div className={styles.recordProvenance}>
                <span>
                  <FileText size={12} /> {selected.events.length} EVENTS
                </span>
                <span>
                  <Waves size={12} /> {selected.metrics.requests.toLocaleString()} COMPLETED
                  REQUESTS
                </span>
                <span>
                  <Clock3 size={12} /> {selected.replayFrames.length} SNAPSHOTS
                </span>
              </div>
            </section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <footer className={styles.footer}>
        <span>FAULTLINE / INTELLIGENCE</span>
        <span>NULL VALUES MEAN THE SOURCE RECORD DID NOT CONTAIN THAT MEASUREMENT</span>
        <span>
          {exportNotice ||
            (selected
              ? `SOURCE: ${selected.persistence === "database" ? "MANAGED DATABASE" : "GUEST RECORD"} · ${selected.id}`
              : "WAITING FOR SOURCE RECORDS")}
        </span>
      </footer>
    </main>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  compact = false,
  emptyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  compact?: boolean;
  emptyLabel?: string;
}) {
  return (
    <label className={`${styles.selectWrap} ${compact ? styles.selectCompact : ""}`}>
      <span className={styles.srOnly}>{label}</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {!options.length ? (
          <option value="">{emptyLabel ?? "NO OPTIONS"}</option>
        ) : (
          options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))
        )}
      </select>
      <ChevronDown size={12} />
    </label>
  );
}

function Metric({
  label,
  value,
  note,
  color,
  icon,
  compact = false,
}: {
  label: string;
  value: string;
  note: string;
  color: string;
  icon: React.ReactNode;
  compact?: boolean;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  return (
    <article className={`${styles.metric} ${styles[`metric_${color}`]}`}>
      <div className={styles.metricTop}>
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.strong
          key={value}
          className={compact ? styles.compactValue : ""}
          initial={reducedMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, y: -3 }}
          transition={{
            duration: reducedMotion ? 0 : motionDuration.fast,
            ease: motionEase.standard,
          }}
        >
          {value}
        </motion.strong>
      </AnimatePresence>
      <small>{note}</small>
      <span className={styles.metricGlow} />
    </article>
  );
}

function PanelHeading({
  index,
  title,
  note,
  icon,
}: {
  index: string;
  title: string;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={styles.panelHeading}>
      <span className={styles.panelIcon}>{icon}</span>
      <div>
        <span>{index} / ANALYTICS</span>
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      <span className={styles.panelMeta}>RECORDED DATA</span>
    </div>
  );
}

function TimeSeriesChart({
  points,
  unit,
  color,
  reduceMotion,
}: {
  points: Array<{ atMs: number; elapsedMs: number; value: number | null }>;
  unit: string;
  color: string;
  reduceMotion: boolean;
}) {
  const values = points
    .map((point) => point.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!points.length || !values.length)
    return (
      <ChartEmpty>
        There are no recorded snapshots in this phase for the selected service.
      </ChartEmpty>
    );
  const width = 760;
  const height = 230;
  const left = 42;
  const right = 14;
  const top = 16;
  const bottom = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index: number) =>
    left +
    (points.length > 1
      ? (index / (points.length - 1)) * (width - left - right)
      : (width - left - right) / 2);
  const y = (value: number) => top + ((max - value) / span) * (height - top - bottom);
  const validPoints = points
    .map((point, index) => ({ ...point, index }))
    .filter((point) => point.value !== null && Number.isFinite(point.value));
  const path = validPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.index)},${y(point.value!)}`)
    .join(" ");
  const area = `${path} L${x(validPoints.at(-1)!.index)},${height - bottom} L${x(validPoints[0]!.index)},${height - bottom} Z`;
  const ticks = Array.from({ length: 4 }, (_, index) => max - (span * index) / 3);
  return (
    <div className={styles.lineChart}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Recorded ${unit} time series with ${points.length} snapshots`}
      >
        <defs>
          <linearGradient id="signal-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" className={styles[`gradient_${color}`]} stopOpacity=".2" />
            <stop offset="100%" className={styles[`gradient_${color}`]} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick, index) => (
          <g key={index}>
            <line
              x1={left}
              x2={width - right}
              y1={top + (index * (height - top - bottom)) / 3}
              y2={top + (index * (height - top - bottom)) / 3}
              className={styles.chartGridline}
            />
            <text
              x={left - 8}
              y={top + (index * (height - top - bottom)) / 3 + 3}
              textAnchor="end"
              className={styles.chartLabel}
            >
              {tick.toFixed(tick > 100 ? 0 : 1)}
            </text>
          </g>
        ))}
        <motion.path
          d={area}
          fill="url(#signal-fill)"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45 }}
        />
        <motion.path
          d={path}
          className={`${styles.signalLine} ${styles[`line_${color}`]}`}
          initial={reduceMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeOut" }}
        />
        {validPoints.map((point) => (
          <circle
            key={`${point.atMs}-${point.index}`}
            cx={x(point.index)}
            cy={y(point.value!)}
            r="3"
            className={`${styles.signalPoint} ${styles[`point_${color}`]}`}
          >
            <title>{`${formatDuration(point.elapsedMs)} · ${formatMetric(point.value, unit)}`}</title>
          </circle>
        ))}
        <text x={left} y={height - 7} className={styles.chartLabel}>
          T+{formatDuration(points[0]!.elapsedMs)}
        </text>
        <text x={width - right} y={height - 7} textAnchor="end" className={styles.chartLabel}>
          T+{formatDuration(points.at(-1)!.elapsedMs)}
        </text>
      </svg>
    </div>
  );
}

function LatencyChart({
  bins,
  samples,
  reduceMotion,
}: {
  bins: ReturnType<typeof latencyDistribution>;
  samples: number;
  reduceMotion: boolean;
}) {
  if (!bins.length)
    return (
      <ChartEmpty>
        No request latency samples were saved for this incident. Percentiles are unavailable.
      </ChartEmpty>
    );
  const highest = Math.max(...bins.map((bin) => bin.count), 1);
  return (
    <div
      className={styles.histogram}
      role="img"
      aria-label={`Latency distribution from ${samples} measured requests`}
    >
      {bins.map((bin, index) => (
        <div className={styles.binColumn} key={index}>
          <motion.div
            className={styles.bin}
            initial={reduceMotion ? false : { height: 0 }}
            animate={{ height: `${Math.max(3, (bin.count / highest) * 100)}%` }}
            transition={{
              duration: reduceMotion ? 0 : 0.45,
              delay: reduceMotion ? 0 : index * 0.018,
            }}
            title={`${bin.count} requests, ${bin.fromMs.toFixed(1)}–${bin.toMs.toFixed(1)} ms`}
          >
            <span>{bin.count ? bin.count : ""}</span>
          </motion.div>
          <small>{bin.fromMs.toFixed(0)}</small>
        </div>
      ))}
      <div className={styles.histogramAxis}>
        <span>LOWER LATENCY</span>
        <span>{samples.toLocaleString()} SAMPLES</span>
        <span>HIGHER LATENCY</span>
      </div>
    </div>
  );
}

function ServiceRow({
  service,
  index,
  reduceMotion,
}: {
  service: ReturnType<typeof serviceHealthComparisons>[number];
  index: number;
  reduceMotion: boolean;
}) {
  return (
    <div className={styles.serviceRow}>
      <div className={styles.serviceIdentity}>
        <span
          className={`${styles.healthMark} ${styles[`health_${service.finalHealth ?? "healthy"}`]}`}
        />
        <strong>{service.name}</strong>
        <small>{service.finalHealth?.replaceAll("-", " ") ?? "NO HEALTH SNAPSHOT"}</small>
      </div>
      <div className={styles.serviceBars}>
        <div className={styles.barLabel}>
          <span>CPU</span>
          <small>
            {formatMetric(service.baselineCpuPct, "%")} <i>→</i>{" "}
            <b>{formatMetric(service.peakCpuPct, "%")}</b>
          </small>
        </div>
        <div className={styles.barTrack}>
          <span
            className={styles.baselineBar}
            style={{ width: `${clamp(service.baselineCpuPct)}%` }}
          />
          <motion.span
            className={styles.peakBar}
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${clamp(service.peakCpuPct)}%` }}
            transition={{ duration: reduceMotion ? 0 : 0.5, delay: index * 0.05 }}
          />
        </div>
        <div className={styles.barLabel}>
          <span>MEMORY</span>
          <small>
            {formatMetric(service.baselineMemoryPct, "%")} <i>→</i>{" "}
            <b>{formatMetric(service.peakMemoryPct, "%")}</b>
          </small>
        </div>
        <div className={styles.barTrack}>
          <span
            className={`${styles.baselineBar} ${styles.baselineViolet}`}
            style={{ width: `${clamp(service.baselineMemoryPct)}%` }}
          />
          <motion.span
            className={styles.peakBarViolet}
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${clamp(service.peakMemoryPct)}%` }}
            transition={{ duration: reduceMotion ? 0 : 0.5, delay: index * 0.05 }}
          />
        </div>
        <div className={styles.barLabel}>
          <span>ERROR</span>
          <small>
            {formatMetric(service.baselineErrorPct, "%")} <i>→</i>{" "}
            <b>{formatMetric(service.peakErrorPct, "%")}</b>
          </small>
        </div>
        <div className={styles.barTrack}>
          <span
            className={`${styles.baselineBar} ${styles.baselineRed}`}
            style={{ width: `${clamp(service.baselineErrorPct)}%` }}
          />
          <motion.span
            className={styles.peakBarRed}
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${clamp(service.peakErrorPct)}%` }}
            transition={{ duration: reduceMotion ? 0 : 0.5, delay: index * 0.05 }}
          />
        </div>
      </div>
    </div>
  );
}

function PropagationGraph({
  propagation,
  start,
}: {
  propagation: NonNullable<ReturnType<typeof failurePropagation>>;
  start: number;
}) {
  const sorted = [...propagation.nodes].sort((a, b) => a.firstAtMs - b.firstAtMs);
  return (
    <div className={styles.propagationGraph}>
      <div className={styles.propagationRail} />
      {sorted.map((node, index) => (
        <div
          className={styles.propagationNode}
          key={node.id}
          style={{ "--node-index": index } as React.CSSProperties}
        >
          <span className={`${styles.propagationLed} ${styles[`health_${node.health}`]}`} />
          <span className={styles.propagationName}>{node.label}</span>
          <span className={`${styles.healthText} ${styles[`healthText_${node.health}`]}`}>
            {node.health.toUpperCase()}
          </span>
          <small>T+{formatDuration(node.firstAtMs - start)}</small>
          {index < sorted.length - 1 &&
            propagation.edges.some(
              (edge) => edge.source === node.id && edge.target === sorted[index + 1]?.id,
            ) && (
              <span className={styles.propagationLink}>
                <ArrowRight size={12} />
              </span>
            )}
        </div>
      ))}
      {propagation.edges.length > 0 && (
        <div className={styles.propagationEdges}>
          {propagation.edges.map((edge) => (
            <span key={edge.source + "-" + edge.target}>
              {propagation.nodes.find((node) => node.id === edge.source)?.label ?? edge.source}
              <ArrowRight size={10} />
              {propagation.nodes.find((node) => node.id === edge.target)?.label ?? edge.target}
              <small>T+{formatDuration(edge.atMs - start)}</small>
            </span>
          ))}
        </div>
      )}
      <div className={styles.propagationEvents}>
        {propagation.events.slice(0, 3).map((event) => (
          <span key={`${event.serviceId}-${event.atMs}`}>
            <TriangleAlert size={11} /> {event.reason}
          </span>
        ))}
      </div>
    </div>
  );
}

function RecoveryChart({
  rows,
  reduceMotion,
}: {
  rows: ReturnType<typeof recoveryPerformance>;
  reduceMotion: boolean;
}) {
  const times = rows
    .map((row) => row.recoveryMs)
    .filter((value): value is number => value !== null);
  const highest = Math.max(...times, 1);
  return (
    <div className={styles.recoveryRows}>
      {rows.map((row, index) => (
        <div className={styles.recoveryRow} key={row.id}>
          <div>
            <strong>{row.name}</strong>
            <small>
              {new Date(row.timestamp).toLocaleDateString()} · {row.outcome.toUpperCase()}
            </small>
          </div>
          <div className={styles.recoveryTrack}>
            <motion.i
              initial={reduceMotion ? false : { width: 0 }}
              animate={{
                width:
                  row.recoveryMs === null
                    ? "0%"
                    : `${Math.max(4, (row.recoveryMs / highest) * 100)}%`,
              }}
              transition={{ duration: reduceMotion ? 0 : 0.5, delay: index * 0.04 }}
            />
          </div>
          <b>{formatDuration(row.recoveryMs)}</b>
          <span>{formatMetric(row.effectivenessPct, "%")}</span>
        </div>
      ))}
    </div>
  );
}

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.chartEmpty}>
      <span>
        <Filter size={15} />
      </span>
      {children}
    </div>
  );
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function serviceName(records: IncidentRecord[], id: string): string {
  if (!id) return "No service selected";
  return (
    records
      .flatMap((record) => record.replayFrames?.flatMap((frame) => frame.services) ?? [])
      .find((service) => service.id === id)?.name ?? id
  );
}

function clamp(value: number | null): number {
  return value === null ? 0 : Math.max(0, Math.min(100, value));
}
function comparisonWidth(value: number | null, other: number | null): string {
  const max = Math.max(value ?? 0, other ?? 0, 1);
  return `${Math.max(2, ((value ?? 0) / max) * 100)}%`;
}
function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
