"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  Box,
  Boxes,
  Braces,
  Check,
  ChevronDown,
  CirclePlus,
  Cloud,
  Cpu,
  Database,
  GitBranch,
  HardDrive,
  Layers3,
  Link2,
  LockKeyhole,
  Network,
  Play,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
  Unlink,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, DragEvent, PointerEvent, ReactNode } from "react";
import { listSavedArchitectures, saveArchitecture } from "@/services/architecture-store";
import {
  architectureTemplates,
  cloneArchitecture,
  componentCatalog,
  makeNode,
} from "@/simulation/architecture-templates";
import { toSimulationConfig, validateArchitecture } from "@/simulation/architecture-adapter";
import { SimulationEngine } from "@/simulation/simulation-engine";
import type {
  ArchitectureComponentType,
  ArchitectureDocument,
  ArchitectureEdge,
  ArchitectureNode,
} from "@/types/architecture";
import type { RuntimeHealth } from "@/types/observatory-runtime";
import styles from "./architecture-explorer.module.css";
import { motionDuration, motionEase } from "@/animations/tokens";

const canvasWidth = 1000;
const canvasHeight = 620;
const blankSubscribe = () => () => undefined;

const icons: Record<ArchitectureComponentType, ReactNode> = {
  "api-gateway": <Braces size={15} />,
  microservice: <Cpu size={15} />,
  database: <Database size={15} />,
  cache: <Layers3 size={15} />,
  "message-queue": <Workflow size={15} />,
  "load-balancer": <Network size={15} />,
  "background-worker": <Activity size={15} />,
  "external-api": <Cloud size={15} />,
};

const healthClass: Record<RuntimeHealth, string> = {
  healthy: styles.healthHealthy,
  "high-load": styles.healthLoad,
  critical: styles.healthCritical,
  failed: styles.healthFailed,
  recovering: styles.healthRecovering,
};

type DragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  moved: boolean;
};

export function ArchitectureExplorer() {
  const reducedMotion = useReducedMotion() ?? false;
  const [architecture, setArchitecture] = useState<ArchitectureDocument>(() =>
    cloneArchitecture(architectureTemplates[0]!),
  );
  const [saved, setSaved] = useState<ArchitectureDocument[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    architectureTemplates[0]!.nodes[1]?.id ?? null,
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const [toast, setToast] = useState("");
  const [savedSelection, setSavedSelection] = useState("");
  const [simulationEngine, setSimulationEngine] = useState<SimulationEngine | null>(null);
  const [simulationError, setSimulationError] = useState("");
  const [draftPosition, setDraftPosition] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointerDrag = useRef<DragState | null>(null);
  const pendingDragPosition = useRef<{ id: string; x: number; y: number } | null>(null);
  const dragFrame = useRef<number | null>(null);
  const nodeSequence = useRef(architectureTemplates[0]!.nodes.length + 1);
  const edgeSequence = useRef(1);
  const savedSequence = useRef(1);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const loaded = listSavedArchitectures();
      setSaved(loaded);
      savedSequence.current = loaded.length + 1;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => () => simulationEngine?.pause(), [simulationEngine]);
  const simSubscribe = useCallback(
    (listener: () => void) => simulationEngine?.subscribe(listener) ?? blankSubscribe(),
    [simulationEngine],
  );
  const simGetSnapshot = useCallback(
    () => simulationEngine?.getSnapshot() ?? null,
    [simulationEngine],
  );
  const simulation = useSyncExternalStore(simSubscribe, simGetSnapshot, () => null);
  const validation = useMemo(() => validateArchitecture(architecture), [architecture]);
  const selectedNode = architecture.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = architecture.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const simulationServices = useMemo(
    () => new Map((simulation?.services ?? []).map((service) => [service.id, service])),
    [simulation?.services],
  );
  const visibleNodes = draftPosition
    ? architecture.nodes.map((node) =>
        node.id === draftPosition.id ? { ...node, x: draftPosition.x, y: draftPosition.y } : node,
      )
    : architecture.nodes;

  function commit(next: ArchitectureDocument) {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    simulationEngine?.pause();
    setSimulationEngine(null);
    setSimulationError("");
    setArchitecture(updated);
  }

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }

  function chooseTemplate(id: string) {
    const template = architectureTemplates.find((item) => item.id === id);
    if (!template) return;
    commit(cloneArchitecture(template));
    setSelectedNodeId(template.nodes[1]?.id ?? template.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
    setLinkMode(false);
    setLinkSourceId(null);
    setValidationOpen(false);
    notify(`${template.name} loaded`);
  }

  function addComponent(type: ArchitectureComponentType, x = 500, y = 310) {
    if (architecture.nodes.length >= 40) {
      notify("Maximum of 40 components reached");
      return;
    }
    let id: string;
    do {
      id = `service-${nodeSequence.current++}`;
    } while (architecture.nodes.some((node) => node.id === id));
    const catalog = componentCatalog.find((item) => item.type === type)!;
    const node = makeNode(
      id,
      type,
      `${catalog.label} ${id.slice("service-".length)}`,
      snap(x),
      snap(y),
    );
    commit({ ...architecture, nodes: [...architecture.nodes, node] });
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    notify(`${catalog.label} added to canvas`);
  }

  function updateNode(id: string, patch: Partial<ArchitectureNode>) {
    commit({
      ...architecture,
      nodes: architecture.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    });
  }

  function removeNode(id: string) {
    const node = architecture.nodes.find((item) => item.id === id);
    if (!node) return;
    commit({
      ...architecture,
      nodes: architecture.nodes.filter((item) => item.id !== id),
      edges: architecture.edges.filter((edge) => edge.source !== id && edge.target !== id),
    });
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    notify(`${node.name} removed`);
  }

  function tryConnect(source: string, target: string) {
    setLinkSourceId(null);
    if (source === target) {
      notify("A component cannot depend on itself");
      return;
    }
    if (architecture.edges.some((edge) => edge.source === source && edge.target === target)) {
      notify("That dependency already exists");
      return;
    }
    const edge: ArchitectureEdge = {
      id: `${source}-${target}-${edgeSequence.current++}`,
      source,
      target,
    };
    const candidate = { ...architecture, edges: [...architecture.edges, edge] };
    const cycle = validateArchitecture(candidate).errors.find((error) =>
      error.includes("Circular dependency risk"),
    );
    if (cycle) {
      notify(cycle);
      return;
    }
    commit(candidate);
    setSelectedNodeId(source);
    setSelectedEdgeId(edge.id);
    notify(`${nodeName(source)} → ${nodeName(target)} dependency added`);
  }

  function selectCanvasNode(id: string) {
    if (linkMode) {
      if (!linkSourceId) {
        setLinkSourceId(id);
        setSelectedNodeId(id);
        notify("Select the dependency target");
      } else {
        tryConnect(linkSourceId, id);
      }
      return;
    }
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }

  function saveCurrent() {
    let id = architecture.id;
    if (id.startsWith("template-")) {
      do {
        id = `architecture-${savedSequence.current++}`;
      } while (saved.some((item) => item.id === id));
    }
    const document = { ...architecture, id };
    const updated = saveArchitecture(document);
    setArchitecture(document);
    setSaved(updated);
    setSavedSelection(id);
    notify("Architecture saved to this device");
  }

  function loadSaved() {
    const document = saved.find((item) => item.id === savedSelection);
    if (!document) return;
    commit(cloneArchitecture(document));
    setSelectedNodeId(document.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
    notify(`${document.name} loaded`);
  }

  function validateNow() {
    setValidationOpen(true);
    setValidationMessage(
      validation.errors.length ? "Validation found issues" : "Architecture is ready for simulation",
    );
    if (!validation.errors.length) notify("Architecture validated and executable");
  }

  function runSimulation() {
    if (simulationEngine) {
      if (simulationEngine.getSnapshot().status === "running") simulationEngine.pause();
      else simulationEngine.start();
      return;
    }
    const report = validateArchitecture(architecture);
    setValidationOpen(true);
    if (report.errors.length) {
      setValidationMessage("Resolve validation issues before running the model");
      notify(report.errors[0]!);
      return;
    }
    try {
      const engine = new SimulationEngine(toSimulationConfig(architecture));
      setSimulationEngine(engine);
      setSimulationError("");
      setValidationMessage("Live model running against the current graph");
      engine.start();
    } catch (error) {
      setSimulationError(
        error instanceof Error
          ? error.message
          : "Could not create a simulation from this architecture.",
      );
    }
  }

  function resetSimulation() {
    if (!simulationEngine) return;
    simulationEngine.reset(false);
    setValidationMessage("Simulation reset to a clean seeded state");
  }

  function onPaletteDragStart(
    event: DragEvent<HTMLButtonElement>,
    type: ArchitectureComponentType,
  ) {
    event.dataTransfer.setData("application/faultline-component", type);
    event.dataTransfer.effectAllowed = "copy";
  }

  function onDropComponent(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const type = event.dataTransfer.getData(
      "application/faultline-component",
    ) as ArchitectureComponentType;
    if (!componentCatalog.some((item) => item.type === type)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    addComponent(
      type,
      ((event.clientX - rect.left) / rect.width) * canvasWidth,
      ((event.clientY - rect.top) / rect.height) * canvasHeight,
    );
  }

  function beginNodeDrag(event: PointerEvent<HTMLButtonElement>, node: ArchitectureNode) {
    if (linkMode || event.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerDrag.current = {
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveNodeDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pendingDragPosition.current = {
      id: drag.id,
      x: clamp(
        drag.originX + ((event.clientX - drag.startX) / drag.width) * canvasWidth,
        32,
        canvasWidth - 32,
      ),
      y: clamp(
        drag.originY + ((event.clientY - drag.startY) / drag.height) * canvasHeight,
        34,
        canvasHeight - 34,
      ),
    };
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 2) drag.moved = true;
    if (dragFrame.current === null) {
      dragFrame.current = requestAnimationFrame(() => {
        setDraftPosition(pendingDragPosition.current);
        dragFrame.current = null;
      });
    }
  }

  function endNodeDrag(event: PointerEvent<HTMLDivElement>) {
    if (!pointerDrag.current || pointerDrag.current.pointerId !== event.pointerId) return;
    const drag = pointerDrag.current;
    pointerDrag.current = null;
    pendingDragPosition.current = null;
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    dragFrame.current = null;
    setDraftPosition(null);
    if (drag.moved)
      updateNode(drag.id, {
        x: snap(
          clamp(
            drag.originX + ((event.clientX - drag.startX) / drag.width) * canvasWidth,
            32,
            canvasWidth - 32,
          ),
        ),
        y: snap(
          clamp(
            drag.originY + ((event.clientY - drag.startY) / drag.height) * canvasHeight,
            34,
            canvasHeight - 34,
          ),
        ),
      });
  }

  return (
    <main className={styles.explorer}>
      <span id="architecture-keyboard-instructions" className={styles.visuallyHidden}>
        Use Alt and the arrow keys to move the selected component on the canvas.
      </span>
      <header className={styles.topbar}>
        <div className={styles.titleGroup}>
          <span className={styles.brandMark}>
            <Network size={16} />
          </span>
          <div>
            <span className={styles.kicker}>SYSTEMS DESIGN / WORKSPACE 04</span>
            <h1>
              Architecture <em>Explorer</em>
            </h1>
          </div>
          <span className={styles.liveTag}>
            <i /> EDITOR READY
          </span>
        </div>
        <div className={styles.topActions}>
          <label className={styles.loadSelect}>
            <span>LOAD</span>
            <select
              aria-label="Select saved architecture"
              value={savedSelection}
              onChange={(event) => setSavedSelection(event.target.value)}
            >
              <option value="">Saved architectures</option>
              {saved.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
          <button
            type="button"
            className={styles.actionButton}
            onClick={loadSaved}
            disabled={!savedSelection}
          >
            <HardDrive size={14} /> LOAD
          </button>
          <button type="button" className={styles.actionButton} onClick={saveCurrent}>
            <Save size={14} /> SAVE
          </button>
          <button
            type="button"
            className={`${styles.runButton} ${simulation?.status === "running" ? styles.runActive : ""}`}
            onClick={runSimulation}
          >
            {simulation?.status === "running" ? (
              <>
                <span className={styles.pauseGlyph} /> PAUSE MODEL
              </>
            ) : (
              <>
                <Play size={13} fill="currentColor" />{" "}
                {simulationEngine ? "RESUME MODEL" : "RUN MODEL"}
              </>
            )}
          </button>
          {simulationEngine && (
            <button
              type="button"
              className={styles.resetButton}
              onClick={resetSimulation}
              title="Reset simulation"
            >
              <Activity size={14} />
            </button>
          )}
        </div>
      </header>

      <section className={styles.workspace}>
        <aside className={styles.palettePanel}>
          <div className={styles.panelEyebrow}>SYSTEM BLUEPRINT</div>
          <label className={styles.templateSelect}>
            <span>START FROM TEMPLATE</span>
            <select value="" onChange={(event) => chooseTemplate(event.target.value)}>
              <option value="" disabled>
                Choose a reference system
              </option>
              {architectureTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          <div className={styles.templateHint}>
            <span>
              <Layers3 size={13} />
            </span>
            <p>Templates are editable starting points. Your changes stay in this workspace.</p>
          </div>
          <div className={styles.paletteHeading}>
            <div>
              <span>COMPONENTS</span>
              <small>DRAG OR ADD TO CANVAS</small>
            </div>
            <span>{architecture.nodes.length.toString().padStart(2, "0")}/40</span>
          </div>
          <div className={styles.componentList}>
            {componentCatalog.map((component) => (
              <button
                key={component.type}
                type="button"
                className={`${styles.componentItem} ${styles[`color_${component.color}`]}`}
                draggable
                onDragStart={(event) => onPaletteDragStart(event, component.type)}
                onClick={() => addComponent(component.type)}
                title={`Drag ${component.label} to the canvas or click to add`}
              >
                <span className={styles.componentIcon}>{icons[component.type]}</span>
                <span>
                  <strong>{component.label}</strong>
                  <small>{component.abbreviation} / MODULE</small>
                </span>
                <Plus size={13} className={styles.componentAdd} />
              </button>
            ))}
          </div>
          <div className={styles.paletteFoot}>
            <span className={styles.footSignal} /> CLIENT SIDE MODEL <i /> TYPESCRIPT ENGINE
          </div>
        </aside>

        <section className={styles.editorPanel} aria-label="Architecture canvas">
          <div className={styles.canvasHeader}>
            <div className={styles.canvasTitle}>
              <span className={styles.canvasGlyph}>
                <Boxes size={16} />
              </span>
              <div>
                <span>
                  ARCHITECTURE / {architecture.nodes.length.toString().padStart(2, "0")} COMPONENTS
                </span>
                <strong>{architecture.name}</strong>
              </div>
            </div>
            <div className={styles.canvasActions}>
              <button
                type="button"
                className={`${styles.linkToggle} ${linkMode ? styles.linkToggleActive : ""}`}
                onClick={() => {
                  setLinkMode((active) => !active);
                  setLinkSourceId(null);
                  setSelectedEdgeId(null);
                }}
              >
                <Link2 size={13} /> {linkMode ? "CANCEL LINK" : "CONNECT"}
              </button>
              <button type="button" className={styles.validateButton} onClick={validateNow}>
                <ShieldAlert size={13} /> VALIDATE
              </button>
            </div>
          </div>
          <div className={`${styles.canvasHint} ${linkMode ? styles.canvasHintLink : ""}`}>
            <span className={linkMode ? styles.linkSignal : ""} />
            {linkMode
              ? linkSourceId
                ? `SELECT A DEPENDENCY FOR ${nodeName(linkSourceId).toUpperCase()}`
                : "SELECT THE CALLER COMPONENT, THEN ITS DEPENDENCY"
              : "DIRECTED FLOW / CALLER → DEPENDENCY · DRAG TO REPOSITION · SNAP GRID 20"}
            <span>
              {simulation?.status === "running" ? (
                <>
                  <i className={styles.livePulse} /> SIMULATION LIVE
                </>
              ) : (
                "EDITING"
              )}
            </span>
          </div>
          <div className={styles.canvasViewport}>
            <div
              ref={canvasRef}
              className={styles.canvasStage}
              onClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDropComponent}
              onPointerMove={moveNodeDrag}
              onPointerUp={endNodeDrag}
              onPointerCancel={endNodeDrag}
            >
              <div className={styles.gridBackdrop} aria-hidden="true" />
              <svg
                className={styles.edgeLayer}
                viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
                preserveAspectRatio="none"
                aria-label="Service dependency connections"
              >
                <defs>
                  <marker
                    id="architecture-arrow"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
                  </marker>
                  <filter id="architecture-glow">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {architecture.edges.map((edge) => {
                  const source = visibleNodes.find((node) => node.id === edge.source);
                  const target = visibleNodes.find((node) => node.id === edge.target);
                  if (!source || !target) return null;
                  const path = edgePath(source, target);
                  return (
                    <g
                      key={edge.id}
                      className={selectedEdgeId === edge.id ? styles.edgeSelected : ""}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedEdgeId(edge.id);
                        setSelectedNodeId(null);
                        setLinkMode(false);
                      }}
                    >
                      <path d={path} className={styles.edgeHitArea} />
                      <path
                        d={path}
                        className={`${styles.edgePath} ${simulation?.status === "running" ? styles.edgeAnimated : ""}`}
                        markerEnd="url(#architecture-arrow)"
                      />
                      {simulation?.status === "running" && (
                        <path d={path} className={styles.edgePacket} />
                      )}
                    </g>
                  );
                })}
              </svg>
              {visibleNodes.map((node) => {
                const component = componentCatalog.find((item) => item.type === node.type)!;
                const service = simulationServices.get(node.id);
                const isSelected = selectedNodeId === node.id;
                const isLinkSource = linkSourceId === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`${styles.archNode} ${styles[`node_${component.color}`]} ${isSelected ? styles.nodeSelected : ""} ${service ? healthClass[service.health] : ""} ${isLinkSource ? styles.nodeSource : ""} ${draftPosition?.id === node.id ? styles.nodeDragging : ""}`}
                    style={{ left: `${node.x / 10}%`, top: `${node.y / 6.2}%` } as CSSProperties}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectCanvasNode(node.id);
                    }}
                    onPointerDown={(event) => beginNodeDrag(event, node)}
                    onKeyDown={(event) => {
                      if (!event.altKey || !event.key.startsWith("Arrow")) return;
                      event.preventDefault();
                      const dx =
                        event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
                      const dy = event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0;
                      updateNode(node.id, {
                        x: snap(clamp(node.x + dx, 32, canvasWidth - 32)),
                        y: snap(clamp(node.y + dy, 34, canvasHeight - 34)),
                      });
                    }}
                    draggable={false}
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
                    aria-describedby="architecture-keyboard-instructions"
                  >
                    <span className={styles.nodeTop}>
                      <i>{icons[node.type]}</i>
                      <small>{component.abbreviation}</small>
                      <span className={styles.nodeHealth}>
                        {service ? (
                          <i className={healthClass[service.health]} />
                        ) : (
                          <i className={styles.healthHealthy} />
                        )}
                      </span>
                    </span>
                    <strong>{node.name}</strong>
                    <span className={styles.nodeMeta}>
                      {service
                        ? `${service.requestsPerSecond.toFixed(1)} REQ/S · ${service.averageLatencyMs.toFixed(0)} MS`
                        : `${node.capacityRequestsPerSecond} REQ/S · ${node.region.toUpperCase()}`}
                    </span>
                    {service && (
                      <span className={styles.nodeMeter}>
                        <i style={{ width: `${Math.min(100, service.cpuUsage)}%` }} />
                      </span>
                    )}
                    <span className={styles.inputHandle} />
                    <span className={styles.outputHandle} />
                  </button>
                );
              })}
              <div className={styles.canvasOrigin}>
                <span>FAULTLINE / ARCHITECTURE MODEL</span>
                <span>
                  {architecture.nodes.length} NODES · {architecture.edges.length} DEPENDENCIES
                </span>
              </div>
              {!architecture.nodes.length && (
                <div className={styles.dropPrompt}>
                  <CirclePlus size={22} />
                  <strong>Drop a component to begin</strong>
                  <span>or select a module from the palette</span>
                </div>
              )}
            </div>
          </div>
          <div className={styles.canvasFooter}>
            <span>
              <i className={styles.legendHealthy} /> HEALTHY
            </span>
            <span>
              <i className={styles.legendLoad} /> HIGH LOAD
            </span>
            <span>
              <i className={styles.legendCritical} /> CRITICAL
            </span>
            <span className={styles.footerSpacer} />
            <span>{architecture.nodes.length} COMPONENTS</span>
            <span>{architecture.edges.length} LINKS</span>
          </div>
          <AnimatePresence>
            {validationOpen && (
              <motion.div
                className={styles.validationPanel}
                initial={reducedMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reducedMotion ? undefined : { opacity: 0, height: 0 }}
                transition={{
                  duration: reducedMotion ? 0 : motionDuration.control,
                  ease: motionEase.standard,
                }}
              >
                <div className={styles.validationHeading}>
                  <span>
                    <ShieldAlert size={14} />
                  </span>
                  <div>
                    <strong>
                      {validation.errors.length
                        ? "ARCHITECTURE NEEDS ATTENTION"
                        : validationMessage || "ARCHITECTURE VALID"}
                    </strong>
                    <small>
                      {validation.errors.length
                        ? `${validation.errors.length} blocking issue${validation.errors.length === 1 ? "" : "s"}`
                        : "Dependency graph can be compiled by the simulation engine"}
                    </small>
                  </div>
                  <button
                    type="button"
                    aria-label="Close validation details"
                    onClick={() => setValidationOpen(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className={styles.validationList}>
                  {validation.errors.map((error) => (
                    <p key={error} className={styles.validationError}>
                      <AlertCircle size={13} />
                      {error}
                    </p>
                  ))}
                  {validation.warnings.map((warning) => (
                    <p key={warning} className={styles.validationWarning}>
                      <AlertCircle size={13} />
                      {warning}
                    </p>
                  ))}
                  {!validation.errors.length && !validation.warnings.length && (
                    <p className={styles.validationSuccess}>
                      <Check size={13} />
                      {validationMessage ||
                        "No cycle risks, missing connections, or invalid service settings detected."}
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence initial={false}>
            {toast && (
              <motion.div
                key={toast}
                role="status"
                className={styles.toast}
                initial={reducedMotion ? false : { opacity: 0, x: "-50%", y: -4, scale: 0.98 }}
                animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
                exit={reducedMotion ? undefined : { opacity: 0, x: "-50%", y: -3, scale: 0.99 }}
                transition={{
                  duration: reducedMotion ? 0 : motionDuration.fast,
                  ease: motionEase.standard,
                }}
              >
                <Check size={13} />
                {toast}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <aside className={styles.inspectorPanel}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={selectedEdge?.id ?? selectedNode?.id ?? "architecture-overview"}
              className={styles.inspectorSwap}
              initial={reducedMotion ? false : { opacity: 0, x: 7 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, x: -4 }}
              transition={{
                duration: reducedMotion ? 0 : motionDuration.control,
                ease: motionEase.standard,
              }}
            >
              {selectedEdge ? (
                <EdgeInspector
                  edge={selectedEdge}
                  architecture={architecture}
                  onRemove={() => {
                    commit({
                      ...architecture,
                      edges: architecture.edges.filter((edge) => edge.id !== selectedEdge.id),
                    });
                    setSelectedEdgeId(null);
                    notify("Dependency removed");
                  }}
                  onClose={() => setSelectedEdgeId(null)}
                />
              ) : selectedNode ? (
                <NodeInspector
                  node={selectedNode}
                  architecture={architecture}
                  onUpdate={(patch) => updateNode(selectedNode.id, patch)}
                  onRemove={() => removeNode(selectedNode.id)}
                  onRemoveDependency={(edgeId) => {
                    commit({
                      ...architecture,
                      edges: architecture.edges.filter((edge) => edge.id !== edgeId),
                    });
                    notify("Dependency removed");
                  }}
                  service={simulationServices.get(selectedNode.id)}
                />
              ) : (
                <ArchitectureInspector
                  architecture={architecture}
                  validation={validation}
                  simulation={simulation}
                  simulationError={simulationError}
                  onUpdate={(patch) => commit({ ...architecture, ...patch })}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </aside>
      </section>
      <footer className={styles.statusbar}>
        <span>
          <span className={styles.statusLed} />{" "}
          {simulation?.status === "running"
            ? "SIMULATION STREAM CONNECTED"
            : "LOCAL ARCHITECTURE WORKSPACE"}
        </span>
        <span>
          {validation.errors.length
            ? `${validation.errors.length} VALIDATION ISSUES`
            : "GRAPH INTEGRITY NOMINAL"}
        </span>
        <span>FAULTLINE / DESIGN SYSTEM 01</span>
      </footer>
    </main>
  );

  function nodeName(id: string) {
    return architecture.nodes.find((node) => node.id === id)?.name ?? id;
  }
}

function NodeInspector({
  node,
  architecture,
  onUpdate,
  onRemove,
  onRemoveDependency,
  service,
}: {
  node: ArchitectureNode;
  architecture: ArchitectureDocument;
  onUpdate: (patch: Partial<ArchitectureNode>) => void;
  onRemove: () => void;
  onRemoveDependency: (edgeId: string) => void;
  service?: ReturnType<SimulationEngine["getSnapshot"]>["services"][number];
}) {
  const component = componentCatalog.find((item) => item.type === node.type)!;
  const dependencies = architecture.edges.filter((edge) => edge.source === node.id);
  const inputs = architecture.edges.filter((edge) => edge.target === node.id);
  return (
    <div className={styles.inspectorContent}>
      <div className={styles.inspectorHeader}>
        <div>
          <span>COMPONENT INSPECTOR</span>
          <strong>Node properties</strong>
        </div>
        <span className={`${styles.inspectorIcon} ${styles[`color_${component.color}`]}`}>
          {icons[node.type]}
        </span>
      </div>
      <div className={styles.componentIdentity}>
        <span className={`${styles.typePill} ${styles[`color_${component.color}`]}`}>
          {component.abbreviation} / {component.label.toUpperCase()}
        </span>
        <span className={styles.identityHealth}>
          <i className={service ? healthClass[service.health] : styles.healthHealthy} />
          {service?.health.toUpperCase() ?? "STANDBY"}
        </span>
      </div>
      <label className={styles.inputLabel}>
        SERVICE NAME
        <input
          value={node.name}
          maxLength={40}
          onChange={(event) => onUpdate({ name: event.target.value })}
        />
      </label>
      <label className={styles.inputLabel}>
        RESPONSIBILITY
        <textarea
          rows={3}
          value={node.responsibility}
          onChange={(event) => onUpdate({ responsibility: event.target.value })}
        />
      </label>
      <div className={styles.propertyGrid}>
        <NumberInput
          label="CAPACITY"
          value={node.capacityRequestsPerSecond}
          suffix="REQ/S"
          min={1}
          max={10000}
          onChange={(value) => onUpdate({ capacityRequestsPerSecond: value })}
        />
        <NumberInput
          label="BASE LATENCY"
          value={node.baseLatencyMs}
          suffix="MS"
          min={1}
          max={60000}
          onChange={(value) => onUpdate({ baseLatencyMs: value })}
        />
        <NumberInput
          label="CONCURRENCY"
          value={node.maxConcurrentRequests}
          suffix="SLOTS"
          min={1}
          max={10000}
          onChange={(value) => onUpdate({ maxConcurrentRequests: value })}
        />
        <NumberInput
          label="MEMORY BASELINE"
          value={node.baselineMemoryPercent}
          suffix="%"
          min={0}
          max={100}
          onChange={(value) => onUpdate({ baselineMemoryPercent: value })}
        />
        <NumberInput
          label="FAILURE PROBABILITY"
          value={Number((node.baseFailureProbability * 100).toFixed(2))}
          suffix="%"
          min={0}
          max={100}
          step={0.1}
          onChange={(value) => onUpdate({ baseFailureProbability: value / 100 })}
        />
        <label className={styles.propertyField}>
          <span>REGION</span>
          <select
            value={node.region}
            onChange={(event) => onUpdate({ region: event.target.value })}
          >
            <option>us-east-1</option>
            <option>us-west-2</option>
            <option>eu-west-1</option>
            <option>ap-southeast-1</option>
          </select>
        </label>
      </div>
      <section className={styles.inspectorSection}>
        <div className={styles.inspectorSectionTitle}>
          <span>DEPENDENCIES</span>
          <b>{dependencies.length.toString().padStart(2, "0")}</b>
        </div>
        {dependencies.length ? (
          <div className={styles.dependencyList}>
            {dependencies.map((edge) => (
              <div key={edge.id} className={styles.dependencyRow}>
                <ArrowDownRight size={12} />
                <span>
                  {architecture.nodes.find((item) => item.id === edge.target)?.name ?? edge.target}
                </span>
                <button
                  type="button"
                  aria-label={`Remove dependency ${edge.id}`}
                  onClick={() => onRemoveDependency(edge.id)}
                >
                  <Unlink size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <small className={styles.muted}>No downstream dependencies configured.</small>
        )}
      </section>
      <div className={styles.ioGrid}>
        <div>
          <span>INPUTS FROM</span>
          <strong>
            {inputs.length
              ? inputs
                  .map(
                    (edge) =>
                      architecture.nodes.find((item) => item.id === edge.source)?.name ??
                      edge.source,
                  )
                  .join(", ")
              : "External traffic"}
          </strong>
        </div>
        <div>
          <span>OUTPUTS TO</span>
          <strong>
            {dependencies.length
              ? dependencies
                  .map(
                    (edge) =>
                      architecture.nodes.find((item) => item.id === edge.target)?.name ??
                      edge.target,
                  )
                  .join(", ")
              : "No downstream call"}
          </strong>
        </div>
      </div>
      {service && (
        <div className={styles.runtimeReadout}>
          <div>
            <span>LIVE / CPU</span>
            <strong>{service.cpuUsage.toFixed(0)}%</strong>
          </div>
          <div>
            <span>LIVE / MEMORY</span>
            <strong>{service.memoryUsage.toFixed(0)}%</strong>
          </div>
          <div>
            <span>LIVE / RPS</span>
            <strong>{service.requestsPerSecond.toFixed(1)}</strong>
          </div>
          <div>
            <span>LIVE / ERROR</span>
            <strong>{service.errorRate.toFixed(2)}%</strong>
          </div>
        </div>
      )}
      <Disclosure
        title="Failure modes"
        icon={<ShieldAlert size={12} />}
        items={component.failureModes}
        tone="red"
      />
      <Disclosure
        title="Recovery strategies"
        icon={<Activity size={12} />}
        items={component.recovery}
        tone="green"
      />
      <button type="button" className={styles.removeButton} onClick={onRemove}>
        <Trash2 size={13} /> REMOVE COMPONENT
      </button>
    </div>
  );
}

function EdgeInspector({
  edge,
  architecture,
  onRemove,
  onClose,
}: {
  edge: ArchitectureEdge;
  architecture: ArchitectureDocument;
  onRemove: () => void;
  onClose: () => void;
}) {
  const source = architecture.nodes.find((node) => node.id === edge.source);
  const target = architecture.nodes.find((node) => node.id === edge.target);
  return (
    <div className={styles.inspectorContent}>
      <div className={styles.inspectorHeader}>
        <div>
          <span>DEPENDENCY INSPECTOR</span>
          <strong>Service connection</strong>
        </div>
        <button className={styles.closeInspector} type="button" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className={styles.connectionDiagram}>
        <span>{source?.name ?? edge.source}</span>
        <ArrowRight size={17} />
        <span>{target?.name ?? edge.target}</span>
      </div>
      <div className={styles.connectionSemantics}>
        <strong>CALLER → DEPENDENCY</strong>
        <p>
          The source service invokes the target in its request path. This directed edge is consumed
          as a dependency by the simulation engine.
        </p>
      </div>
      <button type="button" className={styles.removeButton} onClick={onRemove}>
        <Unlink size={13} /> REMOVE CONNECTION
      </button>
    </div>
  );
}

function ArchitectureInspector({
  architecture,
  validation,
  simulation,
  simulationError,
  onUpdate,
}: {
  architecture: ArchitectureDocument;
  validation: ReturnType<typeof validateArchitecture>;
  simulation: ReturnType<SimulationEngine["getSnapshot"]> | null;
  simulationError: string;
  onUpdate: (patch: Partial<ArchitectureDocument>) => void;
}) {
  return (
    <div className={styles.inspectorContent}>
      <div className={styles.inspectorHeader}>
        <div>
          <span>SYSTEM OVERVIEW</span>
          <strong>Architecture profile</strong>
        </div>
        <span className={styles.overviewIcon}>
          <Network size={16} />
        </span>
      </div>
      <label className={styles.inputLabel}>
        ARCHITECTURE NAME
        <input
          value={architecture.name}
          maxLength={60}
          onChange={(event) => onUpdate({ name: event.target.value })}
        />
      </label>
      <label className={styles.inputLabel}>
        DESIGN INTENT
        <textarea
          rows={2}
          value={architecture.description}
          onChange={(event) => onUpdate({ description: event.target.value })}
        />
      </label>
      <div className={styles.profileStats}>
        <div>
          <Box size={13} />
          <span>COMPONENTS</span>
          <strong>{architecture.nodes.length}</strong>
        </div>
        <div>
          <GitBranch size={13} />
          <span>DEPENDENCIES</span>
          <strong>{architecture.edges.length}</strong>
        </div>
        <div>
          <Activity size={13} />
          <span>TRAFFIC INPUT</span>
          <strong>
            {architecture.requestsPerSecond} <i>RPS</i>
          </strong>
        </div>
      </div>
      <div className={styles.ingressSummary}>
        <span>SIMULATION ROUTES</span>
        <strong>{validation.routes.length}</strong>
        <small>Ingress nodes route to every reachable dependency leaf.</small>
      </div>
      <div
        className={`${styles.validationSummary} ${validation.errors.length ? styles.summaryError : styles.summaryReady}`}
      >
        <span>
          {validation.errors.length ? <AlertCircle size={13} /> : <Check size={13} />}
          {validation.errors.length ? "BLOCKING ISSUES" : "GRAPH VALIDATION"}
        </span>
        <strong>
          {validation.errors.length ? `${validation.errors.length} issues` : "Ready to compile"}
        </strong>
        {validation.errors[0] && <small>{validation.errors[0]}</small>}
        {!validation.errors.length &&
          validation.warnings.map((warning) => <small key={warning}>{warning}</small>)}
      </div>
      <NumberInput
        label="REQUESTS PER SECOND"
        value={architecture.requestsPerSecond}
        suffix="REQ/S"
        min={1}
        max={10000}
        onChange={(value) => onUpdate({ requestsPerSecond: value })}
      />
      {simulation && (
        <div className={styles.simReadout}>
          <div className={styles.simReadoutHead}>
            <span>
              <i className={simulation.status === "running" ? styles.livePulse : ""} /> SIMULATION /{" "}
              {simulation.status.toUpperCase()}
            </span>
            <small>SEED {simulation.version.toString(16).toUpperCase()}</small>
          </div>
          <div className={styles.simMetrics}>
            <Metric
              label="THROUGHPUT"
              value={simulation.metrics.requestsPerSecond.toFixed(1)}
              unit="RPS"
            />
            <Metric
              label="ERROR RATE"
              value={`${simulation.metrics.errorRate.toFixed(2)}%`}
              unit=""
            />
            <Metric
              label="AVG LATENCY"
              value={simulation.metrics.averageLatencyMs.toFixed(0)}
              unit="MS"
            />
            <Metric label="ACTIVE" value={String(simulation.metrics.activeRequests)} unit="REQ" />
          </div>
          <div className={styles.simEventList}>
            {simulation.events
              .filter(
                (event) =>
                  event.type === "service.health.changed" || event.type === "request.completed",
              )
              .slice(-5)
              .reverse()
              .map((event) => (
                <div key={event.sequence}>
                  <span
                    className={
                      (event.type === "service.health.changed" &&
                        (event.to === "critical" || event.to === "failed")) ||
                      (event.type === "request.completed" && event.outcome === "failure")
                        ? styles.eventRed
                        : styles.eventCyan
                    }
                  />
                  <small>
                    {event.type === "service.health.changed"
                      ? `${event.serviceId} → ${event.to}`
                      : event.type === "request.completed"
                        ? `${event.outcome.toUpperCase()} · ${event.latencyMs.toFixed(0)} ms`
                        : ""}
                  </small>
                  <time>+{Math.floor(event.atMs / 1000)}s</time>
                </div>
              ))}
          </div>
        </div>
      )}
      {simulationError && (
        <p className={styles.simError}>
          <AlertCircle size={13} />
          {simulationError}
        </p>
      )}
      <div className={styles.engineNote}>
        <LockKeyhole size={13} />
        <span>
          SIMULATION RUNS IN THIS BROWSER. No live services receive traffic; architecture settings
          compile directly into the deterministic engine.
        </span>
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  suffix,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.propertyField}>
      <span>{label}</span>
      <div>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <small>{suffix}</small>
      </div>
    </label>
  );
}

function Disclosure({
  title,
  icon,
  items,
  tone,
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  tone: string;
}) {
  return (
    <details className={`${styles.disclosure} ${styles[`disclosure_${tone}`]}`}>
      <summary>
        {icon}
        <span>{title}</span>
        <ChevronDown size={13} />
      </summary>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className={styles.simMetric}>
      <span>{label}</span>
      <strong>
        {value}
        <i>{unit}</i>
      </strong>
    </div>
  );
}

function edgePath(source: ArchitectureNode, target: ArchitectureNode) {
  const sx = source.x + (target.x >= source.x ? 64 : -64);
  const tx = target.x + (target.x >= source.x ? -64 : 64);
  const bend = Math.max(30, Math.abs(tx - sx) * 0.38);
  const direction = target.x >= source.x ? 1 : -1;
  return `M ${sx} ${source.y} C ${sx + bend * direction} ${source.y}, ${tx - bend * direction} ${target.y}, ${tx} ${target.y}`;
}

function snap(value: number) {
  return Math.round(value / 20) * 20;
}
function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
