"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Database,
  FastForward,
  Filter,
  HardDrive,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  SkipBack,
  SkipForward,
  Waves,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useObservatorySimulation } from "@/hooks/use-observatory-simulation";
import { getIncident, listIncidents } from "@/services/incident-store";
import { IncidentReplayEngine } from "@/services/incident-replay-engine";
import { IncidentInvestigator } from "@/components/incidents/incident-investigator";
import type { IncidentRecord, IncidentSeverity } from "@/types/incidents";
import type { SimulationEvent } from "@/types/observatory-runtime";
import styles from "./incident-workbench.module.css";
import { motionDuration, motionEase } from "@/animations/tokens";

const ObservatoryNetwork = dynamic(
  () =>
    import("@/components/observatory/observatory-network").then(
      (module) => module.ObservatoryNetwork,
    ),
  {
    ssr: false,
    loading: () => (
      <div className={styles.sceneLoading}>
        <Waves size={18} /> RECONSTRUCTING INFRASTRUCTURE
      </div>
    ),
  },
);

const emptySubscribe = () => () => undefined;
const speedOptions = [0.25, 0.5, 1, 2, 4, 8];
const severityOptions: Array<"all" | IncidentSeverity> = [
  "all",
  "critical",
  "high",
  "medium",
  "low",
];

export function IncidentWorkbench() {
  const reducedMotion = useReducedMotion() ?? false;
  const liveState = useObservatorySimulation();
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<(typeof severityOptions)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [cameraResetVersion, setCameraResetVersion] = useState(0);
  const [fitVersion, setFitVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void listIncidents().then((records) => {
      if (!active) return;
      setIncidents(records);
      setSelectedId(records[0]?.id ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      return;
    }
    const cached = incidents.find((record) => record.id === selectedId);
    if (cached && cached.replayFrames?.length && cached.events) return;
    void getIncident(selectedId).then((record) => {
      if (active && record) {
        setIncidents((current) => current.map((item) => (item.id === record.id ? record : item)));
      }
    });
    return () => {
      active = false;
    };
  }, [selectedId, incidents]);

  const selectedIncident = incidents.find((record) => record.id === selectedId) ?? null;

  const replayEngine = useMemo(() => {
    if (!selectedIncident?.replayFrames?.length) return null;
    return new IncidentReplayEngine(selectedIncident);
  }, [selectedIncident]);
  useEffect(() => () => replayEngine?.dispose(), [replayEngine]);
  const replaySubscribe = useCallback(
    (listener: () => void) => replayEngine?.subscribe(listener) ?? emptySubscribe(),
    [replayEngine],
  );
  const replayGetSnapshot = useCallback(() => replayEngine?.getSnapshot() ?? null, [replayEngine]);
  const replay = useSyncExternalStore(replaySubscribe, replayGetSnapshot, () => null);
  const state = replay?.state ?? liveState;

  const filteredIncidents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return incidents.filter((incident) => {
      const matchesSeverity = severity === "all" || incident.severity === severity;
      const haystack =
        `${incident.name} ${incident.id} ${incident.rootCause} ${incident.affectedServices.join(" ")}`.toLowerCase();
      return matchesSeverity && (!query || haystack.includes(query));
    });
  }, [incidents, search, severity]);

  const servicesById = useMemo(
    () => new Map(state.services.map((service) => [service.id, service])),
    [state.services],
  );
  const selectService = (id: string) => {
    setSelectedServiceId(id);
    setSelectedConnectionId(null);
    setFocusVersion((version) => version + 1);
  };
  const selectedService = servicesById.get(selectedServiceId) ?? state.services[0];
  const cursor = replay?.cursorMs ?? 0;
  const start = selectedIncident?.simulationStartMs ?? 0;
  const end = selectedIncident?.simulationEndMs ?? 0;
  const progress = end > start ? ((cursor - start) / (end - start)) * 100 : 0;
  const visibleEvents = selectedIncident?.events ?? [];

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowDot} /> RESPONSE / HISTORICAL REPLAY
          </div>
          <h1>
            Incident <span>archive</span>
          </h1>
          <p>
            Every failure leaves a shape. Reconstruct the conditions, follow the cascade, and
            inspect the recovery path.
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.persistence}>
            <Database size={13} />
            <span>
              {selectedIncident?.persistence === "database"
                ? "MANAGED DATABASE"
                : "DEVICE-LOCAL DEMO"}
            </span>
            <i />
          </div>
          <Link className={styles.labLink} href="/chaos-lab">
            <Zap size={14} /> OPEN CHAOS LAB <ArrowRight size={13} />
          </Link>
        </div>
      </header>

      <section className={styles.summaryStrip} aria-label="Incident summary">
        <Summary
          icon={<ShieldAlert size={15} />}
          label="RECORDED RUNS"
          value={String(incidents.length).padStart(2, "0")}
          note="historical records"
        />
        <Summary
          icon={<AlertTriangle size={15} />}
          label="CRITICAL"
          value={String(incidents.filter((item) => item.severity === "critical").length).padStart(
            2,
            "0",
          )}
          note="peak severity"
          tone="red"
        />
        <Summary
          icon={<Check size={15} />}
          label="RECOVERED"
          value={String(
            incidents.filter((item) => item.finalOutcome === "recovered").length,
          ).padStart(2, "0")}
          note="verified outcomes"
          tone="green"
        />
        <Summary
          icon={<Activity size={15} />}
          label="REPLAY ENGINE"
          value="READY"
          note="snapshots + event stream"
          tone="violet"
        />
      </section>

      <section className={styles.archiveSection}>
        <div className={styles.sectionHeading}>
          <div>
            <span>01 / INCIDENT REGISTER</span>
            <h2>Historical signals</h2>
          </div>
          <span className={styles.count}>{filteredIncidents.length} RECORDS</span>
        </div>
        <div className={styles.filters}>
          <label className={styles.searchBox}>
            <Search size={14} />
            <input
              aria-label="Search incidents"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search incidents, services, causes…"
            />
          </label>
          <label className={styles.filterBox}>
            <Filter size={13} />
            <select
              aria-label="Filter severity"
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as (typeof severityOptions)[number])
              }
            >
              {severityOptions.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "ALL SEVERITIES" : value.toUpperCase()}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
        </div>
        <div className={styles.timelineViewport}>
          <div className={styles.timelineRail} aria-hidden="true" />
          {loading ? (
            <div className={styles.emptyState}>
              <span className={styles.loader} /> SYNCING INCIDENT ARCHIVE
            </div>
          ) : filteredIncidents.length ? (
            <div className={styles.incidentTimeline}>
              {filteredIncidents.map((incident, index) => (
                <motion.button
                  type="button"
                  key={incident.id}
                  layout
                  className={`${styles.timelineItem} ${selectedId === incident.id ? styles.timelineSelected : ""}`}
                  onClick={() => {
                    setSelectedId(incident.id);
                    setExpandedEvent(null);
                  }}
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={reducedMotion ? undefined : { y: -2 }}
                  transition={{
                    duration: reducedMotion ? 0 : motionDuration.panel,
                    delay: reducedMotion ? 0 : Math.min(index, 8) * 0.025,
                    ease: motionEase.entrance,
                  }}
                >
                  <span className={`${styles.marker} ${styles[`severity_${incident.severity}`]}`}>
                    <CircleDot size={13} />
                  </span>
                  <span className={styles.timelineDate}>{formatDate(incident.timestamp)}</span>
                  <strong>{incident.name}</strong>
                  <small>
                    {incident.failureConfiguration?.faultType?.replaceAll("-", " ") ??
                      "Recorded simulation"}
                  </small>
                  <span className={styles.timelineMeta}>
                    <b>{incident.severity}</b>
                    <i /> {incident.affectedServices?.length ?? 0} services
                  </span>
                  {index < filteredIncidents.length - 1 && (
                    <span className={styles.nodeConnector} aria-hidden="true" />
                  )}
                </motion.button>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span className={styles.emptyGlyph}>
                <Activity size={18} />
              </span>
              <strong>
                {incidents.length
                  ? "No incidents match this filter"
                  : "No simulations recorded yet"}
              </strong>
              <span>
                {incidents.length
                  ? "Adjust search or severity to widen the archive."
                  : "Complete a Chaos Lab run to generate a replayable incident with metrics, events, and historical snapshots."}
              </span>
              {!incidents.length && (
                <Link href="/chaos-lab">
                  CREATE FIRST INCIDENT <ArrowRight size={12} />
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      <AnimatePresence mode="wait">
        {selectedIncident ? (
          <motion.section
            key={selectedIncident.id}
            className={styles.detailSection}
            initial={reducedMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{
              duration: reducedMotion ? 0 : motionDuration.panel,
              ease: motionEase.entrance,
            }}
          >
            <div className={styles.sectionHeading}>
              <div>
                <span>02 / INCIDENT REPLAY</span>
                <h2>Reconstruct the failure</h2>
              </div>
              <div
                className={`${styles.outcome} ${styles[`outcome_${selectedIncident.finalOutcome}`]}`}
              >
                <i /> {selectedIncident.finalOutcome.toUpperCase()}
              </div>
            </div>
            {selectedIncident.replayFrames?.length ? (
              <>
                <div className={styles.replayGrid}>
                  <div className={styles.scenePanel}>
                    <div className={styles.panelTop}>
                      <div>
                        <span>TOPOLOGY / HISTORICAL STATE</span>
                        <strong>{selectedIncident.name}</strong>
                      </div>
                      <div className={styles.sceneBadge}>
                        <i /> {replay?.playing ? "REPLAYING" : "REPLAY PAUSED"}
                      </div>
                    </div>
                    <div className={styles.sceneCanvas}>
                      <div className={styles.sceneGrid} aria-hidden="true" />
                      <ObservatoryNetwork
                        services={state.services}
                        connections={state.connections}
                        selectedServiceId={selectedService?.id ?? ""}
                        selectedConnectionId={selectedConnectionId}
                        running={Boolean(replay?.playing)}
                        speed={replay?.speed ?? 1}
                        focusVersion={focusVersion}
                        cameraResetVersion={cameraResetVersion}
                        fitVersion={fitVersion}
                        onSelectService={selectService}
                        onSelectConnection={(connectionId, sourceId) => {
                          setSelectedConnectionId(connectionId);
                          selectService(sourceId);
                        }}
                        onHoverService={() => undefined}
                      />
                      <div className={styles.sceneOverlayTop}>
                        <span>VIRTUAL T+{formatDuration(Math.max(0, cursor - start))}</span>
                        <span>
                          {
                            state.services.filter(
                              (service) =>
                                service.health === "failed" || service.health === "critical",
                            ).length
                          }{" "}
                          DEGRADED
                        </span>
                      </div>
                      <div className={styles.sceneOverlayBottom}>
                        <button
                          type="button"
                          onClick={() => setCameraResetVersion((version) => version + 1)}
                        >
                          <RotateCcw size={12} /> RESET CAMERA
                        </button>
                        <button
                          type="button"
                          onClick={() => setFitVersion((version) => version + 1)}
                        >
                          FIT GRAPH <ArrowDown size={11} />
                        </button>
                      </div>
                    </div>
                    <div className={styles.transport}>
                      <button
                        type="button"
                        aria-label="Previous event"
                        title="Previous event"
                        onClick={() => replayEngine?.previousEvent()}
                        disabled={!replayEngine}
                      >
                        <SkipBack size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="Restart replay"
                        title="Restart replay"
                        onClick={() => replayEngine?.restart()}
                        disabled={!replayEngine}
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        type="button"
                        className={styles.playButton}
                        aria-label={replay?.playing ? "Pause replay" : "Play replay"}
                        aria-pressed={Boolean(replay?.playing)}
                        onClick={() =>
                          replay?.playing ? replayEngine?.pause() : replayEngine?.play()
                        }
                        disabled={!replayEngine}
                      >
                        {replay?.playing ? (
                          <Pause size={15} />
                        ) : (
                          <Play size={15} fill="currentColor" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Next event"
                        title="Next event"
                        onClick={() => replayEngine?.nextEvent()}
                        disabled={!replayEngine}
                      >
                        <SkipForward size={14} />
                      </button>
                      <label className={styles.speedSelect}>
                        <FastForward size={12} />
                        <select
                          aria-label="Replay speed"
                          value={replay?.speed ?? 1}
                          onChange={(event) => replayEngine?.setSpeed(Number(event.target.value))}
                        >
                          {speedOptions.map((value) => (
                            <option key={value} value={value}>
                              {value}×
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className={styles.seekBar}>
                      <span>{formatDuration(Math.max(0, cursor - start))}</span>
                      <div className={styles.seekTrack}>
                        <input
                          aria-label="Seek replay timeline"
                          type="range"
                          min={start}
                          max={Math.max(start + 1, end)}
                          step={1}
                          value={Math.min(cursor, end)}
                          style={{ "--seek-progress": `${progress}%` } as React.CSSProperties}
                          onChange={(event) => replayEngine?.seek(Number(event.target.value))}
                        />
                        <div className={styles.seekMarkers}>
                          {visibleEvents.map((event, index) => (
                            <i
                              key={`${event.sequence}-${index}`}
                              className={eventTone(event)}
                              style={{
                                left: `${end > start ? ((event.atMs - start) / (end - start)) * 100 : 0}%`,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                      <span>{formatDuration(Math.max(0, end - start))}</span>
                    </div>
                  </div>
                  <aside className={styles.incidentAside}>
                    <div className={styles.incidentIdentity}>
                      <div
                        className={`${styles.severityBadge} ${styles[`severity_${selectedIncident.severity}`]}`}
                      >
                        {selectedIncident.severity.toUpperCase()} SEVERITY
                      </div>
                      <h3>{selectedIncident.name}</h3>
                      <p>
                        <Clock3 size={12} /> {new Date(selectedIncident.timestamp).toLocaleString()}{" "}
                        <span>·</span> {formatDuration(selectedIncident.durationMs)} injection
                      </p>
                      <code>{selectedIncident.id}</code>
                    </div>
                    <div className={styles.causeBlock}>
                      <span>ROOT CAUSE</span>
                      <strong>{selectedIncident.rootCause.replaceAll("-", " ")}</strong>
                      <p>
                        {selectedIncident.failureConfiguration?.intensity}% intensity against{" "}
                        {servicesById.get(selectedIncident.failureConfiguration?.targetServiceId)
                          ?.name ?? selectedIncident.failureConfiguration?.targetServiceId}
                        ; {selectedIncident.failureConfiguration?.trafficVolume}× traffic.
                      </p>
                    </div>
                    <div className={styles.affectedBlock}>
                      <span>
                        AFFECTED SERVICES <b>{selectedIncident.affectedServices.length}</b>
                      </span>
                      <div>
                        {selectedIncident.affectedServices.map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => selectService(id)}
                            className={styles.serviceChip}
                          >
                            <i
                              className={
                                styles[`health_${servicesById.get(id)?.health ?? "healthy"}`]
                              }
                            />
                            {servicesById.get(id)?.shortName ?? id}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={styles.recoveryBlock}>
                      <span>RECOVERY ACTIONS</span>
                      {selectedIncident.recoveryActions.map((action, index) => (
                        <div key={`${action}-${index}`}>
                          <Check size={12} />
                          <span>{action}</span>
                        </div>
                      ))}
                    </div>
                    <div className={styles.selectedMetric}>
                      <span>SELECTED SERVICE</span>
                      {selectedService ? (
                        <>
                          <strong>{selectedService.name}</strong>
                          <div className={styles.serviceHealth}>
                            <i className={styles[`health_${selectedService.health}`]} />
                            {selectedService.health.toUpperCase()}
                          </div>
                          <div className={styles.serviceStats}>
                            <small>
                              CPU <b>{selectedService.cpuUsage.toFixed(0)}%</b>
                            </small>
                            <small>
                              MEM <b>{selectedService.memoryUsage.toFixed(0)}%</b>
                            </small>
                            <small>
                              LATENCY <b>{selectedService.averageLatencyMs.toFixed(0)}ms</b>
                            </small>
                            <small>
                              ERROR <b>{selectedService.errorRate.toFixed(1)}%</b>
                            </small>
                          </div>
                        </>
                      ) : (
                        <p>Select a node in the topology.</p>
                      )}
                    </div>
                  </aside>
                </div>
                <div className={styles.metricGrid}>
                  <Metric
                    label="REQUESTS"
                    value={selectedIncident.metrics.requests.toLocaleString()}
                    note="completed during run"
                  />
                  <Metric
                    label="FAILED REQUESTS"
                    value={selectedIncident.metrics.failedRequests.toLocaleString()}
                    note={`${selectedIncident.metrics.peakErrorRate.toFixed(1)}% peak error`}
                    tone="red"
                  />
                  <Metric
                    label="PEAK LATENCY"
                    value={`${selectedIncident.metrics.peakLatencyMs.toFixed(0)} ms`}
                    note="measured response"
                    tone="violet"
                  />
                  <Metric
                    label="SNAPSHOTS"
                    value={String(selectedIncident.replayFrames.length)}
                    note={`${visibleEvents.length} typed events`}
                    tone="green"
                  />
                </div>
                <div className={styles.eventPanel}>
                  <div className={styles.eventPanelHead}>
                    <div>
                      <span>03 / EVENT TRACE</span>
                      <h3>Signals across the run</h3>
                    </div>
                    <span>{visibleEvents.length} EVENTS</span>
                  </div>
                  <div className={styles.eventList}>
                    {visibleEvents.length ? (
                      visibleEvents.map((event, index) => (
                        <EventRow
                          key={`${event.sequence}-${index}`}
                          event={event}
                          offsetMs={start}
                          expanded={expandedEvent === index}
                          onToggle={() => setExpandedEvent(expandedEvent === index ? null : index)}
                          onSeek={() => replayEngine?.seek(event.atMs)}
                          names={servicesById}
                        />
                      ))
                    ) : (
                      <div className={styles.noEvents}>
                        Snapshot checkpoints are available. This run produced no discrete service or
                        failure events.
                      </div>
                    )}
                  </div>
                </div>
                <IncidentInvestigator key={selectedIncident.id} incident={selectedIncident} />
              </>
            ) : (
              <div className={styles.detailLoading}>
                <HardDrive size={17} /> Loading replay snapshots from incident archive…
              </div>
            )}
          </motion.section>
        ) : !loading && incidents.length === 0 ? (
          <section className={styles.emptyReplay}>
            <span>03 / REPLAY WORKSPACE</span>
            <strong>Waiting for the first signal.</strong>
            <p>
              Incident records are generated automatically when a Chaos Lab experiment completes.
            </p>
            <Link href="/chaos-lab">
              GO TO CHAOS LAB <ArrowRight size={12} />
            </Link>
          </section>
        ) : null}
      </AnimatePresence>
      <footer className={styles.footerNote}>
        <span>FAULTLINE / INCIDENT INTELLIGENCE</span>
        <span>
          LOCAL REPLAY IS AVAILABLE WITHOUT A DATABASE · DATABASE RECORDS SYNC WHEN CONFIGURED
        </span>
      </footer>
    </main>
  );
}

function Summary({
  icon,
  label,
  value,
  note,
  tone = "cyan",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className={`${styles.summary} ${styles[`tone_${tone}`]}`}>
      <span className={styles.summaryIcon}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  tone = "cyan",
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className={`${styles.metric} ${styles[`tone_${tone}`]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
      <i />
    </div>
  );
}

function EventRow({
  event,
  offsetMs,
  expanded,
  onToggle,
  onSeek,
  names,
}: {
  event: SimulationEvent;
  offsetMs: number;
  expanded: boolean;
  onToggle: () => void;
  onSeek: () => void;
  names: Map<string, { name: string }>;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const summary = describeEvent(event, names);
  return (
    <div className={`${styles.eventRow} ${expanded ? styles.eventExpanded : ""}`}>
      <button
        type="button"
        className={styles.eventMain}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={`${styles.eventDot} ${eventTone(event)}`} />
        <time>{formatDuration(Math.max(0, event.atMs - offsetMs))}</time>
        <strong>{summary.title}</strong>
        <small>{summary.detail}</small>
        <ChevronDown size={13} className={styles.eventChevron} />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className={styles.eventDescription}
            initial={reducedMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reducedMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{
              duration: reducedMotion ? 0 : motionDuration.control,
              ease: motionEase.standard,
            }}
          >
            <p>{summary.description}</p>
            <button type="button" onClick={onSeek}>
              <SkipForward size={11} /> SEEK TO EVENT
            </button>
            <code>
              SEQUENCE {event.sequence} · {event.type}
            </code>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function describeEvent(event: SimulationEvent, names: Map<string, { name: string }>) {
  if (event.type === "service.health.changed")
    return {
      title: names.get(event.serviceId)?.name ?? event.serviceId,
      detail: `${event.from} → ${event.to}`,
      description: event.reason,
    };
  if (event.type === "service.recovery.completed")
    return {
      title: names.get(event.serviceId)?.name ?? event.serviceId,
      detail: "recovery completed",
      description: "The service passed its recovery sequence and rejoined the dependency graph.",
    };
  if (event.type === "request.completed")
    return {
      title: event.outcome === "failure" ? "Request failed" : "Request completed",
      detail: event.failedAt
        ? `at ${names.get(event.failedAt)?.name ?? event.failedAt}`
        : `${event.latencyMs.toFixed(0)} ms`,
      description:
        event.reason ??
        `Request completed with ${event.outcome} outcome in ${event.latencyMs.toFixed(0)} milliseconds.`,
    };
  if (event.type === "resilience.activated")
    return {
      title: `${event.strategy} activated`,
      detail: names.get(event.serviceId)?.name ?? event.serviceId,
      description: event.action,
    };
  if (event.type === "traffic.rate.changed")
    return {
      title: "Traffic profile changed",
      detail: `${event.multiplier.toFixed(1)}× · ${event.requestsPerSecond.toFixed(1)} req/s`,
      description: "The simulation request generator changed its configured traffic rate.",
    };
  if (
    event.type === "simulation.started" ||
    event.type === "simulation.paused" ||
    event.type === "simulation.reset"
  )
    return {
      title: `Simulation ${event.type.split(".")[1]}`,
      detail: "lifecycle",
      description: "The deterministic simulation clock changed lifecycle state.",
    };
  return {
    title: event.type.replaceAll(".", " "),
    detail: "system signal",
    description: "Recorded typed simulation event.",
  };
}

function eventTone(event: SimulationEvent): string {
  if (event.type === "service.health.changed")
    return event.to === "failed" || event.to === "critical"
      ? styles.eventRed
      : event.to === "recovering"
        ? styles.eventViolet
        : styles.eventGreen;
  if (event.type === "request.completed" && event.outcome === "failure") return styles.eventRed;
  if (event.type === "service.recovery.completed") return styles.eventGreen;
  if (event.type === "resilience.activated") return styles.eventViolet;
  return styles.eventCyan;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function formatDuration(value: number) {
  const seconds = Math.max(0, value) / 1_000;
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
