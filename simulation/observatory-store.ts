import { defaultSimulationConfig } from "./observatory-scenario";
import { SimulationEngine } from "./simulation-engine";

/** Shared browser demo session; it has no timers until a client explicitly starts it. */
export const observatorySimulation = new SimulationEngine(defaultSimulationConfig);
