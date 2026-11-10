import type { IncidentRecord, IncidentReplayFrame } from "@/types/incidents";
import type { SimulationEvent, SimulationState } from "@/types/observatory-runtime";

export type ReplaySnapshot = {
  cursorMs: number;
  state: SimulationState;
  playing: boolean;
  speed: number;
};

const playbackStepMs = 50;
const speeds = new Set([0.25, 0.5, 1, 2, 4, 8]);

/** Reconstructs a historical engine view from periodic frames plus the typed event stream. */
export class IncidentReplayEngine {
  private listeners = new Set<() => void>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private cursorMs: number;
  private playing = false;
  private speed = 1;
  private snapshot: ReplaySnapshot;
  private lastWallTime = 0;
  private eventSequence: number | null = null;

  constructor(private readonly incident: IncidentRecord) {
    this.cursorMs = incident.simulationStartMs;
    this.eventSequence = this.sequenceAt(this.cursorMs);
    this.snapshot = this.createSnapshot();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ReplaySnapshot => this.snapshot;
  readonly getServerSnapshot = (): ReplaySnapshot => this.snapshot;

  play(): void {
    if (this.playing) return;
    if (this.cursorMs >= this.incident.simulationEndMs) {
      this.cursorMs = this.incident.simulationStartMs;
      this.eventSequence = this.sequenceAt(this.cursorMs);
    }
    this.playing = true;
    this.lastWallTime = Date.now();
    this.interval = setInterval(() => this.advance(), playbackStepMs);
    this.publish();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.publish();
  }

  restart(): void {
    this.pauseWithoutPublish();
    this.cursorMs = this.incident.simulationStartMs;
    this.eventSequence = this.sequenceAt(this.cursorMs);
    this.publish();
  }

  seek(cursorMs: number): void {
    this.cursorMs = clamp(cursorMs, this.incident.simulationStartMs, this.incident.simulationEndMs);
    this.eventSequence = this.sequenceAt(this.cursorMs);
    if (this.cursorMs >= this.incident.simulationEndMs) this.pauseWithoutPublish();
    this.publish();
  }

  setSpeed(speed: number): void {
    if (!speeds.has(speed))
      throw new RangeError("Replay speed must be one of 0.25×, 0.5×, 1×, 2×, 4×, or 8×.");
    this.speed = speed;
    this.publish();
  }

  nextEvent(): void {
    const next = this.incident.events.find(
      (event) =>
        event.atMs > this.cursorMs ||
        (event.atMs === this.cursorMs &&
          this.eventSequence !== null &&
          event.sequence > this.eventSequence),
    );
    if (next) {
      this.cursorMs = next.atMs;
      this.eventSequence = next.sequence;
      this.publish();
    }
  }

  previousEvent(): void {
    const previous = [...this.incident.events]
      .reverse()
      .find(
        (event) =>
          event.atMs < this.cursorMs ||
          (event.atMs === this.cursorMs &&
            this.eventSequence !== null &&
            event.sequence < this.eventSequence),
      );
    if (previous) {
      this.cursorMs = previous.atMs;
      this.eventSequence = previous.sequence;
      this.publish();
    } else this.seek(this.incident.simulationStartMs);
  }

  dispose(): void {
    this.pauseWithoutPublish();
    this.listeners.clear();
  }

  private advance(): void {
    const now = Date.now();
    const elapsed = Math.min(250, Math.max(0, now - this.lastWallTime));
    this.lastWallTime = now;
    this.cursorMs = Math.min(this.incident.simulationEndMs, this.cursorMs + elapsed * this.speed);
    this.eventSequence = this.sequenceAt(this.cursorMs);
    if (this.cursorMs >= this.incident.simulationEndMs) this.pauseWithoutPublish();
    this.publish();
  }

  private createSnapshot(): ReplaySnapshot {
    const frame = this.findFrame(this.cursorMs);
    const state = cloneFrame(frame);
    const applied = this.incident.events.filter((event) => event.atMs <= this.cursorMs);
    const afterFrame = applied.filter((event) => event.sequence > frame.eventSequence);
    for (const event of afterFrame) applyEvent(state, event);
    state.nowMs = this.cursorMs;
    state.events = applied.slice(-120);
    return { cursorMs: this.cursorMs, state, playing: this.playing, speed: this.speed };
  }

  private findFrame(atMs: number): IncidentReplayFrame {
    const frames = this.incident.replayFrames;
    if (!frames.length)
      throw new Error("Incident replay requires at least one recorded simulation frame.");
    let selected = frames[0]!;
    for (const frame of frames) {
      if (frame.nowMs > atMs) break;
      selected = frame;
    }
    return selected;
  }

  private sequenceAt(atMs: number): number | null {
    return (
      [...this.incident.events].reverse().find((event) => event.atMs <= atMs)?.sequence ?? null
    );
  }

  private publish(): void {
    this.snapshot = this.createSnapshot();
    for (const listener of this.listeners) listener();
  }

  private pauseWithoutPublish(): void {
    this.playing = false;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

function cloneFrame(frame: IncidentReplayFrame): SimulationState {
  return {
    ...frame,
    services: frame.services.map((service) => ({
      ...service,
      position: [...service.position] as [number, number, number],
      dependsOn: [...service.dependsOn],
    })),
    connections: frame.connections.map((connection) => ({ ...connection })),
    metrics: { ...frame.metrics },
    events: [],
  };
}

function applyEvent(state: SimulationState, event: SimulationEvent): void {
  switch (event.type) {
    case "service.health.changed": {
      const service = state.services.find((item) => item.id === event.serviceId);
      if (!service) break;
      service.health = event.to;
      if (event.to === "recovering")
        service.recoveryStep = Math.min(5, Math.max(1, service.recoveryStep + 1));
      if (event.to === "failed") service.recoveryStep = 0;
      break;
    }
    case "service.recovery.completed": {
      const service = state.services.find((item) => item.id === event.serviceId);
      if (service) {
        service.health = "healthy";
        service.recoveryStep = 6;
        service.errorRate = Math.min(service.errorRate, 0.1);
      }
      break;
    }
    case "traffic.rate.changed":
      state.trafficMultiplier = event.multiplier;
      state.metrics.requestsPerSecond = event.requestsPerSecond;
      break;
    case "simulation.started":
      state.status = "running";
      break;
    case "simulation.paused":
    case "simulation.reset":
      state.status = "paused";
      break;
    default:
      break;
  }
  state.version = Math.max(state.version, event.sequence);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
