/** A virtual clock. It never reads wall time, so replayed runs stay deterministic. */
export class SimulationClock {
  private currentTimeMs = 0;

  get nowMs(): number {
    return this.currentTimeMs;
  }

  advanceTo(timeMs: number): void {
    if (!Number.isFinite(timeMs) || timeMs < this.currentTimeMs) {
      throw new RangeError("Simulation time must advance monotonically.");
    }
    this.currentTimeMs = timeMs;
  }

  advanceBy(durationMs: number): number {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError("Simulation duration must be a non-negative number.");
    }
    this.currentTimeMs += durationMs;
    return this.currentTimeMs;
  }

  reset(): void {
    this.currentTimeMs = 0;
  }
}
