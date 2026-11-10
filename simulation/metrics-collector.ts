import type { RequestTrace, ServiceMetricSample } from "@/types/simulation";

type RequestMetric = { atMs: number; latencyMs: number; success: boolean };

/** Collects completed request samples and exposes bounded-window telemetry. */
export class MetricsCollector {
  private readonly requests: RequestMetric[] = [];
  private readonly perService = new Map<string, ServiceMetricSample[]>();
  private readonly perConnection = new Map<string, RequestMetric[]>();
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;

  record(trace: RequestTrace, atMs: number): void {
    const success = trace.outcome === "success";
    this.requests.push({ atMs, latencyMs: trace.latencyMs, success });
    this.totalRequests += 1;
    if (success) this.successfulRequests += 1;
    else this.failedRequests += 1;

    for (const sample of trace.serviceSamples) {
      const samples = this.perService.get(sample.serviceId) ?? [];
      samples.push({ atMs, latencyMs: sample.latencyMs, success });
      this.perService.set(sample.serviceId, samples);
    }

    for (const sample of trace.connectionSamples) {
      const connectionId = sample.connectionId;
      const samples = this.perConnection.get(connectionId) ?? [];
      samples.push({ atMs, latencyMs: sample.latencyMs, success });
      this.perConnection.set(connectionId, samples);
    }
  }

  aggregate(nowMs: number, windowMs: number) {
    const cutoff = nowMs - windowMs;
    pruneBefore(this.requests, cutoff, (sample) => sample.atMs);
    for (const samples of this.perService.values()) {
      pruneBefore(samples, cutoff, (sample) => sample.atMs);
    }
    for (const samples of this.perConnection.values()) {
      pruneBefore(samples, cutoff, (sample) => sample.atMs);
    }

    const durationSeconds = Math.max(Math.min(nowMs, windowMs), 1) / 1000;
    const completedRequests = this.requests.length;
    const successfulInWindow = this.requests.reduce(
      (count, sample) => count + Number(sample.success),
      0,
    );
    const failedInWindow = completedRequests - successfulInWindow;
    const byService = new Map<
      string,
      {
        requestsPerSecond: number;
        averageLatencyMs: number;
        errorRate: number;
        completedRequests: number;
        failedRequests: number;
      }
    >();
    for (const [serviceId, samples] of this.perService) {
      const failed = samples.reduce((count, sample) => count + Number(!sample.success), 0);
      byService.set(serviceId, {
        requestsPerSecond: samples.length / durationSeconds,
        averageLatencyMs: mean(samples.map((sample) => sample.latencyMs)),
        errorRate: samples.length === 0 ? 0 : (failed / samples.length) * 100,
        completedRequests: samples.length,
        failedRequests: failed,
      });
    }
    const byConnection = new Map(
      [...this.perConnection].map(([connectionId, samples]) => {
        const failed = samples.reduce((count, sample) => count + Number(!sample.success), 0);
        return [
          connectionId,
          {
            throughput: samples.length / durationSeconds,
            averageLatencyMs: mean(samples.map((sample) => sample.latencyMs)),
            errorRate: samples.length === 0 ? 0 : (failed / samples.length) * 100,
          },
        ];
      }),
    );
    const averageLatencyMs = mean(this.requests.map((sample) => sample.latencyMs));

    return {
      requestsPerSecond: completedRequests / durationSeconds,
      successfulRequestsPerSecond: successfulInWindow / durationSeconds,
      failedRequestsPerSecond: failedInWindow / durationSeconds,
      averageLatencyMs,
      errorRate: completedRequests === 0 ? 0 : (failedInWindow / completedRequests) * 100,
      completedRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      byService,
      byConnection,
    };
  }

  reset(): void {
    this.requests.length = 0;
    this.perService.clear();
    this.perConnection.clear();
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
  }
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pruneBefore<T>(items: T[], cutoff: number, getTime: (item: T) => number): void {
  let expired = 0;
  while (expired < items.length && getTime(items[expired]) < cutoff) expired += 1;
  if (expired > 0) items.splice(0, expired);
}
