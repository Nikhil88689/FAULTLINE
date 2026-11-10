"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Command,
  Menu,
  Orbit,
  Radio,
  Shield,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motionDuration } from "@/animations/tokens";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent, ReactNode } from "react";
import type { NetworkIntroState } from "@/components/landing/hero-network-canvas";
import styles from "./landing-page.module.css";

const HeroNetworkCanvas = dynamic(
  () =>
    import("@/components/landing/hero-network-canvas").then((module) => module.HeroNetworkCanvas),
  {
    ssr: false,
    loading: () => <div className={styles.canvasFallback} aria-hidden="true" />,
  },
);

const heroLines = ["EVERY SYSTEM", "HAS A BREAKING", "POINT."];

const liveServices = [
  {
    id: "edge",
    name: "Edge gateway",
    region: "US · west",
    status: "HEALTHY",
    latency: "18 ms",
    tone: "cyan",
  },
  {
    id: "identity",
    name: "Identity",
    region: "US · west",
    status: "HEALTHY",
    latency: "42 ms",
    tone: "violet",
  },
  {
    id: "ledger",
    name: "Ledger",
    region: "US · east",
    status: "DEGRADED",
    latency: "126 ms",
    tone: "amber",
  },
  {
    id: "events",
    name: "Event stream",
    region: "EU · west",
    status: "HEALTHY",
    latency: "36 ms",
    tone: "green",
  },
  {
    id: "database",
    name: "Primary store",
    region: "US · east",
    status: "HEALTHY",
    latency: "24 ms",
    tone: "cyan",
  },
  {
    id: "insights",
    name: "Insight worker",
    region: "EU · west",
    status: "HEALTHY",
    latency: "58 ms",
    tone: "violet",
  },
];

const experiments = [
  {
    id: "01",
    name: "THE CASCADING FAILURE",
    subtitle: "A single slow dependency. An entire graph under pressure.",
    detail: "LATENCY INJECTION / 850MS",
    tone: "amber",
  },
  {
    id: "02",
    name: "THE VANISHING REGION",
    subtitle: "Remove an availability zone. Watch the system find its balance.",
    detail: "REGION ISOLATION / 90 SEC",
    tone: "red",
  },
  {
    id: "03",
    name: "THE SILENT QUEUE",
    subtitle: "Backpressure builds quietly. Trace the moment it becomes visible.",
    detail: "QUEUE SATURATION / 72%",
    tone: "violet",
  },
];

const principles = [
  {
    number: "01",
    title: "Observe the whole",
    text: "Follow signals across service boundaries. See dependencies, latency, and health as a system, not a pile of dashboards.",
    icon: Radio,
    tone: "cyan",
  },
  {
    number: "02",
    title: "Perturb with intent",
    text: "Explore failure modes inside a deliberate, bounded preview. Understand the blast radius before a real system feels it.",
    icon: TriangleAlert,
    tone: "amber",
  },
  {
    number: "03",
    title: "Engineer resilience",
    text: "Turn what you learn into clearer dependencies, sharper objectives, and systems that recover with purpose.",
    icon: Shield,
    tone: "green",
  },
];

const layers = [
  {
    id: "ingress",
    label: "Ingress",
    title: "Every request has a path.",
    copy: "Edge routing and identity establish the entry point, then hand a traceable request into the service mesh.",
  },
  {
    id: "services",
    label: "Services",
    title: "Dependencies shape behavior.",
    copy: "Small services coordinate across APIs, queues, and event streams. One slow hop can change the shape of the whole request.",
  },
  {
    id: "data",
    label: "Data plane",
    title: "State must survive pressure.",
    copy: "Primary stores, replicas, caches, and workers form the recovery surface when load or failure reaches the data plane.",
  },
];

function MagneticLink({
  href,
  children,
  className,
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  className: string;
  ariaLabel?: string;
}) {
  const element = useRef<HTMLAnchorElement>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const move = (event: PointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType !== "mouse" || reducedMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    gsap.to(event.currentTarget, {
      x: x * 0.12,
      y: y * 0.16,
      duration: motionDuration.control,
      ease: "power3.out",
    });
  };
  const reset = (event: MouseEvent<HTMLAnchorElement>) => {
    if (reducedMotion) {
      gsap.set(event.currentTarget, { x: 0, y: 0 });
      return;
    }
    gsap.to(event.currentTarget, {
      x: 0,
      y: 0,
      duration: motionDuration.magneticReturn,
      ease: "elastic.out(1, 0.45)",
    });
  };

  return (
    <Link
      ref={element}
      href={href}
      className={className}
      aria-label={ariaLabel}
      onPointerMove={move}
      onPointerLeave={reset}
    >
      {children}
    </Link>
  );
}

function CharacterLine({ text, line }: { text: string; line: number }) {
  return (
    <span className={styles.titleLine} data-title-line={line} aria-hidden="true">
      {Array.from(text).map((character, index) => (
        <span className={styles.titleCharacter} data-title-char key={`${line}-${index}`}>
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
    </span>
  );
}

function NetworkMap({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const points = [
    { id: "edge", x: 9, y: 54, label: "EDGE" },
    { id: "identity", x: 29, y: 39, label: "IDENTITY" },
    { id: "ledger", x: 49, y: 61, label: "LEDGER" },
    { id: "events", x: 68, y: 36, label: "EVENTS" },
    { id: "database", x: 88, y: 53, label: "STORE" },
    { id: "insights", x: 68, y: 80, label: "INSIGHT" },
  ];
  const links = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [2, 5],
    [3, 5],
    [1, 3],
  ];

  return (
    <div className={styles.networkMap}>
      <svg
        className={styles.mapLines}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="network-line" x1="0" x2="1">
            <stop stopColor="#6a6df5" stopOpacity=".18" />
            <stop offset=".52" stopColor="#5de6ee" stopOpacity=".62" />
            <stop offset="1" stopColor="#8f78ff" stopOpacity=".22" />
          </linearGradient>
        </defs>
        {links.map(([from, to], index) => {
          const start = points[from];
          const end = points[to];
          return (
            <line
              key={`${from}-${to}`}
              className={styles.mapLink}
              style={{ animationDelay: `${index * -0.72}s` }}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="url(#network-line)"
            />
          );
        })}
      </svg>
      {points.map((point) => (
        <button
          type="button"
          key={point.id}
          className={`${styles.mapNode} ${selected === point.id ? styles.mapNodeActive : ""}`}
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
          onClick={() => onSelect(point.id)}
          aria-label={`Inspect ${point.label.toLowerCase()} node`}
          aria-pressed={selected === point.id}
        >
          <span className={styles.mapNodeHalo} />
          <span className={styles.mapNodeCore} />
          <span className={styles.mapNodeLabel}>{point.label}</span>
        </button>
      ))}
      <div className={styles.mapAxes} aria-hidden="true">
        <span>X / SERVICE LATENCY</span>
        <span>Y / DEPENDENCY DEPTH</span>
      </div>
    </div>
  );
}

function ArchitectureDiagram({
  activeLayer,
  reducedMotion,
}: {
  activeLayer: string;
  reducedMotion: boolean;
}) {
  const isActive = (id: string) => activeLayer === id;
  return (
    <svg
      className={styles.architectureSvg}
      viewBox="0 0 760 410"
      role="img"
      aria-label="Interactive distributed systems architecture diagram"
    >
      <defs>
        <linearGradient id="arch-path" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#4de0e9" />
          <stop offset="1" stopColor="#9278ff" />
        </linearGradient>
        <filter id="arch-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g className={styles.archGrid}>
        {Array.from({ length: 13 }, (_, index) => (
          <line key={`v${index}`} x1={30 + index * 58} x2={30 + index * 58} y1="30" y2="380" />
        ))}
        {Array.from({ length: 7 }, (_, index) => (
          <line key={`h${index}`} x1="30" x2="730" y1={40 + index * 55} y2={40 + index * 55} />
        ))}
      </g>
      <g className={`${styles.archPaths} ${isActive("ingress") ? styles.archPathsActive : ""}`}>
        <path d="M85 206 H220 M220 206 C250 206 250 130 290 130 M220 206 H290 M220 206 C250 206 250 282 290 282" />
        <path d="M405 130 C447 130 440 205 480 205 M405 206 H480 M405 282 C447 282 440 205 480 205" />
        <path d="M595 205 H674 M540 245 V320 H655" />
        <path
          className={styles.archDataPath}
          d="M675 205 C720 205 708 90 650 90 H510 C480 90 472 118 460 132"
        />
      </g>
      <g className={`${styles.archNodeGroup} ${isActive("ingress") ? styles.archFocus : ""}`}>
        <rect x="42" y="178" width="86" height="56" rx="6" />
        <text x="85" y="202" textAnchor="middle">
          EDGE
        </text>
        <text className={styles.archSubLabel} x="85" y="218" textAnchor="middle">
          GATEWAY
        </text>
        <rect x="160" y="178" width="104" height="56" rx="6" />
        <text x="212" y="202" textAnchor="middle">
          IDENTITY
        </text>
        <text className={styles.archSubLabel} x="212" y="218" textAnchor="middle">
          AUTH / ROUTE
        </text>
      </g>
      <g className={`${styles.archNodeGroup} ${isActive("services") ? styles.archFocus : ""}`}>
        <rect x="288" y="102" width="118" height="56" rx="6" />
        <text x="347" y="126" textAnchor="middle">
          API MESH
        </text>
        <text className={styles.archSubLabel} x="347" y="142" textAnchor="middle">
          SERVICE GRAPH
        </text>
        <rect x="288" y="178" width="118" height="56" rx="6" />
        <text x="347" y="202" textAnchor="middle">
          LEDGER
        </text>
        <text className={styles.archSubLabel} x="347" y="218" textAnchor="middle">
          CORE SERVICE
        </text>
        <rect x="288" y="254" width="118" height="56" rx="6" />
        <text x="347" y="278" textAnchor="middle">
          EVENT BUS
        </text>
        <text className={styles.archSubLabel} x="347" y="294" textAnchor="middle">
          ASYNC STREAM
        </text>
      </g>
      <g className={`${styles.archNodeGroup} ${isActive("data") ? styles.archFocus : ""}`}>
        <rect x="480" y="178" width="116" height="56" rx="6" />
        <text x="538" y="202" textAnchor="middle">
          WORKERS
        </text>
        <text className={styles.archSubLabel} x="538" y="218" textAnchor="middle">
          ASYNC COMPUTE
        </text>
        <rect x="625" y="178" width="92" height="56" rx="6" />
        <text x="671" y="202" textAnchor="middle">
          STORE
        </text>
        <text className={styles.archSubLabel} x="671" y="218" textAnchor="middle">
          PRIMARY + REPLICA
        </text>
        <rect x="606" y="300" width="98" height="45" rx="6" />
        <text x="655" y="320" textAnchor="middle">
          CACHE
        </text>
        <text className={styles.archSubLabel} x="655" y="335" textAnchor="middle">
          HOT STATE
        </text>
      </g>
      <circle className={styles.archPacket} r="4" filter="url(#arch-glow)">
        {!reducedMotion && (
          <animateMotion
            dur="4.8s"
            repeatCount="indefinite"
            path="M85 206 H220 C250 206 250 130 290 130 H405 C447 130 440 205 480 205 H674"
          />
        )}
      </circle>
      <text className={styles.archLegend} x="40" y="375">
        REQUEST / TRACE FLOW
      </text>
      <text className={styles.archLegend} x="580" y="375">
        FAULT BOUNDARY ›
      </text>
    </svg>
  );
}

export function LandingPage() {
  const root = useRef<HTMLElement>(null);
  const heroSection = useRef<HTMLElement>(null);
  const curtain = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLAnchorElement>(null);
  const subtitle = useRef<HTMLParagraphElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const scrollCue = useRef<HTMLAnchorElement>(null);
  const intro = useRef<NetworkIntroState>({ particles: 0, connections: 0, camera: 0 });
  const [activeNode, setActiveNode] = useState("ledger");
  const [activeLayer, setActiveLayer] = useState("services");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [canvasActive, setCanvasActive] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;
  const counterRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const section = heroSection.current;
    if (!section) return;
    let intersects = true;
    const updateActivity = () =>
      setCanvasActive(intersects && document.visibilityState === "visible");
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              intersects = Boolean(entry?.isIntersecting);
              updateActivity();
            },
            { threshold: 0.08 },
          );
    observer?.observe(section);
    document.addEventListener("visibilitychange", updateActivity);
    updateActivity();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateActivity);
    };
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const node = root.current;
    if (!node) return;

    if (reducedMotion) {
      intro.current.particles = 1;
      intro.current.connections = 1;
      intro.current.camera = 1;
      gsap.set(node.querySelectorAll("[data-title-char], [data-intro-ui], [data-reveal]"), {
        autoAlpha: 1,
        y: 0,
        clearProps: "transform",
      });
      if (curtain.current) gsap.set(curtain.current, { autoAlpha: 0 });
      return;
    }

    const context = gsap.context(() => {
      const chars = node.querySelectorAll("[data-title-char]");
      gsap.set(node.querySelectorAll("[data-intro-ui]"), { autoAlpha: 0, y: 18 });
      gsap.set(chars, { autoAlpha: 0, yPercent: 110, rotateX: -65, transformOrigin: "50% 100%" });
      if (curtain.current) gsap.set(curtain.current, { autoAlpha: 1 });

      const opening = gsap.timeline({ defaults: { ease: "power3.out" } });
      opening
        .to(curtain.current, { autoAlpha: 0, duration: 0.85 }, 0.38)
        .to(intro.current, { particles: 1, duration: 1.35, ease: "power2.out" }, 0.42)
        .to(intro.current, { connections: 1, duration: 1.28, ease: "power2.inOut" }, 1.04)
        .to(intro.current, { camera: 1, duration: 1.65, ease: "power3.inOut" }, 1.28)
        .to(logo.current, { autoAlpha: 1, y: 0, duration: 0.7 }, 1.3)
        .to(
          chars,
          {
            autoAlpha: 1,
            yPercent: 0,
            rotateX: 0,
            duration: 0.8,
            stagger: 0.026,
            ease: "back.out(1.5)",
          },
          1.62,
        )
        .to(subtitle.current, { autoAlpha: 1, y: 0, duration: 0.7 }, 2.4)
        .to(actions.current, { autoAlpha: 1, y: 0, duration: 0.65 }, 2.54)
        .to(node.querySelector(`.${styles.heroMeta}`), { autoAlpha: 1, y: 0, duration: 0.65 }, 2.68)
        .to(scrollCue.current, { autoAlpha: 1, y: 0, duration: 0.65 }, 2.78);

      node.querySelectorAll<HTMLElement>("[data-reveal]").forEach((element) => {
        gsap.fromTo(
          element,
          { autoAlpha: 0, y: 54 },
          {
            autoAlpha: 1,
            y: 0,
            duration: 1.05,
            ease: "power3.out",
            scrollTrigger: { trigger: element, start: "top 83%", once: true },
          },
        );
      });

      counterRefs.current.forEach((counter) => {
        if (!counter) return;
        const target = Number(counter.dataset.target ?? "0");
        const decimals = Number(counter.dataset.decimals ?? "0");
        const suffix = counter.dataset.suffix ?? "";
        const current = { value: 0 };
        gsap.to(current, {
          value: target,
          duration: 1.8,
          ease: "power2.out",
          scrollTrigger: { trigger: counter, start: "top 88%", once: true },
          onUpdate: () => {
            counter.textContent = `${current.value.toFixed(decimals)}${suffix}`;
          },
        });
      });

      gsap.to(node.querySelectorAll("[data-parallax]"), {
        yPercent: -10,
        ease: "none",
        scrollTrigger: {
          trigger: node.querySelector("#live-map"),
          start: "top bottom",
          end: "bottom top",
          scrub: 0.7,
        },
      });
    }, node);

    return () => context.revert();
  }, [reducedMotion]);

  const selectedService =
    liveServices.find((service) => service.id === activeNode) ?? liveServices[1];
  const layer = layers.find((item) => item.id === activeLayer) ?? layers[1];

  return (
    <main ref={root} className={styles.landing}>
      <div ref={curtain} className={styles.introCurtain} aria-hidden="true" />
      <div className={styles.noise} aria-hidden="true" />

      <header className={styles.header}>
        <Link ref={logo} className={styles.brand} href="/" data-intro-ui>
          <span className={styles.brandMark}>
            <Activity size={18} strokeWidth={1.8} />
          </span>
          <span className={styles.brandText}>
            <strong>FAULTLINE</strong>
            <small>THE LIVING SYSTEMS OBSERVATORY</small>
          </span>
        </Link>
        <nav className={styles.navigation} aria-label="Main navigation">
          <Link href="/observatory">Observatory</Link>
          <Link href="/chaos-lab">Chaos lab</Link>
          <Link href="/architecture">Architecture</Link>
          <Link href="/about">About</Link>
        </nav>
        <Link className={styles.navAction} href="/observatory">
          <span>OPEN PLATFORM</span>
          <ArrowUpRight size={13} />
        </Link>
        <button
          type="button"
          className={styles.mobileMenuToggle}
          aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={mobileMenuOpen}
          aria-controls="landing-mobile-navigation"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? <X size={17} /> : <Menu size={17} />}
        </button>
        <AnimatePresence initial={false}>
          {mobileMenuOpen && (
            <motion.nav
              id="landing-mobile-navigation"
              className={styles.mobileNavigation}
              aria-label="Main navigation"
              initial={reducedMotion ? false : { opacity: 0, y: -8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -5, scale: 0.99 }}
              transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {[
                ["Overview", "/"],
                ["Observatory", "/observatory"],
                ["Chaos lab", "/chaos-lab"],
                ["Incidents", "/incidents"],
                ["Architecture", "/architecture"],
                ["Intelligence", "/intelligence"],
                ["About", "/about"],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={href === "/" ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {label}
                  {href === "/" && <span aria-hidden="true" />}
                </Link>
              ))}
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <section ref={heroSection} className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroBackdrop} aria-hidden="true" />
        <div className={styles.heroCanvas} aria-hidden="true">
          <HeroNetworkCanvas
            intro={intro}
            reducedMotion={reducedMotion}
            active={canvasActive}
            onNodeHover={setHoveredNode}
          />
        </div>
        <div className={styles.heroVignette} aria-hidden="true" />
        <div className={styles.heroCoordinates} aria-hidden="true">
          <span>42°21′N / 71°03′W</span>
          <span>FIELD STUDY 001</span>
          <span>0.001 / 1.000</span>
        </div>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowLine} />A NEW PERSPECTIVE ON SYSTEMS
          </p>
          <h1 id="hero-title" className={styles.heroTitle}>
            <span className={styles.srOnly}>EVERY SYSTEM HAS A BREAKING POINT.</span>
            {heroLines.map((line, index) => (
              <CharacterLine text={line} line={index} key={line} />
            ))}
          </h1>
          <p ref={subtitle} className={styles.heroSubtitle} data-intro-ui>
            Understand the invisible forces that keep distributed systems alive. Simulate failures.
            Investigate chaos. Engineer resilience.
          </p>
          <div ref={actions} className={styles.heroActions} data-intro-ui>
            <MagneticLink href="/observatory" className={styles.primaryButton}>
              ENTER THE OBSERVATORY <ArrowRight size={16} />
            </MagneticLink>
            <MagneticLink href="/architecture" className={styles.secondaryButton}>
              EXPLORE ARCHITECTURE <ArrowUpRight size={15} />
            </MagneticLink>
          </div>
          <div className={styles.heroMeta} data-intro-ui>
            <span>
              <i /> SYSTEMS SIGNAL / 03 REGIONS
            </span>
            <span>BUILT FOR WHAT HAPPENS NEXT</span>
          </div>
        </div>
        <div className={styles.nodeReadout} aria-live="polite">
          <span className={styles.readoutPulse} />
          {hoveredNode ?? "NETWORK / DEMO MODE"}
        </div>
        <Link ref={scrollCue} href="#live-map" className={styles.scrollCue} data-intro-ui>
          <span>SCROLL TO OBSERVE</span>
          <ArrowDown size={14} />
        </Link>
        <div className={styles.heroIndex} aria-hidden="true">
          01 <span>/ 07</span>
        </div>
      </section>

      <section className={styles.statsBand} aria-label="System statistics" data-reveal>
        <div className={styles.sectionRail}>
          <span>AT A GLANCE</span>
          <span>01 — 07</span>
        </div>
        <div className={styles.statsGrid}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>SERVICES IN VIEW</span>
            <strong
              ref={(element) => {
                counterRefs.current[0] = element;
              }}
              data-target="6"
              data-suffix=""
            >
              06
            </strong>
            <span className={styles.statFoot}>ACROSS 3 REGIONS</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>ACTIVE REGIONS</span>
            <strong
              ref={(element) => {
                counterRefs.current[1] = element;
              }}
              data-target="3"
              data-suffix=""
            >
              03
            </strong>
            <span className={styles.statFoot}>
              <i className={styles.dotGreen} /> US-WEST / US-EAST / EU-WEST
            </span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>DEGRADED SIGNALS</span>
            <strong
              ref={(element) => {
                counterRefs.current[2] = element;
              }}
              data-target="1"
              data-suffix=""
            >
              01
            </strong>
            <span className={styles.statFoot}>ONE SERVICE ABOVE BASELINE</span>
          </div>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>DEMO P95 LATENCY</span>
            <strong
              ref={(element) => {
                counterRefs.current[3] = element;
              }}
              data-target="126"
              data-suffix="ms"
            >
              126ms
            </strong>
            <span className={styles.statFoot}>SAMPLE SERVICE SNAPSHOT</span>
          </div>
        </div>
      </section>

      <section id="live-map" className={`${styles.section} ${styles.mapSection}`}>
        <div className={styles.sectionRail} data-reveal>
          <span>01 / LIVE SYSTEMS</span>
          <span>INTERACTIVE TOPOLOGY</span>
        </div>
        <div className={styles.sectionHeading} data-reveal>
          <div>
            <p className={styles.kicker}>SEE THE SIGNAL THROUGH THE NOISE</p>
            <h2>
              A system is more than
              <br />
              <em>the sum of its services.</em>
            </h2>
          </div>
          <p className={styles.sectionLead}>
            Move through the living graph. Every connection carries a story; every deviation is a
            clue to how your system really behaves.
          </p>
        </div>
        <div className={styles.livePanel} data-reveal>
          <div className={styles.livePanelTop}>
            <div className={styles.windowMarks}>
              <i />
              <i />
              <i />
            </div>
            <span className={styles.livePanelTitle}>
              <Radio size={13} /> SERVICE MESH / GLOBAL
            </span>
            <span className={styles.streamBadge}>
              <i /> DEMO SIGNAL
            </span>
          </div>
          <div className={styles.mapLayout}>
            <NetworkMap selected={activeNode} onSelect={setActiveNode} />
            <motion.aside
              key={selectedService.id}
              className={styles.signalAside}
              initial={reducedMotion ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.34, ease: "easeOut" }}
            >
              <div className={styles.asideEyebrow}>
                <span>
                  FOCUS / 0
                  {liveServices.findIndex((service) => service.id === selectedService.id) + 1}
                </span>
                <span
                  className={`${styles.healthFlag} ${selectedService.tone === "amber" ? styles.healthDegraded : styles.healthHealthy}`}
                >
                  ● {selectedService.status}
                </span>
              </div>
              <h3>{selectedService.name}</h3>
              <p>{selectedService.region} · sample telemetry feed</p>
              <div className={styles.latencyReadout}>
                <span>OBSERVED LATENCY</span>
                <strong className={selectedService.tone === "amber" ? styles.amberText : ""}>
                  {selectedService.latency}
                </strong>
              </div>
              <div className={styles.signalRule}>
                <span style={{ width: selectedService.id === "ledger" ? "84%" : "34%" }} />
              </div>
              <p className={styles.signalNote}>
                {selectedService.id === "ledger"
                  ? "A degraded signal is expanding through the dependency path."
                  : "Signal remains within its sample service objective."}
              </p>
              <Link href="/observatory" className={styles.inlineLink}>
                OPEN OBSERVATORY <ArrowUpRight size={13} />
              </Link>
            </motion.aside>
          </div>
          <div className={styles.livePanelFoot}>
            <span>
              TRACE WINDOW <b>LAST 60 SECONDS</b>
            </span>
            <span>
              PACKET FLOW <b>SIMULATED</b>
            </span>
            <span className={styles.panelFootRight}>
              SELECT A NODE TO INSPECT <ArrowDownRight size={12} />
            </span>
          </div>
        </div>
        <div className={styles.mapFootnote} data-reveal>
          <span>FIG 01. — SERVICE DEPENDENCY FIELD</span>
          <span>LATENCY · HEALTH · FLOW</span>
        </div>
      </section>

      <section className={`${styles.section} ${styles.experimentSection}`}>
        <div className={styles.sectionRail} data-reveal>
          <span>02 / CHAOS FIELD NOTES</span>
          <span>CONTROLLED FAILURE</span>
        </div>
        <div className={styles.experimentIntro} data-reveal>
          <div>
            <p className={styles.kicker}>THE QUESTION IS NEVER IF</p>
            <h2>
              Find the fault
              <br />
              <em>before it finds you.</em>
            </h2>
          </div>
          <Link href="/chaos-lab" className={styles.circleLink}>
            <span>
              EXPLORE
              <br />
              CHAOS LAB
            </span>
            <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className={styles.experimentList}>
          {experiments.map((experiment) => (
            <Link
              href="/chaos-lab"
              key={experiment.id}
              className={`${styles.experimentRow} ${styles[`experiment${experiment.tone}`]}`}
              data-reveal
            >
              <span className={styles.experimentNumber}>
                {experiment.id}
                <i />
              </span>
              <span className={styles.experimentMain}>
                <strong>{experiment.name}</strong>
                <small>{experiment.subtitle}</small>
              </span>
              <span className={styles.experimentDetail}>{experiment.detail}</span>
              <span className={styles.experimentArrow}>
                <ArrowUpRight size={17} />
              </span>
            </Link>
          ))}
        </div>
        <div className={styles.experimentCaption} data-reveal>
          <span>DESIGN A FAILURE. STUDY ITS SHAPE.</span>
          <span>NO PRODUCTION SYSTEMS TOUCHED IN DEMO MODE.</span>
        </div>
      </section>

      <section className={`${styles.section} ${styles.principlesSection}`}>
        <div className={styles.sectionRail} data-reveal>
          <span>03 / THE METHOD</span>
          <span>OBSERVE → PERTURB → LEARN</span>
        </div>
        <div className={styles.methodHead} data-reveal>
          <p className={styles.kicker}>RESILIENCE IS ENGINEERED</p>
          <h2>
            Make the invisible
            <br />
            <em>understandable.</em>
          </h2>
        </div>
        <div className={styles.methodList}>
          {principles.map(({ number, title, text, icon: Icon, tone }) => (
            <article className={styles.methodRow} data-reveal key={number}>
              <span className={styles.methodNumber}>{number}</span>
              <span className={`${styles.methodIcon} ${styles[`tone${tone}`]}`}>
                <Icon size={19} strokeWidth={1.4} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className={styles.methodArrow}>
                <ArrowDownRight size={17} />
              </span>
            </article>
          ))}
        </div>
        <div className={styles.methodQuote} data-reveal>
          <span className={styles.quoteMark}>“</span>
          <p>
            Reliability is not a property you add at the end.
            <br />
            <em>It is a behavior you learn to see.</em>
          </p>
          <span className={styles.quoteAttribution}>FAULTLINE / OPERATING PRINCIPLE 001</span>
        </div>
      </section>

      <section className={`${styles.section} ${styles.architectureSection}`}>
        <div className={styles.sectionRail} data-reveal>
          <span>04 / ANATOMY OF A SYSTEM</span>
          <span>SELECT A LAYER</span>
        </div>
        <div className={styles.architectureHeading} data-reveal>
          <div>
            <p className={styles.kicker}>TRACE EVERY BOUNDARY</p>
            <h2>
              Understand the
              <br />
              <em>shape beneath.</em>
            </h2>
          </div>
          <div className={styles.layerTabs} role="tablist" aria-label="Architecture layers">
            {layers.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={activeLayer === item.id}
                className={activeLayer === item.id ? styles.layerTabActive : ""}
                onClick={() => setActiveLayer(item.id)}
              >
                {item.label}
                <span>0{layers.indexOf(item) + 1}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.architecturePanel} data-reveal>
          <div className={styles.architectureCanvas}>
            <div className={styles.architectureStamp}>
              <Orbit size={13} /> REFERENCE ARCHITECTURE / 01
            </div>
            <ArchitectureDiagram activeLayer={activeLayer} reducedMotion={reducedMotion} />
            <div className={styles.architectureCoords}>
              FAULTLINE MODEL <span>·</span> DISTRIBUTED RUNTIME
            </div>
          </div>
          <div className={styles.layerDescription}>
            <span className={styles.layerNumber}>LAYER / 0{layers.indexOf(layer) + 1}</span>
            <h3>{layer.title}</h3>
            <p>{layer.copy}</p>
            <Link href="/architecture" className={styles.inlineLink}>
              EXPLORE ARCHITECTURE <ArrowUpRight size={13} />
            </Link>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.techSection}`}>
        <div className={styles.sectionRail} data-reveal>
          <span>05 / THE INSTRUMENT</span>
          <span>BUILT FOR THE BROWSER</span>
        </div>
        <div className={styles.techCopy} data-reveal>
          <div>
            <p className={styles.kicker}>A LIVING MODEL, NOT A MOVIE</p>
            <h2>
              Engineered to
              <br />
              <em>feel alive.</em>
            </h2>
          </div>
          <p>
            Interactive simulation stays close to the signal. The interface is fast, the boundary is
            clear, and the experience is designed to run where you work.
          </p>
        </div>
        <div className={styles.techStrip} data-reveal>
          <div className={styles.techStripLead}>
            <Sparkles size={15} />
            <span>THE STACK</span>
          </div>
          <div className={styles.techItem}>
            <span>01</span>
            <strong>Next.js</strong>
            <small>APP ROUTER</small>
          </div>
          <div className={styles.techItem}>
            <span>02</span>
            <strong>Three.js</strong>
            <small>REALTIME 3D</small>
          </div>
          <div className={styles.techItem}>
            <span>03</span>
            <strong>R3F</strong>
            <small>REACT THREE FIBER</small>
          </div>
          <div className={styles.techItem}>
            <span>04</span>
            <strong>TypeScript</strong>
            <small>SIMULATION ENGINE</small>
          </div>
          <div className={styles.techItem}>
            <span>05</span>
            <strong>PostgreSQL</strong>
            <small>PERSISTENT RECORDS</small>
          </div>
        </div>
        <div className={styles.techFoot} data-reveal>
          <span>
            <Command size={12} /> SERVERLESS BY DESIGN
          </span>
          <span>CLIENT-SIDE SIMULATION / MANAGED PERSISTENCE</span>
          <span>VERCEL READY ↗</span>
        </div>
      </section>

      <section className={styles.finalSection}>
        <div className={styles.finalOrb} data-parallax aria-hidden="true" />
        <div className={styles.finalContent} data-reveal>
          <p className={styles.kicker}>
            <span className={styles.eyebrowLine} />
            THE NEXT SIGNAL IS YOURS
          </p>
          <h2>
            Look closer.
            <br />
            <em>Break thoughtfully.</em>
          </h2>
          <p>
            Enter a living model of distributed systems. Learn how they bend before the moment they
            break.
          </p>
          <div className={styles.finalActions}>
            <MagneticLink href="/observatory" className={styles.primaryButton}>
              ENTER THE OBSERVATORY <ArrowRight size={16} />
            </MagneticLink>
            <Link href="/about" className={styles.finalTextLink}>
              MEET FAULTLINE <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
        <div className={styles.finalIndex}>
          FAULTLINE <span>·</span> END OF FIELD NOTE 001
        </div>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.footerBrand}>
          <span className={styles.brandMark}>
            <Activity size={16} />
          </span>
          <span>FAULTLINE</span>
        </Link>
        <span>THE LIVING SYSTEMS OBSERVATORY · 2026</span>
        <nav aria-label="Footer navigation">
          <Link href="/observatory">Observatory</Link>
          <Link href="/chaos-lab">Chaos lab</Link>
          <Link href="/architecture">Architecture</Link>
        </nav>
        <span className={styles.footerStatus}>
          <i /> SYSTEM NOMINAL
        </span>
      </footer>
    </main>
  );
}
