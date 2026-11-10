# Simulation engine

The engine under this directory is a deterministic TypeScript model. It has no React or Three.js dependency. The observatory UI reads immutable `SimulationState` snapshots through `useSyncExternalStore` in `hooks/use-observatory-simulation.ts`.

## Deterministic runs

`SimulationEngine` accepts a `SimulationConfig` containing a seed, service definitions, dependency routes, tick duration, and metric window. Use `advanceBy()` or `runTicks()` in tests and offline scenarios; these advance virtual time only and do not use wall-clock time.

```ts
const engine = new SimulationEngine({ ...defaultSimulationConfig, seed: 412 });
const state = engine.runTicks(600);
```

Two engines with the same seed, configuration, and virtual-time advances produce the same events and metrics. Route selection, latency jitter, and request failures all use the engine-owned `SeededRandom` instance.

## Runtime use

`start()` and `pause()` are a small wall-clock adapter for interactive browser sessions. The adapter advances the same virtual scheduler used by deterministic tests. React does not own timers, request generation, random state, service transitions, or metric calculations.

Subscribe to typed domain events with `engine.on("request.completed", handler)`. Subscribe to batched, immutable snapshots with `engine.subscribe()` and read them through `getSnapshot()`. Snapshots include service and connection metrics, aggregate throughput/error/latency, active and queued work, and bounded recent event history.

## Model flow

1. `SimulationClock` and `SimulationScheduler` advance stable virtual time and process due work in insertion order.
2. `TrafficGenerator` carries fractional request volume between fixed ticks and selects weighted scenario routes from the seeded random stream.
3. `DependencyGraph` validates the service DAG and expands each operation to its required dependencies.
4. `RequestRouter` runs each request through available services, samples latency and failures, and records the visited service and edge paths.
5. `ServiceRegistry` owns `ServiceNode` state: health, concurrency, queue backlog, and resource utilization.
6. `MetricsCollector` retains bounded rolling samples; `MetricsAggregator` derives throughput, latency, error rates, CPU, memory, and connection activity for snapshots.

The default scenario is defined in `observatory-scenario.ts`. Its services and capacities are configuration; displayed telemetry is generated from request execution and current node state.
