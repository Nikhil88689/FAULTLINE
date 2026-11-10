"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Layers3,
  Maximize2,
  Menu,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Signal,
  SlidersHorizontal,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { observatorySimulation } from "@/simulation/observatory-store";
import { useObservatorySimulation } from "@/hooks/use-observatory-simulation";
import type {
  RuntimeHealth,
  RuntimeService,
  SimulationEvent,
  ServiceCategory,
} from "@/types/observatory-runtime";
import styles from "./observatory.module.css";
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
        <span className={styles.loadingOrb} />
        <strong>ASSEMBLING SERVICE GRAPH</strong>
        <small>ALLOCATING RENDER NODES</small>
      </div>
    ),
  },
);

type InventoryFilter = "all" | ServiceCategory;
type EventTab = "events" | "requests" | "notifications";
type MobilePane = "inventory" | "inspector" | null;
type EventLevel = "info" | "warning" | "critical" | "success";
type ObservatoryEventView = {
  id: number;
  time: string;
  level: EventLevel;
  serviceId?: string;
  title: string;
  detail: string;
};

const categories: Array<{ id: InventoryFilter; short: string }> = [
  { id: "all", short: "ALL" },
  { id: "entry", short: "ENTRY" },
  { id: "core", short: "CORE" },
  { id: "data", short: "DATA" },
  { id: "async", short: "ASYNC" },
];
const groups: Array<{ id: ServiceCategory; label: string }> = [
  { id: "entry", label: "INGRESS" },
  { id: "core", label: "CORE SERVICES" },
  { id: "data", label: "DATA PLANE" },
  { id: "async", label: "ASYNC WORKERS" },
];
const stateText: Record<RuntimeHealth, string> = {
  healthy: "HEALTHY",
  "high-load": "HIGH LOAD",
  critical: "CRITICAL",
  failed: "FAILED",
  recovering: "RECOVERING",
};
const stateClass: Record<RuntimeHealth, string> = {
  healthy: styles.healthHealthy,
  "high-load": styles.healthHighLoad,
  critical: styles.healthCritical,
  failed: styles.healthFailed,
  recovering: styles.healthRecovering,
};
function healthSummary(services: RuntimeService[]) {
  if (services.some((service) => service.health === "failed"))
    return { label: "SERVICE FAILURE DETECTED", health: "failed" as RuntimeHealth };
  if (services.some((service) => service.health === "critical"))
    return { label: "CRITICAL SIGNAL", health: "critical" as RuntimeHealth };
  if (services.some((service) => service.health === "recovering"))
    return { label: "RECOVERY IN PROGRESS", health: "recovering" as RuntimeHealth };
  if (services.some((service) => service.health === "high-load"))
    return { label: "ELEVATED LOAD", health: "high-load" as RuntimeHealth };
  return { label: "ALL SYSTEMS OPERATIONAL", health: "healthy" as RuntimeHealth };
}

function eventToView(
  event: SimulationEvent,
  services: ReadonlyMap<string, RuntimeService>,
): ObservatoryEventView | null {
  const time = simulationTime(event.atMs);
  switch (event.type) {
    case "simulation.started":
      return {
        id: event.sequence,
        time,
        level: "success",
        title: "Simulation started",
        detail: "Deterministic traffic generation is active.",
      };
    case "simulation.paused":
      return {
        id: event.sequence,
        time,
        level: "info",
        title: "Simulation paused",
        detail: "Virtual time is held until the next start command.",
      };
    case "simulation.reset":
      return {
        id: event.sequence,
        time,
        level: "success",
        title: "Simulation initialized",
        detail: "Seeded scenario restored to its initial state.",
      };
    case "traffic.rate.changed":
      return {
        id: event.sequence,
        time,
        level: event.multiplier > 1 ? "warning" : "success",
        title: event.multiplier > 1 ? "Traffic load increased" : "Traffic load normalized",
        detail: `${event.requestsPerSecond.toFixed(1)} generated requests per second.`,
      };
    case "service.health.changed": {
      const service = services.get(event.serviceId);
      const level: EventLevel =
        event.to === "healthy" || event.to === "recovering"
          ? "success"
          : event.to === "high-load"
            ? "warning"
            : "critical";
      return {
        id: event.sequence,
        time,
        level,
        serviceId: event.serviceId,
        title: `${service?.name ?? event.serviceId} → ${stateText[event.to]}`,
        detail: event.reason,
      };
    }
    case "service.recovery.completed":
    case "resilience.activated":
      return null;
    case "request.completed": {
      const failedService = event.failedAt ? services.get(event.failedAt)?.name : undefined;
      const path = event.path.map((id) => services.get(id)?.shortName ?? id).join(" → ");
      return {
        id: event.sequence,
        time,
        level: event.outcome === "failure" ? "critical" : "info",
        serviceId: event.failedAt ?? event.path[0],
        title:
          event.outcome === "failure"
            ? `Request failed · ${failedService ?? "dependency"}`
            : "Request completed",
        detail: `${event.routeId} · ${event.latencyMs.toFixed(1)} ms · ${path}${event.reason ? ` · ${event.reason}` : ""}`,
      };
    }
    case "simulation.tick":
    case "request.generated":
    case "request.routed":
    case "metrics.updated":
      return null;
  }
}

function simulationTime(atMs: number): string {
  const seconds = Math.floor(atMs / 1000);
  return `T+${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function CategoryIcon({ category }: { category: ServiceCategory }) {
  if (category === "entry") return <Radio size={15} />;
  if (category === "core") return <Box size={15} />;
  if (category === "data") return <Database size={15} />;
  return <Layers3 size={15} />;
}

function HealthMark({ health, small = false }: { health: RuntimeHealth; small?: boolean }) {
  return (
    <span
      className={
        styles.healthMark + " " + stateClass[health] + (small ? " " + styles.healthMarkSmall : "")
      }
      role="img"
      aria-label={stateText[health]}
    />
  );
}

function MetricBar({
  label,
  value,
  display,
  icon,
  state,
  maximum = 100,
}: {
  label: string;
  value: number;
  display: string;
  icon: ReactNode;
  state?: RuntimeHealth;
  maximum?: number;
}) {
  const width = Math.max(value > 0 ? 2 : 0, Math.min(100, (value / maximum) * 100));
  return (
    <div className={styles.metricBlock}>
      <div className={styles.metricHeading}>
        <span>
          {icon}
          {label}
        </span>
        <strong>{display}</strong>
      </div>
      <div className={styles.metricTrack}>
        <span
          className={styles.metricFill + (state ? " " + stateClass[state] : "")}
          style={{ "--metric-width": width + "%" } as CSSProperties}
        />
      </div>
    </div>
  );
}

export function ObservatoryWorkbench() {
  const simulation = useObservatorySimulation();
  const reducedMotion = useReducedMotion() ?? false;
  const services = simulation.services;
  const connections = simulation.connections;
  const running = simulation.status === "running";
  const speed = simulation.speedMultiplier;
  const loadFactor = simulation.trafficMultiplier;
  const [selectedServiceId, setSelectedServiceId] = useState("gateway");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [expandedGroups, setExpandedGroups] = useState<Record<ServiceCategory, boolean>>({
    entry: true,
    core: true,
    data: true,
    async: true,
  });
  const [activeTab, setActiveTab] = useState<EventTab>("events");
  const [eventsExpanded, setEventsExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [cameraResetVersion, setCameraResetVersion] = useState(0);
  const [fitVersion, setFitVersion] = useState(0);
  const [hoveredServiceId, setHoveredServiceId] = useState<string | null>(null);

  useEffect(() => {
    observatorySimulation.start();
    return () => observatorySimulation.pause();
  }, []);

  const serviceById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const selectedService = serviceById.get(selectedServiceId) ?? services[0];
  const systemHealth = healthSummary(services);
  const selectedConnection = selectedConnectionId
    ? connections.find((connection) => connection.id === selectedConnectionId)
    : undefined;
  const incoming = connections.filter((connection) => connection.target === selectedService.id);
  const outgoing = connections.filter((connection) => connection.source === selectedService.id);
  const notifications = services.filter((service) => service.health !== "healthy");
  const events = useMemo(
    () =>
      simulation.events
        .map((event) => eventToView(event, serviceById))
        .filter((event): event is ObservatoryEventView => event !== null)
        .slice(-40)
        .reverse(),
    [simulation.events, serviceById],
  );
  const visibleEvents = eventsExpanded ? events : events.slice(0, 4);

  function focusService(serviceId: string) {
    setSelectedServiceId(serviceId);
    setSelectedConnectionId(null);
    setFocusVersion((version) => version + 1);
    setMobilePane(null);
  }

  function triggerCritical() {
    observatorySimulation.injectCriticalFault(selectedService.id);
    setSettingsOpen(false);
  }

  function triggerFailure() {
    observatorySimulation.failService(selectedService.id);
    setSettingsOpen(false);
  }

  function startRecovery() {
    observatorySimulation.beginServiceRecovery(selectedService.id);
  }

  function resetSimulation() {
    observatorySimulation.reset(true);
    setSelectedConnectionId(null);
    setSettingsOpen(false);
  }

  function toggleLoad() {
    const nextLoad = loadFactor > 1 ? 1 : 1.65;
    observatorySimulation.setTrafficMultiplier(nextLoad);
    setSettingsOpen(false);
  }

  function matchingServices(category: ServiceCategory) {
    return services.filter((service) => {
      const matchesFilter = filter === "all" || service.category === filter;
      const matchesGroup = service.category === category;
      const matchesQuery = (service.name + " " + service.id + " " + service.region)
        .toLowerCase()
        .includes(query.trim().toLowerCase());
      return matchesFilter && matchesGroup && matchesQuery;
    });
  }

  return (
    <main className={styles.observatoryApp}>
      <h1 className="sr-only">Service observatory</h1>
      <header className={styles.controlBar}>
        <div className={styles.brandBlock}>
          <Link href="/" className={styles.brandMark} aria-label="Back to FAULTLINE home">
            <Activity size={19} strokeWidth={1.9} />
          </Link>
          <span className={styles.brandWord}>
            <strong>FAULTLINE</strong>
            <small>THE LIVING SYSTEMS OBSERVATORY</small>
          </span>
          <span className={styles.headerDivider} />
          <span className={styles.routeName}>
            SYSTEM TOPOLOGY <b>01 / 04</b>
          </span>
        </div>
        <div className={styles.runControls}>
          <span className={styles.simulationStatus + " " + stateClass[systemHealth.health]}>
            <i className={styles.statusPulse} />
            {running ? "SIMULATION RUNNING" : "SIMULATION PAUSED"}
          </span>
          <div className={styles.transportControls}>
            <button
              type="button"
              className={styles.transportButton + (running ? " " + styles.transportActive : "")}
              onClick={() => observatorySimulation.start()}
              aria-pressed={running}
              aria-label="Start simulation"
            >
              <Play size={13} fill="currentColor" />
              <span>START</span>
            </button>
            <button
              type="button"
              className={styles.transportButton + (!running ? " " + styles.transportActive : "")}
              onClick={() => observatorySimulation.pause()}
              aria-pressed={!running}
              aria-label="Pause simulation"
            >
              <Pause size={13} fill="currentColor" />
              <span>PAUSE</span>
            </button>
            <button
              type="button"
              className={styles.transportIcon}
              onClick={resetSimulation}
              aria-label="Reset simulation"
              title="Reset simulation"
            >
              <RotateCcw size={14} />
            </button>
          </div>
          <label className={styles.speedControl}>
            <Zap size={13} />
            <span>SPEED</span>
            <select
              value={speed}
              onChange={(event) =>
                observatorySimulation.setSpeedMultiplier(Number(event.target.value))
              }
              aria-label="Simulation speed"
            >
              {[0.5, 1, 2, 4].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
            <ChevronDown size={11} />
          </label>
          <div className={styles.settingsWrap}>
            <button
              type="button"
              className={styles.settingsButton + (settingsOpen ? " " + styles.controlSelected : "")}
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
              aria-haspopup="menu"
            >
              <Settings size={15} />
              <span>SETTINGS</span>
              <ChevronDown size={12} />
            </button>
            <AnimatePresence initial={false}>
              {settingsOpen && (
                <motion.div
                  className={styles.settingsMenu}
                  role="menu"
                  aria-label="Simulation settings"
                  initial={reducedMotion ? false : { opacity: 0, y: -5, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reducedMotion ? undefined : { opacity: 0, y: -3, scale: 0.99 }}
                  transition={{
                    duration: reducedMotion ? 0 : motionDuration.control,
                    ease: motionEase.standard,
                  }}
                >
                  <span className={styles.menuEyebrow}>
                    DEMO CONTROLS / {selectedService.shortName}
                  </span>
                  <button type="button" role="menuitem" onClick={toggleLoad}>
                    <Zap size={14} />
                    {loadFactor > 1 ? "Normalize traffic" : "Increase traffic +65%"}
                  </button>
                  <button type="button" role="menuitem" onClick={triggerCritical}>
                    <AlertTriangle size={14} />
                    Inject transient fault
                  </button>
                  <button type="button" role="menuitem" onClick={triggerFailure}>
                    <Box size={14} />
                    Fail selected service
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={startRecovery}
                    disabled={
                      selectedService.health !== "failed" && selectedService.health !== "critical"
                    }
                  >
                    <ShieldCheck size={14} />
                    Begin service recovery
                  </button>
                  <small>All actions run locally in this browser.</small>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className={styles.mobilePanelButtons}>
          <button
            type="button"
            onClick={() => setMobilePane("inventory")}
            aria-label="Open service inventory"
          >
            <Menu size={16} />
          </button>
          <button
            type="button"
            onClick={() => setMobilePane("inspector")}
            aria-label="Open service inspector"
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </header>

      <div className={styles.workbench}>
        <aside
          className={
            styles.inventory + (mobilePane === "inventory" ? " " + styles.mobilePaneOpen : "")
          }
          aria-label="Service inventory"
        >
          <div className={styles.panelHead}>
            <div>
              <span className={styles.panelKicker}>SYSTEM MAP / 01</span>
              <h2>Service inventory</h2>
            </div>
            <button
              className={styles.iconButton}
              type="button"
              onClick={() => setMobilePane(null)}
              aria-label="Close service inventory"
            >
              <X size={15} />
            </button>
          </div>
          <div className={styles.inventorySummary}>
            <span>
              <i className={styles.healthHealthy} />
              {services.filter((service) => service.health === "healthy").length} healthy
            </span>
            <span>
              <i className={styles.healthHighLoad} />
              {services.filter((service) => service.health === "high-load").length} elevated
            </span>
            <span className={styles.inventoryTotal}>
              10 <small>NODES</small>
            </span>
          </div>
          <label className={styles.searchBox}>
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a service..."
              aria-label="Search services"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className={styles.categoryFilters} aria-label="Filter services by category">
            {categories.map((category) => (
              <button
                type="button"
                key={category.id}
                className={filter === category.id ? styles.categoryActive : ""}
                onClick={() => setFilter(category.id)}
                aria-pressed={filter === category.id}
              >
                {category.short}
              </button>
            ))}
          </div>
          <div className={styles.serviceGroups}>
            {groups.map((group) => {
              const matches = matchingServices(group.id);
              if (!matches.length) return null;
              const open = expandedGroups[group.id] || query.length > 0;
              return (
                <section className={styles.serviceGroup} key={group.id}>
                  <button
                    type="button"
                    className={styles.groupHeader}
                    onClick={() =>
                      setExpandedGroups((previous) => ({
                        ...previous,
                        [group.id]: !previous[group.id],
                      }))
                    }
                    aria-expanded={open}
                  >
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span>{group.label}</span>
                    <b>{String(matches.length).padStart(2, "0")}</b>
                  </button>
                  {open && (
                    <div className={styles.groupServices}>
                      {matches.map((service) => (
                        <button
                          type="button"
                          key={service.id}
                          className={
                            styles.serviceItem +
                            (selectedService.id === service.id
                              ? " " + styles.serviceItemSelected
                              : "")
                          }
                          onClick={() => focusService(service.id)}
                          aria-current={selectedService.id === service.id ? "true" : undefined}
                        >
                          <span className={styles.serviceItemIcon}>
                            <CategoryIcon category={service.category} />
                          </span>
                          <span className={styles.serviceItemCopy}>
                            <strong>{service.name}</strong>
                            <small>{service.region}</small>
                          </span>
                          <HealthMark health={service.health} small />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
            {services.filter((service) =>
              (service.name + " " + service.id).toLowerCase().includes(query.toLowerCase()),
            ).length === 0 && (
              <div className={styles.emptySearch}>No services match “{query}”.</div>
            )}
          </div>
          <div className={styles.inventoryFoot}>
            <span>
              <CircleDot size={11} /> SEEDED SIMULATION
            </span>
            <span>10 / 10 NODES</span>
          </div>
        </aside>

        <section className={styles.visualization} aria-label="Interactive 3D service topology">
          <div className={styles.viewHeader}>
            <div className={styles.viewTitle}>
              <span className={styles.viewEyebrow}>
                <span className={styles.viewLiveDot} /> GLOBAL RUNTIME / US-EAST CLUSTER
              </span>
              <strong>{systemHealth.label}</strong>
            </div>
            <div className={styles.viewTools}>
              <span className={styles.viewToolHint}>
                <span className={styles.keyCap}>DRAG</span> ORBIT{" "}
                <span className={styles.keyCap}>SCROLL</span> ZOOM
              </span>
              <span className={styles.toolDivider} />
              <button
                type="button"
                className={styles.viewToolButton}
                onClick={() => setCameraResetVersion((version) => version + 1)}
                title="Reset camera"
              >
                <RotateCcw size={13} />
                <span>RESET VIEW</span>
              </button>
              <button
                type="button"
                className={styles.viewToolButton}
                onClick={() => setFitVersion((version) => version + 1)}
                title="Fit network to screen"
              >
                <Maximize2 size={13} />
                <span>FIT GRAPH</span>
              </button>
            </div>
          </div>
          <div className={styles.canvasRegion}>
            <div className={styles.sceneGrid} aria-hidden="true" />
            <div className={styles.sceneVignette} aria-hidden="true" />
            <div className={styles.sceneCoords} aria-hidden="true">
              <span>LAT / 37.7749°</span>
              <span>DEPTH / 04</span>
              <span>MODEL / F-10</span>
            </div>
            <ObservatoryNetwork
              services={services}
              connections={connections}
              selectedServiceId={selectedService.id}
              selectedConnectionId={selectedConnectionId}
              running={running}
              speed={speed}
              focusVersion={focusVersion}
              cameraResetVersion={cameraResetVersion}
              fitVersion={fitVersion}
              onSelectService={focusService}
              onSelectConnection={(connectionId, sourceId) => {
                setSelectedConnectionId(connectionId);
                setSelectedServiceId(sourceId);
              }}
              onHoverService={setHoveredServiceId}
            />
            {hoveredServiceId && (
              <div className={styles.hoverCard}>
                <span>INSPECT NODE</span>
                <strong>{serviceById.get(hoveredServiceId)?.name}</strong>
                <ArrowUpRight size={13} />
              </div>
            )}
            <div className={styles.sceneLegend}>
              <span>
                <i className={styles.healthHealthy} />
                HEALTHY
              </span>
              <span>
                <i className={styles.healthHighLoad} />
                HIGH LOAD
              </span>
              <span>
                <i className={styles.healthCritical} />
                CRITICAL
              </span>
              <span>
                <i className={styles.healthFailed} />
                FAILED
              </span>
            </div>
            <div className={styles.sceneReadout}>
              <span>SELECTED NODE</span>
              <strong>{selectedService.name}</strong>
              <span className={stateClass[selectedService.health]}>
                {stateText[selectedService.health]}
              </span>
            </div>
          </div>

          <section
            className={styles.eventDock + (eventsExpanded ? " " + styles.eventDockExpanded : "")}
            aria-label="Simulation activity"
          >
            <div className={styles.eventDockHeader}>
              <div className={styles.eventTabs} role="tablist" aria-label="Activity views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "events"}
                  className={activeTab === "events" ? styles.eventTabActive : ""}
                  onClick={() => setActiveTab("events")}
                >
                  <Activity size={13} />
                  EVENT LOG <span>{events.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "requests"}
                  className={activeTab === "requests" ? styles.eventTabActive : ""}
                  onClick={() => setActiveTab("requests")}
                >
                  <Signal size={13} />
                  REQUEST ACTIVITY
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "notifications"}
                  className={activeTab === "notifications" ? styles.eventTabActive : ""}
                  onClick={() => setActiveTab("notifications")}
                >
                  <Bell size={13} />
                  NOTIFICATIONS <span>{notifications.length}</span>
                </button>
              </div>
              <button
                type="button"
                className={styles.expandEvents}
                onClick={() => setEventsExpanded((expanded) => !expanded)}
                aria-expanded={eventsExpanded}
              >
                <span>{eventsExpanded ? "COLLAPSE" : "EXPAND EVENTS"}</span>
                {eventsExpanded ? <ChevronDown size={13} /> : <ArrowUpRight size={13} />}
              </button>
            </div>
            <div className={styles.eventDockBody}>
              {activeTab === "events" && (
                <div className={styles.eventList}>
                  {visibleEvents.map((event) => (
                    <article className={styles.eventRow} key={event.id}>
                      <span
                        className={
                          styles.eventLevel + " " + styles["event" + capitalize(event.level)]
                        }
                      />
                      <time>{event.time}</time>
                      <strong>{event.title}</strong>
                      <span className={styles.eventDetail}>{event.detail}</span>
                      {event.serviceId && (
                        <button
                          type="button"
                          className={styles.eventService}
                          onClick={() => focusService(event.serviceId!)}
                        >
                          {serviceById.get(event.serviceId)?.shortName ?? "SERVICE"}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {activeTab === "requests" && (
                <div className={styles.requestList}>
                  {connections
                    .filter(
                      (connection) =>
                        connection.source === selectedService.id ||
                        connection.target === selectedService.id,
                    )
                    .slice(0, 7)
                    .map((connection) => {
                      const source = serviceById.get(connection.source);
                      const target = serviceById.get(connection.target);
                      const dropped = source?.health === "failed" || target?.health === "failed";
                      return (
                        <button
                          type="button"
                          className={
                            styles.requestRow + (dropped ? " " + styles.requestFailed : "")
                          }
                          key={connection.id}
                          onClick={() => {
                            setSelectedConnectionId(connection.id);
                            setSelectedServiceId(connection.source);
                          }}
                        >
                          <span className={styles.requestTime}>
                            {connection.averageLatencyMs > 0
                              ? `${connection.averageLatencyMs.toFixed(0)}ms`
                              : "— ms"}
                          </span>
                          <span className={styles.requestLine}>
                            <i
                              style={
                                {
                                  "--request-progress": `${Math.max(2, Math.min(100, connection.throughput * 2.5))}%`,
                                } as CSSProperties
                              }
                            />
                          </span>
                          <strong>{source?.shortName}</strong>
                          <ArrowRight size={12} />
                          <span>{target?.shortName}</span>
                          <b>
                            {dropped ? "PATH DOWN" : `${connection.throughput.toFixed(1)} req/s`}
                          </b>
                        </button>
                      );
                    })}
                  {!connections.some(
                    (connection) =>
                      connection.source === selectedService.id ||
                      connection.target === selectedService.id,
                  ) && (
                    <div className={styles.emptyActivity}>
                      No request paths attached to this node.
                    </div>
                  )}
                </div>
              )}
              {activeTab === "notifications" && (
                <div className={styles.notificationList}>
                  {notifications.length === 0 ? (
                    <div className={styles.emptyActivity}>
                      <ShieldCheck size={16} />
                      No active notifications. System health is nominal.
                    </div>
                  ) : (
                    notifications.map((service) => (
                      <button
                        type="button"
                        className={styles.notificationRow}
                        key={service.id}
                        onClick={() => focusService(service.id)}
                      >
                        <HealthMark health={service.health} small />
                        <span>
                          <strong>{service.name}</strong>
                          <small>
                            {service.health === "recovering"
                              ? "Recovery signal is trending positive."
                              : stateText[service.health] +
                                " · " +
                                service.averageLatencyMs.toFixed(0) +
                                " ms average latency"}
                          </small>
                        </span>
                        <ArrowUpRight size={13} />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className={styles.eventDockFoot}>
              <span>
                <i /> CLIENT-SIDE SIMULATION
              </span>
              <span>STREAM / {running ? "ACTIVE" : "PAUSED"}</span>
              <span>{events.length} RECENT EVENTS</span>
            </div>
          </section>
        </section>

        <aside
          className={
            styles.inspector + (mobilePane === "inspector" ? " " + styles.mobilePaneOpen : "")
          }
          aria-label="Service inspector"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={selectedService.id}
              className={styles.inspectorTransition}
              initial={reducedMotion ? false : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, x: -5 }}
              transition={{
                duration: reducedMotion ? 0 : motionDuration.control,
                ease: motionEase.standard,
              }}
            >
              <div className={styles.panelHead}>
                <div>
                  <span className={styles.panelKicker}>
                    NODE DETAIL / {selectedService.shortName}
                  </span>
                  <h2>Service inspector</h2>
                </div>
                <button
                  className={styles.iconButton}
                  type="button"
                  onClick={() => setMobilePane(null)}
                  aria-label="Close service inspector"
                >
                  <X size={15} />
                </button>
              </div>
              <div className={styles.inspectorIdentity}>
                <div className={styles.inspectorGlyph + " " + stateClass[selectedService.health]}>
                  <CategoryIcon category={selectedService.category} />
                </div>
                <div className={styles.inspectorName}>
                  <h3>{selectedService.name}</h3>
                  <span>
                    {selectedService.id} <i /> {selectedService.region}
                  </span>
                </div>
                <HealthMark health={selectedService.health} />
              </div>
              <div className={styles.healthBanner + " " + stateClass[selectedService.health]}>
                <span>
                  <i className={styles.statusPulse} />
                  {stateText[selectedService.health]}
                </span>
                <span>
                  {selectedService.health === "recovering"
                    ? Math.round((selectedService.recoveryStep / 6) * 100) + "% RECOVERED"
                    : selectedService.health === "failed"
                      ? "CONNECTION LOST"
                      : "LAST 60 SEC"}
                </span>
              </div>
              <div className={styles.inspectorMetrics}>
                <div className={styles.metricSectionLabel}>
                  <span>LIVE TELEMETRY</span>
                  <span>UPDATED {running ? "NOW" : "ON PAUSE"}</span>
                </div>
                <MetricBar
                  label="CPU UTILIZATION"
                  value={selectedService.cpuUsage}
                  display={selectedService.cpuUsage.toFixed(0) + "%"}
                  icon={<Cpu size={13} />}
                  state={selectedService.health}
                />
                <MetricBar
                  label="MEMORY USAGE"
                  value={selectedService.memoryUsage}
                  display={selectedService.memoryUsage.toFixed(0) + "%"}
                  icon={<HardDrive size={13} />}
                  state={selectedService.health}
                />
                <MetricBar
                  label="REQUESTS / SEC"
                  value={selectedService.requestsPerSecond}
                  display={selectedService.requestsPerSecond.toFixed(0)}
                  icon={<Activity size={13} />}
                  maximum={2500}
                />
                <MetricBar
                  label="AVG LATENCY"
                  value={selectedService.averageLatencyMs}
                  display={selectedService.averageLatencyMs.toFixed(0) + " ms"}
                  icon={<Gauge size={13} />}
                  maximum={700}
                  state={selectedService.health}
                />
                <MetricBar
                  label="ERROR RATE"
                  value={selectedService.errorRate}
                  display={selectedService.errorRate.toFixed(2) + "%"}
                  icon={<AlertTriangle size={13} />}
                  maximum={10}
                  state={selectedService.health}
                />
                <MetricBar
                  label="QUEUE BACKLOG"
                  value={selectedService.queueBacklog}
                  display={selectedService.queueBacklog.toString()}
                  icon={<Layers3 size={13} />}
                  maximum={32}
                  state={selectedService.health}
                />
                <MetricBar
                  label="IN FLIGHT"
                  value={selectedService.inFlight}
                  display={selectedService.inFlight.toString()}
                  icon={<Signal size={13} />}
                  maximum={32}
                  state={selectedService.health}
                />
              </div>
              {selectedConnection && (
                <div className={styles.connectionFocus}>
                  <span className={styles.panelKicker}>SELECTED CONNECTION</span>
                  <strong>
                    {serviceById.get(selectedConnection.source)?.shortName} <ArrowRight size={12} />{" "}
                    {serviceById.get(selectedConnection.target)?.shortName}
                  </strong>
                  <small>
                    {selectedConnection.throughput.toFixed(2)} req/s ·{" "}
                    {selectedConnection.averageLatencyMs.toFixed(1)} ms ·{" "}
                    {selectedConnection.errorRate.toFixed(2)}% errors
                  </small>
                </div>
              )}
              <div className={styles.connectionSection}>
                <div className={styles.connectionHead}>
                  <span>DEPENDENCIES</span>
                  <span>{selectedService.dependsOn.length.toString().padStart(2, "0")}</span>
                </div>
                {selectedService.dependsOn.length ? (
                  selectedService.dependsOn.map((id) => (
                    <ConnectionItem
                      key={id}
                      serviceId={id}
                      direction="OUT"
                      serviceById={serviceById}
                      onSelect={focusService}
                    />
                  ))
                ) : (
                  <p className={styles.noDependencies}>No downstream dependencies configured.</p>
                )}
              </div>
              <div className={styles.connectionSection}>
                <div className={styles.connectionHead}>
                  <span>INCOMING CONNECTIONS</span>
                  <span>{incoming.length.toString().padStart(2, "0")}</span>
                </div>
                {incoming.length ? (
                  incoming.map((connection) => (
                    <ConnectionItem
                      key={connection.id}
                      serviceId={connection.source}
                      direction="IN"
                      serviceById={serviceById}
                      onSelect={(id) => {
                        focusService(id);
                        setSelectedConnectionId(connection.id);
                      }}
                    />
                  ))
                ) : (
                  <p className={styles.noDependencies}>No incoming connections.</p>
                )}
              </div>
              <div className={styles.connectionSection}>
                <div className={styles.connectionHead}>
                  <span>OUTGOING CONNECTIONS</span>
                  <span>{outgoing.length.toString().padStart(2, "0")}</span>
                </div>
                {outgoing.length ? (
                  outgoing.map((connection) => (
                    <ConnectionItem
                      key={connection.id}
                      serviceId={connection.target}
                      direction="OUT"
                      serviceById={serviceById}
                      onSelect={(id) => {
                        setSelectedConnectionId(connection.id);
                        setSelectedServiceId(id);
                        setFocusVersion((version) => version + 1);
                        setMobilePane(null);
                      }}
                    />
                  ))
                ) : (
                  <p className={styles.noDependencies}>No outgoing connections.</p>
                )}
              </div>
              <div className={styles.inspectorActions}>
                {(selectedService.health === "failed" || selectedService.health === "critical") && (
                  <button type="button" onClick={startRecovery}>
                    <ShieldCheck size={13} /> BEGIN RECOVERY
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setFocusVersion((version) => version + 1);
                    setMobilePane(null);
                  }}
                >
                  <Maximize2 size={13} /> FOCUS IN VIEW
                </button>
              </div>
              <div className={styles.inspectorFooter}>
                <span>
                  <Radio size={11} /> OBSERVABILITY SIGNAL
                </span>
                <span>DEMO / 001</span>
              </div>
            </motion.div>
          </AnimatePresence>
        </aside>
      </div>
      {mobilePane && (
        <button
          type="button"
          className={styles.mobileScrim}
          onClick={() => setMobilePane(null)}
          aria-label="Close panel"
        />
      )}
    </main>
  );
}

function ConnectionItem({
  serviceId,
  direction,
  serviceById,
  onSelect,
}: {
  serviceId: string;
  direction: "IN" | "OUT";
  serviceById: Map<string, RuntimeService>;
  onSelect: (serviceId: string) => void;
}) {
  const service = serviceById.get(serviceId);
  if (!service) return null;
  return (
    <button type="button" className={styles.connectionItem} onClick={() => onSelect(serviceId)}>
      <span className={styles.connectionDirection}>
        {direction === "IN" ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
      </span>
      <span className={styles.connectionItemName}>
        <strong>{service.name}</strong>
        <small>{service.region}</small>
      </span>
      <HealthMark health={service.health} small />
      <ChevronRight size={13} />
    </button>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
