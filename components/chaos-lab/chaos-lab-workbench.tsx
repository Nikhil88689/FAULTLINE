"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CirclePause,
  Clock3,
  Database,
  Gauge,
  GitBranch,
  Layers3,
  Pause,
  Play,
  RotateCcw,
  Shield,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  StopCircle,
  Terminal,
  Timer,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { chaosExperimentRunner } from "@/simulation/chaos-experiment-runner";
import { defaultSimulationConfig } from "@/simulation/observatory-scenario";
import { useObservatorySimulation } from "@/hooks/use-observatory-simulation";
import type { ChaosExperimentConfig, ChaosFaultType, RecoveryStrategy } from "@/types/chaos-lab";
import type { SimulationEvent } from "@/types/observatory-runtime";
import styles from "./chaos-lab.module.css";
import { motionDuration, motionEase } from "@/animations/tokens";

const ObservatoryNetwork = dynamic(
  () =>
    import("@/components/observatory/observatory-network").then(
      (module) => module.ObservatoryNetwork,
    ),
  {
    ssr: false,
    loading: () => (
      <div className={styles.graphLoading}>
        <span className={styles.loadingOrbit} />
        <strong>CONNECTING THE SERVICE MESH</strong>
        <small>BUILDING LIVE REQUEST ROUTES</small>
      </div>
    ),
  },
);

type Preset = Omit<
  ChaosExperimentConfig,
  "intensity" | "durationSeconds" | "trafficVolume" | "failureProbability"
> & {
  id: string;
  summary: string;
  intensity: number;
  durationSeconds: number;
  trafficVolume: number;
  failureProbability: number;
  accent: "red" | "amber" | "violet" | "cyan";
  icon: typeof Database;
};

const presets: Preset[] = [
  {
    id: "database",
    name: "Primary database outage",
    summary: "Withdraw the transactional store and trace dependency fallout.",
    faultType: "database-outage",
    targetServiceId: "postgres",
    intensity: 100,
    durationSeconds: 24,
    trafficVolume: 1,
    failureProbability: 1,
    recoveryStrategy: "fallback-cache",
    accent: "red",
    icon: Database,
  },
  {
    id: "overload",
    name: "API saturation",
    summary: "Push the gateway past its request capacity envelope.",
    faultType: "api-overload",
    targetServiceId: "gateway",
    intensity: 78,
    durationSeconds: 30,
    trafficVolume: 2.2,
    failureProbability: 0.12,
    recoveryStrategy: "horizontal-autoscaling",
    accent: "amber",
    icon: Gauge,
  },
  {
    id: "latency",
    name: "Network latency injection",
    summary: "Add deterministic delay to a service boundary.",
    faultType: "network-latency",
    targetServiceId: "payment",
    intensity: 65,
    durationSeconds: 26,
    trafficVolume: 1,
    failureProbability: 0.08,
    recoveryStrategy: "retry-backoff",
    accent: "violet",
    icon: Waves,
  },
  {
    id: "termination",
    name: "Random service termination",
    summary: "Select a seeded service and remove it from the mesh.",
    faultType: "random-termination",
    targetServiceId: "worker",
    intensity: 100,
    durationSeconds: 20,
    trafficVolume: 1,
    failureProbability: 1,
    recoveryStrategy: "service-restart",
    accent: "red",
    icon: Zap,
  },
  {
    id: "redis",
    name: "Redis cache failure",
    summary: "Interrupt the cache tier and expose session or read pressure.",
    faultType: "redis-failure",
    targetServiceId: "redis",
    intensity: 100,
    durationSeconds: 22,
    trafficVolume: 1,
    failureProbability: 1,
    recoveryStrategy: "traffic-redistribution",
    accent: "amber",
    icon: Layers3,
  },
  {
    id: "queue",
    name: "Message queue backlog",
    summary: "Reduce drain capacity and build asynchronous pressure.",
    faultType: "queue-backlog",
    targetServiceId: "queue",
    intensity: 74,
    durationSeconds: 34,
    trafficVolume: 1.4,
    failureProbability: 0.16,
    recoveryStrategy: "horizontal-autoscaling",
    accent: "cyan",
    icon: GitBranch,
  },
  {
    id: "auth",
    name: "Authentication outage",
    summary: "Cut identity validation and measure request rejection.",
    faultType: "authentication-outage",
    targetServiceId: "authentication",
    intensity: 100,
    durationSeconds: 20,
    trafficVolume: 1,
    failureProbability: 1,
    recoveryStrategy: "circuit-breaker",
    accent: "red",
    icon: Shield,
  },
  {
    id: "cascade",
    name: "Cascading dependency failure",
    summary: "Remove the data plane and watch failure move upstream.",
    faultType: "cascading-failure",
    targetServiceId: "postgres",
    intensity: 92,
    durationSeconds: 30,
    trafficVolume: 1.3,
    failureProbability: 1,
    recoveryStrategy: "retry-backoff",
    accent: "violet",
    icon: GitBranch,
  },
];

const faultOptions: Array<{ id: ChaosFaultType; label: string }> = [
  { id: "database-outage", label: "Database outage" },
  { id: "api-overload", label: "API overload" },
  { id: "network-latency", label: "Network latency injection" },
  { id: "random-termination", label: "Random service termination" },
  { id: "redis-failure", label: "Redis cache failure" },
  { id: "queue-backlog", label: "Message queue backlog" },
  { id: "authentication-outage", label: "Authentication outage" },
  { id: "cascading-failure", label: "Cascading service failure" },
  { id: "custom", label: "Custom degradation profile" },
];

const recoveryOptions: Array<{ id: RecoveryStrategy; label: string; detail: string }> = [
  { id: "none", label: "Observe only", detail: "Leave the fault unmitigated until the run ends." },
  {
    id: "retry-backoff",
    label: "Retry + exponential backoff",
    detail: "Retry transient calls with increasing delay.",
  },
  {
    id: "circuit-breaker",
    label: "Circuit breaker",
    detail: "Open after three consecutive request failures.",
  },
  {
    id: "fallback-cache",
    label: "Fallback cache",
    detail: "Serve cached read paths when the data tier is down.",
  },
  {
    id: "traffic-redistribution",
    label: "Traffic redistribution",
    detail: "Send eligible reads to a healthy cache tier.",
  },
  {
    id: "service-restart",
    label: "Service restart",
    detail: "Restart the target midway through the experiment.",
  },
  {
    id: "horizontal-autoscaling",
    label: "Horizontal autoscaling",
    detail: "Add target capacity to absorb load pressure.",
  },
];

const emptyConfig: ChaosExperimentConfig = {
  name: "Untitled resilience scenario",
  faultType: "custom",
  targetServiceId: "postgres",
  intensity: 55,
  durationSeconds: 24,
  trafficVolume: 1,
  failureProbability: 0.15,
  recoveryStrategy: "retry-backoff",
};

const phaseLabel: Record<string, string> = {
  configuration: "CONFIGURATION",
  validation: "VALIDATING",
  precheck: "PRE-FLIGHT CHECK",
  confirmation: "READY TO INJECT",
  execution: "EXPERIMENT LIVE",
  paused: "RUN PAUSED",
  completion: "RECOVERY IN PROGRESS",
  results: "RUN COMPLETE",
  failed: "CONFIGURATION ERROR",
};

function useChaosRunner() {
  return useSyncExternalStore(
    chaosExperimentRunner.subscribe,
    chaosExperimentRunner.getSnapshot,
    chaosExperimentRunner.getServerSnapshot,
  );
}

export function ChaosLabWorkbench() {
  const reducedMotion = useReducedMotion() ?? false;
  const simulation = useObservatorySimulation();
  const experiment = useChaosRunner();
  const [config, setConfig] = useState<ChaosExperimentConfig>(emptyConfig);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState("gateway");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [cameraResetVersion, setCameraResetVersion] = useState(0);
  const [fitVersion, setFitVersion] = useState(0);
  const [feedTab, setFeedTab] = useState<"lab" | "requests">("lab");
  const [customMode, setCustomMode] = useState(false);

  useEffect(() => () => chaosExperimentRunner.pauseForNavigation(), []);

  const serviceById = useMemo(
    () => new Map(simulation.services.map((service) => [service.id, service])),
    [simulation.services],
  );
  const selectedService = serviceById.get(selectedServiceId) ?? simulation.services[0];
  const phase = experiment.phase;
  const totalHealth = simulation.services.filter((service) => service.health === "healthy").length;
  const affectedCount = simulation.services.filter(
    (service) => service.health !== "healthy",
  ).length;
  const progress =
    experiment.startedAtMs === null || !experiment.config
      ? 0
      : Math.min(100, (experiment.elapsedMs / (experiment.config.durationSeconds * 1_000)) * 100);
  const requestEvents = simulation.events
    .filter(
      (event): event is Extract<SimulationEvent, { type: "request.completed" }> =>
        event.type === "request.completed",
    )
    .slice(-12)
    .reverse();

  function updateConfig<K extends keyof ChaosExperimentConfig>(
    key: K,
    value: ChaosExperimentConfig[K],
  ) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function selectPreset(preset: Preset) {
    setSelectedPreset(preset.id);
    setCustomMode(false);
    setConfig({
      name: preset.name,
      faultType: preset.faultType,
      targetServiceId: preset.targetServiceId,
      intensity: preset.intensity,
      durationSeconds: preset.durationSeconds,
      trafficVolume: preset.trafficVolume,
      failureProbability: preset.failureProbability,
      recoveryStrategy: preset.recoveryStrategy,
    });
  }

  function focusService(serviceId: string) {
    setSelectedServiceId(serviceId);
    setSelectedConnectionId(null);
    setFocusVersion((value) => value + 1);
  }

  function buildExperiment() {
    chaosExperimentRunner.prepare(config);
  }

  return (
    <main className={`${styles.labPage} ${styles[`labPhase_${phase}`]}`}>
      <div className={styles.atmosphere} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <header className={styles.labHeader}>
        <div className={styles.headingBlock}>
          <div className={styles.eyebrow}>
            <span className={styles.eyebrowLed} /> RESILIENCE ENGINEERING / SANDBOX 04
          </div>
          <h1>
            Chaos <em>laboratory</em>
          </h1>
          <p>Inject controlled failure. Observe the graph. Prove your recovery path.</p>
        </div>
        <div className={styles.headerActions}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={phase}
              className={`${styles.phaseBadge} ${styles[`phase_${phase}`]}`}
              initial={reducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -3 }}
              transition={{
                duration: reducedMotion ? 0 : motionDuration.fast,
                ease: motionEase.standard,
              }}
              role="status"
              aria-live="polite"
            >
              <span /> {phaseLabel[phase]}
            </motion.div>
          </AnimatePresence>
          {phase === "execution" && (
            <button
              type="button"
              className={styles.transportButton}
              onClick={() => chaosExperimentRunner.pause()}
            >
              <Pause size={14} /> Pause
            </button>
          )}
          {phase === "paused" && (
            <button
              type="button"
              className={`${styles.transportButton} ${styles.resumeButton}`}
              onClick={() => chaosExperimentRunner.resume()}
            >
              <Play size={14} /> Resume
            </button>
          )}
          {(phase === "execution" || phase === "paused") && (
            <button
              type="button"
              className={styles.stopButton}
              onClick={() => chaosExperimentRunner.stop()}
            >
              <StopCircle size={14} /> Stop
            </button>
          )}
          {(phase === "results" || phase === "failed") && (
            <button
              type="button"
              className={styles.transportButton}
              onClick={() => {
                chaosExperimentRunner.reset();
                setSelectedPreset(null);
              }}
            >
              <RotateCcw size={14} /> Reset
            </button>
          )}
          <div className={styles.headerTime}>
            <Clock3 size={13} />
            <span>T+ {formatDuration(experiment.elapsedMs)}</span>
          </div>
        </div>
      </header>

      <section className={styles.metricsStrip} aria-label="Live system summary">
        <Metric
          icon={<Activity size={14} />}
          label="REQUEST RATE"
          value={`${simulation.metrics.requestsPerSecond.toFixed(1)}`}
          unit="REQ/S"
          tone="cyan"
        />
        <Metric
          icon={<Gauge size={14} />}
          label="P95-LIKE LATENCY"
          value={`${simulation.metrics.averageLatencyMs.toFixed(0)}`}
          unit="MS AVG"
          tone="violet"
        />
        <Metric
          icon={<AlertTriangle size={14} />}
          label="ERROR RATE"
          value={`${simulation.metrics.errorRate.toFixed(2)}`}
          unit="%"
          tone={simulation.metrics.errorRate > 5 ? "red" : "green"}
        />
        <Metric
          icon={<ShieldCheck size={14} />}
          label="HEALTHY NODES"
          value={`${totalHealth.toString().padStart(2, "0")}`}
          unit={`/ ${simulation.services.length}`}
          tone={affectedCount ? "amber" : "green"}
        />
        <Metric
          icon={<Timer size={14} />}
          label="ACTIVE REQUESTS"
          value={`${simulation.metrics.activeRequests}`}
          unit="IN FLIGHT"
          tone="cyan"
        />
      </section>

      <div className={styles.commandRail}>
        <div className={styles.commandTitle}>
          <span>
            <Siren size={15} />
          </span>
          <div>
            <strong>EXPERIMENT CONTROL</strong>
            <small>CLIENT-SIDE DETERMINISTIC SIMULATION</small>
          </div>
        </div>
        <div className={styles.runProgress}>
          <div className={styles.runProgressLabel}>
            <span>
              {phase === "execution"
                ? "INJECTION WINDOW"
                : phase === "completion"
                  ? "RESTORING SERVICE GRAPH"
                  : phase === "results"
                    ? "EXPERIMENT CLOSED"
                    : "SANDBOX READY"}
            </span>
            <span>
              {phase === "execution"
                ? `${Math.round(progress)}%`
                : phase === "completion"
                  ? "RECOVERY"
                  : phase === "results"
                    ? "100%"
                    : "—"}
            </span>
          </div>
          <div className={styles.progressTrack}>
            <span style={{ width: `${phase === "completion" ? 100 : progress}%` }} />
          </div>
        </div>
        <div className={styles.transportGroup}>
          <button
            type="button"
            aria-label="Reset simulation"
            title="Reset simulation"
            onClick={() => {
              chaosExperimentRunner.reset();
              setSelectedPreset(null);
            }}
            className={styles.railIcon}
          >
            <RotateCcw size={14} />
          </button>
          <span className={styles.railDivider} />
          <span className={styles.clockReadout}>
            SIM CLOCK <strong>{formatDuration(simulation.nowMs)}</strong>
          </span>
        </div>
      </div>

      <section className={styles.labGrid}>
        <aside className={styles.catalogPanel}>
          <div className={styles.panelHeading}>
            <div>
              <span className={styles.sectionKicker}>SCENARIO LIBRARY</span>
              <h2>Failure profiles</h2>
            </div>
            <span className={styles.countBadge}>0{presets.length}</span>
          </div>
          <div className={styles.catalogIntro}>
            Select a known failure mode to preconfigure the test bench.
          </div>
          <div className={styles.presetList}>
            {presets.map((preset, index) => {
              const Icon = preset.icon;
              const active = selectedPreset === preset.id;
              return (
                <motion.button
                  key={preset.id}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  className={`${styles.presetItem} ${styles[`preset_${preset.accent}`]} ${active ? styles.presetActive : ""}`}
                  initial={reducedMotion ? false : { opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: reducedMotion ? 0 : motionDuration.panel,
                    delay: reducedMotion ? 0 : index * 0.025,
                    ease: motionEase.entrance,
                  }}
                >
                  <span className={styles.presetIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.presetIcon}>
                    <Icon size={15} />
                  </span>
                  <span className={styles.presetCopy}>
                    <strong>{preset.name}</strong>
                    <small>{preset.summary}</small>
                  </span>
                  <ChevronRight size={14} className={styles.presetArrow} />
                </motion.button>
              );
            })}
          </div>
          <button
            type="button"
            className={`${styles.customScenarioButton} ${customMode ? styles.customScenarioActive : ""}`}
            onClick={() => {
              setCustomMode(true);
              setSelectedPreset(null);
              setConfig((current) => ({
                ...current,
                name: "Custom scenario",
                faultType: "custom",
              }));
            }}
          >
            <span>
              <SlidersHorizontal size={15} />
            </span>
            <strong>Build custom scenario</strong>
            <ArrowRight size={13} />
          </button>
          <div className={styles.catalogFoot}>
            <span className={styles.footLed} /> ISOLATED DEMO ENVIRONMENT{" "}
            <span>SEED {defaultSimulationConfig.seed.toString(16).toUpperCase()}</span>
          </div>
        </aside>

        <section className={styles.graphPanel} aria-label="Live service graph">
          <div className={styles.graphHeader}>
            <div className={styles.graphTitle}>
              <span className={styles.graphPulse} />
              <div>
                <span className={styles.sectionKicker}>INFRASTRUCTURE / LIVE</span>
                <h2>Service dependency graph</h2>
              </div>
            </div>
            <div className={styles.graphToolbar}>
              <span className={styles.nodeCount}>
                {simulation.services.length} NODES <i /> {simulation.connections.length} LINKS
              </span>
              <button
                type="button"
                onClick={() => setCameraResetVersion((v) => v + 1)}
                title="Reset camera"
              >
                RESET VIEW
              </button>
              <button type="button" onClick={() => setFitVersion((v) => v + 1)} title="Fit network">
                FIT GRAPH
              </button>
            </div>
          </div>
          <div className={styles.graphCanvas}>
            <ObservatoryNetwork
              services={simulation.services}
              connections={simulation.connections}
              selectedServiceId={selectedServiceId}
              selectedConnectionId={selectedConnectionId}
              running={simulation.status === "running"}
              speed={simulation.speedMultiplier}
              focusVersion={focusVersion}
              cameraResetVersion={cameraResetVersion}
              fitVersion={fitVersion}
              onSelectService={focusService}
              onSelectConnection={(connectionId, sourceId) => {
                setSelectedConnectionId(connectionId);
                setSelectedServiceId(sourceId);
              }}
              onHoverService={() => undefined}
            />
            <div className={styles.graphCoordinates}>
              <span>US-WEST-2</span>
              <span>GLOBAL / 3 REGIONS</span>
            </div>
            <div className={styles.graphLegend}>
              <span>
                <i className={styles.legendHealthy} /> HEALTHY
              </span>
              <span>
                <i className={styles.legendCritical} /> CRITICAL
              </span>
              <span>
                <i className={styles.legendFailed} /> FAILED
              </span>
              <span>
                <i className={styles.legendRecovery} /> RECOVERY
              </span>
            </div>
            {selectedService && (
              <div className={styles.selectedReadout}>
                <span>FOCUSED NODE</span>
                <strong>{selectedService.shortName}</strong>
                <small>
                  {selectedService.health.toUpperCase()} /{" "}
                  {selectedService.requestsPerSecond.toFixed(1)} REQ/S
                </small>
              </div>
            )}
          </div>
          <div className={styles.graphFoot}>
            <div>
              <span className={styles.liveDot} />
              {simulation.status === "running" ? "REQUEST STREAM LIVE" : "SIMULATION STANDBY"}
              <i />
            </div>
            <span>
              DRAG TO ORBIT <b>·</b> SCROLL TO ZOOM <b>·</b> SELECT NODE TO INSPECT
            </span>
            <span className={styles.eventCount}>{simulation.events.length} EVENTS CAPTURED</span>
          </div>

          <div className={styles.telemetryBand}>
            <div className={styles.telemetryCell}>
              <span>SELECTED SERVICE</span>
              <strong>{selectedService?.name ?? "—"}</strong>
              <small>
                {selectedService?.health.toUpperCase() ?? "UNKNOWN"} ·{" "}
                {selectedService?.region ?? ""}
              </small>
            </div>
            <div className={styles.telemetryCell}>
              <span>CPU / MEMORY</span>
              <strong>
                {selectedService?.cpuUsage.toFixed(0)}% <i>/</i>{" "}
                {selectedService?.memoryUsage.toFixed(0)}%
              </strong>
              <small>LIVE UTILIZATION</small>
            </div>
            <div className={styles.telemetryCell}>
              <span>LATENCY / ERRORS</span>
              <strong>
                {selectedService?.averageLatencyMs.toFixed(0)}
                <i>MS</i> <b>/</b> {selectedService?.errorRate.toFixed(2)}
                <i>%</i>
              </strong>
              <small>
                {selectedService?.queueBacklog ?? 0} QUEUED · {selectedService?.inFlight ?? 0} IN
                FLIGHT
              </small>
            </div>
            <div className={styles.telemetryCell}>
              <span>DEPENDENCY SIGNAL</span>
              <strong>
                {selectedService?.dependsOn.length.toString().padStart(2, "0")} OUTGOING
              </strong>
              <small>
                {
                  simulation.connections.filter(
                    (connection) => connection.target === selectedService?.id,
                  ).length
                }{" "}
                INCOMING EDGES
              </small>
            </div>
          </div>

          <div className={styles.feedPanel}>
            <div className={styles.feedHeader}>
              <div className={styles.feedTabs}>
                <button
                  type="button"
                  onClick={() => setFeedTab("lab")}
                  className={feedTab === "lab" ? styles.feedTabActive : ""}
                >
                  <Terminal size={13} /> EXPERIMENT FEED <b>{experiment.logs.length}</b>
                </button>
                <button
                  type="button"
                  onClick={() => setFeedTab("requests")}
                  className={feedTab === "requests" ? styles.feedTabActive : ""}
                >
                  <Activity size={13} /> REQUEST TRACE <b>{simulation.metrics.completedRequests}</b>
                </button>
              </div>
              <span>
                <i /> EVENT COLLECTION ON
              </span>
            </div>
            <div className={styles.feedRows}>
              {feedTab === "lab"
                ? experiment.logs
                    .slice(-5)
                    .reverse()
                    .map((entry) => (
                      <div
                        key={entry.id}
                        className={`${styles.feedRow} ${styles[`log_${entry.level}`]}`}
                      >
                        <span className={styles.feedLevel}>
                          <i />
                        </span>
                        <time>{formatDuration(entry.atMs)}</time>
                        <strong>{entry.message}</strong>
                      </div>
                    ))
                : requestEvents.slice(0, 5).map((event) => (
                    <div
                      key={event.sequence}
                      className={`${styles.feedRow} ${event.outcome === "success" ? styles.log_success : styles.log_critical}`}
                    >
                      <span className={styles.feedLevel}>
                        <i />
                      </span>
                      <time>{formatDuration(event.atMs)}</time>
                      <strong>
                        {event.outcome === "success"
                          ? "REQUEST COMPLETED"
                          : `REQUEST FAILED · ${event.failedAt ?? "UNKNOWN"}`}
                      </strong>
                      <span className={styles.requestMeta}>
                        {event.routeId} · {event.latencyMs.toFixed(0)} ms
                      </span>
                    </div>
                  ))}
              {feedTab === "lab" && !experiment.logs.length && (
                <div className={styles.feedEmpty}>
                  Choose an experiment profile to stage the first run.
                </div>
              )}
              {feedTab === "requests" && !requestEvents.length && (
                <div className={styles.feedEmpty}>
                  Request outcomes will stream here when the simulation runs.
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className={styles.configPanel}>
          <div className={styles.configHeader}>
            <div>
              <span className={styles.sectionKicker}>
                {customMode ? "CUSTOM SCENARIO BUILDER" : "EXPERIMENT PARAMETERS"}
              </span>
              <h2>{customMode ? "Define the fault" : "Configuration"}</h2>
            </div>
            <span className={styles.configGlyph}>
              <SlidersHorizontal size={16} />
            </span>
          </div>
          <div className={styles.configBody}>
            <label className={styles.fieldLabel}>
              SCENARIO NAME
              <input
                value={config.name}
                onChange={(event) => updateConfig("name", event.target.value)}
                disabled={phase !== "configuration" && phase !== "failed" && phase !== "results"}
              />
            </label>
            <label className={styles.fieldLabel}>
              FAILURE TYPE
              <select
                value={config.faultType}
                onChange={(event) =>
                  updateConfig("faultType", event.target.value as ChaosFaultType)
                }
                disabled={phase !== "configuration" && phase !== "failed" && phase !== "results"}
              >
                {faultOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              TARGET SERVICE
              <select
                value={config.targetServiceId}
                onChange={(event) => updateConfig("targetServiceId", event.target.value)}
                disabled={phase !== "configuration" && phase !== "failed" && phase !== "results"}
              >
                {simulation.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
            {config.faultType === "random-termination" && (
              <div className={styles.randomNote}>
                <Zap size={13} /> Seeded service selection: the same seed selects the same target on
                reset.
              </div>
            )}
            <RangeField
              label="FAILURE INTENSITY"
              value={config.intensity}
              min={1}
              max={100}
              suffix="%"
              disabled={phase !== "configuration" && phase !== "failed" && phase !== "results"}
              onChange={(value) => updateConfig("intensity", value)}
              tone="red"
            />
            <RangeField
              label="DURATION"
              value={config.durationSeconds}
              min={5}
              max={180}
              suffix="SEC"
              disabled={phase !== "configuration" && phase !== "failed" && phase !== "results"}
              onChange={(value) => updateConfig("durationSeconds", value)}
              tone="violet"
            />
            <RangeField
              label="TRAFFIC VOLUME"
              value={config.trafficVolume}
              min={0.1}
              max={6}
              step={0.1}
              suffix="× BASE"
              disabled={phase !== "configuration" && phase !== "failed" && phase !== "results"}
              onChange={(value) => updateConfig("trafficVolume", value)}
              tone="cyan"
            />
            <RangeField
              label="FAILURE PROBABILITY"
              value={Math.round(config.failureProbability * 100)}
              min={0}
              max={100}
              suffix="%"
              disabled={phase !== "configuration" && phase !== "failed" && phase !== "results"}
              onChange={(value) => updateConfig("failureProbability", value / 100)}
              tone="amber"
            />
            <label className={styles.fieldLabel}>
              RECOVERY STRATEGY
              <select
                value={config.recoveryStrategy}
                onChange={(event) =>
                  updateConfig("recoveryStrategy", event.target.value as RecoveryStrategy)
                }
                disabled={phase !== "configuration" && phase !== "failed" && phase !== "results"}
              >
                {recoveryOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className={styles.fieldHint}>
                {recoveryOptions.find((option) => option.id === config.recoveryStrategy)?.detail}
              </small>
            </label>

            {experiment.precheckWarnings.map((warning) => (
              <div key={warning} className={styles.precheckWarning}>
                <AlertTriangle size={14} />
                {warning}
              </div>
            ))}
            {experiment.validationErrors.map((error) => (
              <div key={error} className={styles.validationError}>
                <X size={13} />
                {error}
              </div>
            ))}

            {phase === "confirmation" ? (
              <div className={styles.confirmBlock}>
                <div className={styles.confirmTop}>
                  <AlertOctagon size={15} />
                  <span>
                    <strong>FAULT INJECTION READY</strong>
                    <small>
                      {config.name} will affect{" "}
                      {serviceById.get(config.targetServiceId)?.name ?? config.targetServiceId}.
                    </small>
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.launchButton}
                  onClick={() => chaosExperimentRunner.confirm()}
                >
                  <Zap size={15} /> CONFIRM AND INJECT <ArrowRight size={14} />
                </button>
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={() => {
                    setSelectedPreset(null);
                    setCustomMode(true);
                  }}
                >
                  EDIT CONFIGURATION
                </button>
              </div>
            ) : phase === "execution" || phase === "paused" || phase === "completion" ? (
              <div className={styles.liveControlBlock}>
                <div className={styles.liveControlHeading}>
                  <span className={phase === "paused" ? styles.pausedLed : styles.liveLed} />
                  <span>
                    <strong>
                      {phase === "paused"
                        ? "SIMULATION HELD"
                        : phase === "completion"
                          ? "RECOVERY SEQUENCE"
                          : "FAULT INJECTION ACTIVE"}
                    </strong>
                    <small>{experiment.config?.name}</small>
                  </span>
                </div>
                <div className={styles.liveNumbers}>
                  <span>
                    <b>{Math.round(progress)}%</b>
                    <small>DURATION</small>
                  </span>
                  <span>
                    <b>{simulation.metrics.failedRequests}</b>
                    <small>FAILED REQS</small>
                  </span>
                  <span>
                    <b>{affectedCount}</b>
                    <small>AFFECTED</small>
                  </span>
                </div>
                <div className={styles.miniProgress}>
                  <i style={{ width: `${phase === "completion" ? 100 : progress}%` }} />
                </div>
              </div>
            ) : phase === "results" && experiment.result ? (
              <div className={styles.resultsCard}>
                <div className={styles.resultsTitle}>
                  <span>
                    <Check size={15} />
                  </span>
                  <div>
                    <strong>EXPERIMENT COMPLETE</strong>
                    <small>
                      {experiment.result.stoppedEarly ? "STOPPED EARLY" : "RUN WINDOW CLOSED"}
                    </small>
                  </div>
                </div>
                <div className={styles.resultGrid}>
                  <ResultValue label="REQUESTS" value={String(experiment.result.requests)} />
                  <ResultValue
                    label="FAILURES"
                    value={String(experiment.result.failedRequests)}
                    tone="red"
                  />
                  <ResultValue
                    label="PEAK ERROR"
                    value={`${experiment.result.peakErrorRate.toFixed(1)}%`}
                    tone="amber"
                  />
                  <ResultValue
                    label="PEAK LATENCY"
                    value={`${experiment.result.peakLatencyMs.toFixed(0)} ms`}
                    tone="violet"
                  />
                </div>
                <div className={styles.resultServices}>
                  <span>DEPENDENCY BLAST RADIUS</span>
                  {experiment.result.affectedServices.map((id) => (
                    <button type="button" key={id} onClick={() => focusService(id)}>
                      {serviceById.get(id)?.shortName ?? id}
                      <ArrowUpRight size={11} />
                    </button>
                  ))}
                </div>
                <div className={styles.resultsRecovery}>
                  <ShieldCheck size={13} /> {experiment.result.recoveredServices.length} services
                  recovered and rejoined
                </div>
                <button
                  type="button"
                  className={styles.launchButton}
                  onClick={() => {
                    chaosExperimentRunner.reset();
                    setSelectedPreset(null);
                  }}
                >
                  RESET LAB <RotateCcw size={14} />
                </button>
              </div>
            ) : (
              <div className={styles.buildBlock}>
                <div className={styles.buildReady}>
                  <span>
                    <ShieldCheck size={14} />
                  </span>
                  <div>
                    <strong>SAFE EXECUTION BOUNDARY</strong>
                    <small>Faults are contained in this browser simulation.</small>
                  </div>
                </div>
                <button type="button" className={styles.launchButton} onClick={buildExperiment}>
                  <SlidersHorizontal size={14} /> VALIDATE & RUN PREFLIGHT <ArrowRight size={14} />
                </button>
                <small className={styles.buildCaption}>
                  No production services are contacted. Engine state is seeded and reproducible.
                </small>
              </div>
            )}
          </div>
          <div className={styles.configFooter}>
            <span>
              <CirclePause size={12} /> CONTROLLED ENVIRONMENT
            </span>
            <span>ENGINE / TS</span>
          </div>
        </aside>
      </section>

      <footer className={styles.labFooter}>
        <span>
          <Activity size={12} /> FAULTLINE RESILIENCE LAB
        </span>
        <span>
          DETERMINISTIC BROWSER SIMULATION <i /> POSTGRES / SERVICE MESH MODEL <i /> NO PRODUCTION
          TRAFFIC
        </span>
        <button type="button" onClick={() => focusService("postgres")}>
          <ArrowDownRight size={12} /> INSPECT DATA PLANE
        </button>
      </footer>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  unit,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
  tone: string;
}) {
  return (
    <div className={`${styles.metricCard} ${styles[`metric_${tone}`]}`}>
      <span className={styles.metricIcon}>{icon}</span>
      <span className={styles.metricCopy}>
        <small>{label}</small>
        <strong>
          {value}
          <i>{unit}</i>
        </strong>
      </span>
      <span className={styles.metricSpark} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  tone,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  disabled: boolean;
  tone: string;
  onChange: (value: number) => void;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <label
      className={`${styles.rangeField} ${styles[`range_${tone}`]}`}
      style={{ "--range-fill": `${percent}%` } as CSSProperties}
    >
      <span className={styles.rangeLabel}>
        {label}
        <strong>
          {value}
          {suffix === "%" ? "" : ` ${suffix}`}
          {suffix === "%" ? "%" : ""}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className={styles.rangeEnds}>
        <small>
          {min}
          {label === "TRAFFIC VOLUME" ? "×" : ""}
        </small>
        <small>
          {max}
          {label === "TRAFFIC VOLUME" ? "×" : ""}
        </small>
      </span>
    </label>
  );
}

function ResultValue({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`${styles.resultValue} ${tone ? styles[`result_${tone}`] : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function formatDuration(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
