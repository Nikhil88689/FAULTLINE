"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleDot,
  FileSearch,
  GitBranch,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Target,
  Waves,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createLocalInvestigationFallback,
  isInvestigationResponse,
  validateIncidentForInvestigation,
  validateInvestigationFinding,
} from "@/services/incident-investigation";
import type { IncidentRecord } from "@/types/incidents";
import type { InvestigationFinding, InvestigationResponse } from "@/types/incident-investigation";
import styles from "./incident-investigator.module.css";

const steps = [
  "VERIFY SOURCE RECORD",
  "SEND STRUCTURED EVIDENCE",
  "WAIT FOR INVESTIGATOR",
  "VALIDATE FINDINGS",
  "REVEAL VERIFIED RESULT",
];

export function IncidentInvestigator({ incident }: { incident: IncidentRecord }) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [step, setStep] = useState(0);
  const [response, setResponse] = useState<InvestigationResponse | null>(null);
  const [error, setError] = useState("");
  const [visibleCharacters, setVisibleCharacters] = useState(0);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => {
    if (!response) return;
    const summary = response.investigation.summary;
    if (reduceMotion) return;
    let position = 0;
    const timer = window.setInterval(() => {
      position = Math.min(summary.length, position + 4);
      setVisibleCharacters(position);
      if (position >= summary.length) window.clearInterval(timer);
    }, 14);
    return () => window.clearInterval(timer);
  }, [reduceMotion, response]);

  async function runInvestigation() {
    setPhase("running");
    setResponse(null);
    setError("");
    setVisibleCharacters(0);
    setStep(0);

    const context = validateIncidentForInvestigation(incident);
    if (!context) {
      setPhase("error");
      setError("This incident record is incomplete. No AI request was sent.");
      return;
    }

    setStep(1);
    const controller = new AbortController();
    requestController.current = controller;
    let request: Response;
    try {
      request = await fetch("/api/investigations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ incident }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) return;
      showFallback(context, "provider_error");
      return;
    }
    setStep(2);

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json().catch(() => null);
      if (
        !request.ok &&
        isInvestigationResponse(body) &&
        validateInvestigationFinding(body.investigation, context)
      ) {
        setResponse(body);
        setPhase("complete");
        setStep(4);
        return;
      }
      if (
        !request.ok &&
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
      ) {
        setPhase("error");
        setError(body.error);
        return;
      }
      setPhase("error");
      setError("The investigation API returned an invalid response. No AI findings were accepted.");
      return;
    }
    if (!request.ok || !contentType.includes("text/event-stream") || !request.body) {
      showFallback(context, "provider_error");
      return;
    }

    setStep(3);
    try {
      const serialized = await readResultStream(request.body);
      const result: unknown = JSON.parse(serialized);
      if (
        !isInvestigationResponse(result) ||
        result.status !== "complete" ||
        !validateInvestigationFinding(result.investigation, context)
      )
        throw new Error("Invalid investigation result");
      setResponse(result);
      setStep(4);
      setPhase("complete");
    } catch {
      if (controller.signal.aborted) return;
      showFallback(context, "invalid_output");
    }
  }

  function showFallback(
    context: NonNullable<ReturnType<typeof validateIncidentForInvestigation>>,
    reason: "provider_error" | "invalid_output",
  ) {
    setResponse(createLocalInvestigationFallback(context, reason));
    setPhase("complete");
    setStep(4);
  }

  const finding = response?.investigation;
  const revealCount = finding && reduceMotion ? finding.summary.length : visibleCharacters;
  return (
    <section className={styles.investigator} aria-labelledby="investigator-title">
      <div className={styles.ambient} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.icon}>
            <BrainCircuit size={17} />
          </span>
          <div>
            <span className={styles.kicker}>OPTIONAL / INCIDENT INVESTIGATION</span>
            <h3 id="investigator-title">Investigate this incident</h3>
            <p>Trace the recorded failure path and assess recovery against the event stream.</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.privacy}>
            <LockKeyhole size={11} /> KEY SERVER-SIDE ONLY
          </span>
          <button
            className={styles.runButton}
            type="button"
            onClick={runInvestigation}
            disabled={phase === "running"}
          >
            {phase === "running" ? (
              <LoaderCircle className={styles.spin} size={14} />
            ) : (
              <Sparkles size={14} />
            )}
            {phase === "running" ? "INVESTIGATING" : response ? "RUN AGAIN" : "RUN INVESTIGATION"}
            {phase !== "running" && <ArrowRight size={12} />}
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {phase === "running" ? (
          <motion.div
            key="progress"
            className={styles.progress}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className={styles.progressTop}>
              <span>
                <Waves size={12} /> ANALYSIS PIPELINE
              </span>
              <span>
                {Math.min(step + 1, steps.length)
                  .toString()
                  .padStart(2, "0")}{" "}
                / {steps.length}
              </span>
            </div>
            <div className={styles.progressRail}>
              <motion.i
                initial={{ width: "4%" }}
                animate={{ width: ((step + 1) / steps.length) * 100 + "%" }}
                transition={{ duration: reduceMotion ? 0 : 0.35 }}
              />
            </div>
            <div className={styles.stepList}>
              {steps.map((label, index) => (
                <div
                  key={label}
                  className={
                    index < step ? styles.stepDone : index === step ? styles.stepActive : ""
                  }
                >
                  <span>
                    {index < step ? (
                      <Check size={10} />
                    ) : index === step ? (
                      <i />
                    ) : (
                      <b>{String(index + 1).padStart(2, "0")}</b>
                    )}
                  </span>
                  {label}
                </div>
              ))}
            </div>
            <p className={styles.waiting}>
              <span className={styles.pulse} /> Waiting for a validated response. The system will
              mark unavailable AI explicitly.
            </p>
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            className={styles.error}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <AlertTriangle size={15} />
            <span>{error}</span>
          </motion.div>
        ) : response && finding ? (
          <motion.div
            key={response.status + incident.id}
            className={styles.result}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.24 }}
          >
            <div className={response.status === "complete" ? styles.aiStatus : styles.localStatus}>
              {response.status === "complete" ? (
                <ShieldCheck size={13} />
              ) : (
                <AlertTriangle size={13} />
              )}
              <div>
                <strong>
                  {response.status === "complete"
                    ? "AI INVESTIGATION COMPLETE"
                    : "AI ANALYSIS UNAVAILABLE"}
                </strong>
                <span>
                  {response.status === "complete"
                    ? "Validated structured output" + (response.model ? " · " + response.model : "")
                    : response.message}
                </span>
              </div>
              <span className={styles.resultSource}>
                {response.source === "ai" ? "MODEL FINDINGS" : "LOCAL RECORD FACTS"}
              </span>
            </div>
            <div className={styles.summaryBlock}>
              <span className={styles.summaryLabel}>
                <CircleDot size={11} /> INCIDENT BRIEF
              </span>
              <p className={styles.typewriter}>
                {finding.summary.slice(0, revealCount)}
                {revealCount < finding.summary.length && <i aria-hidden="true" />}
              </p>
            </div>
            {revealCount >= finding.summary.length && (
              <FindingSections finding={finding} response={response} incident={incident} />
            )}
            {response.status === "unavailable" && (
              <div className={styles.fallbackNote}>
                <LockKeyhole size={12} />
                <span>
                  Only recorded facts are shown. Preventive measures and alternative recovery
                  strategies were not generated without AI.
                </span>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            className={styles.idle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <span className={styles.idleIcon}>
              <FileSearch size={16} />
            </span>
            <div>
              <strong>Evidence package ready</strong>
              <span>
                This run contains {incident.events.length} typed events,{" "}
                {incident.replayFrames.length} state snapshots, {incident.affectedServices.length}{" "}
                affected services, and{" "}
                {incident.latencySamplesMs?.length ?? incident.latencySampleCount ?? 0} latency
                samples.
              </span>
            </div>
            <span className={styles.optionalTag}>OPTIONAL · NO KEY REQUIRED TO USE FAULTLINE</span>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function FindingSections({
  finding,
  response,
  incident,
}: {
  finding: InvestigationFinding;
  response: InvestigationResponse;
  incident: IncidentRecord;
}) {
  const serviceNames = new Map(
    incident.replayFrames.at(-1)?.services.map((service) => [service.id, service.name]) ?? [],
  );
  return (
    <div className={styles.findings}>
      <Finding
        title="Root cause analysis"
        index="01"
        icon={<Target size={13} />}
        refs={finding.rootCauseAnalysis.evidenceRefs}
        defaultOpen
      >
        <div className={styles.confidence}>
          <span>CONFIDENCE</span>
          <b className={styles["confidence_" + finding.rootCauseAnalysis.confidence]}>
            {finding.rootCauseAnalysis.confidence.toUpperCase()}
          </b>
        </div>
        <p>{finding.rootCauseAnalysis.finding}</p>
      </Finding>
      <Finding
        title="Failure propagation"
        index="02"
        icon={<GitBranch size={13} />}
        refs={finding.propagationExplanation.evidenceRefs}
        defaultOpen
      >
        <p>{finding.propagationExplanation.narrative}</p>
      </Finding>
      <Finding
        title="Affected services"
        index="03"
        icon={<Waves size={13} />}
        refs={[]}
        count={finding.affectedServices.length}
      >
        <div className={styles.affectedList}>
          {finding.affectedServices.map((service) => (
            <div key={service.serviceId}>
              <span className={styles.serviceMark} />
              <div>
                <strong>{serviceNames.get(service.serviceId) ?? service.serviceId}</strong>
                <p>{service.impact}</p>
                {service.evidenceRefs.length > 0 && <Refs refs={service.evidenceRefs} />}
              </div>
            </div>
          ))}
        </div>
      </Finding>
      <Finding
        title="Recovery assessment"
        index="04"
        icon={<ShieldCheck size={13} />}
        refs={finding.recoveryAssessment.evidenceRefs}
      >
        <p>{finding.recoveryAssessment.summary}</p>
        <ListBlock label="Observed strengths" items={finding.recoveryAssessment.strengths} />
        <ListBlock label="Observed gaps" items={finding.recoveryAssessment.gaps} />
      </Finding>
      <Finding
        title="Preventive measures"
        index="05"
        icon={<Sparkles size={13} />}
        refs={finding.preventiveMeasures.flatMap((item) => item.evidenceRefs)}
        count={finding.preventiveMeasures.length}
      >
        {finding.preventiveMeasures.length ? (
          finding.preventiveMeasures.map((item, index) => (
            <div className={styles.recommendation} key={item.recommendation}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{item.recommendation}</strong>
                <p>{item.rationale}</p>
                <Refs refs={item.evidenceRefs} />
              </div>
            </div>
          ))
        ) : (
          <p className={styles.unavailableCopy}>
            {response.status === "unavailable"
              ? "Not generated because AI is unavailable."
              : "No preventive measures were returned."}
          </p>
        )}
      </Finding>
      <Finding
        title="Alternative recovery strategies"
        index="06"
        icon={<ArrowRight size={13} />}
        refs={finding.alternativeRecoveryStrategies.flatMap((item) => item.evidenceRefs)}
        count={finding.alternativeRecoveryStrategies.length}
      >
        {finding.alternativeRecoveryStrategies.length ? (
          finding.alternativeRecoveryStrategies.map((item) => (
            <div className={styles.alternative} key={item.strategy}>
              <div>
                <strong>{item.strategy}</strong>
                <p>{item.rationale}</p>
                <ListBlock label="Tradeoffs" items={item.tradeoffs} />
              </div>
              <Refs refs={item.evidenceRefs} />
            </div>
          ))
        ) : (
          <p className={styles.unavailableCopy}>
            {response.status === "unavailable"
              ? "Not generated because AI is unavailable."
              : "No alternatives were returned."}
          </p>
        )}
      </Finding>
    </div>
  );
}

function Finding({
  title,
  index,
  icon,
  refs,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  index: string;
  icon: React.ReactNode;
  refs: string[];
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className={styles.finding} open={defaultOpen}>
      <summary>
        <span className={styles.findingIcon}>{icon}</span>
        <span className={styles.findingIndex}>{index}</span>
        <strong>{title}</strong>
        {count !== undefined && (
          <span className={styles.findingCount}>{count.toString().padStart(2, "0")}</span>
        )}
        <span className={styles.findingRefCount}>
          {refs.length ? refs.length + " EVIDENCE" : "NO REFERENCES"}
        </span>
        <ChevronDown className={styles.chevron} size={13} />
      </summary>
      <div className={styles.findingBody}>
        {children}
        {refs.length > 0 && (
          <div className={styles.findingRefs}>
            <span>SUPPORTING RECORDS</span>
            <Refs refs={refs} />
          </div>
        )}
      </div>
    </details>
  );
}

function Refs({ refs }: { refs: string[] }) {
  return (
    <div className={styles.refs}>
      {[...new Set(refs)].map((ref) => (
        <span key={ref}>
          {ref
            .replace("event:", "EVT ")
            .replace("snapshot:", "SNAP ")
            .replace("metric:", "METRIC ")
            .replace("service:", "SVC ")
            .replace("meta:", "META ")}
        </span>
      ))}
    </div>
  );
}

function ListBlock({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className={styles.listBlock}>
      <span>{label}</span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

async function readResultStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let serialized = "";
  let done = false;
  const consume = (block: string) => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload: unknown = JSON.parse(line.slice(5).trim());
      if (!payload || typeof payload !== "object") continue;
      const event = payload as { type?: unknown; text?: unknown };
      if (event.type === "chunk" && typeof event.text === "string") serialized += event.text;
      if (event.type === "done") done = true;
    }
  };
  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    pending += decoder.decode(value, { stream: true });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() ?? "";
    blocks.forEach(consume);
    if (serialized.length > 80_000) throw new Error("Investigation output exceeded its limit.");
  }
  pending += decoder.decode();
  if (pending.trim()) consume(pending);
  reader.releaseLock();
  if (!done || !serialized) throw new Error("Investigation stream ended before completion.");
  return serialized;
}
