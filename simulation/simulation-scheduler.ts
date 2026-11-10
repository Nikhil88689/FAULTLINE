export type ScheduledTask<T> = {
  atMs: number;
  order: number;
  task: T;
};

/** Stable min-heap scheduler; equal-time tasks run in insertion order. */
export class SimulationScheduler<T> {
  private heap: ScheduledTask<T>[] = [];
  private nextOrder = 0;

  get size(): number {
    return this.heap.length;
  }

  schedule(atMs: number, task: T): number {
    if (!Number.isFinite(atMs) || atMs < 0) {
      throw new RangeError("Scheduled time must be a non-negative number.");
    }
    const entry = { atMs, order: this.nextOrder++, task };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
    return entry.order;
  }

  runUntil(targetMs: number, handler: (task: T, atMs: number) => void): number {
    if (!Number.isFinite(targetMs) || targetMs < 0) {
      throw new RangeError("Scheduler target must be a non-negative number.");
    }
    let executed = 0;
    while (this.heap[0] && this.heap[0].atMs <= targetMs) {
      const entry = this.pop()!;
      handler(entry.task, entry.atMs);
      executed += 1;
    }
    return executed;
  }

  clear(): void {
    this.heap = [];
    this.nextOrder = 0;
  }

  private compare(left: ScheduledTask<T>, right: ScheduledTask<T>): number {
    return left.atMs - right.atMs || left.order - right.order;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.heap[parent], this.heap[index]) <= 0) break;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  private pop(): ScheduledTask<T> | undefined {
    if (this.heap.length === 0) return undefined;
    const first = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return first;
  }

  private sinkDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.compare(this.heap[left], this.heap[smallest]) < 0) smallest = left;
      if (right < length && this.compare(this.heap[right], this.heap[smallest]) < 0)
        smallest = right;
      if (smallest === index) return;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}
