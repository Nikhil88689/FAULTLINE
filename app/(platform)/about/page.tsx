import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Boxes,
  Braces,
  Database,
  GitBranch,
  Orbit,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "Engineering notes",
  description:
    "The technical decisions, system boundaries, and engineering challenges behind FAULTLINE.",
};

const challenges = [
  {
    number: "01",
    title: "Make the same incident reproducible",
    icon: Orbit,
    challenge:
      "Interactive simulations are useful only when a result can be inspected again and compared fairly.",
    decision:
      "The engine owns a virtual clock and seeded random stream. Scenario configuration, seed, and virtual-time advances determine request paths, failures, and metrics; React subscribes to immutable snapshots.",
    evidence: "SimulationEngine · SeededRandom · SimulationScheduler",
    tone: "cyan",
  },
  {
    number: "02",
    title: "Show the cascade, then verify recovery",
    icon: Workflow,
    challenge:
      "A fault at one dependency can change the health and latency of callers several steps away.",
    decision:
      "The dependency graph routes generated requests through required services. The Chaos Lab applies faults to that same engine, records recovery transitions, and waits for a stable health window before saving an outcome.",
    evidence: "RequestRouter · DependencyGraph · ChaosExperimentRunner",
    tone: "red",
  },
  {
    number: "03",
    title: "Rebuild a historical moment, not a screenshot",
    icon: GitBranch,
    challenge: "An incident summary cannot explain the sequence that led to a degraded system.",
    decision:
      "Completed runs retain typed events and periodic state snapshots. The replay engine selects the nearest prior snapshot, applies subsequent events, and updates service health, metrics, and topology as the cursor moves.",
    evidence: "IncidentReplayEngine · IncidentReplayFrame · typed events",
    tone: "violet",
  },
  {
    number: "04",
    title: "Keep serverless work request-scoped",
    icon: Boxes,
    challenge:
      "An interactive, long-running simulation does not fit a short-lived serverless request.",
    decision:
      "The simulation, chaos lifecycle, replay clock, and 3D rendering run in the browser. Route Handlers validate inputs and optionally persist records; they do not host a continuous simulation or socket server.",
    evidence: "Next.js App Router · Node.js Route Handlers · browser TypeScript",
    tone: "green",
  },
];

const boundaries = [
  {
    icon: Orbit,
    label: "BROWSER",
    title: "Interactive systems model",
    detail:
      "Deterministic simulation, fault injection, graph editing, historical replay, metrics, and React Three Fiber rendering.",
    color: "cyan",
  },
  {
    icon: Activity,
    label: "VERCEL FUNCTIONS",
    title: "Short request handlers",
    detail:
      "Health checks, bounded incident read/write operations, and optional evidence-validated AI investigation.",
    color: "violet",
  },
  {
    icon: Database,
    label: "MANAGED POSTGRESQL",
    title: "Optional durable records",
    detail:
      "Prisma-backed incidents when configured. Guest sessions keep a bounded local browser history without credentials.",
    color: "green",
  },
];

const decisions = [
  {
    label: "Evidence before inference",
    detail:
      "Analytics come from request samples, incident events, and replay frames. If a source was not recorded, the UI reports it as unavailable instead of filling in a plausible-looking number.",
    tone: "cyan",
  },
  {
    label: "One model, multiple views",
    detail:
      "The Observatory, chaos experiments, architecture editor, and replay all use the same service and dependency contracts. An edited architecture can be compiled into a SimulationConfig.",
    tone: "violet",
  },
  {
    label: "Useful without paid services",
    detail:
      "The product runs in deterministic demo mode without PostgreSQL or an AI provider. Database persistence and AI investigation are optional server-side integrations.",
    tone: "green",
  },
];

export default function AboutPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="about-title">
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span /> ENGINEERING NOTES / FAULTLINE
          </p>
          <h1 id="about-title">
            Failure is a <em>design condition.</em>
          </h1>
          <p className={styles.lede}>
            FAULTLINE is a browser-first observability and chaos-engineering sandbox. It makes
            distributed-system behavior easier to inspect by letting engineers model a system,
            inject a controlled fault, and trace the recovery from recorded evidence.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href="/architecture">
              <Boxes size={15} /> EXPLORE THE MODEL <ArrowRight size={14} />
            </Link>
            <Link className={styles.textAction} href="/chaos-lab">
              OPEN CHAOS LAB <ArrowRight size={13} />
            </Link>
          </div>
        </div>

        <div className={styles.heroSignal} aria-label="FAULTLINE system design summary">
          <div className={styles.signalTop}>
            <span>EXECUTION BOUNDARY</span>
            <span className={styles.signalStatus}>
              <i /> SIMULATION ONLY
            </span>
          </div>
          <div
            className={styles.signalDiagram}
            role="img"
            aria-label="Browser simulation produces an incident record, which can be stored locally or in managed PostgreSQL."
          >
            <div className={`${styles.signalNode} ${styles.nodeBrowser}`}>
              <Orbit size={16} />
              <span>SIMULATION</span>
              <small>browser runtime</small>
            </div>
            <div className={styles.signalLink}>
              <span />
              <small>events + snapshots</small>
            </div>
            <div className={`${styles.signalNode} ${styles.nodeIncident}`}>
              <GitBranch size={16} />
              <span>INCIDENT</span>
              <small>recorded state</small>
            </div>
            <div className={styles.signalBranch} aria-hidden="true">
              <span />
              <i />
              <i />
            </div>
            <div className={styles.persistenceTargets}>
              <span>GUEST / LOCAL STORAGE</span>
              <span>OPTIONAL / POSTGRESQL</span>
            </div>
          </div>
          <div className={styles.signalFooter}>
            <Braces size={13} /> NO SERVER-HELD SIMULATION STATE
          </div>
        </div>

        <a className={styles.scrollCue} href="#engineering-challenges">
          <span>SCROLL TO INSPECT THE DESIGN</span>
          <ArrowDown size={13} />
        </a>
      </section>

      <section
        className={styles.section}
        id="engineering-challenges"
        aria-labelledby="challenge-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>01 / PROBLEMS TO SOLVE</p>
            <h2 id="challenge-title">Engineering for failure, with evidence.</h2>
          </div>
          <p>
            These are the constraints that shape the implementation, from the simulation clock to
            the Vercel request boundary.
          </p>
        </div>

        <div className={styles.challengeList}>
          {challenges.map((item) => {
            const Icon = item.icon;
            return (
              <article className={`${styles.challenge} ${styles[item.tone]}`} key={item.number}>
                <div className={styles.challengeIndex}>
                  <span>{item.number}</span>
                  <Icon size={17} />
                </div>
                <div className={styles.challengeBody}>
                  <h3>{item.title}</h3>
                  <div className={styles.challengeColumns}>
                    <div>
                      <span>CHALLENGE</span>
                      <p>{item.challenge}</p>
                    </div>
                    <div>
                      <span>ENGINEERING DECISION</span>
                      <p>{item.decision}</p>
                    </div>
                  </div>
                  <code>{item.evidence}</code>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.boundarySection} aria-labelledby="boundary-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>02 / RUNTIME BOUNDARIES</p>
            <h2 id="boundary-title">Put each workload where it belongs.</h2>
          </div>
          <p>
            The architecture follows the deployment target: browser-side interactivity,
            request-scoped APIs, and managed persistence.
          </p>
        </div>
        <div className={styles.boundaryRail}>
          {boundaries.map((item, index) => {
            const Icon = item.icon;
            return (
              <article className={`${styles.boundary} ${styles[item.color]}`} key={item.label}>
                <div className={styles.boundaryTop}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <Icon size={17} />
                </div>
                <span className={styles.boundaryLabel}>{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.decisionsSection} aria-labelledby="decisions-title">
        <div className={styles.decisionsHeader}>
          <div>
            <p className={styles.kicker}>03 / PRINCIPLES IN THE IMPLEMENTATION</p>
            <h2 id="decisions-title">Useful signals. Honest limits.</h2>
          </div>
          <ShieldCheck size={19} aria-hidden="true" />
        </div>
        <div className={styles.decisionRows}>
          {decisions.map((decision, index) => (
            <article className={`${styles.decision} ${styles[decision.tone]}`} key={decision.label}>
              <span className={styles.decisionIndex}>0{index + 1}</span>
              <h3>{decision.label}</h3>
              <p>{decision.detail}</p>
              <Sparkles size={14} aria-hidden="true" />
            </article>
          ))}
        </div>
        <p className={styles.scopeNote}>
          FAULTLINE models example services in an isolated simulation. It does not ingest live
          production telemetry or send faults to real infrastructure.
        </p>
      </section>

      <section className={styles.explore} aria-labelledby="explore-title">
        <div>
          <p className={styles.kicker}>04 / STEP INTO THE SYSTEM</p>
          <h2 id="explore-title">Inspect a topology. Then change the conditions.</h2>
        </div>
        <div className={styles.exploreLinks}>
          <Link href="/observatory">
            <span>
              <Activity size={15} />
            </span>
            <strong>Observe the service graph</strong>
            <ArrowRight size={14} />
          </Link>
          <Link href="/incidents">
            <span>
              <GitBranch size={15} />
            </span>
            <strong>Replay a recorded incident</strong>
            <ArrowRight size={14} />
          </Link>
          <Link href="/intelligence">
            <span>
              <Sparkles size={15} />
            </span>
            <strong>Read record-derived analytics</strong>
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>FAULTLINE / ENGINEERING NOTES</span>
        <span>DETERMINISTIC MODEL · EXPLICIT BOUNDARIES · RECORDED EVIDENCE</span>
      </footer>
    </main>
  );
}
