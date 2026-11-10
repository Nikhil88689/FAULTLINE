import type { TrafficRoute } from "@/types/simulation";
import { SeededRandom } from "./seeded-random";

export class TrafficGenerator {
  private fractionalRequest = 0;

  constructor(
    private readonly routes: readonly TrafficRoute[],
    private readonly random: SeededRandom,
    private readonly baseRequestsPerSecond: number,
  ) {
    if (routes.length === 0) throw new Error("Traffic generator requires at least one route.");
    if (routes.some((route) => route.weight <= 0)) {
      throw new Error("Traffic route weights must be greater than zero.");
    }
  }

  generate(intervalMs: number, multiplier: number): TrafficRoute[] {
    if (intervalMs < 0 || !Number.isFinite(intervalMs)) {
      throw new RangeError("Traffic interval must be a non-negative number.");
    }
    const count = (this.baseRequestsPerSecond * multiplier * intervalMs) / 1000;
    this.fractionalRequest += count;
    const totalRequests = Math.floor(this.fractionalRequest);
    this.fractionalRequest -= totalRequests;
    return Array.from({ length: totalRequests }, () => this.chooseRoute());
  }

  reset(): void {
    this.fractionalRequest = 0;
  }

  private chooseRoute(): TrafficRoute {
    const totalWeight = this.routes.reduce((sum, route) => sum + route.weight, 0);
    let cursor = this.random.next() * totalWeight;
    for (const route of this.routes) {
      cursor -= route.weight;
      if (cursor < 0) return route;
    }
    return this.routes[this.routes.length - 1];
  }
}
