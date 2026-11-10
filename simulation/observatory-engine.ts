/** Public simulation surface retained for observatory code and external demos. */
export { SimulationEngine } from "./simulation-engine";
export {
  observatoryConnections,
  observatoryRoutes,
  observatoryServices,
  defaultSimulationConfig,
} from "./observatory-scenario";
export { SeededRandom } from "./seeded-random";
export { SimulationClock } from "./simulation-clock";
export { SimulationScheduler } from "./simulation-scheduler";
export { ServiceRegistry } from "./service-registry";
export { ServiceNode } from "./service-node";
export { DependencyGraph } from "./dependency-graph";
export { TrafficGenerator } from "./traffic-generator";
export { RequestRouter } from "./request-router";
export { MetricsCollector } from "./metrics-collector";
export { MetricsAggregator } from "./metrics-aggregator";
