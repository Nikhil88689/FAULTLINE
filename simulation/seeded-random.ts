/** A small, reproducible PRNG. Its state is owned by one simulation instance. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  integer(minimum: number, maximum: number): number {
    return Math.floor(this.next() * (maximum - minimum + 1)) + minimum;
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error("Cannot choose from an empty collection.");
    return values[this.integer(0, values.length - 1)];
  }

  getSnapshot(): number {
    return this.state;
  }

  restore(state: number): void {
    this.state = state >>> 0;
  }
}
